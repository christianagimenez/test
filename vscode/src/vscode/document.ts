import * as fs from "fs";
import {
  DecorationRangeBehavior,
  Range,
  TextDocument,
  TextEditor,
  TextEditorRevealType,
  ThemeColor,
  window,
  workspace,
} from "vscode";
import { LineRange } from "../../../common/src/events/events";
import {
  DocumentEditor,
  DocumentLineRange,
  DocumentManager,
  DocumentReader,
} from "../copilot/copilot";

export class VSCodeDocumentManager implements DocumentManager {
  constructor() {}

  async isActive(filepath: string): Promise<boolean> {
    if (!fs.existsSync(filepath)) return false;

    const textEditor = window.activeTextEditor;
    if (!textEditor) return false;

    return textEditor.document.uri.fsPath === filepath;
  }

  async getActiveEditor(): Promise<DocumentEditor | undefined> {
    if (!window.activeTextEditor) return;

    return new VSCodeDocumentEditor(window.activeTextEditor);
  }

  async open(filepath: string): Promise<DocumentReader | undefined> {
    if (!fs.existsSync(filepath)) {
      return undefined;
    }

    try {
      const doc = await workspace.openTextDocument(filepath);
      return new VSCodeDocumentReader(doc);
    } catch (e: any) {
      console.error("VSCodeDocumentManager.open failed to openTextDocument", e);
      return;
    }
  }

  async show(filepath: string): Promise<DocumentEditor> {
    const doc = await workspace.openTextDocument(filepath);
    const editor = await window.showTextDocument(doc, { preview: false });
    return new VSCodeDocumentEditor(editor);
  }
}

export class VSCodeDocumentReader implements DocumentReader {
  constructor(private readonly textDocument: TextDocument) {}

  get lineCount(): number {
    return this.textDocument.lineCount;
  }

  lineAt(lineIndex: number): string | undefined {
    // note: uses 0-based indexing
    if (lineIndex < this.lineCount) {
      return this.textDocument.lineAt(lineIndex).text;
    }

    return undefined;
  }

  getSnippet({ from, to }: LineRange): string {
    const range: Range = new Range(from - 1, 0, to - 1, Infinity);
    return this.textDocument.getText(range);
  }
}

export class VSCodeDocumentEditor implements DocumentEditor {
  private readonly highlightColor = new ThemeColor("merge.currentContentBackground");
  private readonly decoration = window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: this.highlightColor,
    rangeBehavior: DecorationRangeBehavior.ClosedOpen,
  });
  private decorationSeqNum = 0;

  constructor(private readonly editor: TextEditor) {}

  dispose() {
    this.decoration.dispose();
  }

  scrollRangesIntoViewWithHighlight(
    lineRange: DocumentLineRange,
    highlightLineIndexes?: number[]
  ): { dispose: () => any } {
    const endLineLength = this.measureLineLength(lineRange.toIndex);
    const range = new Range(lineRange.fromIndex, 0, lineRange.toIndex, endLineLength);
    this.editor.revealRange(range, TextEditorRevealType.Default);

    const calculateHighlightRanges = () => {
      // no specific line indexes --> highlight entire range
      if (highlightLineIndexes === undefined) {
        return [range];
      }

      // highlight specific lines
      return [
        range,
        ...highlightLineIndexes.map((i) => {
          const lineIndex = range.start.line + i;
          const lineLength = this.measureLineLength(lineIndex);
          return new Range(lineIndex, 0, lineIndex, lineLength);
        }),
      ];
    };

    const highlightRanges = calculateHighlightRanges();
    this.editor.setDecorations(this.decoration, highlightRanges);
    const expectedDecorationSeqNum = ++this.decorationSeqNum;

    return {
      dispose: () => {
        if (this.decorationSeqNum === expectedDecorationSeqNum) {
          this.editor.setDecorations(this.decoration, []);
        }

        this.dispose();
      },
    };
  }

  async replaceLineRange(lineRange: DocumentLineRange, updatedText: string): Promise<any> {
    const endLineLength = this.measureLineLength(lineRange.toIndex);
    const range = new Range(lineRange.fromIndex, 0, lineRange.toIndex, endLineLength);
    await this.editor.edit((builder) => {
      builder.replace(range, updatedText);
    });
  }

  private measureLineLength(line: number) {
    try {
      return this.editor.document.lineAt(line).text.length;
    } catch {
      return 120;
    }
  }
}
