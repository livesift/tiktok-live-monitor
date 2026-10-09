import { EventEmitter } from "node:events";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCliOptions, runCli } from "../src/cli/index.js";
import type { LiveProvider } from "../src/core/provider.js";
import type { LiveEvent } from "../src/events/types.js";

const fixturePath = fileURLToPath(new URL("../examples/session.jsonl", import.meta.url));
const fixtureEvents = (await readFile(fixturePath, "utf8"))
  .trimEnd()
  .split("\n")
  .map((line) => JSON.parse(line) as LiveEvent);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

function createWriter(write: (message: string) => void = () => {}): {
  write: (message: string) => void;
  value: () => string;
} {
  const output: string[] = [];
  return {
    write(message: string): void {
      output.push(message);
      write(message);
    },
    value: () => output.join(""),
  };
}

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "tiktok-replay-cli-"));
  temporaryDirectories.push(path);
  return path;
}

function createProvider(): LiveProvider & { connect: ReturnType<typeof vi.fn> } {
  return {
    connect: vi.fn(async () => ({ username: "creator", roomId: "room", sessionId: "session" })),
    disconnect: vi.fn(async () => {}),
    onEvent: vi.fn(),
  } as unknown as LiveProvider & { connect: ReturnType<typeof vi.fn> };
}

async function archiveDirectory(root: string): Promise<string> {
  const creator = (await readdir(root))[0]!;
  const datePath = join(root, creator, "2026-09-21");
  const session = (await readdir(datePath))[0]!;
  return join(datePath, session);
}

