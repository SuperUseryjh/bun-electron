/**
 * App - application lifecycle management
 * Mimics the Electron `app` module API
 */

import { EventEmitter } from "events";
import { HostManager } from "./host-manager";

export class App extends EventEmitter {
  private host: HostManager;
  private _isReady = false;
  private readyCallbacks: Array<() => void> = [];

  constructor(host: HostManager) {
    super();
    this.host = host;

    host.on("ready", () => {
      this._isReady = true;
      this.emit("ready");
      for (const cb of this.readyCallbacks) {
        cb();
      }
      this.readyCallbacks = [];
    });

    host.on("window_closed", () => {
      // Check if any windows remain
      // (this is handled by checking BrowserWindow instances)
    });

    host.on("exited", (code: number) => {
      this.emit("quit", code);
    });
  }

  /**
   * Promise that resolves when the app is ready
   */
  whenReady(): Promise<void> {
    if (this._isReady) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.readyCallbacks.push(resolve);
    });
  }

  /**
   * Quit the application
   */
  async quit(): Promise<void> {
    await this.host.stop();
    process.exit(0);
  }

  get isReady(): boolean {
    return this._isReady;
  }

  /**
   * Get the path to various system directories
   */
  getPath(name: "home" | "appData" | "userData" | "temp"): string {
    switch (name) {
      case "home":
        return require("os").homedir();
      case "appData":
        return (
          process.env.APPDATA ||
          require("path").join(require("os").homedir(), "AppData", "Roaming")
        );
      case "userData":
        return require("path").join(
          this.getPath("appData"),
          "bun-electron"
        );
      case "temp":
        return require("os").tmpdir();
      default:
        return process.cwd();
    }
  }
}