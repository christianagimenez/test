import { EventEmitter } from "events";
import firebase from "firebase/app";
import { Memento } from "vscode";
import { CaptureSnippetRequest } from "../../common/src/backend/interfaces";
import { Environment } from "../../common/src/env/env";
import {
  ApplyPatchEvent,
  RemoteReferencePastedClientEvent,
  SnippetSelectedEvent,
} from "../../common/src/events/events";
import { GitHosts, makeRepoTripletKey, parseGitRemote } from "../../common/src/model/git";
import {
  ClientID,
  NodeID,
  NotebookHeader,
  TeamID,
  UserID,
} from "../../common/src/model/notebook-dom";
import { Dictionary } from "../../common/src/util/dictionary";
import { shortIDGenerator } from "./util/ids";

export const NOTEBOOK_STORAGE_KEY = "notebooks";
const RECENTLY_USED_NOTEBOOK_ID = "last-id";
const REPO_ROOT_PATHS = "repo-paths";
export const CLIENT_ID = "client-id";
export const USER = "user";
export const ANON_USER_ID = "anon-user-id";
const FIREBASE_USER = "firebase-user";
const HAS_COMPLETED_SETUP = "has-completed-setup";
const HAS_SEEN_CLICKTHROUGH_MODAL = "seen-clickthrough-modal";
const INSTALLED_VERSION = "installed-version";
const IS_INITIAL_ACTIVATION = "initial activation";
const GIT_CONFIG_USER_NAME = "git-user-name";
const GIT_CONFIG_USER_EMAIL = "git-user-email";
const RESTART_ACTIONS_QUEUE = "restart-actions";
const HOST_TYPES = "host-types";
export const ACCESS_TOKEN = "access-token";

const UNKNOWN_GIT_USER = "Unknown git user";

export type RestartAction =
  | { action: "capture"; request: CaptureSnippetRequest }
  | { action: "select"; event: SnippetSelectedEvent }
  | { action: "remote"; event: RemoteReferencePastedClientEvent }
  | { action: "apply-patch"; event: ApplyPatchEvent };

const notebookSortFn = (a: NotebookHeader, b: NotebookHeader) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

export class DeviceStorageService {
  constructor(
    private storage: Memento,
    private readonly env: Environment,
    private readonly emitter: EventEmitter
  ) {}

  public dump() {
    return {
      [this.prefixedKey(NOTEBOOK_STORAGE_KEY)]: this.getAllNotebookHeaders() ?? [],
      [this.prefixedKey(HOST_TYPES)]: this.getHostTypeMap(),
      [this.prefixedKey(RECENTLY_USED_NOTEBOOK_ID)]: this.getRecentlyUsedNotebook() ?? null,
      [this.prefixedKey(REPO_ROOT_PATHS)]: this.getRepoPaths(),
      [this.prefixedKey(CLIENT_ID)]: this.getClientID() ?? null,
      [this.prefixedKey(USER)]: this.getUser() ?? null,
      [this.prefixedKey(ANON_USER_ID)]: this.getAnonymousUserID() ?? null,
      [this.prefixedKey(FIREBASE_USER)]: this.deserializeFirebaseUser() ?? null,
      [this.prefixedKey(HAS_COMPLETED_SETUP)]: this.getHasCompletedSetup(),
      [this.prefixedKey(HAS_SEEN_CLICKTHROUGH_MODAL)]: this.getHasSeenClickthroughModal(),
      [this.prefixedKey(INSTALLED_VERSION)]: this.getInstalledVersion(),
      [this.prefixedKey(GIT_CONFIG_USER_NAME)]: this.getGitUserName(),
      [this.prefixedKey(GIT_CONFIG_USER_EMAIL)]: this.getGitUserEmail(),
      [this.prefixedKey(ACCESS_TOKEN)]: this.getAccessToken(),
    };
  }

  public getNotebookHeader(notebookID: NodeID): NotebookHeader | undefined {
    const notebooks = this.getAllNotebookHeaders();
    return notebooks?.find((p) => p.id === notebookID);
  }

