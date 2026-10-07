import { describe, expect, it } from "vitest";
import type { LiveEvent } from "../src/events/types.js";
import { SessionStats } from "../src/cli/session-stats.js";

const sessionId = "session-stats-test";
const creator = { username: "creator" };

function event(
  type: LiveEvent["type"],
  id: string,
  occurredAt: string,
  data: Record<string, unknown> = {},
  eventSessionId = sessionId,
): LiveEvent {
  return {
    id,
    platform: "tiktok",
    type,
    occurredAt,
    receivedAt: occurredAt,
    session: { id: eventSessionId },
    creator,
    data,
  } as LiveEvent;
}

describe("SessionStats", () => {
  it("starts with a stable snapshot containing only non-negative counters", () => {
    const stats = new SessionStats();
    const snapshot = stats.snapshot();

    expect(Object.keys(snapshot)).toEqual([
      "sessionId",
      "comments",
      "gifts",
      "likes",
      "follows",
      "shares",
      "viewerSamples",
      "currentViewer",
      "peakViewer",
    ]);
    expect(snapshot).toEqual({
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
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it("counts each interaction event once and ignores duplicate IDs", () => {
    const stats = new SessionStats();
    const comment = event("comment", "comment-1", "2026-10-07T10:00:00.000Z", { text: "Hi" });

    expect(stats.add(comment)).toBe(true);
    expect(stats.add(comment)).toBe(false);
    expect(
      stats.add(event("gift", "gift-1", "2026-10-07T10:00:01.000Z", { giftName: "Rose" })),
    ).toBe(true);
    expect(stats.add(event("like", "like-1", "2026-10-07T10:00:02.000Z", { count: 4 }))).toBe(true);
    expect(stats.add(event("follow", "follow-1", "2026-10-07T10:00:03.000Z"))).toBe(true);
    expect(stats.add(event("share", "share-1", "2026-10-07T10:00:04.000Z"))).toBe(true);

    expect(stats.snapshot()).toMatchObject({
      sessionId,
      comments: 1,
      gifts: 1,
      likes: 1,
      follows: 1,
      shares: 1,
    });
  });

  it("keeps the current viewer at the latest event time and counts equal-time arrivals in order", () => {
    const stats = new SessionStats();

    stats.add(event("viewer_count", "viewer-1", "2026-10-07T10:00:00.000Z", { viewerCount: 120 }));
    stats.add(event("viewer_count", "viewer-2", "2026-10-07T09:59:00.000Z", { viewerCount: 95 }));
    stats.add(event("viewer_count", "viewer-3", "2026-10-07T10:00:00.000Z", { viewerCount: 180 }));
    stats.add(event("viewer_count", "viewer-4", "2026-10-07T10:01:00.000Z", { viewerCount: 80 }));

    expect(stats.snapshot()).toMatchObject({
      viewerSamples: 4,
      currentViewer: 80,
      peakViewer: 180,
    });
  });

  it("ignores negative, non-integer, non-finite, and invalid-time viewer samples", () => {
    const stats = new SessionStats();
    const timestamp = "2026-10-07T10:00:00.000Z";
    const invalidSamples = [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY];

    for (const [index, viewerCount] of invalidSamples.entries()) {
      stats.add(event("viewer_count", `viewer-invalid-${index}`, timestamp, { viewerCount }));
    }
    stats.add(event("viewer_count", "viewer-invalid-time", "not-a-date", { viewerCount: 50 }));

    expect(stats.snapshot()).toMatchObject({
      viewerSamples: 0,
      currentViewer: null,
      peakViewer: 0,
    });
  });

  it("rejects events from a different session", () => {
    const stats = new SessionStats();
    stats.add(event("comment", "comment-1", "2026-10-07T10:00:00.000Z", { text: "Hi" }));

    expect(() =>
      stats.add(
        event("gift", "gift-1", "2026-10-07T10:00:01.000Z", { giftName: "Rose" }, "other-session"),
      ),
    ).toThrow("SessionStats is bound to session session-stats-test.");
    expect(stats.snapshot().gifts).toBe(0);
  });
});
