import * as path from "path";
import { commands, Range, Uri } from "vscode";
import { CaptureSnippetRequest } from "../../../common/src/backend/interfaces";
import {
  ApplyPatchEvent,
  LineContent,
  LineRange,
  SnippetSelectedEvent,
} from "../../../common/src/events/events";
import {
  EXPLICIT_GIT_HOSTS,
  GitHosts,
  guessRepoName,
  parseGitHost,
  parseGitRemote,
} from "../../../common/src/model/git";
import {
  NotebookAccess,
  NotebookContent,
  PatchLine,
  UNKNOWN_CLIENT_ID,
  UserID,
} from "../../../common/src/model/notebook-dom";
import { NotebookData } from "../../../common/src/persistence/NotebookData";
import { TrackerEvent } from "../../../common/src/tracking/events";
import { IEventTracker } from "../../../common/src/tracking/interface";
import { splitLines } from "../../../common/src/util/text";
import { IGitExtension } from "../commands/interface";
import { ILogger, SharedCommandServices } from "../commands/services";
import { CodeReferences } from "../references/codeReferences";
import { DeviceStorageService, RestartAction } from "../store";
import { OpenOptions, ProgressTask } from "../ui";
import { execShell } from "../util/cmd";
import { AuthManager } from "../vscode/auth";
import { HIGHLIGHT_DURATION_MILLIS } from "../vscode/presenter";
import { DifferentBranchProcess, IDifferentBranchUI } from "./differentBranch";

export type RepoRootPathResult =
  | { type: "success"; path: string }
  | { type: "clone" }
  | { type: "cancelled" }
  | { type: "continued-in-new-window" }
  | { type: "error"; message: string }
  | { type: "clone-error"; message: string };

const CLONE_REPO_OPTION = "Clone To Folder";
const LOCATE_REPO_OPTION = "Locate Repo";
type MissingActionResponseTypes = typeof CLONE_REPO_OPTION | typeof LOCATE_REPO_OPTION;

export interface CoPilotUI extends IDifferentBranchUI {
  showMessage(message: string, ...actions: string[]): Promise<string | undefined>;
  showModalMessage(message: string, ...actions: string[]): Promise<string | undefined>;
  showError(
    code:
      | "directory-not-a-repo"
      | "find-local-repo-aborted"
      | "git-clone-error"
      | "error-unspecified"
      | "remote-branch-not-found"
      | "file-not-found"
      | "range-not-found",
    message?: string
  ): Promise<any>;
  chooseRepoRootPath(title?: string, openLabel?: string): Promise<string | undefined>;
  chooseHostType(fetchURL: string, possibleHostTypes: GitHosts[]): Promise<GitHosts | undefined>;
  showTaskProgress(message: string, task: ProgressTask): Promise<any>;
  showOpenFolderPrompt(repoName?: string): Promise<OpenOptions>;
  showUpgradePrompt(): Promise<boolean>;
}

export class CoPilot {
  constructor(
    private readonly presenter: CodePresenter,
    private readonly locator: CodeLocator,
    private readonly ui: CoPilotUI,
    private readonly fileSystem: FileSystemHelper,
    private readonly codeRefs: CodeReferences,
    private readonly services: SharedCommandServices
  ) {}

  private get auth(): AuthManager { return this.services.auth; } // prettier-ignore
  private get deviceStorage(): DeviceStorageService { return this.services.deviceStorage; } // prettier-ignore
  private get git(): IGitExtension { return this.services.git; } // prettier-ignore
  private get notebookData(): NotebookData { return this.services.notebookData; } // prettier-ignore
  private get eventTracker(): IEventTracker { return this.services.mixpanel; } // prettier-ignore
  private get logger(): ILogger { return this.services.logger; } // prettier-ignore

  // ensure ensures the notebook:
  // - Exists in local storage
  // - Exists in the database
  // - Is monitored for events and content changes
  public async ensure(content: NotebookContent, access: NotebookAccess, userID: UserID) {
    // Ensure the notebook exists in the DB
    await this.notebookData.ensureNotebook(content, access, userID);
  }

