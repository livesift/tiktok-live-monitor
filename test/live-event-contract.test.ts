import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import { normalizeTikTokEvent } from "../src/events/normalize.js";

const fixtureDirectory = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../schemas/fixtures",
);
const schemaPath = resolve(fixtureDirectory, "../live-event.schema.json");
const manifest = JSON.parse(readFileSync(resolve(fixtureDirectory, "manifest.json"), "utf8")) as {
  schema: string;
  fixtures: Array<{ file: string; valid: boolean }>;
};
const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as object;
const validateSchema = new Ajv({ allErrors: true }).compile(schema);

const context = {
  session: { id: "session-contract", roomId: "room-contract" },
  creator: { username: "creator" },
};

describe("LiveEvent JSON Schema contract", () => {
  it("validates every fixture according to the manifest", () => {
    expect(resolve(fixtureDirectory, manifest.schema)).toBe(schemaPath);

    for (const fixtureInfo of manifest.fixtures) {
      const fixture = JSON.parse(
        readFileSync(resolve(fixtureDirectory, fixtureInfo.file), "utf8"),
      ) as unknown;
      const valid = validateSchema(fixture);
      expect(valid, `${fixtureInfo.file}: ${JSON.stringify(validateSchema.errors)}`).toBe(
        fixtureInfo.valid,
      );
    }
  });

  it("keeps normalized event fields and numeric payloads wire-compatible", () => {
    const normalizedEvents = [
      normalizeTikTokEvent("chat", { content: "hello" }, context),
      normalizeTikTokEvent(
        "gift",
        { giftId: "gift-1", repeatCount: 2, gift: { name: "Rose", diamondCount: 1 } },
        context,
      ),
      normalizeTikTokEvent("like", { count: 10, total: "100" }, context),
      normalizeTikTokEvent("roomUser", { popularity: "1842" }, context),
    ];

    for (const event of normalizedEvents) {
      expect(event).toBeDefined();
      expect(validateSchema(event), JSON.stringify(validateSchema.errors)).toBe(true);
      expect(Object.keys(event ?? {})).toEqual(
        expect.arrayContaining([
          "data",
          "creator",
          "id",
          "occurredAt",
          "platform",
          "raw",
          "receivedAt",
          "session",
          "type",
        ]),
      );
      expect(event?.platform).toBe("tiktok");
    }

    const gift = normalizedEvents[1];
    const like = normalizedEvents[2];
    const viewer = normalizedEvents[3];
    expect(typeof (gift?.data as { count?: unknown }).count).toBe("number");
    expect(typeof (gift?.data as { diamondCount?: unknown }).diamondCount).toBe("number");
    expect(typeof (like?.data as { count?: unknown }).count).toBe("number");
    expect(typeof (like?.data as { total?: unknown }).total).toBe("number");
    expect(typeof (viewer?.data as { viewerCount?: unknown }).viewerCount).toBe("number");
  });
});
