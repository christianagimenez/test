import { DiffCapturedEvent } from "../../../common/src/events/events";
import { ClientID, NodeID } from "../../../common/src/model/notebook-dom";
import { ClientEditors, Origins } from "../../../common/src/util/metadata";
import { CoPilot } from "../copilot/copilot";
import { Repository } from "../vscode/@types/git";
import { InferRepoContextResult } from "./infer";
import { RemoteRepo } from "./interface";
import { SharedCommandServices } from "./services";
import { CaptureTypes } from "./shared";

export interface CaptureDiffUI {
  showError(
    code:
      | "no-repo-detected"
      | "no-remotes-detected"
      | "directory-not-supported"
      | "no-diff-detected"
      | "server-error"
      | "no-active-repos-detected"
  ): Promise<any>;
  inputNote(
    context: InferRepoContextResult,
    captureType: CaptureTypes,
    knownNotebookName?: string
  ): Promise<string | undefined>;
  chooseRemoteRepo(repos: readonly RemoteRepo[]): Promise<RemoteRepo | undefined>;
  showGettingStartedPrompt(): Promise<boolean>;
  inputNewNotebookName(): Promise<string | undefined>;
  showNotebookLink(
    notebook: { id: NodeID; name: string },
    clientID: ClientID,
    options?: { message?: string; cta?: string; forSharing?: boolean }
  ): Promise<void>;
  chooseLocalRepo(repos: readonly Repository[]): Promise<Repository | undefined>;
}

export class CaptureDiffCommand {
  constructor(
    private readonly ui: CaptureDiffUI,
    private readonly copilot: CoPilot,
    private readonly services: SharedCommandServices
  ) {}

  private get deviceStorage() {
    return this.services.deviceStorage;
  }

  private get graphQLAPI() {
    return this.services.graphQLAPI;
  }

  async run(): Promise<any> {
    const clientID = this.deviceStorage.ensureClientID();
    const activeRepos = await this.services.git.getActiveRepositories();
    if (!activeRepos) {
      return await this.ui.showError("no-active-repos-detected");
    }

    const repo = await this.ui.chooseLocalRepo(activeRepos);
    if (!repo) {
      return await this.ui.showError("no-repo-detected");
    }

    const inferredContext = await this.services.inferer.inferContextFromActiveRepo(repo);
    switch (inferredContext.type) {
      case "no-git":
        return await this.ui.showError("no-repo-detected");
    }

    const note = await this.ui.inputNote(inferredContext, "diff");
    if (note === undefined) {
      return;
    }

    const { source, repos } = inferredContext;

    const remoteRepo = await this.ui.chooseRemoteRepo(repos);
    if (!remoteRepo) {
      return await this.ui.showError("no-remotes-detected");
    }

    const explicitHostType = await this.copilot.chooseExplicitHostType(remoteRepo.fetchUrl);

    const userID = this.services.auth.userID;
    if (!userID) {
      return this.ui.showGettingStartedPrompt();
      // TODO: automatically continue the open after the process
    }

    const chosenNotebookName = await this.ui.inputNewNotebookName();
    const diff = await this.services.git.getLocalRepoFrom(repo).getDiffWithHead();
    if (!diff) {
      this.ui.showError("no-diff-detected");
      return;
    }

    const { commitSha: headSha, localBranch, remoteTrackingBranch } = source;
    const notebookID = this.services.uniqueIDGenerator.nextID();
    const notebookName = chosenNotebookName ?? "";

    // TODO decide what we're gunna do with remote tracking branches.
    // We're generally storing them as a string in the format <remote name>/<branch name>
    // but this can be problematic when we need to split them up (as is the case here).
    // E.g. "origin/master" as a perfectly valid remote name, as well as a branch name.
    // We have no way to tell where the remote name ends and the branch name begins.
    // A solution could be to have remoteTracking branch being an object like
    // { remoteName: string, branchName: string } and just join it when needed.
    const strippedRemoteTrackingBranch = remoteTrackingBranch?.replace(
      `${remoteRepo.remoteName}/`,
      ""
    );

    const event: DiffCapturedEvent = {
      type: "diff-captured",
      id: this.services.uniqueIDGenerator.nextID(),
      notebookID,
      notebookName,
      note,
      clientID,
      userID,
      source: {
        hostType: explicitHostType,
        fetchURL: remoteRepo.fetchUrl,
        headSha,
        localBranch,
        remoteTrackingBranch: strippedRemoteTrackingBranch ?? null,
      },
      diff,
      origin: "DIFF_CAPTURE" as Origins, // FIX THIS
      ide: "VSCODE" as ClientEditors, // FIX THIS
    };

    const success = await this.graphQLAPI.captureDiff(event);
    if (!success) {
      this.ui.showError("server-error");
      return;
    }

    this.deviceStorage.setRecentlyUsedNotebook(notebookID);
    this.ui.showNotebookLink({ id: notebookID, name: notebookName }, clientID);
  }
}
