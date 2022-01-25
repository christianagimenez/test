import { ClientID, UserID } from "../../../common/src/model/notebook-dom";
import { TrackerEvent } from "../../../common/src/tracking/events";
import { shortIDGenerator } from "../util/ids";
import { SharedCommandServices } from "./services";

export interface CompleteSetupUI {
  completeSetup(clientID: ClientID, userID?: UserID): Promise<boolean>;
  showUpgradePrompt(): Promise<boolean>;
}

export class CompleteSetupCommand {
  constructor(
    private readonly ui: CompleteSetupUI,
    private readonly services: SharedCommandServices
  ) {}

  async run(clientID: ClientID): Promise<any> {
    if (!this.services.hasMinimumVersionInstalled) {
      return this.ui.showUpgradePrompt();
    }

    const { deviceStorage, mixpanel } = this.services;
    // Try auth userID first. This shouldn't really exist at this stage.
    // If not authed, use anonymous userID.
    // If no anon ID set, use a temporary ID. This is sent to the browser
    // and is used to alias the user so we can associate an installation with a user.
    const userID = deviceStorage.getUser()?.id ?? deviceStorage.getAnonymousUserID() ?? createTempUserID()
    this.ui.completeSetup(clientID, userID);

    mixpanel.track(
      new TrackerEvent("getting-started", "ide", "ide-ui", null, {
        clientID,
        userID,
        notebookID: null,
      }),
      {
        message: "User clicked Complete Setup",
      }
    );
  }
}

export function createTempUserID(): string {
  return `temp:${shortIDGenerator.nextID()}`;
}
