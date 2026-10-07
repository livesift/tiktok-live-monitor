import { readFileSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runCli, type CliWriter } from "../src/cli/index.js";
import type { LiveProvider, LiveSession, ProviderEventHandler } from "../src/core/provider.js";
import type { LiveEvent } from "../src/events/types.js";
import { serializeJsonlEvent } from "../src/sinks/jsonl.js";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixture = readFileSync(resolve(projectRoot, "examples/session.jsonl"), "utf8")
  .trimEnd()
  .split("\n")
  .map((line) => JSON.parse(line) as LiveEvent);
const fixtureSession = fixture[0]?.session;
const fixtureCreator = fixture[0]?.creator.username ?? "fixture_creator";

class FixtureProvider implements LiveProvider {
  connectCalls = 0;
  disconnectCalls = 0;
  private handler: ProviderEventHandler | undefined;

  constructor(private readonly events: readonly LiveEvent[]) {}

  async connect(username: string): Promise<LiveSession> {
    this.connectCalls += 1;
    for (const event of this.events) {
      this.handler?.(event);
    }
    return {
      username,
      roomId: fixtureSession?.roomId ?? "room-fixture-1",
      sessionId: fixtureSession?.id ?? "session-fixture-1",
    };
  }

  async disconnect(): Promise<void> {
    this.disconnectCalls += 1;
  }

  onEvent(handler: ProviderEventHandler): void {
    this.handler = handler;
  }
}

function createWriter(): CliWriter & { value(): string } {
  const chunks: string[] = [];
  return {
    write(message: string): void {
      chunks.push(message);
    },
    value: () => chunks.join(""),
  };
}

describe("fixture-based CLI acceptance", () => {
  it("renders the full fixture as portable rows and writes one summary", async () => {
    const provider = new FixtureProvider(fixture);
    const stdout = createWriter();
    const stderr = createWriter();

    const exitCode = await runCli([fixtureCreator], {
      provider,
      stdout,
      stderr,
      keepAlive: false,
    });
    const output = stdout.value();

    expect(exitCode).toBe(0);
    expect(provider.connectCalls).toBe(1);
    expect(provider.disconnectCalls).toBe(1);
    expect(output).toContain("LIVE @fixture_creator");
    expect(output).toContain("VIEWERS 1,842");
    expect(output).toContain("PEAK 1,842");
    for (const type of [
      "SESSION STARTED",
      "COMMENT",
      "GIFT",
      "LIKES",
      "FOLLOW",
      "SHARE",
      "SESSION ENDED",
    ]) {
      expect(output).toContain(type);
    }
    expect(output.match(/SESSION SUMMARY/g)).toHaveLength(1);
    expect(output).toContain("Status: completed\n");
    expect(output).not.toContain(String.fromCharCode(27));
    expect(stderr.value()).toBe("");
  });

  it("keeps --json stdout parseable and byte-equivalent to the --output file", async () => {
    const root = await mkdtemp(join(tmpdir(), "tiktok-live-monitor-acceptance-"));
    const outputPath = join(root, "nested", "session.jsonl");
    const provider = new FixtureProvider(fixture);
    const stdout = createWriter();
    const stderr = createWriter();

    const exitCode = await runCli(["--json", fixtureCreator, "--output", outputPath], {
      provider,
      stdout,
      stderr,
      keepAlive: false,
    });
    const jsonl = stdout.value();
    const stderrText = stderr.value();

    expect(exitCode).toBe(0);
    expect(provider.connectCalls).toBe(1);
    expect(provider.disconnectCalls).toBe(1);
    expect(jsonl).toBe(fixture.map(serializeJsonlEvent).join(""));
    expect(jsonl).toBe(await readFile(outputPath, "utf8"));
    expect(
      jsonl
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line)),
    ).toEqual(fixture);
    expect(jsonl).not.toContain("SESSION SUMMARY");
    expect(stderrText).toContain("Connecting to @fixture_creator...\n");
    expect(stderrText).toContain("Room ID: room-fixture-1\n");
    expect(stderrText.match(/SESSION SUMMARY/g)).toHaveLength(1);
    expect(stderrText).toContain("Status: completed\n");
    for (const token of [
      "Comments: 1",
      "Gifts: 1",
      "Likes: 1",
      "Follows: 1",
      "Shares: 1",
      "Viewer samples: 2",
      "Current viewers: 1,842",
      "Peak viewers: 1842",
    ]) {
      expect(stderrText).toContain(token);
    }
  });

  it("keeps --output and the Webhook mock limited to raw fixture events", async () => {
    const root = await mkdtemp(join(tmpdir(), "tiktok-live-monitor-acceptance-"));
    const outputPath = join(root, "session.jsonl");
    const provider = new FixtureProvider(fixture);
    const stdout = createWriter();
    const stderr = createWriter();
    const webhookBodies: string[] = [];
    const gatewayFetch: typeof fetch = async (_input, init) => {
      webhookBodies.push(String(init?.body ?? ""));
      return new Response(null, { status: 202 });
    };

    const exitCode = await runCli(
      [fixtureCreator, "--output", outputPath, "--webhook", "https://example.test/events"],
      { provider, stdout, stderr, keepAlive: false, gatewayFetch },
    );

    const output = stdout.value();
    const outputJsonl = await readFile(outputPath, "utf8");
    expect(exitCode).toBe(0);
    expect(provider.connectCalls).toBe(1);
    expect(provider.disconnectCalls).toBe(1);
    expect(output.match(/SESSION SUMMARY/g)).toHaveLength(1);
    expect(output).toContain("Status: completed\n");
    expect(outputJsonl).toBe(fixture.map(serializeJsonlEvent).join(""));
    expect(outputJsonl).not.toContain("SESSION SUMMARY");
    expect(webhookBodies.map((body) => JSON.parse(body))).toEqual(fixture);
    expect(webhookBodies.join("\n")).not.toContain("SESSION SUMMARY");
    expect(stderr.value()).toBe("");
  });
});
