import { Uri } from "vscode";
import { CaptureSnippetRequest } from "../../../common/src/backend/interfaces";
import { LineRange, RemoteReferencePastedClientEvent } from "../../../common/src/events/events";
import { createGitHTTPSBasedFetchURL } from "../../../common/src/model/git";
import { getLanguageModeFromFilepath } from "../../../common/src/model/modes";
import { UNKNOWN_USER_ID } from "../../../common/src/model/notebook-dom";
import { ClientEditors, Origins } from "../../../common/src/util/metadata";
import { splitLines } from "../../../common/src/util/text";
import { CoPilot } from "../copilot/copilot";
import { ProgressTask } from "../ui";
import { SharedCommandServices } from "./services";

export interface RemoteReferencePasteUI {
  showTaskProgress(message: string, task: ProgressTask): Promise<any>;
  showError(code: "file-not-found", message?: string): Promise<any>;
  showUpgradePrompt(): Promise<boolean>;
}

export class RemoteReferencePasteCommand {
  constructor(
    private readonly ui: RemoteReferencePasteUI,
    private readonly copilot: CoPilot,
    private readonly services: SharedCommandServices
  ) {}

  async run({ event }: { event: RemoteReferencePastedClientEvent }): Promise<any> {
    if (!this.services.hasMinimumVersionInstalled) {
      return this.ui.showUpgradePrompt();
    }

    const { git, auth } = this.services;

    const { filepath, repo, commitSha } = event.source;
    const fetchURL = createGitHTTPSBasedFetchURL(repo);

    const absoluteFilepath = await this.copilot.getAbsoluteFilePathAndMaybeShowError(
      { action: "remote", event },
      fetchURL,
      filepath
    );
    if (!absoluteFilepath) {
      return;
    }

    const localRepo = await git.getLocalRepoFor(Uri.file(absoluteFilepath));
    if (!localRepo) {
      // file exists in the right place, but that place is not (no longer?) a Git repo
      return this.ui.showError("file-not-found");
    }

    // find branch
    const branch = await git.getCommitBranch(localRepo, commitSha);

    // get source
    const contents = await localRepo.show(commitSha, filepath);
    if (contents === undefined) {
      return this.ui.showError("file-not-found");
    }

    const snippet = parseSnippetFromContents(contents, event.source.lineRange);

    const request: CaptureSnippetRequest = {
      clientID: this.services.deviceStorage.getClientID()!,
      fileMode: getLanguageModeFromFilepath(filepath).canonical,
      note: "",
      notebookID: event.notebookID,
      snippet,
      source: {
        fetchURL,
        commitSha: commitSha,
        filepath,
        lineRange: event.source.lineRange ?? { from: 1, to: 1 },
        localBranch: branch?.name ?? null,
        remoteTrackingBranch: branch?.upstream?.name ?? null,
      },
      origin: Origins.REMOTE_REFERENCE,
      userID: auth.userID ?? UNKNOWN_USER_ID,
      ide: ClientEditors.VSCODE,
      targetNodeID: event.placeholderNodeID,
    };
    this.services.backendAPI.captureSnippet(request);
    this.copilot.handleCapture(request);
  }
}

function parseSnippetFromContents(contents: string, lineRange: LineRange | undefined): string {
  if (!lineRange) return contents;

  const lines = splitLines(contents);
  const from0 = Math.max(0, lineRange.from - 1);
  const to0 = Math.min(lines.length, lineRange.to);
  const snippetLines = lines.slice(from0, to0);
  return snippetLines.join("\n");
}
