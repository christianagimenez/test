import {
  CancellationToken,
  commands,
  Disposable,
  Event,
  Uri,
  ViewColumn,
  WebviewView,
  WebviewViewProvider,
  WebviewViewResolveContext,
} from "vscode";
import { IEnvironment } from "../../../common/src/env/env";
import { Team } from "../../../common/src/model/auth";
import { NotebookHeader } from "../../../common/src/model/notebook-dom";
import { SharedCommandServices } from "../commands/services";
import { NOTEBOOK_STORAGE_KEY, USER, User } from "../store";

const sidebarCommands: { [key: string]: any } = {
  "create-team": () => commands.executeCommand("codelingo.createTeam"),
  login: () => commands.executeCommand("codelingo.logIn"),
};

class NotebooksWebviewInteractionHandler {
  constructor() {}

  handleMessage(type: string, payload: string) {
    return sidebarCommands[type]?.();
  }
}

export class NotebooksWebviewSidebar implements Disposable, WebviewViewProvider {
  type = "sidebar";
  public static readonly viewType = "activitybar.codelingo";

  private currentUser: User | undefined;
  private currentTeam: Team | undefined;
  private isLoading = true;
  private messageHandler = new NotebooksWebviewInteractionHandler();
  private disposable: Disposable | undefined;
  private webviewView?: WebviewView;

  public get onDidMessageReceive(): Event<any> {
    return this.webviewView!.webview.onDidReceiveMessage;
  }

  constructor(
    private readonly _extensionUri: Uri,
    private readonly env: IEnvironment,
    private readonly services: SharedCommandServices
  ) {
    this.updateUser();
    this.services.emitter.on(USER, () => {
      this.updateUser();
    });
    this.services.emitter.on(NOTEBOOK_STORAGE_KEY, () => {
      this.renderWebView();
    });
  }

  private updateUser() {
    this.currentUser = this.services.deviceStorage.getUser();
    this.updateTeamName();
  }

  private async updateTeamName() {
    if (!this.currentUser) {
      this.currentTeam = undefined;
      this.renderWebView();
      return;
    }

    const { teamIDs } = this.currentUser;
    const teamID = teamIDs.length > 0 ? teamIDs[0] : undefined;
    if (!teamID) {
      this.currentTeam = undefined;
      this.renderWebView();
      return;
    }

    const team = await this.services.userData.getTeam(teamID);
    if (!team) {
      return;
    }

    this.currentTeam = team;
    this.renderWebView();
  }

