import { EventEmitter } from "events";
import firebase from "firebase/app";
import "firebase/auth";
import "firebase/database";
import * as os from "os";
import * as path from "path";
import {
  commands,
  Disposable,
  ExtensionContext,
  ExtensionMode,
  languages,
  Uri,
  window,
  workspace,
} from "vscode";
import { BackendAPI } from "../../common/src/backend/api";
import { Environment, Modes } from "../../common/src/env/env";
import {
  ApplyPatchEvent,
  RemoteReferencePastedClientEvent,
  SnippetSelectedEvent,
} from "../../common/src/events/events";
import {
  ClientID,
  ClientInstallation,
  UNKNOWN_USER_ID,
  UserID,
} from "../../common/src/model/notebook-dom";
import { ConnectionManager } from "../../common/src/persistence/ConnectionManager";
import { FirebaseRealtimeDB } from "../../common/src/persistence/FirebaseRealtimeDB";
import { IRealtimeDB } from "../../common/src/persistence/IRealtimeDB";
import { NotebookData } from "../../common/src/persistence/NotebookData";
import { UserData } from "../../common/src/persistence/UserData";
import { TrackerEvent } from "../../common/src/tracking/events";
import { createNodeMetadata, Origins } from "../../common/src/util/metadata";
import { GraphQLAPI } from "./api/graphql";
import { AddToNotebookCommand } from "./commands/addToNotebook";
import { ApplyPatchCommand } from "./commands/applyPatch";
import { CaptureDiffCommand } from "./commands/captureDiff";
import { NotebookCodeActionsProvider } from "./commands/codeActions";
import { CompleteSetupCommand } from "./commands/completeSetup";
import { CreateTeamCommand } from "./commands/createTeam";
import { DebugToolsCommand } from "./commands/debugTools";
import { ContextInferer, ExplorerContext } from "./commands/infer";
import { LogInCommand } from "./commands/logIn";
import { OpenNotebookCommand } from "./commands/openNotebook";
import { OpenNotebooksHomeCommand } from "./commands/openNotebooksHome";
import { RelevantNotebooksCommand } from "./commands/relevantNotebooks";
import { RemoteReferencePasteCommand } from "./commands/remoteReferencePaste";
import { SharedCommandServices } from "./commands/services";
import { ShareSnippetCommand } from "./commands/shareSnippet";
import { CodePresenter, CoPilot } from "./copilot/copilot";
import { FirebaseClientEventPubSub } from "./realtime/clientEventPubSub";
import { FirebaseVersionMonitor, IVersionChecker } from "./realtime/versionMonitor";
import { CodeReferences } from "./references/codeReferences";
import { NotebookDecorator } from "./references/notebookDecorator";
import { DeviceStorageService, RestartAction } from "./store";
import { MixpanelNodeJSEventTracker } from "./tracking/MixpanelNodeJSEventTracker";
import { IWindowManager, VSCodeUI } from "./ui";
import { execShell } from "./util/cmd";
import { shortIDGenerator } from "./util/ids";
import { AuthManager } from "./vscode/auth";
import { VSCodeDocumentManager } from "./vscode/document";
import { VSCodeTextEditor } from "./vscode/editor";
import { VSCodeFileSystem } from "./vscode/filesystem";
import { VSCodeGitExtension } from "./vscode/git";
import { HeaderSync } from "./vscode/headers";
import { VSCodeLocator } from "./vscode/locator";
import { VSCodeOutputLogger } from "./vscode/logging";
import { VSCodePresenter } from "./vscode/presenter";
import { StatusBarManager } from "./vscode/status";
import { NotebooksWebviewSidebar } from "./vscode/webview";
import { createWindowManager } from "./vscode/window";

const ENABLE_STAGING_STRING = "enable-staging-backend";
const ENABLE_BETA_STRING = "enable-beta-backend";
const ENABLE_DEVELOPMENT_STRING = "enable-development-backend";

