/**
 * BrowserWindow - creates and manages native windows with WebView2
 */

import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import path from "path";
import { HostManager } from "./host-manager";

export interface BrowserWindowOptions {
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  title?: string;
  center?: boolean;
  show?: boolean;
  webPreferences?: {
    devTools?: boolean;
  };
}

export class BrowserWindow extends EventEmitter {
  public id: string;
  public webContents: WebContents;

  private host: HostManager;
  private options: Required<BrowserWindowOptions>;
  private _closed = false;
  private _readyToShow = false;

  constructor(host: HostManager, opts: BrowserWindowOptions = {}) {
    super();
    this.id = randomUUID();
    this.host = host;
    this.options = {
      width: opts.width ?? 1024,
      height: opts.height ?? 768,
      x: opts.x ?? 0,
      y: opts.y ?? 0,
      title: opts.title ?? "Bun Electron",
      center: opts.center ?? true,
      show: opts.show ?? true,
      webPreferences: {
        devTools: opts.webPreferences?.devTools ?? false,
      },
    };

    this.webContents = new WebContents(this.id, host);
    this.webContents.on("ready-to-show", () => {
      this._readyToShow = true;
      this.emit("ready-to-show");
    });

    // Forward window events
    host.on("window_closed", (event) => {
      if (event.window_id === this.id) {
        this._closed = true;
        this.emit("closed");
      }
    });
  }

  /**
   * Create the window and navigate to a URL
   */
  async loadURL(url: string) {
    await this.host.createWindow({
      id: this.id,
      url,
      width: this.options.width,
      height: this.options.height,
      title: this.options.title,
      center: this.options.center,
    });
  }

  /**
   * Serve a local file and navigate to it
   */
  async loadFile(filePath: string) {
    const url = await StaticServer.serveFile(filePath);
    await this.loadURL(url);
  }

  /**
   * Close the window
   */
  async close() {
    if (!this._closed) {
      await this.host.closeWindow(this.id);
    }
  }

  /**
   * Set the window title
   */
  async setTitle(title: string) {
    await this.host.setTitle(this.id, title);
  }

  /**
   * Set window bounds
   */
  async setBounds(bounds: { width?: number; height?: number }) {
    await this.host.setSize(this.id, bounds);
  }

  /**
   * Show developer tools
   */
  async toggleDevTools() {
    await this.host.showDevTools(this.id);
  }

  get isClosed() {
    return this._closed;
  }

  get isReadyToShow() {
    return this._readyToShow;
  }
}

/**
 * WebContents - represents the renderer process of a window
 */
class WebContents extends EventEmitter {
  constructor(
    public windowId: string,
    private host: HostManager
  ) {
    super();

    host.on("ipc_message", (event) => {
      if (event.window_id === this.windowId && event.channel) {
        this.emit("ipc-message", event.channel, event.data);
      }
    });
  }

  /**
   * Send a message to the renderer
   */
  async send(channel: string, data: unknown) {
    await this.host.sendToRenderer(this.windowId, channel, data);
  }

  /**
   * Evaluate JavaScript in the renderer
   */
  async executeJavaScript(code: string): Promise<string> {
    return await this.host.eval(this.windowId, code);
  }
}

/**
 * StaticServer - serves local files for loadFile()
 */
class StaticServer {
  private static server: ReturnType<typeof Bun.serve> | null = null;
  private static port: number = 0;
  private static rootDir: string = "";

  static async serveFile(filePath: string): Promise<string> {
    const absPath = path.resolve(process.cwd(), filePath);
    const dir = path.dirname(absPath);

    if (this.server && this.rootDir !== dir) {
      this.server.stop();
      this.server = null;
    }

    if (!this.server) {
      this.rootDir = dir;

      this.server = Bun.serve({
        port: 0, // auto-assign free port
        async fetch(req) {
          const url = new URL(req.url);
          const filePath = path.join(dir, url.pathname);

          const file = Bun.file(filePath);
          const exists = await file.exists();
          if (!exists) {
            // Fallback to index.html (SPA support)
            const indexPath = path.join(dir, "index.html");
            const indexFile = Bun.file(indexPath);
            if (await indexFile.exists()) {
              return new Response(indexFile);
            }
            return new Response("Not Found", { status: 404 });
          }

          return new Response(file);
        },
      });

      this.port = this.server.port;
    }

    // Navigate to root for index.html, full path for other files
    const baseName = path.basename(absPath);
    const urlPath = baseName === "index.html" ? "/" : `/${encodeURI(baseName)}`;
    return `http://localhost:${this.port}${urlPath}`;
  }

  static stop() {
    if (this.server) {
      this.server.stop();
      this.server = null;
    }
  }
}