  public async handleCapture(request: CaptureSnippetRequest) {
    const notebook = this.deviceStorage.getNotebookHeader(request.notebookID);
    if (!notebook) {
      console.error(`could not find notebook ${request.notebookID} in local storage`);
      return;
    }

    const { fetchURL, filepath, lineRange } = request.source;
    if (!fetchURL || !filepath || !lineRange) {
      return;
    }

    const range = new Range(lineRange.from, 0, lineRange.to, 0);

    const localRepoPath = this.deviceStorage.getRepoRootPath(fetchURL);
    let absoluteFilepath;
    if (!localRepoPath) {
      absoluteFilepath = await this.getAbsoluteFilePathAndMaybeShowError(
        { action: "capture", request },
        fetchURL,
        filepath
      );
      if (!absoluteFilepath) {
        return;
      }
    } else {
      absoluteFilepath = path.join(localRepoPath, filepath);
    }

    // Set the capture straight away for nice UX
    this.codeRefs.setReferencedCodeSnippet({
      notebookID: notebook.id,
      notebookName: notebook.name,
      range: range,
      filepath: Uri.file(absoluteFilepath),
      fetchURL,
    });

    this.services.emitter.emit("snippet-captured");

    // Set the data again when we get it from DB.
    // delay to wait for the event to write to DB before we try to read.
    // This is awful. Remove ASAP.
    setTimeout(async () => {
      await this.codeRefs.setReferencesFromNotebooks(notebook);
      this.services.emitter.emit("snippet-captured");
    }, 3000);
  }

  public async handleSnippetSelectedEvent(event: SnippetSelectedEvent) {
    const { fetchURL, filepath } = event.source;
    const absoluteFilepath = await this.getAbsoluteFilePathAndMaybeShowError(
      { action: "select", event },
      fetchURL,
      filepath
    );
    if (!absoluteFilepath) {
      return;
    }

    const localRepo = await this.git.getLocalRepoFor(Uri.file(absoluteFilepath));
    if (localRepo) {
      const originalRef = event.source?.localBranch;
      const currentRef = localRepo.currentRefName ?? localRepo.currentCommitSha;
      if (currentRef && originalRef && currentRef !== originalRef) {
        const diff = new DifferentBranchProcess(
          this.git,
          this.ui,
          localRepo,
          originalRef,
          currentRef
        );
        const handled = await diff.handle();
        if (!handled) {
          return;
        }
      }
    } else {
      // file exists in the right place, but that place is not (no longer?) a Git repo
      this.ui.showError("file-not-found");
    }

    const { result, lineRange } = await this.validateLineRange(absoluteFilepath, event);
    switch (result) {
      case "file-not-found":
        this.ui.showError("file-not-found");
        break;

      case "range-not-found":
        this.ui.showError("range-not-found"); // intentional fall-through

      case "file-only-found":
      case "found-relocated":
      case "found":
        return this.presenter.highlightLinesInEditor(
          absoluteFilepath,
          lineRange,
          HIGHLIGHT_DURATION_MILLIS,
          fetchURL
        );

      default:
        throw new Error(`Unknown validateLineRange result: "${result}"`);
    }
  }

  public async getAbsoluteFilePathAndMaybeShowError(
    action: RestartAction,
    fetchURL: string,
    relativeFilepath: string
  ): Promise<string | undefined> {
    const rootPath = await this.obtainRepoRootPath(action, fetchURL);

    if (rootPath.type !== "success") {
      switch (rootPath.type) {
        case "cancelled":
          return await this.ui.showError("find-local-repo-aborted");
        case "error":
          return await this.ui.showError("error-unspecified");
        case "clone-error":
          return await this.ui.showError("git-clone-error", rootPath.message);
        case "continued-in-new-window":
        // fallthrough
        default:
          return undefined;
      }
    }

    return path.join(rootPath.path, relativeFilepath);
  }

  public async validateLineRange(
    absoluteFilepath: string,
    event: SnippetSelectedEvent | ApplyPatchEvent
  ): Promise<{ result: LocateLineRangeResultTypes; lineRange?: LineRange }> {
    const { lineContent, lineRange } = parseLineContentAndRange(event);
    const location = await this.locator.locateLineRange(absoluteFilepath, lineRange, lineContent);

    let range: LineRange | undefined;
    switch (location.type) {
      case "file-only-found":
      case "range-not-found":
      case "file-not-found":
        return { result: location.type };

      case "found-relocated":
        if (event.type === "snippet-selected") {
          this.publishRelocationEvent(event, location);
        }
        range = location.newLineRange;
        break;

      case "found":
      default:
        range = lineRange;
    }

    if (event.type === "apply-patch") {
      if (!this.doesSnippetMatch(event.originalText, location.newSnippet)) {
        return { result: "range-not-found" };
      }
    }

    return { result: location.type, lineRange: range };
  }

