import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { MonitorError } from "../src/core/errors.js";
import { installSignalHandlers, MonitorController } from "../src/core/monitor.js";
import type {
  MonitorConnection,
  MonitorEventHandler,
  MonitorTransport,
} from "../src/core/types.js";

class FakeTransport implements MonitorTransport {
  connectCalls = 0;
  disconnectCalls = 0;
  connectError: unknown;
  connection: MonitorConnection = { roomId: "room-123" };
  private readonly handlers = new Set<MonitorEventHandler>();

  async connect(): Promise<MonitorConnection> {
    this.connectCalls += 1;
    if (this.connectError !== undefined) {
      throw this.connectError;
    }
    return this.connection;
  }

  async disconnect(): Promise<void> {
    this.disconnectCalls += 1;
  }

  onEvent(handler: MonitorEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  emit(): void {
    for (const handler of this.handlers) {
      handler({ type: "test", payload: { ok: true } });
    }
  }
}

describe("MonitorController", () => {
  it("tracks a successful connection and exposes the room ID", async () => {
    const transport = new FakeTransport();
    const monitor = new MonitorController(transport);

    const result = await monitor.connect();

    expect(result).toEqual({ roomId: "room-123" });
    expect(monitor.state).toBe("connected");
    expect(monitor.roomId).toBe("room-123");
    expect(transport.connectCalls).toBe(1);
  });

  it("normalizes provider errors and enters the disconnected state", async () => {
    const transport = new FakeTransport();
    transport.connectError = new MonitorError("OFFLINE", "offline");
    const monitor = new MonitorController(transport);

    await expect(monitor.connect()).rejects.toMatchObject({
      code: "OFFLINE",
      message: "offline",
    });
    expect(monitor.state).toBe("disconnected");
    expect(monitor.roomId).toBeUndefined();
  });

  it("makes disconnect idempotent", async () => {
    const transport = new FakeTransport();
    const monitor = new MonitorController(transport);

    await monitor.disconnect();
    await monitor.connect();
    await monitor.disconnect();
    await monitor.disconnect();

    expect(monitor.state).toBe("disconnected");
    expect(monitor.roomId).toBeUndefined();
    expect(transport.disconnectCalls).toBe(1);
  });

  it("registers and removes event handlers through the transport boundary", () => {
    const transport = new FakeTransport();
    const monitor = new MonitorController(transport);
    const handler = vi.fn();

    const removeHandler = monitor.onEvent(handler);
    transport.emit();
    removeHandler();
    transport.emit();

    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("installSignalHandlers", () => {
  it("disconnects once before exiting on SIGINT", async () => {
    const source = new EventEmitter();
    const monitor = new MonitorController(new FakeTransport());
    const onExit = vi.fn();
    installSignalHandlers(monitor, { source, onExit });

    source.emit("SIGINT");
    source.emit("SIGTERM");
    await vi.waitFor(() => expect(onExit).toHaveBeenCalledWith(0));

    expect(onExit).toHaveBeenCalledTimes(1);
    expect(monitor.state).toBe("disconnected");
  });
});
