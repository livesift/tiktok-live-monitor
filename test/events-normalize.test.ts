import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildLiveEvent,
  liveEventSchema,
  normalizeTikTokEvent,
  parseLiveEvent,
} from "../src/events/normalize.js";

const context = {
  session: { id: "session-test", roomId: "room-test" },
  creator: { username: "creator" },
};
const fixtureDirectory = resolve(fileURLToPath(new URL(".", import.meta.url)), "../schemas/fixtures");

describe("LiveEvent normalization", () => {
  it("builds an event with generated identity and UTC timestamps", () => {
    const event = buildLiveEvent(
      "comment",
      { text: "hello" },
      context,
      {
        occurredAt: "2026-09-20T01:02:03Z",
        receivedAt: "2026-09-20T01:02:04Z",
      },
    );

    expect(event).toMatchObject({
      platform: "tiktok",
      type: "comment",
      occurredAt: "2026-09-20T01:02:03.000Z",
      receivedAt: "2026-09-20T01:02:04.000Z",
      session: context.session,
      creator: context.creator,
      data: { text: "hello" },
    });
    expect(event.id).not.toBe("");
    expect(liveEventSchema.parse(event)).toEqual(event);
  });

  it("rejects events missing required envelope fields", () => {
    expect(() => parseLiveEvent({
      platform: "tiktok",
      type: "comment",
      occurredAt: "2026-09-20T01:02:03Z",
      receivedAt: "2026-09-20T01:02:04Z",
      session: { id: "session-test" },
      creator: { username: "creator" },
      data: { text: "hello" },
    })).toThrow();
  });

  it("normalizes core TikTok payloads without leaking provider fields to the envelope", () => {
    const comment = normalizeTikTokEvent(
      "chat",
      {
        common: { createTime: "1726794123000" },
        content: "hello",
        user: { id: "user-1", displayId: "viewer", nickname: "Viewer" },
      },
      context,
    );
    const gift = normalizeTikTokEvent(
      "gift",
      {
        giftId: "gift-1",
        repeatCount: 2,
        gift: { name: "Rose", diamondCount: 1 },
      },
      context,
    );
    const like = normalizeTikTokEvent("like", { count: 10, total: "100" }, context);
    const viewer = normalizeTikTokEvent("roomUser", { popularity: "1842" }, context);
    const follow = normalizeTikTokEvent("follow", { action: "follow" }, context);
    const share = normalizeTikTokEvent("share", { shareType: "copy" }, context);

    expect(comment).toMatchObject({ type: "comment", data: { text: "hello" } });
    expect(gift).toMatchObject({
      type: "gift",
      data: { giftId: "gift-1", giftName: "Rose", count: 2, diamondCount: 1 },
    });
    expect(like).toMatchObject({ type: "like", data: { count: 10, total: 100 } });
    expect(viewer).toMatchObject({ type: "viewer_count", data: { viewerCount: 1842 } });
    expect(follow).toMatchObject({ type: "follow", data: { action: "follow" } });
    expect(share).toMatchObject({ type: "share", data: { shareType: "copy" } });
    expect(comment).not.toHaveProperty("content");
  });

  it("uses the actual room user count when popularity is zero", () => {
    const viewer = normalizeTikTokEvent(
      "roomUser",
      { popularity: "0", total: "1842", totalUser: "1842" },
      context,
    );

    expect(viewer).toMatchObject({ type: "viewer_count", data: { viewerCount: 1842 } });
  });

  it("accepts the committed valid event fixtures through the runtime contract", () => {
    const fixtureFiles = [
      "valid-comment.json",
      "valid-gift.json",
      "valid-like.json",
      "valid-viewer-count.json",
      "valid-session-started.json",
      "valid-session-ended.json",
    ];

    for (const fixtureFile of fixtureFiles) {
      const fixture = JSON.parse(
        readFileSync(resolve(fixtureDirectory, fixtureFile), "utf8"),
      ) as unknown;
      expect(liveEventSchema.parse(fixture)).toEqual(fixture);
    }
  });

  it("ignores unsupported provider events and invalid required payloads", () => {
    expect(normalizeTikTokEvent("system", { message: "unsupported" }, context)).toBeUndefined();
    expect(normalizeTikTokEvent("chat", { content: "" }, context)).toBeUndefined();
    expect(normalizeTikTokEvent("roomUser", { popularity: "-1" }, context)).toBeUndefined();
  });
});
