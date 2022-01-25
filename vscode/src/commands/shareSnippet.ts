import * as path from "path";
import { CaptureSnippetRequest } from "../../../common/src/backend/interfaces";
import { FileSource } from "../../../common/src/events/events";
import {
  ClientID,
  NodeID,
  NotebookAccess,
  NotebookContent,
  NotebookNode,
  TeamID,
  UserID,
} from "../../../common/src/model/notebook-dom";
import { TrackerEvent } from "../../../common/src/tracking/events";
import { ClientEditors, createNodeMetadata, Origins } from "../../../common/src/util/metadata";
import { CoPilot } from "../copilot/copilot";
import { ExplorerContext, InferFileContextResult } from "./infer";
import { RemoteRepo } from "./interface";
import { SharedCommandServices } from "./services";

export interface ShareSnippetUI {
  /**
   * Prompt the user for a note input
   * @param context The relevant context for this note. A hash of this is used to determine if a previous note should be re-shown
   * @param knownNotebookName The name of the notebook that this note will be added to (used when the Notebook is known in advance)
   */
  inputNote(
    context: InferFileContextResult,
    knownNotebookName?: string
  ): Promise<string | undefined>;
  showError(
    code: "no-repo-detected" | "no-remotes-detected" | "directory-not-supported"
  ): Promise<any>;
  showGettingStartedPrompt(): Promise<boolean>;
  chooseRemoteRepo(repos: readonly RemoteRepo[]): Promise<RemoteRepo | undefined>;
  openNotebookURL(notebookID: NodeID, clientID: ClientID): Promise<boolean>;
  showLinkWithMessage(url: string, message: string, cta: string): Promise<any>;
  showNotebookLink(
    notebook: { id: NodeID; name: string },
    clientID: ClientID,
    options?: { message?: string; cta?: string; forSharing?: boolean }
  ): Promise<void>;
}
interface RunOptions {
  isShortcut?: boolean;
  explorerContext?: ExplorerContext;
}
export class ShareSnippetCommand {
  constructor(
    private readonly ui: ShareSnippetUI,
    private readonly copilot: CoPilot,
    private readonly services: SharedCommandServices
  ) {}

  async run({ isShortcut, explorerContext }: RunOptions = {}): Promise<any> {
    const cmdName = "share snippet";

    const inferredContext = explorerContext
      ? await this.services.inferer.inferContextFromExplorer(explorerContext)
      : await this.services.inferer.inferContextFromActiveEditor();

    switch (inferredContext.type) {
      case "no-file":
        return await this.ui.showError("directory-not-supported");
      case "no-editor":
      case "no-git":
        return await this.ui.showError("no-repo-detected");
    }

    const { snippet, fileMode, source, repos, blameInfo } = inferredContext;

    const repo = await this.ui.chooseRemoteRepo(repos);
    if (!repo) {
      return await this.ui.showError("no-remotes-detected");
    }

    const explicitHostType = await this.copilot.chooseExplicitHostType(repo.fetchUrl);

    const clientID = this.services.deviceStorage.getClientID();
    if (!clientID) {
      // This should never happen because we set clientID during activation.
      // It's mainly here to keep TypeScript happy
      throw new Error("no clientID is set");
    }

    const { userID, teamID } = this.services.auth;
    if (!userID) {
      return this.ui.showGettingStartedPrompt();
      // TODO: automatically continue the open after the process
    }

    const isAnonymous = !this.services.auth.isAuthenticated();

    const notebook: NotebookContent = {
      id: this.services.uniqueIDGenerator.nextID(),
      name: this.chooseNotebookName(source),
      nodes: [] as NotebookNode[],
      type: "notebook",
      metadata: createNodeMetadata(userID, Origins.SHARE_SNIPPET),
    };

    const remoteSource = this.services.makeRemoteCapureSource(repo, source, explicitHostType);

    const access: NotebookAccess = createNotebookAccess(userID, teamID, isAnonymous);
    await this.copilot.ensure(notebook, access, userID);
    this.services.deviceStorage.trackRepoRootPath(repo.fetchUrl!, inferredContext.vcsRootPath);

    const request: CaptureSnippetRequest = {
      notebookID: notebook.id,
      clientID,
      userID,
      source: remoteSource,
      snippet: snippet,
      fileMode: fileMode,
      note: "",
      origin: Origins.SHARE_SNIPPET,
      ide: ClientEditors.VSCODE,
      blameInfo,
    };
    this.services.backendAPI.captureSnippet(request);
    this.copilot.handleCapture(request);

    this.services.mixpanel.track(
      new TrackerEvent("create-nb", "ide", isShortcut ? "ide-shortcut" : "ide-palette", null, {
        clientID,
        userID,
        notebookID: notebook.id,
      }),
      {
        command: cmdName,
      }
    );

    this.services.mixpanel.track(
      new TrackerEvent("add-block", "ide", isShortcut ? "ide-shortcut" : "ide-palette", null, {
        userID,
        notebookID: notebook.id,
        clientID,
      }),
      {
        command: cmdName,
        blockType: "code",
      }
    );

    this.ui.showNotebookLink(notebook, clientID, {
      forSharing: true,
      message: "Link copied to clipboard",
      cta: "Open Link",
    });
  }

  private chooseNotebookName(source: FileSource) {
    // Use the file name as the notebook name if no name was provided.
    const { filepath } = source;
    if (!filepath) {
      // ...this should never happen...
      throw new Error("chooseNotebookName: filepath is missing from source");
    }

    return `Snippet from ${path.basename(filepath)}`;
  }
}
function createNotebookAccess(
  userID: UserID,
  teamID: TeamID | undefined,
  isAnonymous: boolean
): NotebookAccess {
  if (isAnonymous) {
    return {
      ownerUserID: userID,
      teamID: null,
      scope: "anonymous",
    };
  }

  return {
    ownerUserID: userID,
    scope: "private",
    teamID: teamID,
  };
}
