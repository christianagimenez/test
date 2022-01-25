import { ClientID } from "../../../common/src/model/notebook-dom";
import { SharedCommandServices } from "./services";

export interface OpenNotebooksHomeUI {
  openNotebooksHomeURL(clientID: ClientID): Promise<boolean>;
  showUpgradePrompt(): Promise<boolean>;
}

export class OpenNotebooksHomeCommand {
  constructor(
    private readonly ui: OpenNotebooksHomeUI,
    private readonly services: SharedCommandServices
  ) {}

  async run(clientID: ClientID): Promise<any> {
    if (!this.services.hasMinimumVersionInstalled) {
      return this.ui.showUpgradePrompt();
    }

    this.ui.openNotebooksHomeURL(clientID);
  }
}
