import type { CaptureSnippetRequest } from "../../../common/src/backend/interfaces";
import { defaultScope } from "../../../common/src/model/auth";
import {
  ClientID,
  NodeID,
  NotebookAccess,
  NotebookContent,
  NotebookHeader,
} from "../../../common/src/model/notebook-dom";
import { TrackerEvent } from "../../../common/src/tracking/events";
import { ClientEditors, createNodeMetadata, Origins } from "../../../common/src/util/metadata";
import { CoPilot } from "../copilot/copilot";
import { ExplorerContext, InferFileContextResult } from "./infer";
import { NotebookCommandChoice, RemoteRepo } from "./interface";
import { SharedCommandServices } from "./services";
import { CaptureTypes } from "./shared";

export interface AddToNotebookUI {
  /**
   * Prompt the user for a note input
   * @param context The relevant context for this note. A hash of this is used to determine if a previous note should be re-shown
   * @param knownNotebookName The name of the notebook that this note will be added to (used when the Notebook is known in advance)
   */
  inputNote(
    context: InferFileContextResult,
    captureType: CaptureTypes,
    knownNotebookName?: string
  ): Promise<string | undefined>;
  showError(
    code: "no-repo-detected" | "no-remotes-detected" | "directory-not-supported"
  ): Promise<any>;
  showGettingStartedPrompt(): Promise<boolean>;
  chooseRemoteRepo(repos: readonly RemoteRepo[]): Promise<RemoteRepo | undefined>;
  chooseNotebook(
    notebooks: readonly NotebookHeader[],
    origin: Origins,
    verb: string
  ): Promise<[NotebookHeader, boolean] | undefined>;
  showNotebookLink(
    notebook: { id: NodeID; name: string },
    clientID: ClientID,
    options?: { message?: string; cta?: string; forSharing?: boolean }
  ): Promise<void>;
  showUpgradePrompt(): Promise<boolean>;
}

interface RunOptions {
  useLastNotebook?: true;
  isShortcut?: boolean;
  explorerContext?: ExplorerContext;
}

export class AddToNotebookCommand {
  constructor(
    private readonly ui: AddToNotebookUI,
    private readonly copilot: CoPilot,
    private readonly services: SharedCommandServices
  ) {}

  private get deviceStorage() {
    return this.services.deviceStorage;
  }

  async run({ useLastNotebook, isShortcut, explorerContext }: RunOptions = {}): Promise<any> {
    if (!this.services.hasMinimumVersionInstalled) {
      return this.ui.showUpgradePrompt();
    }

    const clientID = this.deviceStorage.ensureClientID();

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

    const captureType: CaptureTypes = explorerContext ? "file" : "snippet";
    const choice = useLastNotebook
      ? await this.useLastNotebookWithFallback(captureType)
      : await this.chooseNotebook(captureType);

    if (!choice) {
      return;
    }

    const note = await this.ui.inputNote(inferredContext, captureType, choice.name);
    if (note === undefined) {
      return;
    }

    const { snippet, fileMode, source, repos, blameInfo } = inferredContext;

    const repo = await this.ui.chooseRemoteRepo(repos);
    if (!repo) {
      return await this.ui.showError("no-remotes-detected");
    }

    const explicitHostType = await this.copilot.chooseExplicitHostType(repo.fetchUrl);

    const userID = this.services.auth.userID;
    if (!userID) {
      return this.ui.showGettingStartedPrompt();
      // TODO: automatically continue the open after the process
    }

    const { id, name, isNew } = choice;

    const remoteSource = this.services.makeRemoteCapureSource(repo, source, explicitHostType);

    const cmdName = `add to ${useLastNotebook ? "last " : ""}notebook`;
    if (isNew) {
      const access: NotebookAccess = {
        ownerUserID: userID,
        teamID: null,
        scope: defaultScope(userID),
      };

      const content: NotebookContent = {
        id,
        type: "notebook",
        name,
        nodes: [],
        metadata: createNodeMetadata(userID, Origins.ADD_TO_NOTEBOOK),
      };

      await this.copilot.ensure(content, access, userID);

      this.services.mixpanel.track(
        new TrackerEvent("create-nb", "ide", isShortcut ? "ide-shortcut" : "ide-palette", null, {
          clientID,
          userID,
          notebookID: id,
        }),
        {
          command: cmdName,
        }
      );
    }

    this.deviceStorage.trackRepoRootPath(repo.fetchUrl!, inferredContext.vcsRootPath);
    this.services.mixpanel.track(
      new TrackerEvent("add-block", "ide", isShortcut ? "ide-shortcut" : "ide-palette", null, {
        userID,
        notebookID: choice.id,
        clientID,
      }),
      {
        command: cmdName,
        blockType: "code",
      }
    );

    if (note !== "") {
      this.services.mixpanel.track(
        new TrackerEvent("add-block", "ide", isShortcut ? "ide-shortcut" : "ide-palette", null, {
          userID,
          notebookID: choice.id,
          clientID,
        }),
        {
          command: cmdName,
          blockType: "p",
        }
      );
    }

    const request: CaptureSnippetRequest = {
      notebookID: choice.id,
      notebookName: choice.name,
      clientID,
      userID,
      source: remoteSource,
      snippet: snippet,
      fileMode: fileMode,
      note: note ?? "",
      origin: Origins.ADD_TO_NOTEBOOK,
      ide: ClientEditors.VSCODE,
      blameInfo,
    };
    this.services.backendAPI.captureSnippet(request);
    this.copilot.handleCapture(request);

    this.deviceStorage.setRecentlyUsedNotebook(choice.id);
    this.ui.showNotebookLink(choice, clientID);
  }

  private async useLastNotebookWithFallback(
    captureType: CaptureTypes
  ): Promise<NotebookCommandChoice | undefined> {
    const currNotebooks = this.deviceStorage.getAllNotebookHeaders();
    if (currNotebooks?.length) {
      const { id, name } = currNotebooks[0];
      return {
        id,
        name,
        isNew: false,
      };
    }

    return this.chooseNotebook(captureType);
  }

  private async chooseNotebook(
    captureType: CaptureTypes
  ): Promise<NotebookCommandChoice | undefined> {
    const currNotebooks = this.deviceStorage.getAllNotebookHeaders() ?? [];
    const notebook = await this.ui.chooseNotebook(
      currNotebooks,
      Origins.ADD_TO_NOTEBOOK,
      `add ${captureType} to`
    );
    if (notebook === undefined) {
      return undefined;
    }

    const [{ id, name }, isNew] = notebook;
    return {
      id,
      name,
      isNew,
    };
  }
}
