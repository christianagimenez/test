import { Disposable, QuickPick, QuickPickItem, window } from "vscode";
import { Environment } from "../../../common/src/env/env";
import {
  NodeID,
  NotebookContent,
  NotebookHeader,
  UserID,
} from "../../../common/src/model/notebook-dom";
import { DeviceStorageService } from "../store";

export interface INotebookReader {
  getNotebookContent(notebookID: NodeID): Promise<NotebookContent | undefined>;
  getNotebookHeaderForUser(userID: UserID, notebookID: NodeID): Promise<NotebookHeader | undefined>;
}

export type NotebookChoice =
  | { type: "existing"; header: NotebookHeader | undefined }
  | { type: "new"; name: string | undefined }
  | { type: "multiple"; headers: NotebookHeader[] | undefined };

export class NotebookChooser implements Disposable {
  private readonly subscriptions: Disposable[] = [];
  private readonly createNewItem: NotebookQuickPickItem;
  private readonly quickPick: QuickPick<NotebookQuickPickItem>;
  private lastInputValue: string | undefined;

  constructor(
    private readonly notebookHeaders: readonly NotebookHeader[],
    private readonly env: Environment,
    private readonly notebookReader: INotebookReader,
    private readonly deviceStorage: DeviceStorageService,
    multiple: boolean = false,
    verb: string
  ) {
    this.handleChangeValue = this.handleChangeValue.bind(this);
    this.createNewItem = this.makeCreateNewItem();
    this.quickPick = this.create(multiple, verb);
  }

  private makeCreateNewItem(): NotebookQuickPickItem {
    return this.makeAlwaysShowItem(`$(diff-insert) Create new notebook...`, undefined);
  }

  private makeAlwaysShowItem(
    label: string,
    header: NotebookHeader | undefined,
    description?: string
  ): NotebookQuickPickItem {
    return { label, header, alwaysShow: true, description };
  }

  dispose() {
    this.subscriptions.forEach((d) => d.dispose());
  }

  async show(): Promise<NotebookChoice | undefined> {
    this.quickPick.show();

    return new Promise((resolve, reject) => {
      let choice: NotebookChoice | undefined;

      const handleAccept = () => {
        choice = this.choiceFrom(this.quickPick.selectedItems);
        this.quickPick.hide();
      };

      const handleHide = () => {
        resolve(choice);
        this.dispose();
      };

      this.quickPick.onDidAccept(handleAccept, this, this.subscriptions);
      this.quickPick.onDidHide(handleHide, this, this.subscriptions);
    });
  }

  private choiceFrom(selection: readonly NotebookQuickPickItem[]): NotebookChoice {
    if (this.quickPick.canSelectMany) {
      return { type: "multiple", headers: selection.map((qpi) => qpi.header!) };
    }

    const singleSelection = selection[0];
    return singleSelection === this.createNewItem
      ? { type: "new", name: this.lastInputValue }
      : { type: "existing", header: singleSelection.header! };
  }

  private create(multiple: boolean, verb?: string): QuickPick<NotebookQuickPickItem> {
    const qp = window.createQuickPick<NotebookQuickPickItem>();
    const items = this.notebookHeaders.map(toQuickPickItem);
    qp.items = multiple ? items : [...items, this.createNewItem];
    qp.placeholder = multiple
      ? `Choose one or more notebooks to ${verb}...`
      : `Choose notebook to ${verb}...`;
    qp.canSelectMany = multiple;
    qp.matchOnDescription = true;
    this.subscriptions.push(qp);

    qp.onDidChangeValue(this.handleChangeValue, this, this.subscriptions);

    return qp;
  }

  private async handleChangeValue(value: string) {
    this.lastInputValue = value;
    const baseURL = this.env.getEnvironmentVariables().WEB_HOST;
    const urlMatch = tryMatchNotebookURL(value, baseURL);
    const user = this.deviceStorage.getUser();
    if (user === undefined) {
      throw new Error("handleChangeValue: failed to get user");
    }
    if (urlMatch) {
      const { notebookID } = urlMatch;
      try {
        this.quickPick.busy = true;
        const header: NotebookHeader | undefined = await this.tryLoadNotebookHeader(
          user.id,
          notebookID
        );
        if (header) {
          const label = toNotebookLabel(header.name);
          const description = `from URL ${value}`;
          const matchedURLItem = this.makeAlwaysShowItem(label, header, description);
          this.quickPick.items = [matchedURLItem, ...this.quickPick.items];
        }
      } finally {
        this.quickPick.busy = false;
      }
    }
  }

  private tryLoadNotebookHeader(
    userID: UserID,
    notebookID: string
  ): Promise<NotebookHeader | undefined> {
    return this.notebookReader.getNotebookHeaderForUser(userID, notebookID);
  }
}

export function tryMatchNotebookURL(
  possibleURL: string,
  baseURL: string
): { notebookID: NodeID } | undefined {
  const nakedURLWithRegexCompatibleSlashes = new URL(baseURL).host.replace(/\//g, "\\/");
  const notebookURLPattern = new RegExp(
    `${nakedURLWithRegexCompatibleSlashes}\/(?:p\/)?([0-9a-zA-Z-_]+)`
    // `${nakedURLWithRegexCompatibleSlashes}\/p\/([0-9a-zA-Z-_]+)` // <== TODO: eventually we should switch to this once the old URL format is fully deprecated
  );
  const match = possibleURL.match(notebookURLPattern);
  if (!match) {
    return undefined;
  }

  return { notebookID: match[1] };
}

function toQuickPickItem(header: NotebookHeader): NotebookQuickPickItem {
  return {
    label: toNotebookLabel(header.name),
    header,
  };
}

function toNotebookLabel(name: string): string {
  return `$(repo) ${name}`;
}

interface NotebookQuickPickItem extends QuickPickItem {
  header: NotebookHeader | undefined;
}
