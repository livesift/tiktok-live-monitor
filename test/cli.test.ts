import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { formatLiveEvent, runCli } from "../src/cli/index.js";
import { MonitorError } from "../src/core/errors.js";
import type { LiveProvider, LiveSession, ProviderEventHandler } from "../src/core/provider.js";
import type { LiveEvent } from "../src/events/types.js";

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
  it("formats normalized comment, gift, like, and viewer summaries", () => {
    const base = {
      id: "event-cli",
      platform: "tiktok" as const,
      occurredAt: "2026-09-20T01:02:03Z",
      receivedAt: "2026-09-20T01:02:04Z",
      session: { id: "session-cli" },
      creator: { username: "creator" },
    };

    expect(
      formatLiveEvent({
        ...base,
        type: "comment",
        actor: { username: "viewer" },
        data: { text: "hello" },
      } satisfies LiveEvent<"comment">),
    ).toBe("[01:02:03] COMMENT viewer: hello\n");
    expect(
      formatLiveEvent({
        ...base,
        type: "gift",
        actor: { username: "supporter" },
        data: { giftName: "Rose", count: 1 },
      } satisfies LiveEvent<"gift">),
    ).toBe("[01:02:03] GIFT supporter: Rose x1\n");
    expect(
      formatLiveEvent({
        ...base,
        type: "like",
        actor: { username: "viewer" },
        data: { count: 10, total: 100 },
      } satisfies LiveEvent<"like">),
    ).toBe("[01:02:03] LIKES viewer: +10 (total 100)\n");
    expect(
      formatLiveEvent({
        ...base,
        type: "viewer_count",
        data: { viewerCount: 1842 },
      } satisfies LiveEvent<"viewer_count">),
    ).toBe("[01:02:03] VIEWERS 1,842\n");
  });

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

  it("rejects malformed usernames before starting a connection", async () => {
    const provider = new FakeProvider();
    const stderr = createWriter();

    const exitCode = await runCli(["creator name"], {
      provider,
      stdout: createWriter(),
      stderr,
      keepAlive: false,
    });

    expect(exitCode).toBe(1);
    expect(provider.connectCalls).toBe(0);
    expect(stderr.value()).toContain(
      "Username must be 1-24 letters, numbers, dots, underscores, or hyphens.",
    );
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
