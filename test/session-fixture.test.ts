import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import { SessionStats } from "../src/cli/session-stats.js";
import { liveEventSchema } from "../src/events/normalize.js";
import type { LiveEvent } from "../src/events/types.js";
import { serializeJsonlEvent } from "../src/sinks/jsonl.js";

const publicRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixturePath = resolve(publicRoot, "test/fixtures/session.json");
const examplePath = resolve(publicRoot, "examples/session.jsonl");
const schemaPath = resolve(publicRoot, "schemas/live-event.schema.json");

const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as LiveEvent[];
const example = readFileSync(examplePath, "utf8");
const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as object;
const validateSchema = new Ajv({ allErrors: true }).compile(schema);

describe("deterministic session fixture", () => {
  it("replays an empty stats snapshot through a complete multi-event session", () => {
    const stats = new SessionStats();

    expect(stats.snapshot()).toMatchObject({
      sessionId: null,
      comments: 0,
      gifts: 0,
      likes: 0,
      follows: 0,
      shares: 0,
      viewerSamples: 0,
      currentViewer: null,
      peakViewer: 0,
    });
    expect(fixture.map((item) => item.type).filter((type) => type.startsWith("session_"))).toEqual([
      "session_started",
      "session_ended",
    ]);

    for (const item of fixture) {
      expect(stats.add(item)).toBe(true);
    }

    expect(stats.snapshot()).toMatchObject({
      sessionId: "session-fixture-1",
      comments: 1,
      gifts: 1,
      likes: 1,
      follows: 1,
      shares: 1,
      viewerSamples: 2,
      currentViewer: 1842,
      peakViewer: 1842,
    });
  });

  it("replays through the production serializer into the committed JSONL example", () => {
    const generated = fixture.map(serializeJsonlEvent).join("");

    expect(generated).toBe(example);
  });

  it("validates every fixture and example line against runtime and JSON schemas", () => {
    const exampleLines = example.trimEnd().split("\n");

    expect(exampleLines).toHaveLength(fixture.length);
    expect(exampleLines.every((line) => line.trim() !== "")).toBe(true);
    for (const [index, item] of fixture.entries()) {
      expect(liveEventSchema.parse(item)).toEqual(item);
      expect(validateSchema(item), JSON.stringify(validateSchema.errors)).toBe(true);
      const parsedExample = JSON.parse(exampleLines[index] ?? "") as unknown;
      expect(parsedExample).toEqual(item);
      expect(validateSchema(parsedExample), JSON.stringify(validateSchema.errors)).toBe(true);
    }
  });

  it("has one lifecycle pair, stable session identity, and ordered interactions", () => {
    expect(fixture[0]?.type).toBe("session_started");
    expect(fixture.at(-1)?.type).toBe("session_ended");
    expect(fixture.filter((item) => item.type === "session_started")).toHaveLength(1);
    expect(fixture.filter((item) => item.type === "session_ended")).toHaveLength(1);
    expect(fixture.slice(1, -1).map((item) => item.type)).toEqual([
      "viewer_count",
      "comment",
      "gift",
      "viewer_count",
      "like",
      "follow",
      "share",
    ]);
    expect(new Set(fixture.map((item) => item.type))).toEqual(
      new Set([
        "session_started",
        "session_ended",
        "viewer_count",
        "comment",
        "gift",
        "like",
        "follow",
        "share",
      ]),
    );
    expect(new Set(fixture.map((item) => item.session.id))).toEqual(new Set(["session-fixture-1"]));
    expect(fixture[0]?.data).toMatchObject({ startedAt: "2026-09-21T10:00:00.000Z" });
    expect(fixture.at(-1)?.data).toMatchObject({
      startedAt: "2026-09-21T10:00:00.000Z",
      endedAt: "2026-09-21T10:01:00.000Z",
      reason: "stream_end",
    });
  });
});
