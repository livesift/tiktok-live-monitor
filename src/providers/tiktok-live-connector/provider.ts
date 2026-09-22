import { TikTokLiveConnection } from "tiktok-live-connector";
import { SessionLifecycle, type SessionLifecycleOptions } from "../../core/session-lifecycle.js";
import { normalizeCreatorUsername } from "../../core/username.js";
import type {
  LiveProvider,
  LiveSession,
  ProviderEvent,
  ProviderEventHandler,
} from "../../core/provider.js";
import { eventTimestamp, type LiveEventContext } from "../../events/normalize.js";
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
  clock?: SessionLifecycleOptions["clock"];
  idFactory?: SessionLifecycleOptions["idFactory"];
  eventIdFactory?: SessionLifecycleOptions["eventIdFactory"];
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
  private liveEventContext: LiveEventContext | undefined;
  private clientListenerCleanups: Array<() => void> = [];
  private readonly lifecycle: SessionLifecycle;

  constructor(options: TikTokLiveConnectorProviderOptions = {}) {
    this.clientFactory = options.clientFactory ?? createDefaultClient;
    this.lifecycle = new SessionLifecycle({
      clock: options.clock,
      idFactory: options.idFactory,
      eventIdFactory: options.eventIdFactory,
    });
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
      const session = normalizeLiveSession(normalizedUsername, state.roomId);
      const startedEvent = this.lifecycle.start({
        roomId: session.roomId,
        creator: { username: session.username },
      });
      const context = this.lifecycle.context;
      if (context === undefined) {
        throw new Error("Session lifecycle did not create a context.");
      }
      this.liveEventContext = context;
      this.attachClientEvents(client);
      this.emitEvent(startedEvent);
      return session;
    } catch (error) {
      this.detachClientEvents();
      this.client = undefined;
      this.username = undefined;
      this.liveEventContext = undefined;
      throw normalizeTikTokError(error, normalizedUsername);
    }
  }

  async disconnect(): Promise<void> {
    const client = this.client;
    const username = this.username ?? "creator";
    if (client !== undefined && this.liveEventContext !== undefined) {
      const endedEvent = this.lifecycle.finish("stream_end");
      if (endedEvent !== undefined) {
        this.emitEvent(endedEvent);
      }
    }
    this.detachClientEvents();
    this.client = undefined;
    this.username = undefined;
    this.liveEventContext = undefined;

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
        this.emitNormalizedEvent(eventName, payload);
      };

      client.on(eventName, listener);
      this.clientListenerCleanups.push(() => {
        client.removeListener?.(eventName, listener);
        client.off?.(eventName, listener);
      });
    }
  }

  private emitNormalizedEvent(type: string, payload: unknown): void {
    if (type === "sessionStarted") {
      return;
    }

    if (type === "streamEnd") {
      const endedEvent = this.lifecycle.finish("stream_end", eventTimestamp(payload, new Date()));
      if (endedEvent !== undefined) {
        this.emitEvent(endedEvent);
      }
      return;
    }

    if (this.liveEventContext === undefined) {
      return;
    }

    const event = normalizeProviderEvent(type, payload, this.liveEventContext);
    if (event === undefined) {
      return;
    }

    this.emitEvent(event);
  }

  private emitEvent(event: ProviderEvent): void {
    for (const handler of this.handlers) {
      handler(event);
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