  public getAllNotebookHeaders(): NotebookHeader[] | undefined {
    const unsortedNotebooks = this.get<NotebookHeader[] | undefined>(
      NOTEBOOK_STORAGE_KEY,
      undefined
    );

    if (!unsortedNotebooks) {
      return;
    }

    const sortedNotebooks = unsortedNotebooks.slice().sort(notebookSortFn);

    const lastUsedID = this.getRecentlyUsedNotebook();
    if (lastUsedID) {
      const lastUsedNotebookIndex = sortedNotebooks.findIndex((p) => p.id === lastUsedID);
      if (lastUsedNotebookIndex) {
        const [lastUsedNotebook] = sortedNotebooks.splice(lastUsedNotebookIndex, 1);
        sortedNotebooks.unshift(lastUsedNotebook);
      }
    }

    return sortedNotebooks;
  }

  // XXX Dev only. Remove
  public resetLocalData() {
    this.removeAllNotebooks();
    this.set(REPO_ROOT_PATHS, undefined);
    this.setHasSeenClickthroughModal(false);
    this.setHasCompletedSetup(false);
    this.setRecentlyUsedNotebook(undefined);
    this.setInstalledVersion(undefined);
    this.deleteClientID();
    this.deleteUser();
    this.deleteAnonymousUserID();
    this.deleteFirebaseUser();
  }

  public removeAllNotebooks() {
    this.setNotebookHeaders(undefined);
  }

  public removeUserNotebooks() {
    this.removeNotebooksUsingFilter((pb) => !pb.teamID);
  }

  public removeTeamNotebooks() {
    this.removeNotebooksUsingFilter((pb) => typeof pb.teamID === "string");
  }

  public removeSelectedNotebooks(selectedNotebookIDs: NodeID[]) {
    this.removeNotebooksUsingFilter((p) => selectedNotebookIDs.includes(p.id));

    // clear the recently used notebook if it is not longer present
    const lastUsedID = this.getRecentlyUsedNotebook();
    if (lastUsedID && this.doesNotebookHeaderExist(lastUsedID)) {
      this.setRecentlyUsedNotebook(undefined);
    }
  }

  private doesNotebookHeaderExist(notebookID: NodeID): boolean {
    return this.getNotebookHeader(notebookID) !== undefined;
  }

  private removeNotebooksUsingFilter(filterFn: (notebook: NotebookHeader) => boolean) {
    const notebooks = this.getAllNotebookHeaders();
    if (!notebooks) return;

    const newNotebooks = notebooks.filter((pb) => !filterFn(pb)); // negated because we keep everything except what we've filtered out
    this.setNotebookHeaders(newNotebooks);
  }

  // ensureClientID returns the client ID from local storage.
  // It will create and add the ID to local storage if none exists.
  public ensureClientID(): string {
    let clientID = this.getClientID();
    if (!clientID) {
      clientID = shortIDGenerator.nextID();
      this.setClientID(clientID);
    }

    return clientID;
  }

  // ensureNotebook ensures that we have a local storage entry for the notebook
  public upsertHeader(notebook: NotebookHeader) {
    const currNotebooks = this.getAllNotebookHeaders() ?? [];
    const match = currNotebooks.find((p) => p.id === notebook.id);
    if (!match) {
      this.setNotebookHeaders([...currNotebooks, notebook]);
    } else if (match.name !== notebook.name) {
      // name changed?
      const otherNotebooks = currNotebooks.filter((p) => p.id !== notebook.id);
      const notebookWithUpdatedName = currNotebooks
        .filter((p) => p.id === notebook.id)
        .map((p) => ({ ...p, name: notebook.name }))[0];
      this.setNotebookHeaders([...otherNotebooks, notebookWithUpdatedName]);
    }
  }

  public getRecentlyUsedNotebook(): NodeID | undefined {
    return this.get(RECENTLY_USED_NOTEBOOK_ID);
  }