  doesSnippetMatch(originalText: string, newSnippet: string) {
    const originalLines = splitLines(originalText);
    const newLines = splitLines(newSnippet);

    if (originalLines.length !== newLines.length) {
      return false;
    }

    for (let i = 0; i < originalLines.length; i++) {
      const originalLineTrimmed = originalLines[i].trim();
      const newLineTrimmed = newLines[i].trim();
      if (originalLineTrimmed !== newLineTrimmed) {
        return false;
      }
    }

    return true;
  }

  private publishRelocationEvent(
    event: { nodeID: string; notebookID: string },
    location: LocateLineRelocatedResult
  ) {
    const clientID = this.deviceStorage.getClientID();
    const userID = this.auth.userID;

    if (userID) {
      this.services.backendAPI.relocateSnippet({
        notebookID: event.notebookID,
        clientID: clientID ?? UNKNOWN_CLIENT_ID,
        userID: userID,
        nodeID: event.nodeID,
        lineRange: location.newLineRange,
        snippet: location.newSnippet,
      });
    }
  }

  async obtainRepoRootPath(action: RestartAction, fetchURL: string): Promise<RepoRootPathResult> {
    // check for a cached repo root
    const repoPath = this.deviceStorage.getRepoRootPath(fetchURL);
    if (repoPath) {
      if (await this.isValidGitRepo(repoPath)) {
        await this.git.addRepo(Uri.file(repoPath));
        return { type: "success", path: repoPath };
      }
    }

    // when missing: show UI to locate or clone
    const response = await this.chooseMissingAction(fetchURL);

    switch (response) {
      case CLONE_REPO_OPTION:
        this.eventTracker.track(
          new TrackerEvent("clone-repo", "ide", "ide-ui", "mouse", {
            clientID: null,
            userID: this.auth.userID ?? "unknown",
            notebookID: null,
          }),
          {
            repo: fetchURL,
          }
        );

        let repoPath = undefined;
        try {
          repoPath = await this.clone(fetchURL);
        } catch (e: any) {
          return { type: "clone-error", message: e.message };
        }

        if (repoPath) {
          const localRepo = await this.git.addRepo(Uri.file(repoPath));
          if (!localRepo) {
            this.logger.error(`obtainRepoRootPath failed to locate local repo at: ${repoPath}`);
            return { type: "error", message: "failed to locate local repository" };
          }

          const openOption = await this.maybeStoreRequestAndChangeFolder(action, repoPath);
          if (openOption === "new-window") {
            return { type: "continued-in-new-window" };
          }

          return { type: "success", path: repoPath };
        } // intentional fall-through

      case LOCATE_REPO_OPTION:
        const locatedPath = await this.locate(fetchURL);
        if (locatedPath) {
          return { type: "success", path: locatedPath };
        } // intentional fall-through

      case undefined:
      default:
        break;
    }

    return { type: "cancelled" };
  }

  private async maybeStoreRequestAndChangeFolder(
    action: RestartAction,
    repoPath: string,
    repoName?: string
  ): Promise<OpenOptions> {
    const openOption = await this.ui.showOpenFolderPrompt(repoName);
    if (openOption !== "cancelled") {
      const uri = Uri.file(repoPath);
      this.deviceStorage.pushRestartAction(action);
      await commands.executeCommand("vscode.openFolder", uri, {
        forceNewWindow: openOption === "new-window",
      });
    }

    return openOption;
  }

  private async isValidGitRepo(path: string) {
    if (await this.fileSystem.exists(path)) {
      if (await this.fileSystem.isGitRepoRoot(path)) {
        return true;
      }
    }

    return false;
  }

  private async locate(fetchURL: string): Promise<string | undefined> {
    const chosenPath = await this.ui.chooseRepoRootPath();
    if (!chosenPath) {
      return;
    }

    const isValidDir = await this.fileSystem.isGitRepoRoot(chosenPath);
    if (!isValidDir) {
      return;
    }

    await this.deviceStorage.trackRepoRootPath(fetchURL, chosenPath);
    return chosenPath;
  }

  private async clone(fetchURL: string): Promise<string | undefined> {
    const cloneIntoPath = await this.ui.chooseRepoRootPath();
    if (!cloneIntoPath) {
      return;
    }

    await this.cloneRepo(this.ui, fetchURL, cloneIntoPath);

    // XXX Git chooses a folder name that matches the fetch URL, but may
    // tack a -<number> on the end. We don't currently have any way to address this.
    const repoName = guessRepoName(fetchURL);
    const repoPath = path.join(cloneIntoPath, repoName);
    this.deviceStorage.trackRepoRootPath(fetchURL, repoPath);

    return repoPath;
  }

