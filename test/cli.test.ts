import { EventEmitter } from "node:events";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { formatLiveEvent, parseCliOptions, runCli } from "../src/cli/index.js";
import { MonitorError } from "../src/core/errors.js";
import type { LiveProvider, LiveSession, ProviderEventHandler } from "../src/core/provider.js";
import type { LiveEvent } from "../src/events/types.js";

class FakeProvider implements LiveProvider {
  connectCalls = 0;
  disconnectCalls = 0;
  connectError: unknown;
  emitSessionEnd = false;
  private readonly session: LiveSession = { username: "creator", roomId: "room-cli" };
  private readonly handlers = new Set<ProviderEventHandler>();

  async connect(username: string): Promise<LiveSession> {
    this.connectCalls += 1;
    if (this.connectError !== undefined) {
      throw this.connectError;
    }
    const session = { ...this.session, username };
    if (this.emitSessionEnd) {
      const base = {
        platform: "tiktok" as const,
        occurredAt: "2026-09-20T02:00:00Z",
        receivedAt: "2026-09-20T02:00:01Z",
        session: { id: "session-cli", roomId: session.roomId },
        creator: { username: session.username },
      };
      for (const handler of this.handlers) {
        handler({
          ...base,
          id: "event-started",
          type: "session_started",
          occurredAt: "2026-09-20T01:00:00Z",
          data: { startedAt: "2026-09-20T01:00:00Z" },
        });
        handler({
          ...base,
          id: "event-ended",
          type: "session_ended",
          data: {
            startedAt: "2026-09-20T01:00:00Z",
            endedAt: "2026-09-20T02:00:00Z",
            reason: "stream_end",
          },
        });
      }
    }
    return session;
  }

  async disconnect(): Promise<void> {
    this.disconnectCalls += 1;
  }

  onEvent(handler: ProviderEventHandler): void {
    this.handlers.add(handler);
  }
}

function createWriter() {
  const write = vi.fn<(message: string) => void>();
  return { write, value: () => write.mock.calls.map(([message]) => message).join("") };
}

