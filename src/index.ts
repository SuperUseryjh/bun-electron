/**
 * Bun Electron - Main entry point
 *
 * A lightweight Electron alternative using Bun + WebView2
 */

export { App } from "./app";
export { BrowserWindow, type BrowserWindowOptions } from "./browser-window";
export { IpcMain, type IpcMainEvent } from "./ipc-main";
export { HostManager } from "./host-manager";

import { HostManager } from "./host-manager";
import { App } from "./app";
import { IpcMain } from "./ipc-main";
import path from "path";
import { fileURLToPath } from "url";

// Singleton instances
let host: HostManager;
let app: App;
let ipcMain: IpcMain;
let initialized = false;

/**
 * Initialize the Bun Electron runtime
 * Must be called before any other API
 */
export async function init(options: {
  hostPath?: string;
} = {}) {
  if (initialized) return { app, ipcMain, host };

  host = new HostManager();
  app = new App(host);
  ipcMain = new IpcMain(host);

  // Find the host binary
  const hostPath =
    options.hostPath ??
    path.join(process.cwd(), "build", "host", "WebViewHost.exe");

  await host.start(hostPath);
  initialized = true;

  return { app, ipcMain, host };
}

/**
 * Get the singleton instances
 */
export function getInstances() {
  if (!initialized) {
    throw new Error(
      "Bun Electron not initialized. Call init() first."
    );
  }
  return { app, ipcMain, host };
}