import { Range, TextEditor, Uri } from "vscode";
import { LanguageModes } from "../../../common/src/model/modes";
import { ActiveTextEditor, EditorSelection } from "../commands/interface";

interface VSCodeWindow {
  activeTextEditor: TextEditor | undefined;
}

export class VSCodeTextEditor implements ActiveTextEditor {
  private readonly window: VSCodeWindow;

  constructor(window: VSCodeWindow) {
    this.window = window;
  }

  private get activeEditor(): TextEditor | undefined {
    return this.window.activeTextEditor;
  }

  get languageMode(): LanguageModes | undefined {
    return this.activeEditor?.document.languageId as LanguageModes;
  }

  get uri(): Uri | undefined {
    return this.activeEditor?.document.uri;
  }

  get selection(): EditorSelection | undefined {
    const editor = this.activeEditor;
    if (!editor || !editor.selection) {
      return;
    }

    const selection = editor.selection;
    const start = selection.start.with({ character: 0 });
    const end = selection.end.with({ character: 1 << 16 });
    const content = editor.document.getText(new Range(start, end));
    return { start, end, content };
  }
}
