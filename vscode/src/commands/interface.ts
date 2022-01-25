import { Uri } from "vscode";
import { NodeID } from "../../../common/src/model/notebook-dom";
import { Branch, RefType, Repository } from "../vscode/@types/git";

export interface CaptureInput {
  title: string;
  description: string;
}

export interface Rule {
  id: number;
  name: string;
  description: string;
}

export interface TextPosition {
  readonly line: number; // 0-based
}

export interface EditorSelection {
  readonly start: TextPosition;
  readonly end: TextPosition;
  readonly content: string;
}

export interface IAuth {
  accessToken: string | undefined;
  authenticate(): Promise<any>;
}

export interface ActiveTextEditor {
  readonly selection: EditorSelection | undefined;
  readonly uri: Uri | undefined;
}

export interface NotebookCommandChoice {
  id: NodeID;
  name: string;
  isNew: boolean;
}

export interface IGitExtension {
  initialise(): Promise<any>;
  getLocalRepoFor(uri: Uri): Promise<ILocalRepo | undefined>;
  getRemoteRepos(repo: ILocalRepo): Promise<readonly RemoteRepo[]>;
  checkout(repo: ILocalRepo, ref: string): Promise<void>;
  pull(repo: ILocalRepo): Promise<void>;
  fetch(repo: ILocalRepo, branch?: string): Promise<void>;
  getBranchType(repo: ILocalRepo, name: string): Promise<RefType | undefined>;
  addRepo(root: Uri): Promise<ILocalRepo | undefined>;
  getCommitBranch(repo: ILocalRepo, commitSha: string): Promise<Branch | undefined>;
  getActiveRepositories(): Promise<Repository[] | undefined>;
  getLocalRepoFrom(repo: Repository): ILocalRepo;
}

export interface RemoteRepo {
  readonly fetchUrl: string;
  readonly localRepo: ILocalRepo;
  readonly remoteName: string;
}

export interface RemoteInfo {
  readonly name: string;
  readonly fetchUrl?: string;
}

export interface ILocalRepo {
  readonly rootUri: Uri;
  readonly remotes: RemoteInfo[];
  readonly currentRefName: string | undefined;
  readonly currentRemoteName: string | undefined;
  readonly currentCommitSha: string | undefined;
  readonly remoteTrackingBranch: string | undefined;
  getCommitSha(ref: string): Promise<string>;
  getBranch(name: string): Promise<Branch | undefined>;
  checkout(ref: string): Promise<void>;
  pull(): Promise<void>;
  fetch(ref?: string): Promise<void>;
  getCommitBranch(commitSha: string): Promise<Branch | undefined>;
  show(ref: string, path: string): Promise<string | undefined>;
  getDiffWithHead(): Promise<string | undefined>;
}
