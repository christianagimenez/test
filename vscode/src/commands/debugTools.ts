import { Modes } from "../../../common/src/env/env";
import { NodeID, NotebookHeader } from "../../../common/src/model/notebook-dom";
import { DeviceStorageService } from "../store";

export interface DebugToolsUI {
  chooseString<T extends string>(strings: T[], placeHolder?: string): Promise<T | undefined>;
  warnModal<T extends string>(message: string, options: readonly T[]): Promise<T | undefined>;
  chooseMultipleNotebooks(
    notebooks: readonly NotebookHeader[],
    verb?: string
  ): Promise<NotebookHeader[]>;
  openTextEditorWithStringContents(contents: string, language?: string): Promise<void>;
}

const enum ToolOptions {
  DEREGISTER = "Deregister one or more notebooks",
  DUMP_SETTINGS = "Dump settings to editor",
  RESET_HOST_TYPES = "Reset host types",
  RESET = "Reset local settings",
}

const TOOL_OPTIONS = [
  ToolOptions.DEREGISTER,
  ToolOptions.DUMP_SETTINGS,
  ToolOptions.RESET_HOST_TYPES,
  ToolOptions.RESET,
];

export class DebugToolsCommand {
  constructor(
    private readonly ui: DebugToolsUI,
    private readonly deviceStorage: DeviceStorageService,
    private readonly mode: Modes
  ) {}

  async run(): Promise<any> {
    const tool = await this.ui.chooseString<ToolOptions>(
      TOOL_OPTIONS,
      "Choose a debugging tool..."
    );
    if (!tool) {
      return;
    }

    switch (tool) {
      case ToolOptions.DEREGISTER:
        return this.deregister();
      case ToolOptions.DUMP_SETTINGS:
        return this.dumpSettings();
      case ToolOptions.RESET_HOST_TYPES:
        return this.resetHostTypes();
      case ToolOptions.RESET:
        return this.reset();
      default:
        throw new Error(`Unexpected tool '${tool}'`);
    }
  }

  private async resetHostTypes() {
    await this.deviceStorage.deleteHostTypes();
  }

  private async dumpSettings() {
    const settings = this.deviceStorage.dump();
    const settingsJSON = JSON.stringify(settings, undefined, 2);
    await this.ui.openTextEditorWithStringContents(settingsJSON, "json");
  }

  private async deregister() {
    const notebooks = this.deviceStorage.getAllNotebookHeaders() ?? [];
    const selectedNotebooks = await this.ui.chooseMultipleNotebooks(notebooks, "deregister");
    if (selectedNotebooks.length === 0) {
      return;
    }

    const someNotebooks = quantifyNotebooks(selectedNotebooks.length, notebooks.length);
    const response = await this.ui.warnModal(
      `Are you sure you want to deregister ${someNotebooks}?`,
      ["Yes", "No"]
    );

    if (response === "Yes") {
      const notebookIDs: NodeID[] = selectedNotebooks.map((p) => p.id);
      this.deviceStorage.removeSelectedNotebooks(notebookIDs);
    }
  }

  private async reset() {
    const response = await this.ui.warnModal("Are you sure you want to reset Notebook settings?", [
      "Yes",
      "No",
    ] as const);

    if (response === "Yes") {
      this.deviceStorage.resetLocalData();
    }
  }
}

function quantifyNotebooks(numSelected: number, numNotebooks: number) {
  if (numSelected === numNotebooks) {
    return "ALL notebooks";
  }

  return numSelected === 1 ? "this notebook" : `${numSelected} notebooks`;
}
