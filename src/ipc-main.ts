/**
 * IPC Main - handles IPC from renderer processes
 */

import { EventEmitter } from "events";
import { HostManager } from "./host-manager";

type IpcHandler = (event: IpcMainEvent, ...args: unknown[]) => void;
type IpcSyncHandler = (
  event: IpcMainEvent,
  ...args: unknown[]
) => unknown;

export interface IpcMainEvent {
  sender: {
    send: (channel: string, data: unknown) => Promise<void>;
    windowId: string;
  };
  windowId: string;
}

export class IpcMain extends EventEmitter {
  private handlers = new Map<string, IpcHandler[]>();
  private syncHandlers = new Map<string, IpcSyncHandler>();

  constructor(private host: HostManager) {
    super();

    host.on("ipc_message", (event) => {
      if (!event.channel) return;

      const sender: IpcMainEvent = {
        sender: {
          send: (channel: string, data: unknown) =>
            host.sendToRenderer(event.window_id!, channel, data),
          windowId: event.window_id!,
        },
        windowId: event.window_id!,
      };

      // Parse data if it's a string
      let parsedData: unknown = event.data;
      if (typeof event.data === "string") {
        try {
          parsedData = JSON.parse(event.data);
        } catch {}
      }

      // Call on handlers
      const channelHandlers = this.handlers.get(event.channel);
      if (channelHandlers) {
        const args = Array.isArray(parsedData) ? parsedData : [parsedData];
        for (const handler of channelHandlers) {
          try {
            handler(sender, ...args);
          } catch (err) {
            console.error(`IPC handler error (${event.channel}):`, err);
          }
        }
      }

      // Call handle handlers
      const syncHandler = this.syncHandlers.get(event.channel);
      if (syncHandler) {
        try {
          const result = syncHandler(sender, parsedData);
          if (result instanceof Promise) {
            result.catch((err) =>
              console.error(`IPC handle error (${event.channel}):`, err)
            );
          }
        } catch (err) {
          console.error(`IPC handle error (${event.channel}):`, err);
        }
      }
    });
  }

  /**
   * Listen for IPC messages from renderer
   */
  override on(channel: string, handler: IpcHandler): this {
    if (!this.handlers.has(channel)) {
      this.handlers.set(channel, []);
    }
    this.handlers.get(channel)!.push(handler);
    return this;
  }

  /**
   * Remove a listener
   */
  override removeAllListeners(channel?: string): this {
    if (channel) {
      this.handlers.delete(channel);
    } else {
      this.handlers.clear();
    }
    return this;
  }

  /**
   * Handle a single IPC message with a sync/async response
   */
  handle(channel: string, handler: IpcSyncHandler): void {
    this.syncHandlers.set(channel, handler);
  }
}