import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_REPLAY_BYTES, parseReplayJsonl, readReplayFile } from "../src/core/replay.js";
import type { LiveEvent } from "../src/events/types.js";

const fixturePath = fileURLToPath(new URL("../examples/session.jsonl", import.meta.url));
const fixtureText = await readFile(fixturePath, "utf8");
const fixture = fixtureText
  .trimEnd()
  .split("\n")
  .map((line) => JSON.parse(line) as LiveEvent);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

function encodeJsonl(events: readonly unknown[]): string {
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "tiktok-live-replay-"));
  temporaryDirectories.push(path);
  return path;
}

describe("replay JSONL validation", () => {
  it("accepts the complete nine-event fixture with or without its final newline", () => {
    expect(parseReplayJsonl(fixtureText)).toEqual(fixture);
    expect(parseReplayJsonl(fixtureText.trimEnd())).toEqual(fixture);
  });

  it("reads a bounded fixture file and preserves each event object", async () => {
    const events = await readReplayFile(fixturePath);

    expect(events).toEqual(fixture);
    expect(events.map((event) => event.id)).toEqual(fixture.map((event) => event.id));
  });

  it("reports the source and line for malformed JSON", () => {
    const lines = fixtureText.trimEnd().split("\n");
    lines[1] = "{";

    expect(() => parseReplayJsonl(lines.join("\n"), "session.jsonl")).toThrow(
      "session.jsonl:2: invalid JSON",
    );
  });

  it("rejects blank data rows while allowing the one final newline", () => {
    const lines = fixtureText.trimEnd().split("\n");
    lines.splice(2, 0, "  ");

    expect(() => parseReplayJsonl(`${lines.join("\n")}\n`, "session.jsonl")).toThrow(
      "session.jsonl:3: blank JSONL data lines",
    );
  });

  it.each(["pk_started", "pk_ended"])("rejects independent %s PK draft types", (type) => {
    const lines = fixtureText.trimEnd().split("\n");
    const event = JSON.parse(lines[3]!) as Record<string, unknown>;
    event.type = type;
    lines[3] = JSON.stringify(event);

    expect(() => parseReplayJsonl(lines.join("\n"), "pk.jsonl")).toThrow(
      "pk.jsonl:4: invalid LiveEvent",
    );
  });

  it("rejects events from another session or creator", () => {
    const values = fixtureText
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line) as unknown);
    const event = values[2] as Record<string, unknown>;
    const session = event.session as Record<string, unknown>;
    session.id = "another-session";

    expect(() => parseReplayJsonl(encodeJsonl(values), "mixed.jsonl")).toThrow(
      "mixed.jsonl:3: all events must share the same session and creator identity",
    );
  });

  it("rejects events with a different creator identity", () => {
    const values = fixtureText
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line) as unknown);
    const event = values[2] as Record<string, unknown>;
    const creator = event.creator as Record<string, unknown>;
    creator.username = "another_creator";

    expect(() => parseReplayJsonl(encodeJsonl(values), "creator.jsonl")).toThrow(
      "creator.jsonl:3: all events must share the same session and creator identity",
    );
  });

  it.each([
    ["missing session_started", fixture.slice(1)],
    ["missing session_ended", fixture.slice(0, -1)],
    ["duplicate session_started", [...fixture, fixture[0]!]],
    ["duplicate session_ended", [...fixture, fixture.at(-1)!]],
  ])("rejects a %s lifecycle", (_label, events) => {
    expect(() => parseReplayJsonl(encodeJsonl(events), "lifecycle.jsonl")).toThrow(
      /exactly one session_(started|ended) event/,
    );
  });

  it("rejects a mismatched lifecycle start time", () => {
    const lines = fixtureText.trimEnd().split("\n");
    const ended = JSON.parse(lines.at(-1)!) as {
      data: { startedAt: string };
    };
    ended.data.startedAt = "2026-09-21T09:59:00.000Z";
    lines[lines.length - 1] = JSON.stringify(ended);

    expect(() => parseReplayJsonl(lines.join("\n"), "time.jsonl")).toThrow(
      "time.jsonl:9: session_ended.data.startedAt must match",
    );
  });

  it("rejects a non-UTF-8 file with its path", async () => {
    const path = join(await temporaryDirectory(), "invalid-utf8.jsonl");
    await writeFile(path, Buffer.from([0xc3, 0x28]));

    await expect(readReplayFile(path)).rejects.toThrow(`${path}: replay input is not valid UTF-8`);
  });

  it("reports a path when the replay file cannot be read", async () => {
    const path = join(await temporaryDirectory(), "missing.jsonl");

    await expect(readReplayFile(path)).rejects.toThrow(`${path}: unable to read replay input`);
  });

  it("rejects input beyond the 16 MiB limit", async () => {
    const path = join(await temporaryDirectory(), "oversize.jsonl");
    await writeFile(path, Buffer.alloc(MAX_REPLAY_BYTES + 1, 0x20));

    await expect(readReplayFile(path)).rejects.toThrow(`${MAX_REPLAY_BYTES}-byte limit`);
  });
});
