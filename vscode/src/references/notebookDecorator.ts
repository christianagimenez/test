import {
  DecorationOptions,
  extensions,
  MarkdownString,
  OverviewRulerLane,
  Range,
  TextEditor,
  TextEditorDecorationType,
  window,
} from "vscode";
import { Environment } from "../../../common/src/env/env";
import { CodeReferences } from "./codeReferences";
import { colors, PURPLE } from "./colors";

export interface NotebookAnnotation {
  range: Range;
  notebookIDs: string[];
}

const createDecorationType = (): [TextEditorDecorationType, TextEditorDecorationType] => {
  const path = extensions.getExtension("codelingo.codelingo")?.extensionUri;
  if (!path) {
    throw new Error("NotebookDecorator: cannot get extension path");
  }

  const beforeDecoration = window.createTextEditorDecorationType({
    before: {
      height: "100%",
      width: "1ch",
      margin: "0 6px -1px 0",
      textDecoration: "none; box-sizing: border-box",
    },
  });
  const rulerDecoration = window.createTextEditorDecorationType({
    overviewRulerLane: OverviewRulerLane.Center,
    overviewRulerColor: PURPLE, // #FFA836 @ 50% (Brand orange)
  });

  return [beforeDecoration, rulerDecoration];
};

export class NotebookDecorator {
  private beforeDecoration: TextEditorDecorationType;
  private rulerDecoration: TextEditorDecorationType;

  constructor(private readonly env: Environment) {
    const [before, ruler] = createDecorationType();
    this.beforeDecoration = before;
    this.rulerDecoration = ruler;
  }

  decorate(editor: TextEditor, refs: CodeReferences): void {
    const annotationsArr: NotebookAnnotation[] = [];

    const codeReferences = refs.getReferencedCodeSnippets(editor.document.uri) ?? [];

    const idToNameMap = new Map<string, string>();

    for (const snippet of codeReferences) {
      const startLine = snippet.range.start.line - 1;
      const endLine = snippet.range.end.line - 1;
      // Decorate the entire last line so hover popup acts nicely.
      const endLineLength = editor.document.lineAt(endLine).text.length;

      const annotation: NotebookAnnotation = {
        range: new Range(startLine, 0, endLine, endLineLength),
        notebookIDs: [snippet.notebookID],
      };

      annotationsArr.push(annotation);
      idToNameMap.set(snippet.notebookID, snippet.notebookName);
    }

    const lineMap: Map<number, GutterInfo> = this.makeLineMap(annotationsArr);
    const { before, ruler } = this.lineMapToDecorationOptions(editor, lineMap, idToNameMap);
    editor.setDecorations(this.beforeDecoration, before);
    editor.setDecorations(this.rulerDecoration, ruler);
  }

  undecorate(editor: TextEditor) {
    editor.setDecorations(this.beforeDecoration, []);
    editor.setDecorations(this.rulerDecoration, []);
  }

  private generateHoverContent(ids: string[], idToNameMap: Map<string, string>): MarkdownString {
    const host = this.env.getEnvironmentVariables().WEB_HOST;
    let content = "Notebooks referencing this code:\n\n";
    for (const id of ids) {
      let name = idToNameMap.get(id);
      if (!name) {
        console.error(`could not find name for notebook ${id}`);
        name = id;
      }

      content += `[${name}](${host}/p/${id})\n\n`;
    }

    const hoverContent = new MarkdownString(content);
    hoverContent.isTrusted = true;
    return hoverContent;
  }

  makeLineMap(annotations: NotebookAnnotation[]): Map<number, GutterInfo> {
    const lineMap = new Map<number, GutterInfo>();
    for (const a of annotations) {
      for (let i = a.range.start.line; i <= a.range.end.line; i++) {
        const type = (() => {
          if (i === a.range.start.line) return "start";
          if (i === a.range.end.line) return "end";
          return "middle";
        })();

        const curr = lineMap.get(i);
        if (!curr) {
          lineMap.set(i, { type, ids: a.notebookIDs });
          continue;
        }

        lineMap.set(i, {
          type: curr.type === "middle" ? type : curr.type,
          ids: [...curr.ids, ...a.notebookIDs],
        });
      }
    }

    return lineMap;
  }

  private lineMapToDecorationOptions(
    editor: TextEditor,
    lineMap: Map<number, GutterInfo>,
    notebookIDToNameMap: Map<string, string>
  ): { before: DecorationOptions[]; ruler: DecorationOptions[] } {
    const beforeDecorations: DecorationOptions[] = [];
    const rulerDecorations: DecorationOptions[] = [];

    const N = colors.length;

    const formatter = typeToDot;

    for (let i = 0; i < editor.document.lineCount; i++) {
      const info = lineMap.get(i);
      const { ids, type } = info ? info : { ids: [], type: "none" as const };
      const line = editor.document.lineAt(i);
      const range = new Range(i, 0, i, line.text.length);

      if (info) {
        rulerDecorations.push({
          range,
        });
      }

      const uniqueIDs = Array.from(new Set(ids));
      const hasSnippets = uniqueIDs.length > 0;
      const decoration: DecorationOptions = {
        range,
        renderOptions: {
          before: {
            color: PURPLE,
            contentText: formatter(type),
            textDecoration: hasSnippets ? "none; cursor:pointer" : "none",
          },
        },
        hoverMessage: hasSnippets ? this.generateHoverContent(uniqueIDs, notebookIDToNameMap) : "",
      };
      beforeDecorations.push(decoration);
    }

    return { before: beforeDecorations, ruler: rulerDecorations };
  }
}

type GutterInfo = {
  type: "start" | "middle" | "end" | "none";
  ids: string[];
};

function typeToDot(type: GutterInfo["type"]): string {
  if (type === "none") return "\u00a0";
  return "❙";
}
