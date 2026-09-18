import { TikTokLiveConnection } from "tiktok-live-connector";
import { normalizeCreatorUsername } from "../../core/username.js";
import type { LiveProvider, LiveSession, ProviderEventHandler } from "../../core/provider.js";
import {
  getWebcastEventNames,
  normalizeLiveSession,
  normalizeProviderEvent,
  normalizeTikTokError,
} from "./normalize.js";

interface TikTokConnectionState {
  roomId: string | number;
}

export interface TikTokConnectionLike {
  connect(): Promise<TikTokConnectionState>;
  disconnect(): Promise<void>;
  on(event: string, handler: (payload: unknown) => void): unknown;
  removeListener?(event: string, handler: (payload: unknown) => void): unknown;
  off?(event: string, handler: (payload: unknown) => void): unknown;
}

export type TikTokClientFactory = (username: string) => TikTokConnectionLike;

export interface TikTokLiveConnectorProviderOptions {
  clientFactory?: TikTokClientFactory;
}

function createDefaultClient(username: string): TikTokConnectionLike {
  return new TikTokLiveConnection(username, {}) as unknown as TikTokConnectionLike;
}

export class TikTokLiveConnectorProvider implements LiveProvider {
  private readonly clientFactory: TikTokClientFactory;
  private readonly eventNames = getWebcastEventNames();
  private readonly handlers = new Set<ProviderEventHandler>();
  private client: TikTokConnectionLike | undefined;
  private username: string | undefined;
  private clientListenerCleanups: Array<() => void> = [];

  constructor(options: TikTokLiveConnectorProviderOptions = {}) {
    this.clientFactory = options.clientFactory ?? createDefaultClient;
  }

  async connect(username: string): Promise<LiveSession> {
    const normalizedUsername = normalizeCreatorUsername(username);

    if (this.client !== undefined) {
      await this.disconnect();
    }

    const client = this.clientFactory(normalizedUsername);
    this.client = client;
    this.username = normalizedUsername;

    try {
      const state = await client.connect();
      this.attachClientEvents(client);
      return normalizeLiveSession(normalizedUsername, state.roomId);
    } catch (error) {
      this.detachClientEvents();
      this.client = undefined;
      this.username = undefined;
      throw normalizeTikTokError(error, normalizedUsername);
    }
  }

  async disconnect(): Promise<void> {
    const client = this.client;
    const username = this.username ?? "creator";
    this.detachClientEvents();
    this.client = undefined;
    this.username = undefined;

    if (client === undefined) {
      return;
    }

    try {
      await client.disconnect();
    } catch (error) {
      throw normalizeTikTokError(error, username);
    }
  }

  onEvent(handler: ProviderEventHandler): void {
    this.handlers.add(handler);
  }

  private attachClientEvents(client: TikTokConnectionLike): void {
    this.detachClientEvents();

    for (const eventName of this.eventNames) {
      const listener = (payload: unknown): void => {
        const event = normalizeProviderEvent(eventName, payload);
        for (const handler of this.handlers) {
          handler(event);
        }
      };

      client.on(eventName, listener);
      this.clientListenerCleanups.push(() => {
        client.removeListener?.(eventName, listener);
        client.off?.(eventName, listener);
      });
    }
  }

  private detachClientEvents(): void {
    for (const cleanup of this.clientListenerCleanups) {
      cleanup();
    }
    this.clientListenerCleanups = [];
  }
}

export function createTikTokLiveConnectorProvider(
  options: TikTokLiveConnectorProviderOptions = {},
): LiveProvider {
  return new TikTokLiveConnectorProvider(options);
}
