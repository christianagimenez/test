import { StatusBarAlignment, StatusBarItem, ThemeColor, window } from "vscode";
import {
  ConnectionManager,
  ConnectionStateWithSource,
} from "../../../common/src/persistence/ConnectionManager";
import { DeviceStorageService } from "../store";
import { AuthManager, AuthStatus } from "./auth";

export class StatusBarManager {
  private authItem: StatusBarItem;
  private completeSetupItem: StatusBarItem;
  private connectionStates: ConnectionStateWithSource[];
  private authStatus: AuthStatus;

  constructor(
    private readonly auth: AuthManager,
    private readonly deviceStorage: DeviceStorageService,
    readonly connectionManager: ConnectionManager
  ) {
    this.authItem = window.createStatusBarItem(StatusBarAlignment.Left, 100);
    this.completeSetupItem = window.createStatusBarItem(StatusBarAlignment.Right, 100);
    this.authStatus = { type: "anonymous", uid: undefined };
    this.connectionStates = [];

    // auth status changes
    this.handleAuthStatusChanged = this.handleAuthStatusChanged.bind(this);
    auth.onAuthStatusChanged(this.handleAuthStatusChanged);

    // connection status changes
    this.handleConnectionStateChange = this.handleConnectionStateChange.bind(this);
    connectionManager.onStateChange(this.handleConnectionStateChange);

    this.updateAuthItem();
  }

  private handleConnectionStateChange(states: ConnectionStateWithSource[]) {
    this.connectionStates = states;
    this.updateAuthItem();
  }

  private handleAuthStatusChanged(status: AuthStatus) {
    this.authStatus = status;
    this.updateAuthItem();
  }

  private get isConnectedToWeb(): boolean {
    const webState = this.connectionStates.filter(({ source }) => source === "web")[0];
    return webState?.connected && webState.authenticatedAs === this.auth.userID;
  }

  private updateAuthItem() {
    let command: string | undefined;
    let color: ThemeColor;
    let icon: string = "";
    let connTooltip: string = "";
    let authTooltip: string = "";
    let initialTooltip: string | undefined;

    const hasCompletedSetup = this.deviceStorage.getHasCompletedSetup();

    // green when connected to NBs web, otherwise red
    if (this.isConnectedToWeb) {
      color = new ThemeColor("debugIcon.restartForeground"); // green
      connTooltip = "connected";
      icon = "$(primitive-dot)";
    } else {
      color = new ThemeColor("debugIcon.stopForeground"); // red
      connTooltip = "not connected. Click to connect!";
      icon = "$(debug-breakpoint-unverified)";
      command = "codelingo.openNotebooksHome";
    }

    if (!hasCompletedSetup) {
      command = "codelingo.completeSetup";
      initialTooltip = "Click to complete setup";
    } else if (this.isConnectedToWeb) {
      if (this.authStatus?.type === "authenticated") {
        const { email, uid } = this.authStatus;
        icon = "$(pass-filled)";
        authTooltip = ` (as ${email ?? uid})`;
      } else {
        authTooltip = ` (not logged in)`;
      }
    }

    this.authItem.command = command;
    this.authItem.color = color;
    this.authItem.text = `${icon}CL`;
    this.authItem.tooltip = `CodeLingo: ${initialTooltip ?? `${connTooltip}${authTooltip}`}`;
    this.authItem.show();
  }

  public hideCompleteSetupItem() {
    this.completeSetupItem.hide();
    this.updateAuthItem();
  }

  public showCompleteSetupItem() {
    (this.completeSetupItem as any).backgroundColor = new ThemeColor(
      "statusBarItem.errorBackground"
    );
    this.completeSetupItem.text = "Setup CodeLingo Notebooks";
    this.completeSetupItem.command = "codelingo.completeSetup";
    this.completeSetupItem.show();
  }
}
