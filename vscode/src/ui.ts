import { generate as generateID } from "shortid";
import { commands, env, ProgressLocation, QuickPickItem, Uri, window, workspace } from "vscode";
import { Environment } from "../../common/src/env/env";
import { LineRange } from "../../common/src/events/events";
import { defaultScope } from "../../common/src/model/auth";
import { GitHosts, parseGitRemote } from "../../common/src/model/git";
import {
  ClientID,
  NodeID,
  NotebookContent,
  NotebookHeader,
  UNKNOWN_USER_ID,
  UserID,
} from "../../common/src/model/notebook-dom";
import { TrackerEvent } from "../../common/src/tracking/events";
import { IEventTracker } from "../../common/src/tracking/interface";
import { createNodeMetadata, Origins } from "../../common/src/util/metadata";
import { AddToNotebookUI } from "./commands/addToNotebook";
import { ApplyPatchUI } from "./commands/applyPatch";
import { CaptureDiffUI } from "./commands/captureDiff";
import { CompleteSetupUI, createTempUserID } from "./commands/completeSetup";
import { DebugToolsUI } from "./commands/debugTools";
import { InferFileContextResult, InferRepoContextResult } from "./commands/infer";
import { CaptureInput, RemoteRepo } from "./commands/interface";
import { OpenNotebookUI } from "./commands/openNotebook";
import { OpenNotebooksHomeUI } from "./commands/openNotebooksHome";
import { SharedCommandServices } from "./commands/services";
import { CaptureTypes } from "./commands/shared";
import { ShareSnippetUI } from "./commands/shareSnippet";
import { CoPilotUI } from "./copilot/copilot";
import { IVersionChecker } from "./realtime/versionMonitor";
import { DeviceStorageService } from "./store";
import { Repository } from "./vscode/@types/git";
import { AuthManager } from "./vscode/auth";
import { INotebookReader, NotebookChooser } from "./vscode/chooser";
import { VSCodePresenterUI } from "./vscode/presenter";
import { StatusBarManager } from "./vscode/status";
import { WindowManagerUI } from "./vscode/window";
export type ProgressTask = () => Promise<any>;
export interface RemoteRepoQuickPickItem extends QuickPickItem {
  repo: RemoteRepo;
}

export interface LocalRepoQuickPickItem extends QuickPickItem {
  repo: Repository;
}

export interface HostTypeQuickPickItem extends QuickPickItem {
  hostType: GitHosts;
}

export interface NotebookQuickPickItem extends QuickPickItem {
  notebook: NotebookContent | undefined;
}

export type Severity = "warn" | "error" | "info";
export type OpenOptions = "existing-window" | "new-window" | "cancelled";
export type MissingBranchOptions = "fetch" | "stay" | "cancelled";
type MessageFn = (message: string, ...items: string[]) => Thenable<string | undefined>;

// prettier-ignore
const ERRORS: { [key: string]: { message: string; severity: Severity, command?: {type: string, label: string} } } = {
  "no-repo-detected": { message: "CodeLingo could not detect which Git repo this file belongs to.", severity: "error" },
  "no-active-repos-detected": { message: "CodeLingo could not detect any currently open git repo(s).", severity: "error" },
  "no-remotes-detected": { message: "CodeLingo could not find any remotes for this Git repo.", severity: "error" },
  "repo-not-found": { message: "CodeLingo was unable to find your repo. Please make sure the CodeLingo GitHub app is installed on the repo.", severity: "error" },
  "error-unspecified": { message: "CodeLingo capture hit an error.", severity: "error" },
  "git-disabled": { message: "CodeLingo requires Git to be enabled. Please re-enable Git \u2014 set `git.enabled` to true and reload.", severity: "error" },
  "git-not-found": { message: "CodeLingo was unable to find Git. Please make sure Git is installed. Also ensure that Git is in the PATH.", severity: "error" },
  "range-not-found": { message: "That snippet could not be located, but here's the file 👀", severity: "warn" },
  "file-not-found": { message: "Sorry! That file could not be located 😢", severity: "error" },
  "file-not-in-git-repo": { message: "That file was found, but it is not part of a Git repo 🤔", severity: "error" },
  "directory-not-a-repo": { message: "Directory must be a git repository", severity: "error" },
  "find-local-repo-aborted": { message: "Some CodeLingo features will not work without a known repo location", severity: "error" },
  "git-clone-error": { message: "Error cloning repo", severity: "error" },
  "remote-branch-not-found": { message: "Failed to find remote branch. Attempting to open file on current branch.", severity: "error" },
  "directory-not-supported": { message:"Sorry! This command is not supported for directories 😢", severity: "warn" },
  "patch-applied": { message:"✔ Successfully applied patch", severity: "info" },
  "patch-not-applied": { message:"Patch could not be applied. The file no longer matches.", severity: "warn" },
  "no-diff-detected": { message:"Failed to create diff of local changes", severity: "warn" },
  "server-error": { message:"CodeLingo hit a server error. Please try again", severity: "error" },
  "already-in-team": { message:"You are already in a team", severity: "info" },
  "not-logged-in": { message:"You must be logged in to use this command", severity: "error", command: {type: "codelingo.logIn", label: "Log In"} },
}

