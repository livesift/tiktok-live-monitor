import { normalizeMonitorError, MonitorError } from "./errors.js";
import type { LiveProvider, LiveSession, ProviderEventHandler } from "./provider.js";

export type MonitorState = "idle" | "connecting" | "connected" | "disconnected";

export interface SignalSource {
  once(signal: NodeJS.Signals, listener: () => void): unknown;
  removeListener(signal: NodeJS.Signals, listener: () => void): unknown;
}

export interface SignalHandlerOptions {
  source?: SignalSource;
  onSignal?: () => void;
  onExit?: (code: number) => void;
}

export class MonitorController {
  private currentState: MonitorState = "idle";
  private currentSession: LiveSession | undefined;
  private connectPromise: Promise<LiveSession> | undefined;
  private disconnectPromise: Promise<void> | undefined;
  private lifecycleVersion = 0;

  constructor(private readonly provider: LiveProvider) {}

  get state(): MonitorState {
    return this.currentState;
  }

  get session(): LiveSession | undefined {
    return this.currentSession;
  }

  connect(username: string): Promise<LiveSession> {
    if (this.currentState === "connected" && this.currentSession !== undefined) {
      if (this.currentSession.username === username.replace(/^@/, "").trim()) {
        return Promise.resolve(this.currentSession);
      }

      return Promise.reject(
        new MonitorError("CONNECTION_FAILED", "A different creator is already connected."),
      );
    }

    if (this.connectPromise !== undefined) {
      return this.connectPromise;
    }

    const version = ++this.lifecycleVersion;
    this.currentState = "connecting";
    let providerConnected = false;

    const promise = this.provider
      .connect(username)
      .then((session) => {
        providerConnected = true;
        if (version !== this.lifecycleVersion || this.currentState === "disconnected") {
          throw new MonitorError(
            "CONNECTION_CANCELLED",
            "The monitoring connection was cancelled before it was established.",
          );
        }

        if (typeof session.roomId !== "string" || session.roomId.trim() === "") {
          throw new MonitorError(
            "CONNECTION_FAILED",
            "The provider did not return a valid room ID.",
          );
        }

        if (typeof session.sessionId !== "string" || session.sessionId.trim() === "") {
          throw new MonitorError(
            "CONNECTION_FAILED",
            "The provider did not return a valid session ID.",
          );
        }

        this.currentSession = session;
        this.currentState = "connected";
        return session;
      })
      .catch(async (error: unknown) => {
        if (providerConnected && this.currentState !== "disconnected") {
          await this.provider.disconnect().catch(() => undefined);
        }
        if (version === this.lifecycleVersion) {
          this.currentSession = undefined;
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

    const wasConnecting = this.currentState === "connecting";
    const shouldDisconnect = wasConnecting || this.currentState === "connected";
    this.lifecycleVersion += 1;
    this.currentSession = undefined;
    this.currentState = "disconnected";

    if (!shouldDisconnect) {
      return Promise.resolve();
    }

    const connectPromise = wasConnecting ? this.connectPromise : undefined;
    const disconnectOperation = connectPromise
      ? connectPromise.catch(() => undefined).then(() => this.provider.disconnect())
      : this.provider.disconnect();

    const promise = Promise.resolve(disconnectOperation)
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

  onEvent(handler: ProviderEventHandler): void {
    this.provider.onEvent(handler);
  }
}

export function installSignalHandlers(
  monitor: MonitorController,
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
    options.onSignal?.();

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
