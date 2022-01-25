import path from "path";
import { Range, Uri } from "vscode";
import { parseGitRemote } from "../../../common/src/model/git";
import { CodeNode, NotebookHeader } from "../../../common/src/model/notebook-dom";
import { NotebookData } from "../../../common/src/persistence/NotebookData";
import { DeviceStorageService } from "../store";

export interface RepoCodeSnippet {
  notebookID: string;
  notebookName: string;
  range: Range;
  filepath: Uri;
  fetchURL: string;
}

type RepoCodeSnippetLookup = { [key: string]: RepoCodeSnippet[] };

const areSnippetsEqual = (a: RepoCodeSnippet, b: RepoCodeSnippet): boolean => {
  if (!a || !b) return false;

  return (
    a.filepath === b.filepath &&
    a.notebookID === b.notebookID &&
    a.notebookName === b.notebookName &&
    a.range.isEqual(b.range) &&
    (a.fetchURL === b.fetchURL || parseGitRemote(a.fetchURL) === parseGitRemote(b.fetchURL))
  );
};

export class CodeReferences {
  private _codeSnippets: RepoCodeSnippetLookup = {};

  constructor(
    private readonly store: DeviceStorageService,
    private readonly notebookData: NotebookData
  ) {}

  public async init(): Promise<void> {
    const notebooks = this.store.getAllNotebookHeaders();
    if (!notebooks) return;

    return this.setReferencesFromNotebooks(...notebooks);
  }

  public async setReferencesFromNotebooks(...notebookHeaders: NotebookHeader[]): Promise<void> {
    if (notebookHeaders.length === 0) return;

    const refreshCodePromises = notebookHeaders.map(async (notebook) => {
      const nodes = await this.notebookData.getCodeNodes(notebook.id);
      if (!nodes) return;

      for (const node of nodes) {
        const snippet = this.createSnippetFromCodeNode(notebook, node);
        if (snippet) {
          this.setReferencedCodeSnippet(snippet);
        }
      }
    });

    await Promise.all(refreshCodePromises);
  }

  public setReferencedCodeSnippet(code: RepoCodeSnippet) {
    const key = code.filepath.toString();
    const snippets = this.getReferencedCodeSnippets(code.filepath);
    if (!snippets?.find((snippet) => areSnippetsEqual(snippet, code), this)) {
      this._codeSnippets[key] = [...(snippets || []), code];
    }
  }

  public getReferencedCodeSnippets(filepath: Uri): RepoCodeSnippet[] | undefined {
    if (!this.isValidUri(filepath)) {
      return undefined;
    }

    return this._codeSnippets[filepath.toString()];
  }

  private createSnippetFromCodeNode(
    header: NotebookHeader,
    node: CodeNode
  ): RepoCodeSnippet | undefined {
    if (!node.source.lineRange) {
      console.log(`node ${JSON.stringify(node)} is missing line range`);
      return;
    }

    const range = new Range(node.source.lineRange.from, 0, node.source.lineRange.to, 0);

    const { fetchURL, filepath } = node.source;
    if (!fetchURL || !filepath) return;

    const localRepoPath = this.store.getRepoRootPath(fetchURL);
    if (!localRepoPath) return;

    return {
      notebookID: header.id,
      notebookName: header.name,
      range,
      filepath: Uri.file(path.join(localRepoPath, filepath)),
      fetchURL,
    };
  }

  private isValidUri(filepath: Uri): boolean {
    return filepath.scheme === "file";
  }
}
