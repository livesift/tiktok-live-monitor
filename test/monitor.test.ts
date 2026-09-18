import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { MonitorError } from "../src/core/errors.js";
import { installSignalHandlers, MonitorController } from "../src/core/monitor.js";
import type { LiveProvider, LiveSession, ProviderEventHandler } from "../src/core/provider.js";

class FakeProvider implements LiveProvider {
  connectCalls = 0;
  disconnectCalls = 0;
  connectError: unknown;
  session: LiveSession = { username: "creator", roomId: "room-123" };
  private readonly handlers = new Set<ProviderEventHandler>();

  async connect(username: string): Promise<LiveSession> {
    this.connectCalls += 1;
    if (this.connectError !== undefined) {
      throw this.connectError;
    }
    return { ...this.session, username: username.replace(/^@/, "").trim() };
  }

  async disconnect(): Promise<void> {
    this.disconnectCalls += 1;
  }

  onEvent(handler: ProviderEventHandler): void {
    this.handlers.add(handler);
  }

  emit(): void {
    for (const handler of this.handlers) {
      handler({ type: "test", payload: { ok: true } });
    }
  }
}

describe("MonitorController", () => {
  it("tracks a successful provider connection and exposes the session", async () => {
    const provider = new FakeProvider();
    const monitor = new MonitorController(provider);

    const result = await monitor.connect("@creator");

    expect(result).toEqual({ username: "creator", roomId: "room-123" });
    expect(monitor.state).toBe("connected");
    expect(monitor.session).toEqual(result);
    expect(provider.connectCalls).toBe(1);
  });

  it("normalizes provider errors and enters the disconnected state", async () => {
    const provider = new FakeProvider();
    provider.connectError = new MonitorError("OFFLINE", "offline");
    const monitor = new MonitorController(provider);

    await expect(monitor.connect("creator")).rejects.toMatchObject({
      code: "OFFLINE",
      message: "offline",
    });
    expect(monitor.state).toBe("disconnected");
    expect(monitor.session).toBeUndefined();
  });

  it("makes disconnect idempotent", async () => {
    const provider = new FakeProvider();
    const monitor = new MonitorController(provider);

    await monitor.disconnect();
    await monitor.connect("creator");
    await monitor.disconnect();
    await monitor.disconnect();

    expect(monitor.state).toBe("disconnected");
    expect(monitor.session).toBeUndefined();
    expect(provider.disconnectCalls).toBe(1);
  });

  it("registers event handlers through the provider boundary", () => {
    const provider = new FakeProvider();
    const monitor = new MonitorController(provider);
    const handler = vi.fn();

    monitor.onEvent(handler);
    provider.emit();

    expect(handler).toHaveBeenCalledOnce();
  });
});

describe("installSignalHandlers", () => {
  it("disconnects once before exiting on SIGINT", async () => {
    const source = new EventEmitter();
    const monitor = new MonitorController(new FakeProvider());
    const onExit = vi.fn();
    installSignalHandlers(monitor, { source, onExit });

    source.emit("SIGINT");
    source.emit("SIGTERM");
    await vi.waitFor(() => expect(onExit).toHaveBeenCalledWith(0));

    expect(onExit).toHaveBeenCalledTimes(1);
    expect(monitor.state).toBe("disconnected");
  });
});