export async function activate(context: ExtensionContext): Promise<void> {
  const mode = getEnvironmentMode(context);
  console.log(`active initial mode: ${mode}`);
  const env = new Environment(mode);
  const mixpanel = new MixpanelNodeJSEventTracker(env.getEnvironmentVariables());
  const firebaseSubscription = initFirebase(env);
  const db: IRealtimeDB = new FirebaseRealtimeDB(firebase.database());
  const notebookData = new NotebookData(db);
  const userData = new UserData(db);
  const emitter = new EventEmitter();
  const deviceStorage = new DeviceStorageService(context.globalState, env, emitter);
  updateLocalGitInfo(deviceStorage);
  const backendAPI = new BackendAPI(firebase.functions());

  const windowManager: IWindowManager = createWindowManager(
    {
      showModalMessage: async (message: string, ...actions: string[]) =>
        ui.showModalMessage(message, ...actions),
    },
    deviceStorage
  );

  const docManager = new VSCodeDocumentManager();
  const locator = new VSCodeLocator(docManager);
  const editor = new VSCodeTextEditor(window);
  const git = new VSCodeGitExtension();
  const inferer = new ContextInferer(editor, git, deviceStorage);
  const clientID = deviceStorage.ensureClientID();
  const clientPubSub = new FirebaseClientEventPubSub(clientID, db);
  const connectionManager = new ConnectionManager(
    clientID,
    deviceStorage.getAnonymousUserID(),
    "vscode",
    db,
    firebase.auth()
  );
  const auth = new AuthManager(
    firebase.auth(),
    firebase.database(),
    userData,
    deviceStorage,
    connectionManager,
    backendAPI
  );
  const statusBar = new StatusBarManager(auth, deviceStorage, connectionManager);
  const codeRefs = new CodeReferences(deviceStorage, notebookData);
  const decorator = new NotebookDecorator(env);
  const versionChecker: IVersionChecker = new FirebaseVersionMonitor(firebase.database());
  const logger = new VSCodeOutputLogger();
  const graphQLClient = new GraphQLAPI(
    env.getEnvironmentVariables().GRAPHQL_API_HOST,
    deviceStorage
  );
  const services = new SharedCommandServices(
    deviceStorage,
    shortIDGenerator,
    clientPubSub,
    notebookData,
    auth,
    inferer,
    mixpanel,
    logger,
    git,
    versionChecker,
    backendAPI,
    graphQLClient,
    userData,
    emitter
  );
  const ui = new VSCodeUI(env, windowManager, notebookData, statusBar, services);
  const presenter = new VSCodePresenter(docManager, ui);
  const fileSystem = new VSCodeFileSystem();
  const copilot = new CoPilot(presenter, locator, ui, fileSystem, codeRefs, services);
  new HeaderSync(auth, db, deviceStorage, copilot); // variable reference not used

  const currentInstallVersion = deviceStorage.getInstalledVersion();

  const codeActionsDisposer = languages.registerCodeActionsProvider(
    { scheme: "file" },
    new NotebookCodeActionsProvider(editor)
  );
  context.subscriptions.push(codeActionsDisposer);

  const webviewSidebar: NotebooksWebviewSidebar = new NotebooksWebviewSidebar(
    context.extensionUri,
    env,
    services
  );
  context.subscriptions.push(
    window.registerWebviewViewProvider(NotebooksWebviewSidebar.viewType, webviewSidebar, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    })
  );

  let gettingStartedPromptShown = false;

  clientPubSub.subscribe("authentication", auth.createAuthenticationHandler());
  auth.attemptSignInFromStorage().then((success) => {
    // Log event on the very first activation of the extension.
    if (deviceStorage.getIsInitialActivation()) {
      // Immediately set inital activation flag. This block will
      // not run again.
      deviceStorage.setIsInitialActivation();
      webviewSidebar.show();
      // If the current version is defined, the user had probably
      // installed prior to this flag being added, so only log install
      // event if the isInitialActivation flag is not set and they
      // have no version stored in deviceStorage.
      if (currentInstallVersion === undefined) {
        mixpanel.track(
          new TrackerEvent("vscode-plugin-installed", "ide", "ide-auto", null, {
            clientID,
            userID: auth.userID ?? UNKNOWN_USER_ID,
            notebookID: null,
          })
        );
      }
    }

    if (!success) {
      setTimeout(() => {
        deviceStorage.setAccessToken(undefined);
        if (
          !auth.isAuthenticated() &&
          !gettingStartedPromptShown &&
          deviceStorage.getHasCompletedSetup()
        ) {
          ui.showLogInPrompt();
        }
      }, 5000);
    }
  });

  const latestVer = env.getEnvironmentVariables().LATEST_VER;

  if (currentInstallVersion !== latestVer) {
    console.log(`${currentInstallVersion} <-- ${latestVer} (${clientID})`);

    mixpanel.track(
      new TrackerEvent("vscode-plugin-upgraded", "ide", "ide-auto", null, {
        clientID,
        userID: auth.userID ?? UNKNOWN_USER_ID,
        notebookID: null,
      }),
      {
        fromVersion: currentInstallVersion,
        toVersion: latestVer,
      }
    );

    const installation: ClientInstallation = createInstallation(
      clientID,
      auth.userID ?? UNKNOWN_USER_ID,
      latestVer
    );
    userData.logInstallation(installation);
    deviceStorage.setInstalledVersion(latestVer);
  }

  // Go through 'getting started' flow if this is the first time
  // they've activated or if they have aborted 'getting started'
  // in the past.

  if (!deviceStorage.getHasCompletedSetup()) {
    gettingStartedPromptShown = true;
    ui.showGettingStartedPrompt();
  }

  clientPubSub.subscribe<RemoteReferencePastedClientEvent>("remote-reference-pasted", (event) => {
    new RemoteReferencePasteCommand(ui, copilot, services).run({ event });
  });

  clientPubSub.subscribe<SnippetSelectedEvent>("snippet-selected", (e) => {
    copilot.handleSnippetSelectedEvent(e);
  });

  clientPubSub.subscribe<ApplyPatchEvent>("apply-patch", (event) => {
    new ApplyPatchCommand(ui, copilot, services, presenter).run({ event });
  });

  commands.executeCommand("setContext", "codelingo:gitenabled", true);
  const enabled = workspace.getConfiguration("git", null).get<boolean>("enabled", true);
  if (!enabled) {
    await ui.showError("git-disabled");
    return;
  }

  try {
    await git.initialise();
  } catch (ex: any) {
    commands.executeCommand("setContext", "codelingo:gitenabled", false);

    if (ex.message.includes("Unable to find git")) {
      await ui.showError("git-not-found");
    }

    return;
  }

  const relevantNotebooks = new RelevantNotebooksCommand(
    codeRefs,
    decorator,
    ui,
    services,
    getEnableReferencedNotebooksByDefault()
  );

  // explicitly decorate once when the data loads. Subsequent decoration calls are done via active editor listener.
  // init must be called to fetch code node data from DB
  const refreshDecorationsFn = () => relevantNotebooks.refreshDecorations();
  codeRefs.init().then(refreshDecorationsFn);

  const configListenerDisposable = workspace.onDidChangeConfiguration((event) => {
    const affected = event.affectsConfiguration("codelingo");
    if (affected) {
      const newMode = getEnvironmentMode(context);
      env.setMode(newMode);
      relevantNotebooks.defaultVisibility = getEnableReferencedNotebooksByDefault();
    }
  });
  context.subscriptions.push(configListenerDisposable);

  // Will potentially decorate the opened file unless the user has turned it off.
  const trackingSubs = Disposable.from(
    window.onDidChangeActiveTextEditor((e) => relevantNotebooks.handleChangedActiveTextEditor(e)),
    workspace.onDidChangeTextDocument((e) => relevantNotebooks.handleDidChangeTextDocument(e))
  );
  context.subscriptions.push(trackingSubs);

  emitter.addListener("snippet-captured", refreshDecorationsFn);

  const addToLastCommand = commands.registerCommand(
    "codelingo.addToLastNotebook",
    (isShortcut: boolean) =>
      new AddToNotebookCommand(ui, copilot, services).run({ useLastNotebook: true, isShortcut })
  );
  context.subscriptions.push(addToLastCommand);

  const shareSnippetCommand = commands.registerCommand(
    "codelingo.shareSnippet",
    (isShortcut: boolean) => new ShareSnippetCommand(ui, copilot, services).run({ isShortcut })
  );
  context.subscriptions.push(shareSnippetCommand);

  const createTeamCommandFn = () => new CreateTeamCommand(ui, services).run();
  const createTeamCommand = commands.registerCommand("codelingo.createTeam", createTeamCommandFn);
  context.subscriptions.push(createTeamCommand);

  const runOpenNotebookFn = () => new OpenNotebookCommand(ui, copilot, services).run();
  const openCommand = commands.registerCommand("codelingo.openNotebook", runOpenNotebookFn);
  context.subscriptions.push(openCommand);

  const runCaptureDiffFn = () => new CaptureDiffCommand(ui, copilot, services).run();
  const captureDiffCommand = commands.registerCommand("codelingo.captureDiff", runCaptureDiffFn);
  context.subscriptions.push(captureDiffCommand);
  const logError = (error: any) =>
    mixpanel.track(
      new TrackerEvent("error", "ide", "ide-auto", null, {
        clientID,
        userID: auth.userID ?? UNKNOWN_USER_ID,
        notebookID: null,
      }),
      { error }
    );

  context.subscriptions.push(
    Disposable.from(
      commands.registerCommand(
        "codelingo.showReferencedNotebooks",
        await catchAndLogWrapper(
          (isButtonPress: boolean) => relevantNotebooks.toggle(isButtonPress),
          logError
        )
      ),
      commands.registerCommand(
        "codelingo.showReferencedNotebooks_1",
        await catchAndLogWrapper(
          (isButtonPress: boolean) => relevantNotebooks.toggle(isButtonPress),
          logError
        )
      ),
      commands.registerCommand(
        "codelingo.hideReferencedNotebooks",
        await catchAndLogWrapper(
          (isButtonPress: boolean) => relevantNotebooks.toggle(isButtonPress),
          logError
        )
      )
    )
  );

  const addCommand = commands.registerCommand("codelingo.addToNotebook", (isShortcut: boolean) => {
    new AddToNotebookCommand(ui, copilot, services).run({ isShortcut });
  });
  context.subscriptions.push(addCommand);

  const addToPathCommand = commands.registerCommand("codelingo.addPathToNotebook", (uri: Uri) => {
    const explorerContext: ExplorerContext = {
      selectionUri: uri,
    };
    new AddToNotebookCommand(ui, copilot, services).run({ explorerContext });
  });
  context.subscriptions.push(addCommand);

  const debugCommand = commands.registerCommand("codelingo.debug", () =>
    new DebugToolsCommand(ui, deviceStorage, env.getMode()).run()
  );
  context.subscriptions.push(debugCommand);

  const logInCommand = commands.registerCommand("codelingo.logIn", () => {
    new LogInCommand(ui, services).run(clientID);
  });
  context.subscriptions.push(logInCommand);

  const completeSetupCommand = commands.registerCommand("codelingo.completeSetup", () => {
    new CompleteSetupCommand(ui, services).run(clientID);
  });
  context.subscriptions.push(completeSetupCommand);

  const openNotebooksHomeCommand = commands.registerCommand("codelingo.openNotebooksHome", () => {
    new OpenNotebooksHomeCommand(ui, services).run(clientID);
  });
  context.subscriptions.push(openNotebooksHomeCommand);

  // firebase event monitoring

  context.subscriptions.push(firebaseSubscription, clientPubSub);

  // Handle all events that were stored before extension restart.
  const actions = deviceStorage.emptyRestartActionsQueue();
  executeRestartActions(actions, copilot, ui, services, presenter);
}

