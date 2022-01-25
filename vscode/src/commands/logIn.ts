import { ClientID } from "../../../common/src/model/notebook-dom";
import { SharedCommandServices } from "./services";

export interface LogInUI {
  openLoginURL(clientID: ClientID): Promise<boolean>;
  showUpgradePrompt(): Promise<boolean>;
}

export class LogInCommand {
  constructor(private readonly ui: LogInUI, private readonly services: SharedCommandServices) {}

  async run(clientID: ClientID): Promise<any> {
    if (!this.services.hasMinimumVersionInstalled) {
      return this.ui.showUpgradePrompt();
    }
    this.ui.openLoginURL(clientID);
  }
}
