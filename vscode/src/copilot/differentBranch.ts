import { sleep } from "../../../common/src/util/async";
import { IGitExtension, ILocalRepo } from "../commands/interface";
import { DifferentBranchChoices, MissingBranchOptions } from "../ui";
import { RefType } from "../vscode/@types/git";
import { MemoisedBranchChooser } from "./MemoisedBranchChooser";

export interface IDifferentBranchUI {
  chooseDifferentBranchAction(
    current: string,
    original: string
  ): Promise<DifferentBranchChoices | undefined>;
  chooseFetchWhenBranchMissing(
    currentBranch: string,
    remoteBranch: string,
    remote: string
  ): Promise<MissingBranchOptions>;
  showError(code: "remote-branch-not-found", message?: string): Promise<any>;
}

export type MissingBranchResult = [option: MissingBranchOptions, success: boolean];

export class DifferentBranchProcess {
  private memoisedBranchChooser: MemoisedBranchChooser;

  constructor(
    private readonly git: IGitExtension,
    private readonly ui: IDifferentBranchUI,
    private readonly repo: ILocalRepo,
    private readonly originalBranch: string,
    readonly currentRef: string
  ) {
    this.memoisedBranchChooser = new MemoisedBranchChooser(currentRef, ui);
  }

  private getOriginalBranch(type: RefType): string {
    if (this.repo.currentRemoteName && type == RefType.RemoteHead)
      return `${this.repo.currentRemoteName}/${this.originalBranch}`;

    return this.originalBranch;
  }

  async handle(): Promise<boolean> {
    const branchType = await this.git.getBranchType(this.repo, this.originalBranch);
    switch (branchType) {
      case RefType.Head:
      case RefType.RemoteHead:
        return this.handleOriginalBranchExists(branchType);

      case undefined:
      default:
        const [choice, success] = await this.handleOriginalBranchMissing();
        if (choice === "fetch" && !success) {
          this.ui.showError("remote-branch-not-found");
        }

        // Always return true unless the user cancelled. We will have either succeeded in fetching and checking out
        // the desired branch OR we will have displayed an error and we can continue attempting
        // to find the file and range on the current branch.
        return choice !== "cancelled";
    }
  }

  private async handleOriginalBranchExists(branchType: RefType) {
    const originalBranch = this.getOriginalBranch(branchType);
    const choice = await this.memoisedBranchChooser.choose(originalBranch);

    switch (choice) {
      case "checkout-original":
        await this.git.checkout(this.repo, originalBranch);
        await sleep(500); // allow time for file to reload from disk
        return true;

      case "stay-on-current":
        return true;

      default:
        return false;
    }
  }

  private async handleOriginalBranchMissing(): Promise<MissingBranchResult> {
    const choice = await this.ui.chooseFetchWhenBranchMissing(
      this.currentRef,
      this.originalBranch,
      this.repo.currentRemoteName ?? "remote"
    );
    if (choice === "fetch") {
      try {
        await this.git.fetch(this.repo, this.originalBranch);
        await this.git.checkout(this.repo, this.originalBranch);
      } catch (e: any) {
        return [choice, false];
      }
    }

    return [choice, true];
  }
}
