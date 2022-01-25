import shortid from "shortid";
import { isAnonUserID } from "../../../common/src/model/auth";
import { arrayToDictionary } from "../../../common/src/util/dictionary";
import { SharedCommandServices } from "./services";

export interface CreateTeamUI {
  showError(code: "already-in-team" | "not-logged-in" | "server-error"): Promise<any>;
  genericInput(prompt: string, placeHolder: string | undefined): Promise<string | undefined>;
  showGettingStartedPrompt(): Promise<boolean>;
  openURL(url: string): Promise<boolean>;
  showMessage(message: string, ...actions: string[]): Promise<string | undefined>;
}

export class CreateTeamCommand {
  constructor(
    private readonly ui: CreateTeamUI,
    private readonly services: SharedCommandServices
  ) {}

  private get deviceStorage() {
    return this.services.deviceStorage;
  }

  async run(): Promise<any> {
    const user = this.deviceStorage.getUser();
    if (!user || isAnonUserID(user.id)) {
      return this.ui.showError("not-logged-in");
    }

    if (user.teamIDs.length > 0) {
      return this.ui.showError("already-in-team");
    }

    const teamName = await this.ui.genericInput(
      "What’s the name of your company or team?",
      "e.g. Red Team or Bananas Ltd"
    );
    if (!teamName) {
      return;
    }

    const teamEmailsStr = await this.ui.genericInput(
      `Who do you collaborate with?`,
      "To give Notebooks a try, add a few coworker email addresses (comma separated)"
    );

    const coworkerEmails = teamEmailsStr?.split(",").map((s) => s.trim());

    try {
      await this.services.backendAPI.createTeam({
        team: {
          id: shortid(),
          name: teamName,
          members: coworkerEmails
            ? arrayToDictionary(
                coworkerEmails,
                (email) => email,
                () => true
              )
            : {},
          owner: user.id,
        },
      });
    } catch (e) {
      return this.ui.showError("server-error");
    }

    return this.ui.showMessage(`Yay! Successfully created team ${teamName}!`);
  }
}
