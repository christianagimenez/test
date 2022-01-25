import { Uri } from "vscode";
import { ApplyPatchEvent } from "../../../common/src/events/events";
import { CodePresenter, CoPilot } from "../copilot/copilot";
import { SharedCommandServices } from "./services";

export interface ApplyPatchUI {
  showError(code: "file-not-found"): Promise<any>;
  showError(code: "patch-not-applied"): Promise<any>;
  showError(code: "patch-applied"): Promise<any>;
  showUpgradePrompt(): Promise<boolean>;
}

export class ApplyPatchCommand {
  constructor(
    private readonly ui: ApplyPatchUI,
    private readonly copilot: CoPilot,
    private readonly services: SharedCommandServices,
    private readonly presenter: CodePresenter
  ) {}

  private get deviceStorage() {
    return this.services.deviceStorage;
  }

  private get git() {
    return this.services.git;
  }

  private get auth() {
    return this.services.auth;
  }

  async run({ event }: { event: ApplyPatchEvent }): Promise<any> {
    if (!this.services.hasMinimumVersionInstalled) {
      return this.ui.showUpgradePrompt();
    }

    const { fetchURL, filepath } = event.target;
    const absoluteFilepath = await this.copilot.getAbsoluteFilePathAndMaybeShowError(
      { action: "apply-patch", event },
      fetchURL,
      filepath
    );

    if (!absoluteFilepath) {
      return;
    }

    const localRepo = await this.git.getLocalRepoFor(Uri.file(absoluteFilepath));
    if (!localRepo) {
      // file exists in the right place, but that place is not (no longer?) a Git repo
      this.ui.showError("file-not-found");
    }

    const clientID = this.deviceStorage.ensureClientID();
    const userID = this.auth.userID;
    const notebookID = event.notebookID;
    const nodeID = event.nodeID;

    const { result, lineRange } = await this.copilot.validateLineRange(absoluteFilepath, event);
    switch (result) {
      case "found":
      case "found-relocated":
        await this.presenter.replaceRange(
          absoluteFilepath,
          lineRange!,
          event.updatedText,
          event.patchLines,
          fetchURL
        );
        if (clientID && userID && nodeID && notebookID) {
          this.services.backendAPI.logPatchApplied({ clientID, userID, notebookID, nodeID });
        }
        this.ui.showError("patch-applied");
        break;

      case "range-not-found":
        this.ui.showError("patch-not-applied");
        break;

      case "file-not-found":
        this.ui.showError("file-not-found");
        break;

      case "file-only-found":
      default:
        throw new Error(`Unexpected validateLineRange result for apply-patch event: ${result}`);
    }
  }
}
