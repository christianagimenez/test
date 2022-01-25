import { commands, TextDocumentChangeEvent, TextEditor, window } from "vscode";
import { UNKNOWN_USER_ID } from "../../../common/src/model/notebook-dom";
import { TrackerEvent } from "../../../common/src/tracking/events";
import { BuiltInCommands, ContextKeys } from "../constants";
import { CodeReferences } from "../references/codeReferences";
import { NotebookDecorator } from "../references/notebookDecorator";
import { SharedCommandServices } from "./services";

type Dictionary<T> = { [key: string]: T };

export interface RelevantNotebooksUI {
  showUpgradePrompt(): Promise<boolean>;
}

interface RunOptions {
  isButtonPress?: boolean;
}
export class RelevantNotebooksCommand {
  private readonly decorationsVisibleByFilepath: Dictionary<boolean>;

  constructor(
    private readonly codeRefs: CodeReferences,
    private readonly decorator: NotebookDecorator,
    private readonly ui: RelevantNotebooksUI,
    private readonly services: SharedCommandServices,
    private _defaultVisibility: boolean
  ) {
    this.decorationsVisibleByFilepath = {};
  }

  async toggle(
    isButtonPress: boolean | undefined,
    force?: { newVisibleState: boolean }
  ): Promise<any> {
    if (!this.services.hasMinimumVersionInstalled) {
      return this.ui.showUpgradePrompt();
    }

    const editor = this.getEditor();
    if (!editor) {
      return;
    }

    const filepath = editor.document.uri.toString();
    if (force?.newVisibleState !== undefined) {
      this.setDecorationsVisible(filepath, force.newVisibleState);
    } else {
      this.toggleDecorationsVisibleFor(filepath);
    }
    this.refreshDecorations();

    const clientID = this.services.deviceStorage.getClientID() ?? null;

    // Only track toggle event if initiated via button
    if (isButtonPress) {
      this.services.mixpanel.track(
        new TrackerEvent(
          "toggle-related-notebooks",
          "ide",
          isButtonPress ? "ide-shortcut" : "ide-palette",
          null,
          { clientID, notebookID: null, userID: this.services.auth.userID ?? UNKNOWN_USER_ID }
        )
      );
    }
  }

  public handleChangedActiveTextEditor(editor: TextEditor | undefined): any {
    if (!editor) {
      return;
    }

    this.refreshDecorations(editor);
  }

  public handleDidChangeTextDocument(e: TextDocumentChangeEvent): any {
    const filepath = e.document.uri.toString();
    const visible = this.areDecorationsVisibleFor(filepath);
    if (!visible) {
      return;
    }

    if (this.getEditor()?.document === e.document) {
      this.toggle(false, { newVisibleState: false });
    }
  }

  public refreshDecorations(editor?: TextEditor) {
    editor ??= this.getEditor();
    if (!editor) {
      return;
    }

    const filepath = editor.document.uri.toString();
    const shouldDecorate = this.areDecorationsVisibleFor(filepath);

    if (shouldDecorate) {
      this.decorate(editor);
    } else {
      const numSnippets = this.countSnippetsFor(editor);
      commands.executeCommand(BuiltInCommands.SetContext, ContextKeys.SnippetsCount, numSnippets);
      this.undecorate(editor);
    }
  }

  public clearDecorations(editor?: TextEditor) {
    editor ??= this.getEditor();
    if (!editor) {
      return;
    }

    this.undecorate(editor);
  }

  private getEditor(): TextEditor | undefined {
    const openEditor = window.visibleTextEditors.filter(isFileEditor)[0];
    return openEditor; // may be undefined
  }

  private toggleDecorationsVisibleFor(filepath: string): boolean {
    const visible = this.areDecorationsVisibleFor(filepath);
    this.setDecorationsVisible(filepath, !visible);
    return !visible;
  }

  private setDecorationsVisible(filepath: string, visible: boolean) {
    this.decorationsVisibleByFilepath[filepath] = visible;
  }

  private areDecorationsVisibleFor(filepath: string): boolean {
    const visible = this.decorationsVisibleByFilepath[filepath];
    if (visible === undefined) {
      return (this.decorationsVisibleByFilepath[filepath] = this._defaultVisibility);
    }

    return visible;
  }

  private countSnippetsFor(editor: TextEditor): number {
    const snippets = this.codeRefs.getReferencedCodeSnippets(editor.document.uri);
    return snippets?.length ?? 0;
  }

  private decorate(editor: TextEditor) {
    commands.executeCommand(
      BuiltInCommands.SetContext,
      ContextKeys.RelevantNotebooksDecorationsVisible,
      "visible"
    );
    this.decorator.decorate(editor, this.codeRefs);
  }

  private undecorate(editor: TextEditor) {
    commands.executeCommand(
      BuiltInCommands.SetContext,
      ContextKeys.RelevantNotebooksDecorationsVisible,
      undefined
    );
    this.decorator.undecorate(editor);
  }

  public set defaultVisibility(isVisible: boolean) {
    if (this._defaultVisibility === isVisible) {
      // Do nothing. This also prevents messing with exsiting toggle
      // state for known files.
      return;
    }

    this._defaultVisibility = isVisible;

    // If the user sets the default visibility to "visible" (on),
    // set all known filepaths to be on. If they set the default to
    // "not visible" (off), leave preferences as is.
    if (isVisible) {
      for (const filepath of Object.keys(this.decorationsVisibleByFilepath)) {
        this.setDecorationsVisible(filepath, isVisible);
      }
    }
  }
}

const isFileEditor = (editor: TextEditor): boolean => editor.document.uri.scheme === "file";