  public setRecentlyUsedNotebook(notebookID: NodeID | undefined) {
    this.set(RECENTLY_USED_NOTEBOOK_ID, notebookID);
  }

  private getRestartActions(): RestartAction[] | undefined {
    return this.get<RestartAction[] | undefined>(RESTART_ACTIONS_QUEUE);
  }

  private setRestartActions(queue: RestartAction[] | undefined) {
    if (!queue || queue.length === 0) {
      this.set(RESTART_ACTIONS_QUEUE, undefined);
      return;
    }

    this.set(RESTART_ACTIONS_QUEUE, queue);
  }

  public pushRestartAction(event: RestartAction): void {
    const existingQueue = this.getRestartActions();

    if (!existingQueue) {
      this.setRestartActions([event]);
      return;
    }

    this.setRestartActions([...existingQueue, event]);
  }

  public emptyRestartActionsQueue(): RestartAction[] | undefined {
    const queue = this.getRestartActions();
    this.setRestartActions(undefined);
    return queue;
  }

  getGitUserName(): string {
    return this.get(GIT_CONFIG_USER_NAME, UNKNOWN_GIT_USER);
  }

  setGitUserName(name: string) {
    if (name === "") return;
    this.set(GIT_CONFIG_USER_NAME, name);
  }

  getGitUserEmail(): string {
    return this.get(GIT_CONFIG_USER_EMAIL, UNKNOWN_GIT_USER);
  }

  setGitUserEmail(email: string) {
    if (email === "") return;
    this.set(GIT_CONFIG_USER_EMAIL, email);
  }

  getRepoRootPath(fetchURL: string): string | undefined {
    const paths = this.getRepoPaths();
    const urlValue = paths[fetchURL];
    if (urlValue !== undefined) {
      return urlValue;
    }

    // try to find an alias for the remote by comparing triplet
    const triplet = parseGitRemote(fetchURL);
    if (triplet !== undefined) {
      const tripletKey = makeRepoTripletKey(triplet);
      for (const knownFetchURL in paths) {
        const parsedTriplet = parseGitRemote(knownFetchURL);
        if (parsedTriplet && tripletKey === makeRepoTripletKey(parsedTriplet)) {
          const path = paths[knownFetchURL];
          this.setRepoPath(fetchURL, path);
          return path;
        }
      }
    }

    return undefined;
  }

  async trackRepoRootPath(fetchURL: string, path: string): Promise<boolean> {
    const existingPath = this.getRepoRootPath(fetchURL);
    if (existingPath !== path) {
      await this.setRepoPath(fetchURL, path);
      return true;
    }

    return false;
  }

  private getRepoPaths(): RepoPathLookup {
    return this.get<RepoPathLookup>(REPO_ROOT_PATHS, {});
  }

  private async setRepoPath(fetchURL: string, path: string) {
    const paths = this.getRepoPaths();
    paths[fetchURL] = path;

    await this.set(REPO_ROOT_PATHS, paths);
  }

  public getClientID(): ClientID | undefined {
    return this.get<string | undefined>(CLIENT_ID, undefined);
  }

  public deleteClientID(): void {
    this.set(CLIENT_ID, undefined);
  }

  private setClientID(clientID: ClientID): void {
    this.set(CLIENT_ID, clientID);
  }

  /** This method should only be used with AuthManager. Always prefer AuthManager.userID which takes anonymous userID into account. */
  public getUser(): User | undefined {
    return this.get<User | undefined>(USER, undefined);
  }

  public deleteUser(): void {
    this.set(USER, undefined);
  }

  public setUser(user: User): void {
    this.set(USER, user);
  }

  public getAnonymousUserID(): UserID | undefined {
    return this.get<UserID | undefined>(ANON_USER_ID, undefined);
  }

  public deleteAnonymousUserID(): void {
    this.set(ANON_USER_ID, undefined);
  }

  public setAnonymousUserID(userID: UserID): void {
    this.set(ANON_USER_ID, userID);
  }

  public serializeFirebaseUser(user: firebase.User) {
    const serializableUser = user.toJSON();
    this.set(FIREBASE_USER, serializableUser);
  }

