import { defaultScope } from "../../../common/src/model/auth";
import {
  ClientID,
  NodeID,
  NotebookContent,
  NotebookHeader,
} from "../../../common/src/model/notebook-dom";
import { TrackerEvent } from "../../../common/src/tracking/events";
import { createNodeMetadata, Origins } from "../../../common/src/util/metadata";
import { CoPilot } from "../copilot/copilot";
import { DeviceStorageService } from "../store";
import { RemoteRepo } from "./interface";
import { SharedCommandServices } from "./services";

export interface OpenNotebookUI {
  showError(code: "no-repo-detected" | "no-remotes-detected"): Promise<any>;
  showGettingStartedPrompt(): Promise<boolean>;
  chooseRemoteRepo(repos: readonly RemoteRepo[]): Promise<RemoteRepo | undefined>;
  chooseNotebook(
    notebooks: readonly NotebookHeader[],
    origin: Origins,
    verb: string
  ): Promise<[NotebookHeader, boolean] | undefined>;
  openNotebookURL(notebookID: NodeID, clientID: ClientID): void;
  showUpgradePrompt(): Promise<boolean>;
}

export class OpenNotebookCommand {
  constructor(
    private readonly ui: OpenNotebookUI,
    private readonly copilot: CoPilot,
    private readonly services: SharedCommandServices
  ) {}

  private get deviceStorage(): DeviceStorageService { return this.services.deviceStorage; } // prettier-ignore

  async run(): Promise<any> {
    if (!this.services.hasMinimumVersionInstalled) {
      return this.ui.showUpgradePrompt();
    }

    const cmdName = "open notebook";
    const clientID = this.deviceStorage.getClientID();
    if (!clientID) {
      // XXX should never happen. This should be handled better
      throw new Error("no clientID is set");
    }

    const userID = this.services.auth.userID;
    if (!userID) {
      return this.ui.showGettingStartedPrompt();
      // TODO: automatically continue the open after the process
    }

    const currHeaders = this.deviceStorage.getAllNotebookHeaders() ?? [];
    const choice = await this.ui.chooseNotebook(currHeaders, Origins.OPEN_NOTEBOOK, "open");
    if (!choice) {
      // User aborted selection
      return;
    }

    const [{ id, name }, isNew] = choice;

    if (isNew) {
      const access = {
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
    }

    this.services.mixpanel.track(
      new TrackerEvent("open-nb", "ide", "ide-palette", null, {
        clientID,
        userID,
        notebookID: id,
      }),
      {
        command: cmdName,
      }
    );

    this.services.deviceStorage.setRecentlyUsedNotebook(id);
    this.ui.openNotebookURL(id, clientID);
  }
}
