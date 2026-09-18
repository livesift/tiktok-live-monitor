import { normalizeMonitorError, MonitorError } from "./errors.js";
import type {
  LiveMonitor,
  MonitorConnection,
  MonitorEventHandler,
  MonitorState,
  MonitorTransport,
} from "./types.js";

export interface SignalSource {
  once(signal: NodeJS.Signals, listener: () => void): unknown;
  removeListener(signal: NodeJS.Signals, listener: () => void): unknown;
}

export interface SignalHandlerOptions {
  source?: SignalSource;
  onExit?: (code: number) => void;
}

export class MonitorController implements LiveMonitor {
  private currentState: MonitorState = "idle";
  private currentRoomId: string | undefined;
  private connectPromise: Promise<MonitorConnection> | undefined;
  private disconnectPromise: Promise<void> | undefined;
  private lifecycleVersion = 0;

  constructor(private readonly transport: MonitorTransport) {}

  get state(): MonitorState {
    return this.currentState;
  }

  get roomId(): string | undefined {
    return this.currentRoomId;
  }

  connect(): Promise<MonitorConnection> {
    if (this.currentState === "connected" && this.currentRoomId !== undefined) {
      return Promise.resolve({ roomId: this.currentRoomId });
    }

    if (this.connectPromise !== undefined) {
      return this.connectPromise;
    }

    const version = ++this.lifecycleVersion;
    this.currentState = "connecting";

    const promise = this.transport
      .connect()
      .then((connection) => {
        if (version !== this.lifecycleVersion || this.currentState === "disconnected") {
          void this.transport.disconnect().catch(() => undefined);
          throw new MonitorError(
            "CONNECTION_CANCELLED",
            "The monitoring connection was cancelled before it was established.",
          );
        }

        if (connection.roomId.trim() === "") {
          throw new MonitorError(
            "CONNECTION_FAILED",
            "TikTok did not return a valid live room ID.",
          );
        }

        this.currentRoomId = connection.roomId;
        this.currentState = "connected";
        return connection;
      })
      .catch((error: unknown) => {
        if (version === this.lifecycleVersion) {
          this.currentRoomId = undefined;
          this.currentState = "disconnected";
        }
        throw normalizeMonitorError(error);
      })
      .finally(() => {
        if (this.connectPromise === promise) {
          this.connectPromise = undefined;
        }
      });

    this.connectPromise = promise;
    return promise;
  }

  disconnect(): Promise<void> {
    if (this.disconnectPromise !== undefined) {
      return this.disconnectPromise;
    }

    const shouldDisconnect =
      this.currentState === "connecting" || this.currentState === "connected";
    this.lifecycleVersion += 1;
    this.currentRoomId = undefined;
    this.currentState = "disconnected";

    if (!shouldDisconnect) {
      return Promise.resolve();
    }

    const promise = this.transport
      .disconnect()
      .catch((error: unknown) => {
        throw normalizeMonitorError(error);
      })
      .finally(() => {
        if (this.disconnectPromise === promise) {
          this.disconnectPromise = undefined;
        }
      });

    this.disconnectPromise = promise;
    return promise;
  }

  onEvent(handler: MonitorEventHandler): () => void {
    return this.transport.onEvent(handler);
  }
}

export function installSignalHandlers(
  monitor: LiveMonitor,
  options: SignalHandlerOptions = {},
): () => void {
  const source = options.source ?? process;
  const onExit = options.onExit ?? ((code: number) => process.exit(code));
  let stopping = false;

  const stop = (): void => {
    if (stopping) {
      return;
    }
    stopping = true;

    void monitor
      .disconnect()
      .catch(() => undefined)
      .finally(() => onExit(0));
  };

  source.once("SIGINT", stop);
  source.once("SIGTERM", stop);

  return () => {
    source.removeListener("SIGINT", stop);
    source.removeListener("SIGTERM", stop);
  };
}