  async chooseMissingAction(fetchURL: string): Promise<MissingActionResponseTypes | undefined> {
    return (await this.ui.showModalMessage(
      `CodeLingo could not find a local copy of ${fetchURL}. Please locate it in your filesystem (or clone)`,
      CLONE_REPO_OPTION,
      LOCATE_REPO_OPTION
    )) as MissingActionResponseTypes | undefined;
  }

  private async cloneRepo(ui: CoPilotUI, fetchURL: string, parentPath: string): Promise<void> {
    await ui.showTaskProgress("Cloning repository...", () =>
      execShell(`git clone ${fetchURL}`, parentPath)
    );
  }

  async chooseExplicitHostType(fetchURL: string): Promise<GitHosts | undefined> {
    if (parseGitRemote(fetchURL) !== undefined) {
      // host can be inferred from fetchURL
      return;
    }

    const server = parseGitHost(fetchURL, "server");
    if (!server) {
      // this shouldn't happen, in theory, except for file:// or ftp:// based remotes (but who uses those?)
      return "unknown";
    }

    const cachedHostType: GitHosts | undefined =
      this.services.deviceStorage.getHostTypeForServer(server);
    if (cachedHostType) return cachedHostType;

    const possibleHostTypes: GitHosts[] = EXPLICIT_GIT_HOSTS.filter((host) => {
      return host === "unknown" || parseGitRemote(fetchURL, host) !== undefined;
    });

    if (possibleHostTypes.length === 1) {
      return possibleHostTypes[0];
    }

    const chosenHostType = await this.ui.chooseHostType(server, possibleHostTypes);
    if (chosenHostType) {
      await this.services.deviceStorage.setHostTypeForServer(server, chosenHostType);
    }
    return chosenHostType;
  }
}

export type LocateLineRelocatedResult = {
  type: "found-relocated";
  newLineRange: LineRange;
  newSnippet: string;
};

export type LocateLineFoundResult = {
  type: "found";
  newLineRange: LineRange;
  newSnippet: string;
};

export type LocateLineRangeResult =
  | { type: "range-not-found" }
  | { type: "file-only-found" } // i.e. no range included in the snippet (a "path" node)
  | { type: "file-not-found" }
  | LocateLineFoundResult
  | LocateLineRelocatedResult;

type LocateLineRangeResultTypes = LocateLineRangeResult["type"];

export interface CodePresenter {
  highlightLinesInEditor(
    absoluteFilepath: string,
    lineRange: LineRange | undefined,
    durationMillis: number,
    fetchURL: string
  ): Promise<any>;
  replaceRange(
    absoluteFilepath: string,
    lineRange: LineRange,
    updatedText: string,
    patchLines: PatchLine[],
    fetchURL: string
  ): Promise<any>;
}

export interface CodeLocator {
  locateLineRange(
    absoluteFilepath: string,
    lineRange?: LineRange,
    lineContent?: LineContent
  ): Promise<LocateLineRangeResult>;
}

export interface DocumentReader {
  lineCount: number;
  lineAt(lineIndex: number /* 0-based */): string | undefined;
  getSnippet(newLineRange: LineRange): string;
}

export interface DocumentEditor {
  replaceLineRange(range: DocumentLineRange, updatedText: string): Promise<any>;
  scrollRangesIntoViewWithHighlight(
    range: DocumentLineRange,
    highlightLineIndexes?: number[]
  ): { dispose: () => any };
}

export interface DocumentLineRange {
  toIndex: number; // 0-based
  fromIndex: number; // 0-based
}

export interface DocumentManager {
  open(filepath: string): Promise<DocumentReader | undefined>;
  show(filepath: string): Promise<DocumentEditor>;
  getActiveEditor(): Promise<DocumentEditor | undefined>;
  isActive(filepath: string): Promise<boolean>;
}

export interface FileSystemHelper {
  isGitRepoRoot(filepath: string): Promise<boolean>;
  exists(filepath: string): Promise<boolean>;
}

function parseLineContentAndRange(event: SnippetSelectedEvent | ApplyPatchEvent): {
  lineContent: LineContent | undefined;
  lineRange: LineRange | undefined;
} {
  switch (event.type) {
    case "snippet-selected":
      return { lineContent: event.lineContent, lineRange: event.source.lineRange };

    case "apply-patch":
      const lines = splitLines(event.originalText);
      const lineContent: LineContent = {
        first: lines[0],
        last: lines[lines.length - 1],
      };
      return { lineContent, lineRange: event.target.lineRange };
  }
}