  public async resolveWebviewView(
    webviewView: WebviewView,
    context: WebviewViewResolveContext,
    _token: CancellationToken
  ) {
    this.webviewView = webviewView;

    this.webviewView.webview.onDidReceiveMessage((message) => {
      this.messageHandler.handleMessage(message.type, message.payload);
    });

    webviewView.webview.options = {
      // Allow scripts in the webview
      enableScripts: true,
      enableCommandUris: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this.getHtml();
    this.disposable = Disposable.from(webviewView.onDidDispose(this.onWebviewDisposed, this));
  }

  private renderWebView() {
    if (this.webviewView) {
      this.webviewView.webview.html = this.getHtml();
    }
  }

  private getHtml(): string {
    const fontFamily = "font-family: 'Source Sans Pro', sans-serif;";
    const webHost = this.env.getEnvironmentVariables().WEB_HOST;
    const baseButton = (id: string, label: string) =>
      `<button id=${id}-button style="background-color: rgba(143, 72, 255, 1); color: white; border-radius: 5px; padding: 10px; font-weight: 600; font-size: 20">${label}</button>`;
    const createTeamButton = baseButton("create-team", "Create Team");
    const logInButton = baseButton("login", "Log In");
    const teamNameLabel = `<h4 style="font-weight: normal;margin:0 0 10px 0;">You're in team</h4>
    <div><a href="${webHost}/team" style="text-decoration:none;font-size: 18px; color: #DCC6FF;">${this.currentTeam?.name}</a></div>`;

    const htmlContent = this.currentTeam
      ? teamNameLabel
      : this.currentUser
      ? createTeamButton
      : logInButton;

    // const htmlContent = teamNameLabel;
    const buttonType = this.currentUser ? "create-team" : "login";
    const headerLinks = this.generateHeaderLinks();

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Codelingo</title>
    </head>
    <body
      style="${fontFamily}"
    >
        <div id="root">
        <center>
          <h3 style="margin-bottom:30px;">CodeLingo Notebooks</h3>
          ${htmlContent}
        </center>
        ${this.currentTeam ? headerLinks : ""}
        </div>
        <script>
            (function() {
                const vscode = acquireVsCodeApi();
                const button = document.getElementById('${buttonType}-button');
                if (button) {
                  button.onclick = () => {
                    vscode.postMessage({
                        type: '${buttonType}',
                        payload: ''
                    });
                  };
                }
            }())
        </script>
    </body>
    </html>`;
  }

  private generateHeaderLinks() {
    const currHeaders = this.services.deviceStorage.getAllNotebookHeaders() ?? [];
    const userHeaders = currHeaders.filter((header) => !header.teamID);
    const teamHeaders = currHeaders.filter((header) => header.teamID);
    const webHost = this.env.getEnvironmentVariables().WEB_HOST;
    const svg = `<span style="padding-right:5px;display:inline-flex;vertical-align:middle;">
      <svg version="1.0" xmlns="http://www.w3.org/2000/svg"
      width="14" height="14" viewBox="0 0 168.000000 187.000000"
      preserveAspectRatio="xMidYMid meet">
        <g transform="translate(0.000000,187.000000) scale(0.100000,-0.100000)"
        fill="#6cb1ff" stroke="none">
        <path d="M252 1644 c-19 -13 -22 -24 -22 -80 0 -113 -51 -104 600 -104 649 0
        600 -8 600 100 0 108 49 100 -598 100 -488 0 -560 -2 -580 -16z"/>
        <path d="M250 1240 c-16 -16 -20 -33 -20 -80 0 -108 -49 -100 600 -100 649 0
        600 -8 600 100 0 108 49 100 -600 100 -547 0 -560 0 -580 -20z"/>
        <path d="M246 838 c-24 -34 -21 -133 4 -158 20 -20 33 -20 580 -20 649 0 600
        -8 600 100 0 108 50 100 -604 100 l-565 0 -15 -22z"/>
        <path d="M250 440 c-16 -16 -20 -33 -20 -80 0 -104 -14 -100 350 -100 297 0
        311 1 330 20 25 25 28 124 4 158 -15 22 -16 22 -330 22 -301 0 -315 -1 -334
        -20z"/>
        </g>
      </svg>
    </span>`;

    const createHeaderTitle = (label: "My" | "Team") =>
      `<center><h4 style="font-weight: normal;margin: 30px 0 10px 0; text-align: left;">${label} Notebooks</h4></center>`;
    const createHeaderLink = (header: NotebookHeader) => {
      return `<li style="padding:3px 0;overflow: hidden;white-space: nowrap;text-overflow: ellipsis;"><a style="color:#6cb1ff;text-decoration:none;" href="${webHost}/n/${header.id}" target="_blank">${svg}${header.name}</a></li>`;
    };

    const myNotebookLinks = userHeaders
      .map((header, i: number) => createHeaderLink(header))
      .join("");

    const teamNotebookLinks = teamHeaders
      .map((header, i: number) => createHeaderLink(header))
      .join("");

    return `
      ${myNotebookLinks.length > 0 ? createHeaderTitle("My") : ""}
      <ul style="padding:0;list-style-type: none;max-width:300px; margin: 0;">${myNotebookLinks}</ul>
      ${teamNotebookLinks.length > 0 ? createHeaderTitle("Team") : ""}
      <ul style="padding:0;list-style-type: none;max-width:300px;margin: 0 0 30px 0;">${teamNotebookLinks}</ul>
    `;
  }

  dispose() {
    this.disposable && this.disposable.dispose();
  }

  private onWebviewDisposed() {
    // this._onDidClose.fire();
  }

  get viewColumn(): ViewColumn | undefined {
    return undefined; // this._view._panel.viewColumn;
  }

  show() {
    this.webviewView?.show(false);
  }
}
