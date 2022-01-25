import { OutputChannel, window } from "vscode";
import { ILogger } from "../commands/services";

export class VSCodeOutputLogger implements ILogger {
  private readonly channel: OutputChannel;

  constructor() {
    this.channel = window.createOutputChannel("CodeLingo");
    this.info("CodeLingo output started");
  }

  info(info: string) {
    this.channel.appendLine(`[INFO  ${timestamp()}] ${info}`);
  }

  debug(debug: string) {
    this.channel.appendLine(`[DEBUG ${timestamp()}] ${debug}`);
  }

  warn(error: string) {
    this.channel.appendLine(`[WARN ${timestamp()}] ${error}`);
  }

  error(error: string) {
    this.channel.appendLine(`[ERROR ${timestamp()}] ${error}`);
  }
}

function timestamp(): string {
  return new Date().toLocaleTimeString();
}
