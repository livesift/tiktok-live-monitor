export interface LiveSession {
  username: string;
  roomId: string;
}

export interface ProviderEvent {
  type: string;
  payload: unknown;
}

export type ProviderEventHandler = (event: ProviderEvent) => void;

export interface LiveProvider {
  connect(username: string): Promise<LiveSession>;
  disconnect(): Promise<void>;
  onEvent(handler: ProviderEventHandler): void;
}