describe("offline CLI replay", () => {
  it("parses replay without username and rejects LIVE-only option combinations", () => {
    expect(parseCliOptions(["--replay", fixturePath, "--json"])).toEqual({
      json: true,
      replay: fixturePath,
    });
    expect(() => parseCliOptions(["--replay", fixturePath, "creator"])).toThrow(
      "--replay cannot be used with a username",
    );
    expect(() =>
      parseCliOptions(["--replay", fixturePath, "--webhook", "https://example.test/events"]),
    ).toThrow("--replay cannot be used with --webhook or --webhook-header");
    expect(() =>
      parseCliOptions(["--replay", fixturePath, "--webhook-header", "Authorization: token"]),
    ).toThrow("--replay cannot be used with --webhook or --webhook-header");
  });

  it("writes the fixture to JSON stdout and a replay archive without provider or Gateway calls", async () => {
    const root = await temporaryDirectory();
    const provider = createProvider();
    const gatewayFetch = vi.fn<typeof fetch>();
    const stdout = createWriter();
    const stderr = createWriter();
    vi.stubEnv("LIVESIFT_GATEWAY_URL", "http://127.0.0.1:1");

    const exitCode = await runCli(["--replay", fixturePath, "--json", "--output-dir", root], {
      provider,
      stdout,
      stderr,
      gatewayFetch,
    });

    expect(exitCode).toBe(0);
    const stdoutEvents = stdout
      .value()
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line) as LiveEvent);
    const outputDirectory = await archiveDirectory(root);
    const fileEvents = (await readFile(join(outputDirectory, "events.jsonl"), "utf8"))
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line) as LiveEvent);
    const metadata = JSON.parse(
      await readFile(join(outputDirectory, "session.metadata.json"), "utf8"),
    ) as {
      source: string;
      status: string;
      eventCount: number;
      eventCounts: Record<string, number>;
    };

    expect(stdoutEvents).toEqual(fixtureEvents);
    expect(fileEvents).toEqual(fixtureEvents);
    expect(metadata).toEqual(
      expect.objectContaining({ source: "replay", status: "completed", eventCount: 9 }),
    );
    expect(Object.values(metadata.eventCounts).reduce((sum, count) => sum + count, 0)).toBe(9);
    expect(stdout.value()).not.toContain("SESSION SUMMARY");
    expect(stderr.value().match(/SESSION SUMMARY/g)).toHaveLength(1);
    expect(provider.connect).not.toHaveBeenCalled();
    expect(gatewayFetch).not.toHaveBeenCalled();
  });

  it("writes equivalent events to JSON stdout and the explicit output file", async () => {
    const root = await temporaryDirectory();
    const outputPath = join(root, "events.jsonl");
    const stdout = createWriter();

    const exitCode = await runCli(["--replay", fixturePath, "--json", "--output", outputPath], {
      stdout,
      stderr: createWriter(),
    });

    expect(exitCode).toBe(0);
    expect(stdout.value()).toBe(await readFile(outputPath, "utf8"));
  });

  it("validates replay before truncating an existing output file", async () => {
    const root = await temporaryDirectory();
    const invalidInput = join(root, "invalid.jsonl");
    const outputPath = join(root, "existing.jsonl");
    const provider = createProvider();
    const stdout = createWriter();
    await writeFile(invalidInput, "{\n");
    await writeFile(outputPath, "preserve this file\n");

    const exitCode = await runCli(["--replay", invalidInput, "--json", "--output", outputPath], {
      provider,
      stdout,
      stderr: createWriter(),
    });

    expect(exitCode).toBe(1);
    expect(stdout.value()).toBe("");
    expect(await readFile(outputPath, "utf8")).toBe("preserve this file\n");
    expect(provider.connect).not.toHaveBeenCalled();
  });

  it("rejects LIVE-only option conflicts before reading or opening output", async () => {
    const root = await temporaryDirectory();
    const outputPath = join(root, "existing.jsonl");
    const provider = createProvider();
    const stderr = createWriter();
    await writeFile(outputPath, "preserve this file\n");

    const exitCode = await runCli(
      ["creator", "--replay", join(root, "missing.jsonl"), "--output", outputPath],
      { provider, stdout: createWriter(), stderr },
    );

    expect(exitCode).toBe(1);
    expect(stderr.value()).toContain("--replay cannot be used with a username");
    expect(await readFile(outputPath, "utf8")).toBe("preserve this file\n");
    expect(provider.connect).not.toHaveBeenCalled();
  });

  it("rejects Webhook and Header conflicts before reading replay or opening output", async () => {
    const root = await temporaryDirectory();
    const missingInput = join(root, "missing.jsonl");
    const outputPath = join(root, "existing.jsonl");
    const provider = createProvider();
    const gatewayFetch = vi.fn<typeof fetch>();
    await writeFile(outputPath, "preserve this file\n");

    for (const args of [
      [
        "--replay",
        missingInput,
        "--webhook",
        "https://example.test/events",
        "--output",
        outputPath,
      ],
      [
        "--replay",
        missingInput,
        "--webhook-header",
        "Authorization: token",
        "--output",
        outputPath,
      ],
    ]) {
      const stderr = createWriter();
      const exitCode = await runCli(args, {
        provider,
        stdout: createWriter(),
        stderr,
        gatewayFetch,
      });

      expect(exitCode).toBe(1);
      expect(stderr.value()).toContain(
        "--replay cannot be used with --webhook or --webhook-header",
      );
      expect(stderr.value()).not.toContain("unable to read replay input");
      expect(await readFile(outputPath, "utf8")).toBe("preserve this file\n");
    }

    expect(provider.connect).not.toHaveBeenCalled();
    expect(gatewayFetch).not.toHaveBeenCalled();
  });

  it("renders one human-readable summary for a complete replay", async () => {
    const stdout = createWriter();
    const stderr = createWriter();

    const exitCode = await runCli(["--replay", fixturePath], { stdout, stderr });

    expect(exitCode).toBe(0);
    expect(stdout.value()).toContain("SESSION STARTED");
    expect(stdout.value()).toContain("SESSION ENDED");
    expect(stdout.value().match(/SESSION SUMMARY/g)).toHaveLength(1);
    expect(stdout.value()).toContain("Status: completed");
    expect(stderr.value()).toBe("");
  });

  it("does not overwrite an existing archive when replayed twice", async () => {
    const root = await temporaryDirectory();
    const first = await runCli(["--replay", fixturePath, "--json", "--output-dir", root], {
      stdout: createWriter(),
      stderr: createWriter(),
    });
    const directory = await archiveDirectory(root);
    const before = await readFile(join(directory, "events.jsonl"), "utf8");
    const beforeMetadata = await readFile(join(directory, "session.metadata.json"), "utf8");
    const secondStderr = createWriter();

    const second = await runCli(["--replay", fixturePath, "--json", "--output-dir", root], {
      stdout: createWriter(),
      stderr: secondStderr,
    });

    expect(first).toBe(0);
    expect(second).toBe(1);
    expect(secondStderr.value()).toContain("Session archive already exists");
    expect(await readFile(join(directory, "events.jsonl"), "utf8")).toBe(before);
    expect(await readFile(join(directory, "session.metadata.json"), "utf8")).toBe(beforeMetadata);
  });

  it("returns non-zero and marks a partial archive failed on output error", async () => {
    const root = await temporaryDirectory();
    const stdout = createWriter((message) => {
      if (message.includes("SESSION STARTED")) {
        throw new Error("terminal output failed");
      }
    });
    const stderr = createWriter();

    const exitCode = await runCli(["--replay", fixturePath, "--output-dir", root], {
      stdout,
      stderr,
    });

    expect(exitCode).toBe(1);
    expect(stderr.value()).toContain("Replay error: terminal output failed");
    const directory = await archiveDirectory(root);
    const metadata = JSON.parse(
      await readFile(join(directory, "session.metadata.json"), "utf8"),
    ) as { status: string; endedAt: string | null };
    expect(metadata).toEqual(expect.objectContaining({ status: "failed", endedAt: null }));
  });

  it("does not add a synthetic end event when a local signal interrupts replay", async () => {
    const root = await temporaryDirectory();
    const signalSource = new EventEmitter();
    const stdout = createWriter((message) => {
      if (message.includes("SESSION STARTED")) {
        signalSource.emit("SIGINT");
      }
    });
    const stderr = createWriter();

    const exitCode = await runCli(["--replay", fixturePath, "--output-dir", root], {
      stdout,
      stderr,
      signalSource,
    });

    expect(exitCode).toBe(1);
    expect(stderr.value()).toContain("Replay interrupted before all events were written");
    expect(stdout.value()).not.toContain("SESSION ENDED");
    const directory = await archiveDirectory(root);
    const eventLines = (await readFile(join(directory, "events.jsonl"), "utf8"))
      .trimEnd()
      .split("\n");
    const metadata = JSON.parse(
      await readFile(join(directory, "session.metadata.json"), "utf8"),
    ) as { status: string; eventCount: number; endedAt: string | null };
    expect(eventLines).toHaveLength(1);
    expect(JSON.parse(eventLines[0]!).type).toBe("session_started");
    expect(metadata).toEqual(
      expect.objectContaining({ status: "failed", eventCount: 1, endedAt: null }),
    );
  });
});
