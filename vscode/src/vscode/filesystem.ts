import { FileSystemHelper } from "../copilot/copilot";
import { FileType, Uri, workspace } from "vscode";
import * as fs from "fs";

export class VSCodeFileSystem implements FileSystemHelper {
  async isGitRepoRoot(filepath: string): Promise<boolean> {
    const dirContents = await workspace.fs.readDirectory(Uri.file(filepath));
    return dirContents.some(([ext, type]) => ext === ".git" && type === FileType.Directory);
  }

  async exists(filepath: string): Promise<boolean> {
    return fs.existsSync(filepath);
  }
}
