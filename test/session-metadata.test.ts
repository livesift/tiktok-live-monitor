import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import type { SessionMetadata } from "../src/sinks/session-metadata.js";

const schemaDirectory = resolve(fileURLToPath(new URL(".", import.meta.url)), "../schemas");
const schema = JSON.parse(
  readFileSync(resolve(schemaDirectory, "session-metadata.schema.json"), "utf8"),
) as object;
const validate = new Ajv({ allErrors: true }).compile(schema);

function readFixture(file: string): unknown {
  return JSON.parse(readFileSync(resolve(schemaDirectory, "fixtures", file), "utf8")) as unknown;
}

describe("session export metadata schema", () => {
  it("validates completed metadata and checks total counts against event counts", () => {
    const metadata = readFixture("valid-session-metadata.json") as SessionMetadata;

    expect(validate(metadata), JSON.stringify(validate.errors)).toBe(true);
    const countTotal = (Object.values(metadata.eventCounts) as number[]).reduce(
      (sum, count) => sum + count,
      0,
    );
    expect(countTotal).toBe(metadata.eventCount);
  });

  it("allows an in-progress snapshot without an end time", () => {
    const metadata = readFixture("recording-session-metadata.json") as SessionMetadata;

    expect(validate(metadata), JSON.stringify(validate.errors)).toBe(true);
    expect(metadata.endedAt).toBeNull();
    expect(metadata.endReason).toBeNull();
    const countTotal = (Object.values(metadata.eventCounts) as number[]).reduce(
      (sum, count) => sum + count,
      0,
    );
    expect(countTotal).toBe(metadata.eventCount);
  });

  it("rejects an invalid status and negative event counts", () => {
    expect(validate(readFixture("invalid-session-metadata.json"))).toBe(false);
    expect(validate.errors?.length).toBeGreaterThan(0);
  });
});
