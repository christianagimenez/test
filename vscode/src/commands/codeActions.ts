import {
  CancellationToken,
  CodeAction,
  CodeActionContext,
  CodeActionProvider,
  Command,
  ProviderResult,
  Range,
  TextDocument,
} from "vscode";
import { VSCodeTextEditor } from "../vscode/editor";

export class NotebookCodeActionsProvider implements CodeActionProvider {
  constructor(private readonly editor: VSCodeTextEditor) {}

  provideCodeActions(
    document: TextDocument,
    range: Range | Selection,
    context: CodeActionContext,
    token: CancellationToken
  ): ProviderResult<(CodeAction | Command)[]> {
    if (!this.editor.selection) return;
    if (range instanceof Range) {
      // Prevent lightbulb when no selection
      if (range.start.isEqual(range.end)) {
        return;
      }
    }

    const shareCmd: Command = {
      title: "CodeLingo: Share snippet",
      command: "codelingo.shareSnippet",
    };

    const addToLastNotebookCmd: Command = {
      title: "CodeLingo: Add to last Notebook...",
      command: "codelingo.addToLastNotebook",
    };

    const addToNotebookCmd: Command = {
      title: "CodeLingo: Add to Notebook...",
      command: "codelingo.addToNotebook",
    };

    return [addToNotebookCmd, addToLastNotebookCmd, shareCmd];
  }
}
