import * as fs from "fs";
import * as path from "path";
import { Range, Uri } from "vscode";
import { FilePathSource, FileSource, LineRange } from "../../../common/src/events/events";
import { getLanguageModeFromFilepath, LanguageModes } from "../../../common/src/model/modes";
import { BlameCommit } from "../../../common/src/model/notebook-dom";
import type { Dictionary } from "../../../common/src/util/dictionary";
import { DeviceStorageService } from "../store";
import { getBlameInfoForRange } from "../util/blame";
import { Repository } from "../vscode/@types/git";
import { ActiveTextEditor, EditorSelection, IGitExtension, RemoteRepo } from "./interface";

export interface InferFileContextResultSuccess {
  readonly type: "file/success";
  readonly snippet?: string;
  readonly source: FileSource;
  readonly repos: readonly RemoteRepo[];
  readonly fileMode?: LanguageModes;
  readonly vcsRootPath: string;
  readonly blameInfo?: Dictionary<BlameCommit>;
}

export interface InferRepoContextResultSuccess {
  readonly type: "repo/success";
  readonly source: Omit<FilePathSource, "filepath" | "blameInfo">;
  readonly repos: readonly RemoteRepo[];
  readonly vcsRootPath: string;
}

export interface InferContextResultNoFile {
  readonly type: "no-file";
}

export interface InferContextResultNoEditor {
  readonly type: "no-editor";
}

export interface InferContextResultNoGit {
  readonly type: "no-git";
}

export type InferFileContextResult =
  | InferFileContextResultSuccess
  | InferContextResultNoFile
  | InferContextResultNoEditor
  | InferContextResultNoGit;

export type InferRepoContextResult = InferRepoContextResultSuccess | InferContextResultNoGit;

export interface ExplorerContext {
  selectionUri: Uri;
}

export class ContextInferer {
  private readonly editor: ActiveTextEditor;
  private readonly git: IGitExtension;
  private readonly deviceStorage: DeviceStorageService;

  constructor(editor: ActiveTextEditor, git: IGitExtension, deviceStorage: DeviceStorageService) {
    this.editor = editor;
    this.git = git;
    this.deviceStorage = deviceStorage;
  }

  async inferContextFromExplorer(context: ExplorerContext): Promise<InferFileContextResult> {
    const fsPath = context.selectionUri.fsPath;
    if (fs.statSync(fsPath).isDirectory()) {
      return { type: "no-file" };
    }
    return this.infer(context.selectionUri, undefined);
  }

  async inferContextFromActiveEditor(): Promise<InferFileContextResult> {
    const { selection, uri } = this.editor;
    if (!selection || !uri) {
      return { type: "no-editor" };
    }

    return this.infer(uri, selection);
  }

  async inferContextFromActiveRepo(repo: Repository): Promise<InferRepoContextResult> {
    const localRepo = this.git.getLocalRepoFrom(repo);
    if (!localRepo) {
      return { type: "no-git" };
    }

    const { rootUri, currentRefName: currentBranch, remoteTrackingBranch } = localRepo;
    const commitSha = await localRepo.getCommitSha("HEAD");
    const remoteRepos = await this.git.getRemoteRepos(localRepo);

    return {
      type: "repo/success",
      source: {
        commitSha,
        localBranch: currentBranch ?? null,
        remoteTrackingBranch: remoteTrackingBranch ?? null,
      },
      repos: remoteRepos,
      vcsRootPath: rootUri.fsPath,
    };
  }

  private async infer(
    uri: Uri,
    selection: EditorSelection | undefined
  ): Promise<InferFileContextResult> {
    const localRepo = await this.git.getLocalRepoFor(uri);
    if (!localRepo) {
      return { type: "no-git" };
    }

    const { rootUri, currentRefName: currentBranch, remoteTrackingBranch } = localRepo;
    const filepath = makeUriRootRelative(uri, rootUri);
    const commitSha = await localRepo.getCommitSha("HEAD");
    const remoteRepos = await this.git.getRemoteRepos(localRepo);

    let blameInfo: Dictionary<BlameCommit> | undefined;
    let content: string | undefined;
    let lineRange: LineRange | undefined;

    if (selection) {
      const { start, end } = selection;
      content = selection.content;
      const range = new Range(start.line, 0, end.line, 0); // 0-based line references

      try {
        blameInfo = await getBlameInfoForRange(
          localRepo,
          filepath,
          range,
          this.deviceStorage.getGitUserName(),
          this.deviceStorage.getGitUserEmail()
        );
      } catch (e: any) {
        console.error(e);
      }

      // convert to 1-based line references
      lineRange = { from: start.line + 1, to: end.line + 1 };
    }

    return {
      type: "file/success",
      source: {
        filepath,
        lineRange,
        commitSha,
        localBranch: currentBranch ?? null,
        remoteTrackingBranch: remoteTrackingBranch ?? null,
      },
      repos: remoteRepos,
      snippet: content ?? "",
      fileMode: getLanguageModeFromFilepath(filepath).canonical,
      vcsRootPath: rootUri.fsPath,
      blameInfo,
    };
  }
}

// file uri --> repo-relative path
function makeUriRootRelative(fileUri: Uri, repoRootUri: Uri): string {
  const relativePath = path.relative(repoRootUri.fsPath, fileUri.fsPath).replace(/\\/g, "/");
  return relativePath;
}
