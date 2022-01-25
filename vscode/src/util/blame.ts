import { Range } from "vscode";
import { BlameCommit } from "../../../common/src/model/notebook-dom";
import type { Dictionary } from "../../../common/src/util/dictionary";
import { ILocalRepo } from "../commands/interface";
import { BlameParser } from "./blameParser";
import { execShell } from "./cmd";

export async function getBlameInfoForRange(
  repo: ILocalRepo,
  relativeFilePath: string,
  range: Range,
  gitUserName: string,
  gitEmail: string
): Promise<Dictionary<BlameCommit>> {
  const blameInfo: Dictionary<BlameCommit> = {};
  const rawBlameOutput = await execShell(
    `git blame ${relativeFilePath} --date=unix --line-porcelain`,
    repo.rootUri.fsPath
  ).catch((error) => {
    console.error(error);
    throw new Error("failed to run git blame command");
  });

  const blameParser = new BlameParser(gitUserName, gitEmail);
  const blameByLine = blameParser.parseBlame(rawBlameOutput);
  const relevantBlame = blameByLine.slice(range.start.line, range.end.line + 1);

  for (const blame of relevantBlame) {
    const sha = blame.sha;
    if (blameInfo[blame.sha]) {
      blameInfo[sha].blameLines = [...blameInfo[sha].blameLines, ...blame.blameLines];
      continue;
    }

    blameInfo[sha] = blame;
  }

  return blameInfo;
}
