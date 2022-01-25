import fs from "fs";
import { setTimeout } from "timers";
import { window } from "vscode";
import { LineRange } from "../../../common/src/events/events";
import { parseGitRemote } from "../../../common/src/model/git";
import { PatchLine } from "../../../common/src/model/notebook-dom";
import { sleep } from "../../../common/src/util/async";
import { CodePresenter, DocumentLineRange, DocumentManager } from "../copilot/copilot";

export const HIGHLIGHT_DURATION_MILLIS = 2500;

export interface VSCodePresenterUI {
  showError(errorCode: "file-not-in-git-repo"): Promise<any>;
  focused: boolean;
  focusIDE(windowPattern: string | undefined): Promise<any>;
  showUpgradePrompt(): Promise<boolean>;
}

/** VSCodePresenter carries out Notebook UI interactions in VSCode */
export class VSCodePresenter implements CodePresenter {
  constructor(
    private readonly docManager: DocumentManager,
    private readonly ui: VSCodePresenterUI
  ) {}

  async notifyFileNotInAGitRepo(): Promise<any> {
    await this.ui.showError("file-not-in-git-repo");
  }

  async highlightLinesInEditor(
    absoluteFilepath: string,
    lineRange1: LineRange | undefined,
    durationMillis: number,
    fetchURL: string
  ) {
    if (!fs.statSync(absoluteFilepath).isFile()) {
      return;
    }
    const editor = await this.docManager.show(absoluteFilepath);

    if (lineRange1) {
      const range: DocumentLineRange = {
        fromIndex: lineRange1.from - 1,
        toIndex: lineRange1.to - 1,
      };
      this.highlightRangesInActiveEditor(range, durationMillis);
    }

    this.ui.focusIDE(windowPatternFromFetchURL(fetchURL));
  }

  async highlightRangesInActiveEditor(
    lineRange0: DocumentLineRange,
    durationMillis: number,
    highlightLineIndexes?: number[]
  ) {
    const activeEditor = await this.docManager.getActiveEditor();
    if (!activeEditor) {
      console.error("No active editor available to highlight ranges");
      return;
    }

    const { dispose } = activeEditor.scrollRangesIntoViewWithHighlight(
      lineRange0,
      highlightLineIndexes
    );
    if (this.ui.focused) {
      setTimeout(dispose, durationMillis);
    } else {
      const listener = window.onDidChangeWindowState((windowState) => {
        if (windowState.focused) {
          setTimeout(dispose, durationMillis);
          listener.dispose();
        }
      });
    }
  }

  async replaceRange(
    absoluteFilepath: string,
    lineRange: LineRange,
    updatedText: string,
    patchLines: PatchLine[],
    fetchURL: string
  ): Promise<any> {
    if (!fs.statSync(absoluteFilepath).isFile()) {
      return;
    }

    const isActive = this.docManager.isActive(absoluteFilepath);
    const editor = await this.docManager.show(absoluteFilepath);
    if (!isActive) {
      await sleep(500); // delay, so you can watch the patch being made 🤷‍♂️
    }
    const range0: DocumentLineRange = { fromIndex: lineRange.from - 1, toIndex: lineRange.to - 1 };
    editor.replaceLineRange(range0, updatedText);
    const activeEditor = await this.docManager.getActiveEditor();
    if (activeEditor) {
      const [finalRange0, addedLineIndexes] = calculateFinalRangeAndAddedLineIndexes(
        range0.fromIndex,
        patchLines
      );
      this.highlightRangesInActiveEditor(finalRange0, HIGHLIGHT_DURATION_MILLIS, addedLineIndexes);
    }

    this.ui.focusIDE(windowPatternFromFetchURL(fetchURL));
  }
}

/** Returns the indexes of all added lines, relative to the patch (0-based), after excluding any deleted lines
 *
 *  e.g.
 *    function greet() {
 *  -   console.log("Hello, world.");
 *  +   console.log("Hello, world.");
 *      return;
 *    }
 *
 *  will return [1]
 *
 */
function calculateFinalRangeAndAddedLineIndexes(
  fromIndex: number,
  patchLines: PatchLine[]
): [DocumentLineRange, number[]] {
  const finalLines = patchLines.filter(([kind]) => kind >= 0); // added or unchanged lines
  const addedLineIndexes = finalLines
    .map(([kind], i) => [kind, i]) // tuples of [kind = 0 | 1, index]
    .filter(([kind, _]) => kind === 1) // additions
    .map(([_, i]) => i);

  const finalRange0: DocumentLineRange = { fromIndex, toIndex: fromIndex + finalLines.length - 1 };
  return [finalRange0, addedLineIndexes];
}

function windowPatternFromFetchURL(fetchURL: string): string | undefined {
  const triplet = parseGitRemote(fetchURL);
  if (triplet !== undefined) {
    return triplet.repo;
  }
}
