import firebase from "firebase";
import "firebase/auth";
import "firebase/database";
import { Event, EventEmitter } from "vscode";
import { IBackendAPI } from "../../../common/src/backend/api";
import { ClientEvent } from "../../../common/src/events/events";
import { ClientInstallation, TeamID, UserID } from "../../../common/src/model/notebook-dom";
import { ConnectionManager } from "../../../common/src/persistence/ConnectionManager";
import { WatchDisposer } from "../../../common/src/persistence/IRealtimeDB";
import { UserData } from "../../../common/src/persistence/UserData";
import { makeClientInstallationPath } from "../../../common/src/schema";
import { NodeMetadata, updateNodeMetadata } from "../../../common/src/util/metadata";
import { DeviceStorageService } from "../store";

export type AuthStatus =
  | { type: "authenticated"; uid: string; email: string | undefined; teamID: TeamID | undefined }
  | { type: "anonymous"; uid: string | undefined };

export class AuthManager {
  private readonly authStatusEmitter: EventEmitter<AuthStatus>;
  private userWatchDisposer: WatchDisposer | undefined;

  constructor(
    private readonly auth: firebase.auth.Auth,
    private readonly db: firebase.database.Database,
    private readonly userData: UserData,
    private readonly deviceStorage: DeviceStorageService,
    private readonly connectionManager: ConnectionManager,
    private readonly backendAPI: IBackendAPI
  ) {
    this.authStatusEmitter = new EventEmitter();

    this.auth.onAuthStateChanged(this.handleAuthStateChange.bind(this));
  }

  public get onAuthStatusChanged(): Event<AuthStatus> {
    return this.authStatusEmitter.event;
  }

  createAuthenticationHandler(): (event: ClientEvent) => Promise<any> {
    return async (event: ClientEvent) => {
      if (event.type !== "authentication") {
        return;
      }

      const { userID, clientID, authenticationType } = event;

      if (authenticationType === "anonymous" || authenticationType === "sign-out") {
        this.deviceStorage.setAnonymousUserID(userID);
        this.connectionManager.setAnonymousUserID(userID);
        this.deviceStorage.setAccessToken(undefined);
      }

      const isSignInEvent = authenticationType === "sign-in" && event.credentialsJSON;

      await Promise.all([
        this.associateClientIDWithUserID(clientID, userID),
        isSignInEvent && this.attemptSignInFromCredentials(event.credentialsJSON!),
        authenticationType === "sign-out" && this.signOut(),
      ]);

      // Creating access token cannot run in parallel with the above due
      // to the fact that it requires the user to be authenticated first
      isSignInEvent && (await this.createAccessToken());
    };
  }

  private handleAuthStateChange(user: firebase.User | null) {
    if (user) {
      return this.handleSignedIn(user);
    }

    this.handleSignedOut();
  }

  private async handleSignedIn(user: firebase.User) {
    console.debug(`Signed in as ${user.uid}`);

    const teamIDs = await this.userData.getUserTeamIDs(user.uid);
    const email = user.email ?? undefined;

    this.userData.watchTeamsForUser(user.uid, (teamIDs: TeamID[] | undefined) => {
      this.deviceStorage.setUser({
        id: user.uid,
        email,
        teamIDs: teamIDs ?? [],
      });
    });

    // XXX: eventually this needs to support multiple teams
    const __HACK__firstTeamID: string | undefined = teamIDs[0];

    this.authStatusEmitter.fire({
      type: "authenticated",
      email,
      uid: user.uid,
      teamID: __HACK__firstTeamID,
    });
  }

  private handleSignedOut() {
    this.userWatchDisposer?.();
    this.userWatchDisposer = undefined;
    return this.deviceStorage.deleteUser();
  }

  get userID(): UserID | undefined {
    return this.deviceStorage.getUser()?.id ?? this.deviceStorage.getAnonymousUserID();
  }

  get teamID(): TeamID | undefined {
    return this.deviceStorage.getUser()?.teamIDs[0];
  }

  isAuthenticated() {
    const user = this.auth.currentUser;
    if (!user || user.isAnonymous) return false;

    return true;
  }

  async attemptSignInFromStorage(): Promise<boolean> {
    const user = this.deviceStorage.deserializeFirebaseUser();
    if (!user) {
      return false;
    }

    try {
      await firebase.auth().updateCurrentUser(user);
      // Creating access token cannot run in parallel with the above due
      // to the fact that it requires the user to be authenticated first
      await this.createAccessToken();
      return true;
    } catch (e: any) {
      console.error(`Failed to sign in from storage: ${e.message}`);
      this.signOut();
      return false;
    }
  }

  async attemptSignInFromCredentials(credentialsJSON: string) {
    if (!credentialsJSON) {
      await this.signOut();
      throw new Error("no creentials found file");
    }

    const creds = firebase.auth.AuthCredential.fromJSON(credentialsJSON);
    if (!creds) {
      await this.signOut();
      throw new Error("failed to parse credentials file");
    }

    try {
      const { user } = await this.auth.signInWithCredential(creds);
      if (!user) {
        throw new Error("signInWithCredential didn't include user");
      }

      this.deviceStorage.serializeFirebaseUser(user);
    } catch ({ code, message }) {
      await this.signOut();
      throw new Error(`authentication event failed: ${code} --> ${message}`);
    }
  }

  async signOut() {
    if (this.auth.currentUser) {
      await this.auth.signOut();
    }

    this.deviceStorage.deleteFirebaseUser();
    // this.deviceStorage.deleteUser(); <-- called by handleSignedOut()
    this.deviceStorage.setAccessToken(undefined);

    this.authStatusEmitter.fire({
      type: "anonymous",
      uid: this.deviceStorage.getAnonymousUserID(),
    });
  }

  async associateClientIDWithUserID(clientID: string, userID: string): Promise<any> {
    const path = makeClientInstallationPath("vscode", clientID);
    const installationSnapshot = await this.db.ref(path).once("value");
    const installation: ClientInstallation | undefined = installationSnapshot.val();
    if (!installation) {
      return;
    }

    if (installation.users?.[userID] === true) {
      return;
    }

    const metadata: NodeMetadata = updateNodeMetadata(installation, userID);
    const updatedInstallation: ClientInstallation = {
      ...installation,
      ...metadata,
      users: { ...installation.users, [userID]: true },
    };
    return this.db.ref(path).set(updatedInstallation);
  }

  async createAccessToken(): Promise<void> {
    try {
      const { token } = await this.backendAPI.createAuthToken({});
      this.deviceStorage.setAccessToken(token);
    } catch (e) {
      console.error(e);
      this.deviceStorage.setAccessToken(undefined);
    }
  }
}
