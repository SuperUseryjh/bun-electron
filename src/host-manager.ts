/**
 * HostManager - manages the C# WebView2 host process lifecycle
 * and provides JSON-RPC style communication over stdin/stdout
 */

import { EventEmitter } from "events";

export interface HostEvent {
  event: string;
  window_id?: string;
  channel?: string;
  data?: string;
  message?: string;
  result?: string;
  error?: string;
}

export class HostManager extends EventEmitter {
  private proc: Bun.Subprocess | null = null;
  private _ready = false;
  private _readyPromise: Promise<void>;
  private _resolveReady!: () => void;
  private _pendingEval = new Map<
    string,
    { resolve: (v: string) => void; reject: (e: Error) => void }
  >();

  constructor() {
    super();
    this._readyPromise = new Promise((resolve) => {
      this._resolveReady = resolve;
    });
  }

  get ready() {
    return this._ready;
  }

  get readyPromise() {
    return this._readyPromise;
  }

  get pid() {
    return this.proc?.pid;
  }

  get running() {
    return this.proc !== null && this.proc.killed === false;
  }

  async start(hostPath: string) {
    if (this.proc) {
      await this.stop();
    }

    // Ensure the binary exists
    const file = Bun.file(hostPath);
    const exists = await file.exists();
    if (!exists) {
      throw new Error(
        `Host binary not found at: ${hostPath}\nRun "bun run build:host" first.`
      );
    }

    // Spawn the C# host process
    this.proc = Bun.spawn([hostPath], {
      stdio: ["pipe", "pipe", "inherit"],
      env: {
        ...process.env,
        DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: "1",
      },
    });

    // Read stdout line by line
    const reader = (this.proc.stdout as any).getReader() as ReadableStreamDefaultReader<Uint8Array>;
    this.readStdout(reader).catch((err) => {
      this.emit("error", err);
    });

    // Handle process exit
    this.proc.exited.then((code) => {
      this._ready = false;
      this.emit("exited", code);
    });

    // Wait for first event to confirm host is alive
    await this._readyPromise;
  }

  private async readStdout(
    reader: ReadableStreamDefaultReader<Uint8Array>
  ) {
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const event = JSON.parse(trimmed) as HostEvent;
          this.handleEvent(event);
        } catch (e) {
          // Ignore malformed JSON
        }
      }
    }
  }

  private handleEvent(event: HostEvent) {
    if (!this._ready && event.event === "ready") {
      this._ready = true;
      this._resolveReady();
    }

    // Emit the raw event
    this.emit("event", event);
    this.emit(event.event, event);
  }

  /**
   * Send a command to the host process
   */
  async sendCommand(cmd: Record<string, unknown>) {
    if (!this.proc?.stdin) throw new Error("Host not started");
    const json = JSON.stringify(cmd) + "\n";
    (this.proc.stdin as any).write(json);
  }

  /**
   * Create a new window
   */
  async createWindow(options: {
    id: string;
    url: string;
    width?: number;
    height?: number;
    title?: string;
    center?: boolean;
  }) {
    await this.sendCommand({
      cmd: "create_window",
      ...options,
    });
  }

  /**
   * Navigate a window to a URL
   */
  async navigate(windowId: string, url: string) {
    await this.sendCommand({ cmd: "navigate", window_id: windowId, url });
  }

  /**
   * Evaluate JavaScript in a window
   */
  async eval(windowId: string, code: string): Promise<string> {
    const evalId = `${windowId}:${Date.now()}:${Math.random()}`;
    const promise = new Promise<string>((resolve, reject) => {
      this._pendingEval.set(evalId, { resolve, reject });
      // Timeout after 10s
      setTimeout(
        () => {
          if (this._pendingEval.has(evalId)) {
            this._pendingEval.delete(evalId);
            reject(new Error("Eval timeout"));
          }
        },
        10000
      );
    });

    await this.sendCommand({
      cmd: "eval",
      window_id: windowId,
      code,
      eval_id: evalId,
    });

    return promise;
  }

  /**
   * Set window title
   */
  async setTitle(windowId: string, title: string) {
    await this.sendCommand({ cmd: "set_title", window_id: windowId, title });
  }

  /**
   * Set window size/position
   */
  async setSize(
    windowId: string,
    size: { width?: number; height?: number; x?: number; y?: number }
  ) {
    await this.sendCommand({ cmd: "set_size", window_id: windowId, ...size });
  }

  /**
   * Show dev tools for a window
   */
  async showDevTools(windowId: string) {
    await this.sendCommand({ cmd: "show_devtools", window_id: windowId });
  }

  /**
   * Send a message to the renderer process
   */
  async sendToRenderer(
    windowId: string,
    channel: string,
    data: unknown
  ) {
    await this.sendCommand({
      cmd: "send_to_renderer",
      window_id: windowId,
      channel,
      data: JSON.stringify(data),
    });
  }

  /**
   * Close a window
   */
  async closeWindow(windowId: string) {
    await this.sendCommand({ cmd: "close", window_id: windowId });
  }

  /**
   * Stop the host process
   */
  async stop() {
    if (this.proc) {
      try {
        if (this.proc.stdin) {
          await this.sendCommand({ cmd: "quit" });
          (this.proc.stdin as any).end();
        }
      } catch {}
      try {
        this.proc.kill();
      } catch {}
      await this.proc.exited.catch(() => {});
      this.proc = null;
    }

    this._ready = false;
  }
}