type LastNote = { readonly contextHash: string; readonly note: string };

export interface IWindowManager {
  focus(windowPattern: string | undefined): Promise<void>;
}

export class VSCodeUI
  implements
    AddToNotebookUI,
    ShareSnippetUI,
    OpenNotebookUI,
    VSCodePresenterUI,
    CoPilotUI,
    WindowManagerUI,
    DebugToolsUI,
    CompleteSetupUI,
    OpenNotebooksHomeUI,
    ApplyPatchUI,
    CaptureDiffUI
{
  private lastNote: LastNote = { contextHash: "", note: "" };

  constructor(
    private readonly env: Environment,
    private readonly windowManager: IWindowManager,
    private readonly notebookReader: INotebookReader,
    private readonly statusBar: StatusBarManager,
    private readonly services: SharedCommandServices
  ) {}

  private get versionChecker(): IVersionChecker { return this.services.versionChecker; } // prettier-ignore
  private get deviceStorage(): DeviceStorageService { return this.services.deviceStorage; } // prettier-ignore
  private get mixpanel(): IEventTracker { return this.services.mixpanel; } // prettier-ignore
  private get auth(): AuthManager { return this.services.auth; } // prettier-ignore

  async showUpgradePrompt(): Promise<boolean> {
    const minimumVersion = this.versionChecker.minimumVersion;
    const installedVersion = this.deviceStorage.getInstalledVersion() ?? "0.0.0";
    const checkCommand = "Check for Updates";
    const response = await window.showWarningMessage(
      `Your version of CodeLingo Notebooks (${installedVersion}) is below the minimum required version (${minimumVersion}).\n\nYou will need to upgrade to continue using Notebooks`,
      { modal: true },
      checkCommand
    );
    if (response === checkCommand) {
      await commands.executeCommand("workbench.extensions.action.checkForUpdates");
      return true;
    }
    return true;
  }

  async showGettingStartedPrompt(): Promise<boolean> {
    const COMPLETE_SETUP = "Complete Setup";
    const clientID = this.deviceStorage.getClientID() ?? null;
    if (!clientID) {
      const errorMsg = "showGettingStartedPrompt: clientID is not set";

      this.mixpanel.track(
        new TrackerEvent("error", "ide", "ide-ui", null, {
          clientID,
          userID: this.auth.userID ?? UNKNOWN_USER_ID,
          notebookID: null,
        }),
        {
          error: errorMsg,
        }
      );
      console.error(errorMsg);
      return false;
    }

    const didAgree = await window.showInformationMessage(
      "Get started with CodeLingo Notebooks!",
      { modal: true },
      COMPLETE_SETUP
    );

    let usingTempID = false;
    let userID = this.auth.userID ?? this.deviceStorage.getAnonymousUserID();
    if (!userID) {
      userID = createTempUserID();
      usingTempID = true;
    }

    // First time using the extension (or storage cleared).
    if (didAgree !== COMPLETE_SETUP) {
      // User aborted setup steps
      this.mixpanel.track(
        new TrackerEvent("abort", "ide", "ide-ui", null, {
          clientID,
          userID,
          notebookID: null,
        }),
        {
          message: "user aborted IDE getting started when prompted with information message",
        }
      );
      this.statusBar.showCompleteSetupItem();
      return false;
    }

    return this.completeSetup(clientID, usingTempID ? userID : undefined);
  }

  async completeSetup(clientID: ClientID, tempUserID?: UserID): Promise<boolean> {
    const didOpenInitLink = await this.tryOpenInitLink(clientID, tempUserID);
    if (!didOpenInitLink) {
      this.mixpanel.track(
        new TrackerEvent("abort", "ide", "ide-ui", null, {
          clientID,
          userID: this.auth.userID ?? tempUserID ?? UNKNOWN_USER_ID,
          notebookID: null,
        }),
        {
          message: "user aborted when presented with getting started external host link",
        }
      );
      this.statusBar.showCompleteSetupItem();
      return false;
    }

    this.deviceStorage.setHasCompletedSetup(true);
    this.statusBar.hideCompleteSetupItem();
    return true;
  }

  async showLinkWithMessage(url: string, message: string, cta: string) {
    const response = await window.showInformationMessage(message, cta);
    if (response === cta) {
      this.openURL(url);
    }
  }

  async showTaskProgress(message: string, task: ProgressTask): Promise<void> {
    return window.withProgress(
      { title: message, location: ProgressLocation.Notification, cancellable: false },
      async (_progress, _token): Promise<any> => {
        return task();
      }
    );
  }

  async showOpenFolderPrompt(repoName?: string): Promise<OpenOptions> {
    const OPEN = "Open";
    const OPEN_NEW_WINDOW = "Open in New Window";
    const response = await window.showInformationMessage(
      `Would you like to open ${repoName ?? "the cloned repository"}?`,
      OPEN,
      OPEN_NEW_WINDOW
    );

    switch (response) {
      case OPEN:
        return "existing-window";
      case OPEN_NEW_WINDOW:
        return "new-window";
      default:
        return "cancelled";
    }
  }

  async showLogInPrompt(): Promise<boolean> {
    const LOG_IN = "Log In";
    const clientID = this.deviceStorage.getClientID() ?? null;
    if (!clientID) {
      const errorMsg = "showLogInPrompt: clientID is not set";

      this.mixpanel.track(
        new TrackerEvent("error", "ide", "ide-ui", null, {
          clientID,
          userID: this.auth.userID ?? UNKNOWN_USER_ID,
          notebookID: null,
        }),
        {
          error: errorMsg,
        }
      );
      console.error(errorMsg);
      return false;
    }

    const didAgree = await window.showInformationMessage("Log in to CodeLingo Notebooks", LOG_IN);

    if (didAgree !== LOG_IN) {
      return false;
    }

    const didOpenLink = await this.tryOpenForcedLoginLink(clientID);
    if (!didOpenLink) {
      return false;
    }

    return true;
  }

  async loginConfirmation() {
    const response = await window.showInformationMessage(
      "Please log in with GitHub and run the command again",
      "Login"
    );
    return response === "Login";
  }

  async chooseRemoteRepo(remotes: readonly RemoteRepo[]): Promise<RemoteRepo | undefined> {
    const toRepoQuickPickItem = (remote: RemoteRepo): RemoteRepoQuickPickItem => {
      const repo = parseGitRemote(remote.fetchUrl);
      if (!repo) {
        return {
          label: remote.fetchUrl,
          repo: remote,
        };
      }

      return {
        label: `${repo.owner}/${repo.repo}`,
        repo: remote,
      };
    };

    if (remotes) {
      if (remotes.length === 1) {
        return remotes[0];
      } else if (remotes.length > 1) {
        const item = await window.showQuickPick(remotes.map(toRepoQuickPickItem), {
          canPickMany: false,
        });
        return item?.repo;
      }
    }

    return undefined;
  }

  async chooseLocalRepo(repos: readonly Repository[]): Promise<Repository | undefined> {
    if (repos.length === 1) {
      return repos[0];
    }

    const toRepoQuickPickItem = (repo: Repository): LocalRepoQuickPickItem => {
      return {
        label: repo.rootUri.toString(),
        repo: repo,
      };
    };

    const item = await window.showQuickPick(repos.map(toRepoQuickPickItem), {
      canPickMany: false,
    });
    return item?.repo;
  }

  async chooseHostType(
    server: string,
    possibleHostTypes: GitHosts[]
  ): Promise<GitHosts | undefined> {
    const choice = await window.showQuickPick(["No", "Yes"], {
      title: "Unrecognised Git Remote",
      placeHolder: `Is this a BitBucket Server (self-hosted): "${server}"?`,
    });
    return choice === "Yes" ? "bitbucket-server" : "unknown";

    // Original implementation (use this if we ever add more than one option...)
    // ------------
    // const toHostQuickPickItem = (hostType: GitHosts): HostTypeQuickPickItem => {
    //   return {
    //     hostType,
    //     label: describeGitHost(hostType),
    //   };
    // };
    // const choice = await window.showQuickPick(possibleHostTypes.map(toHostQuickPickItem), {
    //   placeHolder: `What type of Git server is "${server}"?`,
    // });
    // return choice?.hostType;
  }

  async chooseMultipleNotebooks(
    notebooks: readonly NotebookHeader[],
    verb: string
  ): Promise<NotebookHeader[]> {
    const chooser = new NotebookChooser(
      notebooks,
      this.env,
      this.notebookReader,
      this.deviceStorage,
      true,
      verb
    );
    const result = await chooser.show();
    if (result?.type !== "multiple") {
      return [];
    }

    return result.headers ?? [];
  }

  async chooseNotebook(
    notebooks: readonly NotebookHeader[],
    origin: Origins,
    verb: string
  ): Promise<[NotebookHeader, boolean] | undefined> {
    if (!notebooks || notebooks.length == 0) {
      const header = await this.createTemporaryNotebookHeader(origin);
      return header && [header, true];
    }

    const chooser = new NotebookChooser(
      notebooks,
      this.env,
      this.notebookReader,
      this.deviceStorage,
      false,
      verb
    );
    const choice = await chooser.show();

    if (!choice) {
      return;
    }

    if (choice.type === "new") {
      // User chose to create new notebook
      const createResult = await this.createTemporaryNotebookHeader(origin, choice.name);
      if (!createResult) {
        // go back a step by recursion
        return this.chooseNotebook(notebooks, origin, verb);
      }
      return createResult && [createResult, true];
    }

    if (choice.type === "multiple") {
      // should never get here
      return undefined;
    }

    return choice.header && [choice.header, false];
  }

  async createTemporaryNotebookHeader(
    origin: Origins,
    initialName?: string
  ): Promise<NotebookHeader | undefined> {
    const name = await window.showInputBox({
      placeHolder: "Name",
      prompt: "Confirm name for new notebook",
      value: initialName,
      validateInput: (value) => (value.trim() === "" ? "Notebook name is required" : ""),
    });

    if (!name) {
      return undefined;
    }

    const userID = this.auth.userID ?? UNKNOWN_USER_ID;
    return {
      id: generateID(),
      ownerUserID: userID,
      teamID: null,
      name: this.decorateName(name),
      metadata: createNodeMetadata(userID, origin),
      scope: defaultScope(userID),
    };
  }

  private decorateName(name: string): string {
    if (this.env.getMode() === "development") {
      return `${name} [DEV]`;
    }

    return name;
  }

  async showNotebookLink(
    notebook: { id: NodeID; name: string },
    clientID: ClientID,
    options?: { message?: string; cta?: string; forSharing?: boolean }
  ): Promise<void> {
    const defaultMessage = () => `Snippet copied to Notebook \u2018${notebook.name}\u2019`;

    // copy to clipboard?
    if (options?.forSharing) {
      const shareURL = this.makeURL(`/n/${notebook.id}`, clientID, undefined, { forSharing: true });
      env.clipboard.writeText(shareURL);
    }

    const ctaText = options?.cta ?? "View Notebook";
    const response = await window.showInformationMessage(
      options?.message ?? defaultMessage(),
      ctaText
    );

    if (response === ctaText) {
      this.mixpanel.track(
        new TrackerEvent("open-nb", "ide", "ide-ui", null, {
          clientID,
          userID: this.auth.userID ?? UNKNOWN_USER_ID,
          notebookID: notebook.id,
        }),
        {
          message: "showNotebookLink",
        }
      );
      this.openNotebookURL(notebook.id, clientID, { forSharing: options?.forSharing ?? false });
    }
  }

  private async tryOpenInitLink(clientID: ClientID, tempUserID?: string): Promise<boolean> {
    const url = this.makeURL("/init/vscode", clientID, tempUserID);
    return this.openURL(url);
  }

  private async tryOpenForcedLoginLink(clientID: ClientID): Promise<boolean> {
    const url = this.makeURL("/log-in/force", clientID);
    return this.openURL(url);
  }

  async openLoginURL(clientID: ClientID): Promise<boolean> {
    const url = this.makeURL("/log-in/force", clientID);
    return this.openURL(url);
  }

  async openNotebookURL(
    notebookID: NodeID,
    clientID: ClientID,
    options?: { forSharing: boolean }
  ): Promise<boolean> {
    const url = this.makeURL(`/n/${notebookID}`, clientID, undefined, options);
    return this.openURL(url);
  }

  async openNotebooksHomeURL(clientID: ClientID): Promise<boolean> {
    const url = this.makeURL("/n", clientID);
    return this.openURL(url);
  }

  async openURL(url: string): Promise<boolean> {
    return env.openExternal(Uri.parse(url));
  }

  public makeURL(
    path: string,
    clientID: ClientID | undefined,
    tempUserID?: UserID,
    options?: { forSharing: boolean }
  ): string {
    const { WEB_HOST } = this.env.getEnvironmentVariables();
    let url = `${WEB_HOST}${path}`;
    if (options?.forSharing) {
      url = `${url}?action=open`;
    } else if (clientID && tempUserID) {
      url = `${url}?clientid=${clientID}&tempid=${tempUserID}`;
    } else if (clientID) {
      url = `${url}?clientid=${clientID}`;
    }

    return url;
  }

  async inputCaptureContent(lineRange: LineRange | undefined): Promise<CaptureInput | undefined> {
    function describeLineRange(lineRange: LineRange | undefined) {
      if (!lineRange) {
        return "";
      }

      const { from, to } = lineRange;
      return from === to ? `line ${from}` : `lines ${from}-${to}`;
    }

    const titleResult = await window.showInputBox({
      placeHolder: "Enter a title for your rule",
      prompt: `What rule do you want to capture at ${describeLineRange(lineRange)}?`,
      validateInput: (value) => (value.trim() === "" ? "Title is required" : ""),
    });

    if (!titleResult) {
      // exit early when no title given
      return;
    }

    const descriptionResult = await window.showInputBox({
      placeHolder: "Add a description",
      prompt: `Give your rule a description (optional)`,
    });

    const result: CaptureInput = {
      title: titleResult.trim(),
      description: descriptionResult?.trim() ?? "",
    };

    return result;
  }

  async inputNote(
    context: InferFileContextResult | InferRepoContextResult,
    captureType: CaptureTypes,
    knownNotebookName?: string
  ): Promise<string | undefined> {
    const contextHash = hashInferredContext(context);
    const prefilledValue = this.lastNote.contextHash === contextHash ? this.lastNote.note : "";

    const note = await window.showInputBox({
      placeHolder: `Enter a note for this ${captureType} (optional)`,
      prompt: knownNotebookName && `Adding to "${knownNotebookName}"`,
      value: prefilledValue,
      valueSelection: [0, prefilledValue.length],
      ignoreFocusOut: true,
    });

    this.lastNote = { contextHash, note: note ?? "" };
    return note;
  }

  async genericInput(prompt: string, placeHolder: string | undefined): Promise<string | undefined> {
    const teamName = await window.showInputBox({
      placeHolder,
      prompt,
      ignoreFocusOut: true,
    });

    return teamName;
  }

  async inputNewNotebookName(): Promise<string | undefined> {
    return await window.showInputBox({
      prompt: "Enter a name for your new notebook (optional)",
      ignoreFocusOut: true,
    });
  }

  async showError(errorCode: keyof typeof ERRORS, errorMessage?: string): Promise<void> {
    const error = ERRORS[errorCode];
    if (!error) {
      throw new Error(`No error found with errorCode "${errorCode}"`);
    }
    const { message, severity, command } = error;
    const showFn = VSCodeUI.chooseMessageFnForSeverity(severity);
    const displayMessage = errorMessage ? `${message}: ${errorMessage}` : message;
    if (!command) {
      showFn(displayMessage);
      return;
    }

    const choice = await showFn(displayMessage, command.label);
    if (choice && choice === command?.label) {
      commands.executeCommand(command.type);
    }
  }

  private static chooseMessageFnForSeverity(severity: Severity): MessageFn {
    if (severity === "error") return window.showErrorMessage;
    if (severity === "warn") return window.showWarningMessage;
    return window.showInformationMessage;
  }

  async errorAPIServer(message: string) {
    await window.showErrorMessage(
      `API Error: ${message}. Please make sure you have the CodeLingo GitHub app installed on this repo.`
    );
  }

  async showMessage(message: string, ...actions: string[]): Promise<string | undefined> {
    const response = await window.showInformationMessage(message, ...actions);
    return response;
  }

  async showModalMessage(message: string, ...actions: string[]): Promise<string | undefined> {
    const response = await window.showInformationMessage(message, { modal: true }, ...actions);
    return response;
  }

  async chooseRepoRootPath(title?: string, openLabel?: string): Promise<string | undefined> {
    const uri = await window.showOpenDialog({
      title,
      openLabel,
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
    });

    if (!uri) {
      return undefined;
    }

    return uri[0].fsPath;
  }

  get focused(): boolean {
    return window.state.focused;
  }

  async focusIDE(windowPattern: string): Promise<any> {
    if (!window.state.focused) {
      this.windowManager.focus(windowPattern);
    }
  }

  async chooseString<T extends string>(strings: T[], placeHolder?: string): Promise<T | undefined> {
    const result = await window.showQuickPick(strings, { placeHolder });
    return result as T | undefined;
  }

  async warnModal<T extends string>(
    message: string,
    options: readonly T[]
  ): Promise<T | undefined> {
    const result = await window.showWarningMessage(message, { modal: true }, ...options);
    return result as T | undefined;
  }

  async openTextEditorWithStringContents(contents: string, language?: string): Promise<void> {
    const textDocument = await workspace.openTextDocument({ content: contents, language });
    window.showTextDocument(textDocument);
  }

  async chooseDifferentBranchAction(
    current: string,
    original: string
  ): Promise<DifferentBranchChoices | undefined> {
    const checkoutOriginal = `Checkout "${original}"`;
    const stayOnCurrent = `Stay on "${current}"`;

    const choice = await window.showInformationMessage(
      `This snippet was captured on the "${original}" branch.\n\nYou have "${current}" checked out.`,

      { modal: true },
      checkoutOriginal,
      stayOnCurrent
    );

    switch (choice) {
      case checkoutOriginal:
        return "checkout-original";
      case stayOnCurrent:
        return "stay-on-current";
      default:
        return;
    }
  }

  async chooseFetchWhenBranchMissing(
    currentBranch: string,
    remoteBranch: string,
    remote: string
  ): Promise<MissingBranchOptions> {
    const fetchOption = `Try fetch from ${remote}`;
    const stayOption = `Stay on ${currentBranch}`;
    const choice = await window.showInformationMessage(
      `There is no local branch named "${remoteBranch}".`,
      { modal: true },
      stayOption,
      fetchOption
    );

    switch (choice) {
      case fetchOption:
        return "fetch";
      case stayOption:
        return "stay";
      default:
        return "cancelled";
    }
  }
}

/** `hashInferredContext` hashes the unique parts of the context.
 * Used to check whether the result is close enough to a previous capture */
function hashInferredContext(i: InferFileContextResult | InferRepoContextResult): string {
  if (i.type === "file/success") {
    return `${i.source.filepath}:${JSON.stringify(i.source.lineRange)}`;
  }

  if (i.type === "repo/success") {
    return `${i.type}:${i.source.localBranch}:${i.vcsRootPath}`;
  }

  return i.type;
}

export type DifferentBranchChoices = "checkout-original" | "stay-on-current";
