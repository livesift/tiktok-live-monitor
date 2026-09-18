export type MonitorState = "idle" | "connecting" | "connected" | "disconnected";

export interface MonitorEvent {
  type: string;
  payload: unknown;
}

export type MonitorEventHandler = (event: MonitorEvent) => void;

export interface MonitorConnection {
  roomId: string;
}

export interface MonitorTransport {
  connect(): Promise<MonitorConnection>;
  disconnect(): Promise<void>;
  onEvent(handler: MonitorEventHandler): () => void;
}

export interface LiveMonitor {
  readonly state: MonitorState;
  readonly roomId: string | undefined;
  connect(): Promise<MonitorConnection>;
  disconnect(): Promise<void>;
  onEvent(handler: MonitorEventHandler): () => void;
}
