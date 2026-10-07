import { describe, expect, it } from "vitest";
import type { LiveEvent } from "../src/events/types.js";
import { TerminalRenderer } from "../src/cli/terminal-renderer.js";
import type { TextSink } from "../src/sinks/output.js";

const startedAt = "2026-10-07T10:00:00.000Z";
const endedAt = "2026-10-07T10:01:00.000Z";

class MemoryTextSink implements TextSink {
  readonly chunks: string[] = [];
  closeCalls = 0;

  async write(chunk: string): Promise<void> {
    this.chunks.push(chunk);
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
  }
}

function event(
  type: LiveEvent["type"],
  id: string,
  data: Record<string, unknown>,
  occurredAt = startedAt,
): LiveEvent {
  const base = {
    id,
    platform: "tiktok" as const,
    occurredAt,
    receivedAt: occurredAt,
    session: { id: "session-renderer", roomId: "room-renderer" },
    creator: { username: "creator" },
  };

  if (type === "session_started") {
    return { ...base, type, data: { startedAt } } as unknown as LiveEvent;
  }
  if (type === "session_ended") {
    return {
      ...base,
      type,
      occurredAt: endedAt,
      receivedAt: endedAt,
      data: { startedAt, endedAt, reason: "stream_end" },
    } as unknown as LiveEvent;
  }
  return { ...base, type, data } as unknown as LiveEvent;
}

describe("TerminalRenderer", () => {
  it("renders lifecycle, viewer and every interaction with a fixed session summary", async () => {
    const sink = new MemoryTextSink();
    const renderer = new TerminalRenderer(sink);
    const events: LiveEvent[] = [
      event("session_started", "started", { startedAt }),
      event("viewer_count", "viewers", { viewerCount: 1842 }, "2026-10-07T10:00:01.000Z"),
      {
        ...event("comment", "comment", { text: "hello" }, "2026-10-07T10:00:02.000Z"),
        actor: { username: "viewer" },
      },
      {
        ...event("gift", "gift", { giftName: "Rose", count: 2 }, "2026-10-07T10:00:03.000Z"),
        actor: { username: "supporter" },
      },
      {
        ...event("like", "like", { count: 10, total: 100 }, "2026-10-07T10:00:04.000Z"),
        actor: { username: "viewer" },
      },
      event("follow", "follow", {}, "2026-10-07T10:00:05.000Z"),
      event("share", "share", {}, "2026-10-07T10:00:06.000Z"),
      event("session_ended", "ended", { startedAt, endedAt, reason: "stream_end" }, endedAt),
    ];

    for (const item of events) {
      await renderer.write(item);
    }
    await renderer.close();

    const output = sink.chunks.join("");
    expect(output).toContain("SESSION STARTED");
    expect(output).toContain("LIVE @creator");
    expect(output).toContain("VIEWERS 1,842");
    expect(output).toContain("PEAK 1,842");
    expect(output).toContain("COMMENT viewer: hello");
    expect(output).toContain("GIFT supporter: Rose x2");
    expect(output).toContain("LIKES viewer: +10 (total 100)");
    expect(output).toContain("FOLLOW unknown");
    expect(output).toContain("SHARE unknown");
    expect(output).toContain("SESSION ENDED");
    expect(output).toContain("ENDED @creator");
    expect(output).toContain(
      [
        "SESSION SUMMARY",
        "Session ID: session-renderer",
        "Status: completed",
        "Comments: 1",
        "Gifts: 1",
        "Likes: 1",
        "Follows: 1",
        "Shares: 1",
        "Viewer samples: 1",
        "Current viewers: 1,842",
        "Peak viewers: 1842",
      ].join("\n"),
    );
    expect(sink.closeCalls).toBe(1);
  });

  it("writes one complete summary for an empty bound session", async () => {
    const sink = new MemoryTextSink();
    const renderer = new TerminalRenderer(sink);
    renderer.bindSession("creator", "session-empty");

    await renderer.finalize("completed");
    await renderer.close();

    expect(sink.chunks).toEqual([
      [
        "SESSION SUMMARY",
        "Session ID: session-empty",
        "Status: completed",
        "Comments: 0",
        "Gifts: 0",
        "Likes: 0",
        "Follows: 0",
        "Shares: 0",
        "Viewer samples: 0",
        "Current viewers: --",
        "Peak viewers: 0",
        "",
      ].join("\n"),
    ]);
    expect(sink.chunks.join("")).not.toContain("undefined");
  });

  it("uses an ANSI dashboard only when interactive and keeps the event feed bounded", async () => {
    const interactiveSink = new MemoryTextSink();
    const interactive = new TerminalRenderer(interactiveSink, {
      interactive: true,
      maxRecentEvents: 2,
    });
    await interactive.write(event("session_started", "started", { startedAt }));
    await interactive.write(event("comment", "comment-1", { text: "first" }));
    await interactive.write(event("comment", "comment-2", { text: "second" }));
    await interactive.write(event("comment", "comment-3", { text: "third" }));

    const dashboard = interactiveSink.chunks.at(-1) ?? "";
    expect(dashboard).toContain("\u001b[2J\u001b[H");
    expect(dashboard).toContain("COMMENT unknown: second");
    expect(dashboard).toContain("COMMENT unknown: third");
    expect(dashboard).not.toContain("COMMENT unknown: first");

    const redirectedSink = new MemoryTextSink();
    const redirected = new TerminalRenderer(redirectedSink, { interactive: false });
    await redirected.write(event("session_started", "started", { startedAt }));
    await redirected.write(event("viewer_count", "viewers", { viewerCount: 42 }));
    await redirected.finalize("completed");

    expect(redirectedSink.chunks.join("")).not.toContain(String.fromCharCode(27));
    expect(redirectedSink.chunks.join("")).toContain("VIEWERS 42");
    expect(redirectedSink.chunks.join("")).toContain("PEAK 42");
  });
});
