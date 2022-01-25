import { exec, spawn } from "child_process";
import * as os from "os";
import { extensions } from "vscode";
import { DeviceStorageService } from "../store";
import { IWindowManager } from "../ui";

export interface WindowManagerUI {
  showModalMessage(message: string, ...actions: string[]): Promise<string | undefined>;
}

export function createWindowManager(
  ui: WindowManagerUI,
  deviceStorage: DeviceStorageService
): IWindowManager {
  switch (os.platform()) {
    case "linux":
      return new LinuxWindowManager(ui, deviceStorage);
    case "win32":
      return new WindowsWindowManager(ui, deviceStorage);
    case "darwin":
      return new MacWindowManager(ui, deviceStorage);
    default:
      return new ModalInfoModal(ui, deviceStorage);
  }
}

class ModalInfoModal implements IWindowManager {
  constructor(
    private readonly ui: WindowManagerUI,
    private readonly deviceStorage: DeviceStorageService
  ) {}

  async focus(windowPattern: string): Promise<void> {
    this.maybeShowModal();
  }

  async maybeShowModal(): Promise<void> {
    // DEV: uncomment to reset
    // this.deviceStorage.setHasSeenClickthroughModal(false);

    if (this.deviceStorage.getHasSeenClickthroughModal()) {
      return;
    }

    const response = await this.ui.showModalMessage(
      "💡 Whenever you click a code snippet from a Notebook, it will highlight like this in VS Code\n\n(This message won't show again)",
      "Got it!"
    );

    if (response) {
      this.deviceStorage.setHasSeenClickthroughModal(true);
    }
  }
}

class MacWindowManager extends ModalInfoModal implements IWindowManager {
  constructor(ui: WindowManagerUI, deviceStorage: DeviceStorageService) {
    super(ui, deviceStorage);
  }

  async focus(windowPattern: string): Promise<void> {
    super.maybeShowModal();

    // Reportedly, on some macs, the foregoing does not focus the window, but
    // doing this does. On fwereade's, neither focuses the window.
    exec("code");
  }
}

class LinuxWindowManager extends ModalInfoModal implements IWindowManager {
  constructor(ui: WindowManagerUI, deviceStorage: DeviceStorageService) {
    super(ui, deviceStorage);
  }

  async focus(windowPattern: string): Promise<void> {
    super.maybeShowModal();

    const path = extensions.getExtension("codelingo.codelingo")?.extensionPath;
    if (!path) {
      console.error("LinuxWindowManager: cannot get extension path");
      return;
    }

    const binPath = `${path}/src/util/linux/xdotool`;
    exec(`${binPath} search "Visual Studio Code" windowactivate`);
  }
}

class WindowsWindowManager extends ModalInfoModal implements IWindowManager {
  constructor(ui: WindowManagerUI, deviceStorage: DeviceStorageService) {
    super(ui, deviceStorage);
  }

  async focus(windowPattern: string): Promise<void> {
    super.maybeShowModal();

    const path = extensions.getExtension("codelingo.codelingo")?.extensionPath;
    if (!path) {
      console.error("WindowsWindowManager: cannot get extension path");
      return;
    }

    const binPath = `${path}\\scripts\\windows\\focus.ps1`;
    const child = spawn("powershell.exe", ["-noprofile", "-file", binPath, windowPattern]);
    child.stdout.on("data", function (data) {
      console.log("Powershell Data: " + data);
    });
    child.stderr.on("data", function (data) {
      console.log("Powershell Errors: " + data);
    });
    child.on("exit", function () {
      console.log("Powershell Script finished");
    });
    child.stdin.end();
  }
}

class NoopWindowManager implements IWindowManager {
  public readonly focus = () => Promise.resolve();
}
