import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { LiveEvent } from "../src/events/types.js";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageMetadata = JSON.parse(readFileSync(resolve(projectRoot, "package.json"), "utf8")) as {
  version: string;
};
const fixture = readFileSync(resolve(projectRoot, "examples/session.jsonl"), "utf8")
  .trimEnd()
  .split("\n")
  .map((line) => JSON.parse(line) as LiveEvent);
const preview = readFileSync(resolve(projectRoot, "examples/terminal-demo.txt"), "utf8");
const captureLines = readFileSync(resolve(projectRoot, "examples/terminal-demo.cast"), "utf8")
  .trimEnd()
  .split("\n");
const captureHeader = JSON.parse(captureLines[0] ?? "") as {
  version: number;
  packageVersion: string;
};
const captureEvents = captureLines
  .slice(1)
  .map((line) => JSON.parse(line) as [number, "o", string]);

describe("terminal demo capture", () => {
  it("matches the fixture and package version with an 18-second readable recording", () => {
    const outputEvents = captureEvents.filter((event) => event[1] === "o");
    const capturedOutput = outputEvents.map((event) => event[2]).join("");
    const eventTypes = new Set(fixture.map((event) => event.type));

    expect(captureHeader).toMatchObject({ version: 2, packageVersion: packageMetadata.version });
    expect(
      captureEvents.every(
        (event, index) => index === 0 || event[0] >= captureEvents[index - 1]![0],
      ),
    ).toBe(true);
    expect(outputEvents.at(-1)?.[0]).toBe(18);
    expect(capturedOutput).toBe(preview);
    expect(capturedOutput).not.toContain(String.fromCharCode(27));
    expect(eventTypes).toEqual(
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
    expect(capturedOutput).toContain("LIVE @fixture_creator");
    expect(capturedOutput).toContain("VIEWERS 1,842");
    expect(capturedOutput).toContain("PEAK 1,842");
    expect(capturedOutput).toContain("SESSION SUMMARY");
  });
});
