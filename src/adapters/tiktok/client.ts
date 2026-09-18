import {
  InvalidUniqueIdError,
  TikTokLiveConnection,
  UserOfflineError,
  WebcastEvent,
} from "tiktok-live-connector";
import { MonitorController } from "../../core/monitor.js";
import { MonitorError } from "../../core/errors.js";
import { normalizeCreatorUsername } from "../../core/username.js";
import type {
  LiveMonitor,
  MonitorConnection,
  MonitorEventHandler,
  MonitorTransport,
} from "../../core/types.js";

interface TikTokConnectionState {
  roomId: string | number;
}

interface TikTokConnectionLike {
  connect(): Promise<TikTokConnectionState>;
  disconnect(): Promise<void>;
  on(event: string, handler: (payload: unknown) => void): unknown;
  removeListener?(event: string, handler: (payload: unknown) => void): unknown;
  off?(event: string, handler: (payload: unknown) => void): unknown;
}

export type TikTokClientFactory = (username: string) => TikTokConnectionLike;

export interface TikTokLiveTransportOptions {
  clientFactory?: TikTokClientFactory;
}

function createDefaultClient(username: string): TikTokConnectionLike {
  return new TikTokLiveConnection(username, {}) as unknown as TikTokConnectionLike;
}

function getWebcastEventNames(): string[] {
  return Object.values(WebcastEvent).map((event) => String(event));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error && error.message !== ""
    ? error.message
    : "Unknown connection error.";
}

function mapTikTokError(error: unknown, username: string): MonitorError {
  if (error instanceof UserOfflineError) {
    return new MonitorError("OFFLINE", `@${username} is currently offline.`, { cause: error });
  }

  if (error instanceof InvalidUniqueIdError) {
    return new MonitorError(
      "INVALID_USERNAME",
      `Unable to recognize TikTok username @${username}.`,
      {
        cause: error,
      },
    );
  }

  return new MonitorError(
    "CONNECTION_FAILED",
    `Unable to connect to @${username}: ${getErrorMessage(error)}`,
    {
      cause: error,
    },
  );
}

export class TikTokLiveTransport implements MonitorTransport {
  private readonly client: TikTokConnectionLike;
  private readonly username: string;
  private readonly eventNames = getWebcastEventNames();
  private readonly listenerCleanups = new Set<() => void>();

  constructor(username: string, options: TikTokLiveTransportOptions = {}) {
    this.username = normalizeCreatorUsername(username);
    this.client = (options.clientFactory ?? createDefaultClient)(this.username);
  }

  async connect(): Promise<MonitorConnection> {
    try {
      const state = await this.client.connect();
      const roomId = String(state.roomId).trim();

      if (roomId === "") {
        throw new MonitorError("CONNECTION_FAILED", "TikTok did not return a valid live room ID.");
      }

      return { roomId };
    } catch (error) {
      throw mapTikTokError(error, this.username);
    }
  }

  async disconnect(): Promise<void> {
    for (const cleanup of this.listenerCleanups) {
      cleanup();
    }
    this.listenerCleanups.clear();
    await this.client.disconnect();
  }

  onEvent(handler: MonitorEventHandler): () => void {
    const cleanups = this.eventNames.map((eventName) => {
      const listener = (payload: unknown): void => {
        handler({ type: eventName, payload });
      };

      this.client.on(eventName, listener);
      return () => {
        this.client.removeListener?.(eventName, listener);
        this.client.off?.(eventName, listener);
      };
    });

    let active = true;
    const cleanup = (): void => {
      if (!active) {
        return;
      }
      active = false;
      for (const removeListener of cleanups) {
        removeListener();
      }
      this.listenerCleanups.delete(cleanup);
    };

    this.listenerCleanups.add(cleanup);
    return cleanup;
  }
}

export function createTikTokLiveMonitor(
  username: string,
  options: TikTokLiveTransportOptions = {},
): LiveMonitor {
  return new MonitorController(new TikTokLiveTransport(username, options));
}
