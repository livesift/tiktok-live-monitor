import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli/index.js";
import { MonitorError } from "../src/core/errors.js";
import type { LiveProvider, LiveSession, ProviderEventHandler } from "../src/core/provider.js";

class FakeProvider implements LiveProvider {
  connectCalls = 0;
  disconnectCalls = 0;
  connectError: unknown;
  private readonly session: LiveSession = { username: "creator", roomId: "room-cli" };

  async connect(username: string): Promise<LiveSession> {
    this.connectCalls += 1;
    if (this.connectError !== undefined) {
      throw this.connectError;
    }
    return { ...this.session, username };
  }

  async disconnect(): Promise<void> {
    this.disconnectCalls += 1;
  }

  onEvent(handler: ProviderEventHandler): void {
    void handler;
  }
}

function createWriter() {
  const write = vi.fn<(message: string) => void>();
  return { write, value: () => write.mock.calls.map(([message]) => message).join("") };
}

describe("runCli", () => {
  it("connects with a normalized username and prints the live session", async () => {
    const provider = new FakeProvider();
    const stdout = createWriter();
    const stderr = createWriter();

    const exitCode = await runCli(["@creator"], {
      provider,
      stdout,
      stderr,
      keepAlive: false,
    });

    expect(exitCode).toBe(0);
    expect(provider.connectCalls).toBe(1);
    expect(provider.disconnectCalls).toBe(1);
    expect(stdout.value()).toContain("Connecting to @creator...\n");
    expect(stdout.value()).toContain("LIVE detected\n");
    expect(stdout.value()).toContain("Connected.\n");
    expect(stdout.value()).toContain("Room ID: room-cli\n");
    expect(stderr.value()).toBe("");
  });

  it("rejects missing and extra username arguments without connecting", async () => {
    const provider = new FakeProvider();
    const stderr = createWriter();

    await expect(
      runCli([], { provider, stderr, stdout: createWriter(), keepAlive: false }),
    ).resolves.toBe(1);
    await expect(
      runCli(["creator", "extra"], { provider, stderr, stdout: createWriter(), keepAlive: false }),
    ).resolves.toBe(1);

    expect(provider.connectCalls).toBe(0);
    expect(stderr.value()).toContain("Usage: tiktok-live-monitor <username>");
  });

  it("prints provider errors without a stack trace", async () => {
    const provider = new FakeProvider();
    provider.connectError = new MonitorError("OFFLINE", "@creator is currently offline.");
    const stderr = createWriter();

    const exitCode = await runCli(["creator"], {
      provider,
      stdout: createWriter(),
      stderr,
      keepAlive: false,
    });

    expect(exitCode).toBe(1);
    expect(stderr.value()).toBe("@creator is currently offline.\n");
    expect(stderr.value()).not.toContain("at ");
  });

  it("disconnects and exits after SIGINT", async () => {
    const provider = new FakeProvider();
    const source = new EventEmitter();
    const stdout = createWriter();
    const run = runCli(["creator"], {
      provider,
      signalSource: source,
      stdout,
      stderr: createWriter(),
      keepAlive: true,
    });

    await vi.waitFor(() => expect(stdout.value()).toContain("Connected.\n"));
    source.emit("SIGINT");

    await expect(run).resolves.toBe(0);
    expect(provider.disconnectCalls).toBe(1);
    expect(stdout.value()).toContain("Disconnected.\n");
  });
});
