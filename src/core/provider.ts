import type { LiveEvent } from "../events/types.js";

export interface LiveSession {
  username: string;
  roomId: string;
}

export type ProviderEvent = LiveEvent;

export type ProviderEventHandler = (event: ProviderEvent) => void;

export interface LiveProvider {
  connect(username: string): Promise<LiveSession>;
  disconnect(): Promise<void>;
  onEvent(handler: ProviderEventHandler): void;
}