describe("runCli", () => {
  it("parses flags before and after the username and renders help without connecting", async () => {
    expect(parseCliOptions(["--json", "@creator", "--output", "session.jsonl"])).toEqual({
      username: "creator",
      json: true,
      output: "session.jsonl",
    });
    expect(parseCliOptions(["@creator", "--output", "session.jsonl", "--json"])).toEqual({
      username: "creator",
      json: true,
      output: "session.jsonl",
    });
    expect(parseCliOptions(["@creator", "--webhook", "https://example.test/events"])).toEqual({
      username: "creator",
      json: false,
      webhook: "https://example.test/events",
    });
    expect(
      parseCliOptions([
        "@creator",
        "--webhook",
        "https://example.test/events",
        "--webhook-header",
        "Authorization: Bearer token",
        "--webhook-header",
        "X-Source: livesift",
      ]),
    ).toEqual({
      username: "creator",
      json: false,
      webhook: "https://example.test/events",
      webhookHeaders: [
        { name: "Authorization", value: "Bearer token" },
        { name: "X-Source", value: "livesift" },
      ],
    });
    expect(() => parseCliOptions(["--unknown", "creator"])).toThrow("unknown option");
    expect(() => parseCliOptions(["creator", "--output"])).toThrow(
      "option '-o, --output <path>' argument missing",
    );
    expect(() => parseCliOptions(["creator", "extra"])).toThrow("too many arguments");
    expect(() => parseCliOptions(["creator", "--webhook-header", "Authorization"])).toThrow(
      '"Name: value"',
    );

    const provider = new FakeProvider();
    const stdout = createWriter();
    const exitCode = await runCli(["--help"], {
      provider,
      stdout,
      stderr: createWriter(),
      keepAlive: false,
    });

    expect(exitCode).toBe(0);
    expect(provider.connectCalls).toBe(0);
    expect(stdout.value()).toContain("Usage: tiktok-live-monitor [options] <username>");
    expect(stdout.value()).toContain("--json");
    expect(stdout.value()).toContain("--output <path>");
    expect(stdout.value()).toContain("--webhook <url>");
    expect(stdout.value()).toContain("--webhook-header <header>");
  });

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

  it("rejects an invalid Webhook URL before starting a connection", async () => {
    const provider = new FakeProvider();
    const stderr = createWriter();

    const exitCode = await runCli(["creator", "--webhook", "ftp://example.test/events"], {
      provider,
      stdout: createWriter(),
      stderr,
      keepAlive: false,
    });

    expect(exitCode).toBe(1);
    expect(provider.connectCalls).toBe(0);
    expect(stderr.value()).toContain("Webhook URL must use http or https.");
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

  it("exits when the provider emits session_ended", async () => {
    const provider = new FakeProvider();
    provider.emitSessionEnd = true;
    const stdout = createWriter();

    await expect(
      runCli(["creator"], {
        provider,
        stdout,
        stderr: createWriter(),
        keepAlive: true,
      }),
    ).resolves.toBe(0);

    expect(provider.disconnectCalls).toBe(1);
    expect(stdout.value()).toContain("SESSION ENDED\n");
  });

  it("keeps human output while writing JSONL to --output", async () => {
    const root = await mkdtemp(join(tmpdir(), "tiktok-live-monitor-cli-"));
    const outputPath = join(root, "nested", "session.jsonl");
    const provider = new FakeProvider();
    provider.emitSessionEnd = true;
    const stdout = createWriter();

    const exitCode = await runCli(["@creator", "--output", outputPath], {
      provider,
      stdout,
      stderr: createWriter(),
    });

    expect(exitCode).toBe(0);
    expect(stdout.value()).toContain("Connecting to @creator...\n");
    expect(stdout.value()).toContain("SESSION STARTED\n");
    const lines = (await readFile(outputPath, "utf8")).trimEnd().split("\n");
    expect(lines.map((line) => JSON.parse(line).type)).toEqual([
      "session_started",
      "session_ended",
    ]);
  });

  it("writes only JSONL to stdout in --json mode and keeps diagnostics on stderr", async () => {
    const provider = new FakeProvider();
    provider.emitSessionEnd = true;
    const stdout = createWriter();
    const stderr = createWriter();

    const exitCode = await runCli(["--json", "creator"], {
      provider,
      stdout,
      stderr,
    });

    expect(exitCode).toBe(0);
    const lines = stdout.value().trimEnd().split("\n");
    expect(lines.map((line) => JSON.parse(line).type)).toEqual([
      "session_started",
      "session_ended",
    ]);
    expect(stdout.value()).not.toContain("Connecting");
    expect(stderr.value()).toContain("Connecting to @creator...\n");
    expect(stderr.value()).toContain("Room ID: room-cli\n");
  });

  it("writes byte-equivalent JSONL to stdout and --output", async () => {
    const root = await mkdtemp(join(tmpdir(), "tiktok-live-monitor-cli-"));
    const outputPath = join(root, "session.jsonl");
    const provider = new FakeProvider();
    provider.emitSessionEnd = true;
    const stdout = createWriter();

    const exitCode = await runCli(["creator", "--json", "--output", outputPath], {
      provider,
      stdout,
      stderr: createWriter(),
    });

    expect(exitCode).toBe(0);
    expect(stdout.value()).toBe(await readFile(outputPath, "utf8"));
  });

  it("keeps JSON stdout empty for an offline creator", async () => {
    const provider = new FakeProvider();
    provider.connectError = new MonitorError("OFFLINE", "@creator is currently offline.");
    const stdout = createWriter();
    const stderr = createWriter();

    const exitCode = await runCli(["--json", "creator"], { provider, stdout, stderr });

    expect(exitCode).toBe(1);
    expect(stdout.value()).toBe("");
    expect(stderr.value()).toContain("@creator is currently offline.\n");
  });

  it("rejects an output path before connecting", async () => {
    const root = await mkdtemp(join(tmpdir(), "tiktok-live-monitor-cli-"));
    const conflict = join(root, "conflict");
    await writeFile(conflict, "file");
    const provider = new FakeProvider();
    const stderr = createWriter();

    const exitCode = await runCli(["creator", "--output", join(conflict, "session.jsonl")], {
      provider,
      stdout: createWriter(),
      stderr,
    });

    expect(exitCode).toBe(1);
    expect(provider.connectCalls).toBe(0);
    expect(stderr.value()).toContain("Output initialization failed:");
  });

  it("returns a non-zero code and disconnects when stdout fails", async () => {
    const provider = new FakeProvider();
    provider.emitSessionEnd = true;
    const stdout = {
      write: vi.fn((message: string) => {
        if (message.startsWith("{")) {
          throw new Error("EPIPE");
        }
      }),
    };
    const stderr = createWriter();

    const exitCode = await runCli(["--json", "creator"], { provider, stdout, stderr });

    expect(exitCode).toBe(1);
    expect(provider.disconnectCalls).toBe(1);
    expect(stderr.value()).toContain("Output error: EPIPE\n");
  });
});