function executeRestartActions(
  actions: RestartAction[] | undefined,
  copilot: CoPilot,
  ui: VSCodeUI,
  services: SharedCommandServices,
  presenter: CodePresenter
) {
  if (!actions) return;

  for (const action of actions) {
    switch (action.action) {
      case "capture":
        copilot.handleCapture(action.request);
        break;

      case "select":
        copilot.handleSnippetSelectedEvent(action.event);
        break;

      case "remote":
        new RemoteReferencePasteCommand(ui, copilot, services).run({ event: action.event });
        break;

      case "apply-patch":
        new ApplyPatchCommand(ui, copilot, services, presenter).run({ event: action.event });
        break;
    }
  }
}

function initFirebase(env: Environment) {
  if (Object.keys(firebase.apps).length > 0) {
    return { dispose() {} };
  }
  const vars = env.getEnvironmentVariables();
  const firebaseConfig = {
    apiKey: vars.API_KEY,
    authDomain: vars.AUTH_DOMAIN,
    databaseURL: vars.DATABASE_URL,
    projectId: vars.PROJECT_ID,
    storageBucket: vars.STORAGE_BUCKET,
    messagingSenderId: vars.MESSAGING_SENDER_ID,
    appId: vars.APP_ID,
    measurementId: vars.MEASUREMENT_ID,
  };

  firebase.initializeApp(firebaseConfig);

  return {
    dispose(): any {
      firebase.app().delete();
    },
  };
}

