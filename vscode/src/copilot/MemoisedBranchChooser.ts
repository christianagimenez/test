import type { Dictionary } from "../../../common/src/util/dictionary";
import { DifferentBranchChoices } from "../ui";
import { IDifferentBranchUI } from "./differentBranch";

export class MemoisedBranchChooser {
  private storedChoices: Dictionary<DifferentBranchChoices> = {};

  constructor(private readonly currentRef: string, private readonly ui: IDifferentBranchUI) {}

  static makeBranchPairKey(currentRef: string, originalBranch: string): string {
    return `${currentRef}|${originalBranch}`;
  }

  public async choose(originalBranch: string): Promise<DifferentBranchChoices | undefined> {
    const priorChoice = this.getStoredChoiceFor(originalBranch);
    if (priorChoice !== undefined) {
      return priorChoice;
    }

    const choice = await this.ui.chooseDifferentBranchAction(this.currentRef, originalBranch);
    if (choice !== undefined) {
      this.storeChoiceFor(originalBranch, choice);
    }

    return choice;
  }

  private getStoredChoiceFor(originalBranch: string): DifferentBranchChoices | undefined {
    const key = MemoisedBranchChooser.makeBranchPairKey(this.currentRef, originalBranch);
    const priorChoice = this.storedChoices[key];
    return priorChoice ?? undefined;
  }

  private storeChoiceFor(originalBranch: string, choice: DifferentBranchChoices): void {
    const key = MemoisedBranchChooser.makeBranchPairKey(this.currentRef, originalBranch);
    this.storedChoices[key] = choice;
  }
}
