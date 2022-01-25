import "firebase/auth";
import "firebase/database";
import { NotebookHeader } from "../../../common/src/model/notebook-dom";
import { IRealtimeDB, WatchDisposer } from "../../../common/src/persistence/IRealtimeDB";
import {
  makeTeamNotebookHeadersPath,
  makeUserNotebookHeadersPath,
} from "../../../common/src/schema";
import { CoPilot } from "../copilot/copilot";
import { DeviceStorageService, USER } from "../store";
import { AuthManager } from "./auth";

export class HeaderSync {
  private readonly watchDisposers: WatchDisposer[] = [];

  constructor(
    private readonly auth: AuthManager,
    private readonly db: IRealtimeDB,
    private readonly deviceStorage: DeviceStorageService,
    private readonly copilot: CoPilot
  ) {
    // auth.onAuthStatusChanged((e) => {
    //   this.refreshHeaders();
    // });
    deviceStorage.watchValue(USER, () => {
      this.refreshHeaders();
    });
  }

  async refreshHeaders() {
    const userID = this.auth.userID;
    if (userID === undefined) {
      this.disposeWatchers();
      this.deviceStorage.removeAllNotebooks();
      return;
    }

    this.disposeWatchers();

    // team headers
    await this.refreshTeamHeaders();

    // user headers
    await this.refreshUserHeaders(userID);
  }

  private disposeWatchers() {
    while (this.watchDisposers.length) {
      const disposer = this.watchDisposers.pop();
      disposer && disposer();
    }
  }

  private async refreshUserHeaders(userID: string) {
    const userNotebooksPath = makeUserNotebookHeadersPath(userID);
    const userDisposer = this.db.watchValue(userNotebooksPath, (snapshot) => {
      this.deviceStorage.removeUserNotebooks();

      const userHeaders: NotebookHeader[] | null = snapshot.val();
      console.log(`${userID}: header change in db`, JSON.stringify(userHeaders));
      if (userHeaders === null) return;
      Object.values(userHeaders).forEach((header) => this.deviceStorage.upsertHeader(header));
    });

    this.watchDisposers.push(userDisposer);
  }

  private async refreshTeamHeaders() {
    const firstTeamID = this.deviceStorage.getUser()?.teamIDs[0];
    if (firstTeamID !== undefined) {
      const teamDisposer = this.db.watchValue(
        makeTeamNotebookHeadersPath(firstTeamID),
        (snapshot) => {
          this.deviceStorage.removeTeamNotebooks();

          const teamHeaders: NotebookHeader[] | null = snapshot.val();
          if (teamHeaders === null) return;

          Object.values(teamHeaders).forEach((header) => this.deviceStorage.upsertHeader(header));
        }
      );
      this.watchDisposers.push(teamDisposer);
    } else {
      this.deviceStorage.removeTeamNotebooks();
    }
  }
}
