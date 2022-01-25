import { Extension, extensions, Uri } from "vscode";
import { IGitExtension, ILocalRepo, RemoteInfo, RemoteRepo } from "../commands/interface";
import { execShell } from "../util/cmd";
import { API, Branch, Commit, GitExtension, RefType, Repository } from "./@types/git";

export class VSCodeGitExtension implements IGitExtension {
  private api: API | undefined;

  async initialise() {
    this.api = await this.getBuiltInGitApi();
  }

  async checkout(repo: ILocalRepo, ref: string): Promise<void> {
    if (!this.api) {
      return;
    }

    return await repo.checkout(ref);
  }

  async pull(repo: ILocalRepo): Promise<void> {
    if (!this.api) {
      return;
    }

    return await repo.pull();
  }

  async fetch(repo: ILocalRepo, branch?: string): Promise<void> {
    if (!this.api) {
      return;
    }

    return await repo.fetch(branch);
  }

  async getBuiltInGitApi(): Promise<API | undefined> {
    try {
      const extension = extensions.getExtension("vscode.git") as Extension<GitExtension>;
      if (extension !== undefined) {
        const gitExtension = extension.isActive ? extension.exports : await extension.activate();

        return gitExtension.getAPI(1);
      }
    } catch {}

    return;
  }

  async getActiveRepositories(): Promise<Repository[] | undefined> {
    const git = await this.getBuiltInGitApi();
    if (!git) return;

    return git.repositories;
  }

  async addRepo(root: Uri): Promise<ILocalRepo | undefined> {
    if (!this.api) {
      return;
    }

    const existingRepo = await this.getLocalRepoFor(root);
    // If the repo has already been added, return it.
    if (existingRepo) {
      return existingRepo;
    }

    const repo = await this.api.openRepository(root);
    if (repo !== null) {
      this.api.repositories.push(repo);
      return new LocalRepo(repo);
    }

    return undefined;
  }

  async getLocalRepoFor(uri: Uri): Promise<ILocalRepo | undefined> {
    if (!this.api) {
      return;
    }

    for (const repo of this.api.repositories) {
      // take the first one that matches
      if (uri.fsPath.startsWith(repo.rootUri.fsPath)) {
        return new LocalRepo(repo);
      }
    }

    return undefined;
  }

  getLocalRepoFrom(repo: Repository): ILocalRepo {
    return new LocalRepo(repo);
  }

  async getRemoteRepos(repo: ILocalRepo): Promise<readonly RemoteRepo[]> {
    const remotes: RemoteRepo[] = [];

    for (const remote of repo.remotes) {
      if (!remote.fetchUrl) {
        // exclude remotes with no fetchURL
        continue;
      }

      const rem: RemoteRepo = {
        localRepo: repo,
        fetchUrl: remote.fetchUrl,
        remoteName: remote.name,
      };
      if (remote.name === repo.currentRemoteName) {
        return [rem];
      }
      remotes.push(rem);
    }

    return remotes;
  }

  async getBranchType(repo: ILocalRepo, name: string): Promise<RefType | undefined> {
    const branch = await repo.getBranch(name);
    if (branch) {
      return branch.type;
    }

    return undefined;
  }

  async getCommitBranch(repo: ILocalRepo, commitSha: string): Promise<Branch | undefined> {
    return repo.getCommitBranch(commitSha);
  }
}

class LocalRepo implements ILocalRepo {
  constructor(private readonly repo: Repository) {}

  get rootUri(): Uri {
    return this.repo.rootUri;
  }

  get remotes(): RemoteInfo[] {
    return this.repo.state.remotes;
  }

  get currentRemoteName(): string | undefined {
    return this.repo.state.HEAD?.upstream?.remote;
  }

  get currentCommitSha(): string | undefined {
    return this.repo.state.HEAD?.commit;
  }

  get currentRefName(): string | undefined {
    return this.repo.state.HEAD?.name;
  }

  get remoteTrackingBranch(): string | undefined {
    return this.repo.state.HEAD?.upstream?.name;
  }

  async getCommitSha(ref: string): Promise<string> {
    const commit = await this.repo.getCommit(ref);
    return commit.hash;
  }

  async getBranch(name: string): Promise<Branch | undefined> {
    try {
      const branch = await this.repo.getBranch(name);
      return branch;
    } catch (e: any) {
      return undefined;
    }
  }

  async checkout(ref: string): Promise<void> {
    await this.repo.checkout(ref);
  }

  async pull(): Promise<void> {
    await this.repo.pull();
  }

  async fetch(ref?: string): Promise<void> {
    await this.repo.fetch(undefined, ref);
  }

  async show(ref: string, path: string): Promise<string | undefined> {
    try {
      const trimmedPath = path.startsWith("/") ? path.substr(1) : path;
      const workingDirectory = this.repo.rootUri.fsPath;
      return await execShell(`git show ${ref}:${trimmedPath}`, workingDirectory);
    } catch (e: any) {
      return undefined;
    }
  }

  async getCommitBranch(commitSha: string): Promise<Branch | undefined> {
    let commit: Commit;
    try {
      commit = await this.repo.getCommit(commitSha);
    } catch {
      return undefined;
    }

    const workingDirectory = this.repo.rootUri.fsPath;
    const execResult = await execShell(
      `git branch -a --contains ${commitSha} --format="%(refname:short)\t%(HEAD)"`,
      workingDirectory
    );

    const branches = parseBranchContainsResult(execResult);

    // choose branch
    const branchName = chooseBranchName(branches);
    if (branchName) {
      return this.getBranch(branchName);
    }

    return undefined;
  }

  async getDiffWithHead(): Promise<string | undefined> {
    const workingDirectory = this.repo.rootUri.fsPath;
    let diff: string;
    try {
      const execResult = await execShell(`git diff HEAD`, workingDirectory);
      diff = execResult;
    } catch (e: any) {
      console.error(e);
      return undefined;
    }

    return diff;
  }
}

function chooseBranchName(branches: ParsedBranch[]): string | undefined {
  if (branches.length === 0) return;

  // 1. prefer HEAD
  const head = branches.filter((b) => b.isHead)[0];
  if (head) {
    return head.branch;
  }

  // 2. prefer main|master, then a named branch then origin/main|master, then any remote with main/master
  const preferredBranchPatterns = [
    /^main$/,
    /^master$/,
    /^[\/]+$/,
    /^origin\/main$/,
    /^origin\/master$/,
    /^[\/]+\/main$/,
    /^[\/]+\/master$/,
  ];
  for (const pattern of preferredBranchPatterns) {
    const matches = branches.filter((b) => b.branch.match(pattern));
    if (matches.length > 0) {
      return matches[0].branch;
    }
  }

  // 3. finally, just return the first branch (if there is one)
  return branches[0].branch;
}

type ParsedBranch = { branch: string; isHead: boolean };
function parseBranchContainsResult(execResult: string): ParsedBranch[] {
  const lines = execResult.split("\n");
  return lines.map((line) => {
    const [branch, star] = line.split("\t");
    return {
      branch,
      isHead: star === "*",
    };
  });
}
