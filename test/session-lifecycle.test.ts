import { describe, expect, it } from "vitest";
import { SessionLifecycle } from "../src/core/session-lifecycle.js";

describe("SessionLifecycle", () => {
  it("creates one complete lifecycle and makes finish idempotent", () => {
    const lifecycle = new SessionLifecycle({
      clock: () => new Date("2026-09-20T01:00:00Z"),
      idFactory: () => "session-id-1",
      eventIdFactory: (() => {
        let index = 0;
        return () => `event-id-${++index}`;
      })(),
    });

    const started = lifecycle.start({
      roomId: "room-1",
      creator: { username: "creator" },
    });
    const ended = lifecycle.finish("stream_end", "2026-09-20T02:00:00Z");

    expect(started).toMatchObject({
      id: "event-id-1",
      type: "session_started",
      session: { id: "session-session-id-1", roomId: "room-1" },
      data: { startedAt: "2026-09-20T01:00:00.000Z" },
    });
    expect(ended).toMatchObject({
      id: "event-id-2",
      type: "session_ended",
      session: started.session,
      data: {
        startedAt: "2026-09-20T01:00:00.000Z",
        endedAt: "2026-09-20T02:00:00.000Z",
        reason: "stream_end",
      },
    });
    expect(lifecycle.finish("duplicate_end", "2026-09-20T03:00:00Z")).toBeUndefined();
    expect(lifecycle.isActive).toBe(false);
  });

  it("creates a new session identity after the previous session ends", () => {
    let id = 0;
    const lifecycle = new SessionLifecycle({
      clock: () => new Date("2026-09-20T01:00:00Z"),
      idFactory: () => `id-${++id}`,
    });

    const first = lifecycle.start({ roomId: "room-1", creator: { username: "creator" } });
    lifecycle.finish("stream_end", "2026-09-20T01:01:00Z");
    const second = lifecycle.start({ roomId: "room-2", creator: { username: "creator" } });

    expect(second.session.id).not.toBe(first.session.id);
    expect(second.session.roomId).toBe("room-2");
  });

  it("rejects an end timestamp before the session start", () => {
    const lifecycle = new SessionLifecycle({
      clock: () => new Date("2026-09-20T01:00:00Z"),
      idFactory: () => "session-id-1",
    });

    lifecycle.start({ roomId: "room-1", creator: { username: "creator" } });

    expect(() => lifecycle.finish("invalid_order", "2026-09-20T00:59:00Z")).toThrow(
      "A live session cannot end before it starts.",
    );
    expect(lifecycle.isActive).toBe(true);
  });
});
