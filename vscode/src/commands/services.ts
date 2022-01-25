import EventEmitter from "events";
import { IBackendAPI } from "../../../common/src/backend/api";
import { FileSource, RemoteCaptureSource } from "../../../common/src/events/events";
import { GitHosts } from "../../../common/src/model/git";
import { UniqueIDGenerator } from "../../../common/src/model/ids";
import { NotebookData } from "../../../common/src/persistence/NotebookData";
import { UserData } from "../../../common/src/persistence/UserData";
import { IEventTracker } from "../../../common/src/tracking/interface";
import { GraphQLAPI } from "../api/graphql";
import { IClientEventPubSub } from "../realtime/clientEventPubSub";
import { IVersionChecker } from "../realtime/versionMonitor";
import { DeviceStorageService } from "../store";
import { AuthManager } from "../vscode/auth";
import { ContextInferer } from "./infer";
import { IGitExtension, RemoteRepo } from "./interface";

export class SharedCommandServices {
  constructor(
    readonly deviceStorage: DeviceStorageService,
    readonly uniqueIDGenerator: UniqueIDGenerator,
    readonly clientEventPubSub: IClientEventPubSub,
    readonly notebookData: NotebookData,
    readonly auth: AuthManager,
    readonly inferer: ContextInferer,
    readonly mixpanel: IEventTracker,
    readonly logger: ILogger,
    readonly git: IGitExtension,
    readonly versionChecker: IVersionChecker,
    readonly backendAPI: IBackendAPI,
    readonly graphQLAPI: GraphQLAPI,
    readonly userData: UserData,
    readonly emitter: EventEmitter
  ) {}

  public makeRemoteCapureSource(
    repo: RemoteRepo,
    fileSource: FileSource,
    explicitHostType: GitHosts | undefined
  ): RemoteCaptureSource {
    return {
      fetchURL: repo.fetchUrl,
      ...fileSource,
      ...explicitHostType && { hostType: explicitHostType }, // prettier-ignore
    };
  }

  public get hasMinimumVersionInstalled(): boolean {
    const { versionChecker, deviceStorage } = this;
    const installedVersion = deviceStorage.getInstalledVersion();
    return versionChecker.isGTEMinimumVersion(installedVersion);
  }
}

export interface ILogger {
  error(message: string): void;
  debug(message: string): void;
}
