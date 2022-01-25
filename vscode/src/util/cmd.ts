import * as cp from "child_process";

export function execShell(cmd: string, wd: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    cp.exec(cmd, { cwd: wd }, (err, out) => {
      if (err) {
        console.error(err);

        return reject(err);
      }
      return resolve(out);
    });
  });
}
