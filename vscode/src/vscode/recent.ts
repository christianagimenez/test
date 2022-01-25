import * as os from "os";
import { extensions, Uri, window, workspace } from "vscode";

export async function go() {
  const result = await window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    title: "Open Folder for mrcrowl/swarm",
    defaultUri: Uri.file(os.homedir()),
  });

  console.log(result?.[0].fsPath);
}
