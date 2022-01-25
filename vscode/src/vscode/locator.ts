import { LineContent, LineRange } from "../../../common/src/events/events";
import {
  CodeLocator,
  DocumentManager,
  DocumentReader,
  LocateLineRangeResult,
} from "../copilot/copilot";

/** VSCodePresenter carries out Notebook UI interactions in VSCode */
export class VSCodeLocator implements CodeLocator {
  constructor(private readonly docManager: DocumentManager) {}

  async locateLineRange(
    absoluteFilepath: string,
    lineRange?: LineRange,
    lineContent?: LineContent
  ): Promise<LocateLineRangeResult> {
    const doc: DocumentReader | undefined = await this.docManager.open(absoluteFilepath);
    if (!doc) {
      return { type: "file-not-found" };
    }

    if (!lineRange || !lineContent) {
      return { type: "file-only-found" };
    }

    // 1 to 0-based conversion
    const lineRange0: LineRange = {
      from: lineRange.from - 1,
      to: lineRange.to - 1,
    };
    const docFirstLine = doc.lineAt(lineRange0.from);
    const docLastLine = doc.lineAt(lineRange0.to);
    const firstMatches = lineMatches(docFirstLine, lineContent.first);
    const lastMatches = lineMatches(docLastLine, lineContent.last);
    if (firstMatches && lastMatches) {
      const newSnippet = doc.getSnippet(lineRange);
      return { type: "found", newSnippet, newLineRange: lineRange0 };
    }

    const relocationResult = this.relocate(doc, lineRange0, lineContent);
    if (relocationResult) {
      const { newLineRange, newSnippet } = relocationResult;
      return { type: "found-relocated", newLineRange, newSnippet };
    }

    return { type: "range-not-found" };
  }

  relocate(
    doc: DocumentReader,
    lineRange: LineRange,
    lineContent: LineContent
  ): { newLineRange: LineRange; newSnippet: string } | undefined {
    const above: LineIndexDistance | undefined = this.locateLine(
      doc,
      lineContent.first,
      lineRange.from,
      0
    );
    const below: LineIndexDistance | undefined = this.locateLine(
      doc,
      lineContent.first,
      lineRange.from,
      doc.lineCount - 1
    );

    const winner: LineIndexDistance | undefined = chooseWinner(above, below);
    if (!winner) {
      return;
    }

    const newLineRange: LineRange = {
      from: 1 + winner.index, // convert back to 1-based
      to: 1 + lineRange.to - lineRange.from + winner.index,
    };

    const newSnippet: string = doc.getSnippet(newLineRange);
    return { newLineRange, newSnippet };
  }

  locateLine(
    doc: DocumentReader,
    expectedLine: string,
    fromIndex: number,
    toIndex: number
  ): { index: number; distance: number } | undefined {
    const delta = fromIndex < toIndex ? 1 : -1;
    const stopIndex = toIndex + delta; // i.e. one line past the toIndex
    let i = Math.max(0, Math.min(doc.lineCount - 1, fromIndex));
    const withinBounds = (idx: number) => idx >= 0 && idx < doc.lineCount;
    while (i !== stopIndex && withinBounds(i)) {
      const actualLine = doc.lineAt(i);
      if (lineMatches(expectedLine, actualLine)) {
        return { index: i, distance: Math.abs(fromIndex - i) };
      }
      i += delta;
    }
    return undefined;
  }
}

function chooseWinner(above: LineIndexDistance | undefined, below: LineIndexDistance | undefined) {
  if (above && below) {
    return above.distance < below.distance ? above : below;
  } else if (above) {
    return above;
  } else if (below) {
    return below;
  }
  return;
}

export function lineMatches(expected: string | undefined, actual: string | undefined): boolean {
  if (expected !== undefined && actual !== undefined) {
    return expected.trim() === actual.trim();
  }

  return false;
}

type LineIndexDistance = { index: number; distance: number };