function getEnvironmentMode(context: ExtensionContext): Modes {
  const inferredMode = context.extensionMode === ExtensionMode.Development ? "development" : "beta";
  const devFlags = workspace.getConfiguration("codelingo").get("flags") as string;
  const mode = overrideModeFromFlagsWithFallback(devFlags, inferredMode);
  console.log(`Running codelingo extension in ${mode} mode`);
  return mode;
}

function getEnableReferencedNotebooksByDefault(): boolean {
  const enableDefaultVisibilityForDecorations: string | undefined = workspace
    .getConfiguration("codelingo")
    .get("showReferencedNotebooksInFiles");
  console.log(enableDefaultVisibilityForDecorations);

  return enableDefaultVisibilityForDecorations === "On by default";
}

function overrideModeFromFlagsWithFallback(devFlags: string, fallback: Modes): Modes {
  switch (devFlags) {
    case ENABLE_BETA_STRING:
      return "beta";
    case ENABLE_STAGING_STRING:
      return "staging";
    case ENABLE_DEVELOPMENT_STRING:
      return "development";
    default:
      return fallback;
  }
}

function createInstallation(
  clientID: ClientID,
  userID: UserID,
  version: string
): ClientInstallation {
  const username = homedirName();
  const installation: ClientInstallation = {
    clientID,
    username,
    version,
    users: {
      [userID]: true,
    },
    ...createNodeMetadata(userID, Origins.INSTALLATION),
  };

  return installation;
}

function homedirName(): string {
  try {
    return path.basename(os.homedir());
  } catch {
    return "unknown";
  }
}

async function updateLocalGitInfo(store: DeviceStorageService) {
  await Promise.all([
    execShell("git config --get user.name", os.homedir())
      .then((name) => {
        store.setGitUserName(name.trim().replace(/\n/g, ""));
      })
      .catch((error) => {
        console.error(error);
      }),
    execShell("git config --get user.email", os.homedir())
      .then((email) => store.setGitUserEmail(email.trim().replace(/\n/g, "")))
      .catch((error) => {
        console.error(error);
      }),
  ]);
}

async function catchAndLogWrapper(
  fn: (...args: any[]) => any,
  log?: (error: any) => void
): Promise<(...args: any[]) => any> {
  return async () => {
    try {
      await fn();
    } catch (error: any) {
      console.error(error);
      log?.(JSON.stringify(error));
    }
  };
}

export function deactivate() {}