  public deserializeFirebaseUser(): firebase.User | undefined {
    const userData = this.get<any>(FIREBASE_USER);
    if (!userData) {
      return;
    }

    const user = new (firebase as any).User(
      userData,
      userData.stsTokenManager,
      userData
    ) as firebase.User;
    return user;
  }

  public get hasFirebaseUser(): boolean {
    return !!this.get<any>(FIREBASE_USER);
  }

  public deleteFirebaseUser() {
    this.set(FIREBASE_USER, undefined);
  }

  public getHasCompletedSetup(): boolean {
    return this.get<boolean>(HAS_COMPLETED_SETUP, false);
  }

  public setHasCompletedSetup(value: boolean) {
    this.set(HAS_COMPLETED_SETUP, value);
  }

  public setHasSeenClickthroughModal(value: boolean) {
    this.set(HAS_SEEN_CLICKTHROUGH_MODAL, value);
  }

  public getHasSeenClickthroughModal(): boolean {
    return this.get<boolean>(HAS_SEEN_CLICKTHROUGH_MODAL, false);
  }

  public setInstalledVersion(value: string | undefined): void {
    this.set(INSTALLED_VERSION, value);
  }

  public getInstalledVersion(): string | undefined {
    return this.get<string>(INSTALLED_VERSION);
  }

  public getIsInitialActivation(): boolean {
    return this.get<boolean>(IS_INITIAL_ACTIVATION, true);
  }

  // Sets IS_INITIAL_ACTIVATION to false. Cannot be changed again.
  public setIsInitialActivation(): void {
    this.set(IS_INITIAL_ACTIVATION, false);
  }

  private getHostTypeMap(): Dictionary<GitHosts> {
    return this.get<Dictionary<GitHosts>>(HOST_TYPES, {});
  }

  public getHostTypeForServer(server: string): GitHosts | undefined {
    const hostTypesMap = this.getHostTypeMap();
    const hostType = hostTypesMap[server.toLowerCase()] as GitHosts | undefined;
    return hostType;
  }

  public async setHostTypeForServer(server: string, hostType: GitHosts) {
    const hostTypesMap = this.getHostTypeMap();

    await this.set(HOST_TYPES, {
      ...hostTypesMap,
      [server]: hostType,
    });
  }

  public deleteHostTypes() {
    return this.set(HOST_TYPES, undefined);
  }

  // We MUST use this as the ONLY way to set headers in storage.
  // We do not anticipate an empty array being stored under this key.
  private setNotebookHeaders(headers: NotebookHeader[] | undefined) {
    if (headers && headers.length === 0) {
      this.set(NOTEBOOK_STORAGE_KEY, undefined);
      return;
    }

    this.set(NOTEBOOK_STORAGE_KEY, headers);
  }

  private prefixedKey(key: string): string {
    const mode = this.env.getMode();
    if (mode === "beta") {
      return key;
    }

    return `${mode}:${key}`;
  }

  private async set(key: string, value: any): Promise<void> {
    await this.storage.update(this.prefixedKey(key), value);
    this.emitter.emit(key);
  }

  private get<T>(key: string): T | undefined;
  private get<T>(key: string, defaultValue: T): T;
  private get<T>(key: string, defaultValue?: T): T | undefined {
    if (!defaultValue) {
      return this.storage.get<T>(this.prefixedKey(key));
    }

    return this.storage.get<T>(this.prefixedKey(key), defaultValue);
  }

  watchValue(key: string, callback: (value: any) => void) {
    this.emitter.on(key, callback);
  }

  getAccessToken(): string | undefined {
    return this.get<string>(ACCESS_TOKEN);
  }

  setAccessToken(accessToken: string | undefined) {
    this.set(ACCESS_TOKEN, accessToken);
  }
}

interface RepoPathLookup {
  [key: string]: string;
}

export interface User {
  readonly id: UserID;
  readonly email: string | undefined;
  readonly teamIDs: TeamID[];
}
