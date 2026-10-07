import type { EventSink, TextSink } from "../sinks/output.js";
import type { LiveEvent } from "../events/types.js";
import { SessionStats, type SessionStatsSnapshot } from "./session-stats.js";

export type SessionSummaryStatus = "completed" | "interrupted" | "failed";

function actorLabel(event: LiveEvent): string {
  return event.actor?.username ?? event.actor?.nickname ?? event.actor?.userId ?? "unknown";
}

function eventTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "--:--:--" : date.toISOString().slice(11, 19);
}

function count(value: number | undefined): string {
  return value === undefined ? "-" : value.toLocaleString("en-US");
}

export function formatLiveEvent(event: LiveEvent): string {
  const prefix = `[${eventTime(event.occurredAt)}]`;

  switch (event.type) {
    case "session_started":
      return `${prefix} SESSION STARTED\n`;
    case "session_ended":
      return `${prefix} SESSION ENDED\n`;
    case "comment":
      return `${prefix} COMMENT ${actorLabel(event)}: ${event.data.text}\n`;
    case "gift":
      return `${prefix} GIFT ${actorLabel(event)}: ${event.data.giftName ?? "Gift"} x${count(event.data.count)}\n`;
    case "like":
      return `${prefix} LIKES ${actorLabel(event)}: +${count(event.data.count)} (total ${count(event.data.total)})\n`;
    case "viewer_count":
      return `${prefix} VIEWERS ${event.data.viewerCount.toLocaleString("en-US")}\n`;
    case "follow":
      return `${prefix} FOLLOW ${actorLabel(event)}\n`;
    case "share":
      return `${prefix} SHARE ${actorLabel(event)}\n`;
  }
}

export function formatSessionSummary(
  snapshot: SessionStatsSnapshot,
  status: SessionSummaryStatus,
): string {
  return [
    "SESSION SUMMARY",
    `Session ID: ${snapshot.sessionId ?? "--"}`,
    `Status: ${status}`,
    `Comments: ${snapshot.comments}`,
    `Gifts: ${snapshot.gifts}`,
    `Likes: ${snapshot.likes}`,
    `Follows: ${snapshot.follows}`,
    `Shares: ${snapshot.shares}`,
    `Viewer samples: ${snapshot.viewerSamples}`,
    `Current viewers: ${snapshot.currentViewer?.toLocaleString("en-US") ?? "--"}`,
    `Peak viewers: ${snapshot.peakViewer}`,
    "",
  ].join("\n");
}

export function summaryStatusForEndReason(reason: string): SessionSummaryStatus {
  return reason === "local_shutdown" ? "interrupted" : "completed";
}

export interface TerminalRendererOptions {
  stats?: SessionStats;
  interactive?: boolean;
  maxRecentEvents?: number;
}

export class TerminalRenderer implements EventSink {
  readonly stats: SessionStats;
  private creatorUsername = "--";
  private roomId = "--";
  private state: "CONNECTING" | "LIVE" | "ENDED" = "CONNECTING";
  private summaryWritten = false;
  private summaryStatus: SessionSummaryStatus = "completed";
  private readonly interactive: boolean;
  private readonly maxRecentEvents: number;
  private readonly recentEvents: string[] = [];
  private finalizePromise: Promise<void> | undefined;
  private closePromise: Promise<void> | undefined;

  constructor(
    private readonly sink: TextSink,
    options: TerminalRendererOptions = {},
  ) {
    this.stats = options.stats ?? new SessionStats();
    this.interactive = options.interactive ?? false;
    this.maxRecentEvents = options.maxRecentEvents ?? 8;
    if (!Number.isInteger(this.maxRecentEvents) || this.maxRecentEvents < 1) {
      throw new Error("TerminalRenderer maxRecentEvents must be a positive integer.");
    }
  }

  get failure(): Error | undefined {
    return this.sink.failure;
  }

  bindSession(username: string, sessionId: string, roomId?: string): void {
    this.stats.bindSession(sessionId);
    this.creatorUsername = username;
    this.roomId = roomId ?? this.roomId;
    this.state = "LIVE";
  }

  async write(event: LiveEvent): Promise<void> {
    if (this.summaryWritten) {
      return;
    }
    if (!this.stats.add(event)) {
      return;
    }

    if (event.type === "session_started") {
      this.creatorUsername = event.creator.username;
      this.roomId = event.session.roomId ?? this.roomId;
      this.state = "LIVE";
    }
    if (event.type === "session_ended") {
      this.state = "ENDED";
      this.summaryStatus = summaryStatusForEndReason(event.data.reason);
    }

    const eventLine = formatLiveEvent(event);
    this.pushRecentEvent(eventLine.trimEnd());
    const lines = [eventLine, this.statusLine()];
    if (event.type === "session_ended") {
      this.summaryWritten = true;
      lines.push(formatSessionSummary(this.stats.snapshot(), this.summaryStatus));
    }

    await this.sink.write(this.interactive ? this.renderInteractive() : lines.join(""));
  }

  finalize(status: SessionSummaryStatus = "completed"): Promise<void> {
    if (this.finalizePromise !== undefined) {
      return this.finalizePromise;
    }
    if (this.summaryWritten || this.stats.snapshot().sessionId === null) {
      this.summaryWritten = true;
      this.finalizePromise = Promise.resolve();
      return this.finalizePromise;
    }

    this.summaryWritten = true;
    this.summaryStatus = status;
    this.state = status === "interrupted" ? "ENDED" : this.state;
    this.finalizePromise = this.sink.write(
      this.interactive
        ? this.renderInteractive()
        : formatSessionSummary(this.stats.snapshot(), status),
    );
    return this.finalizePromise;
  }

  close(): Promise<void> {
    if (this.closePromise !== undefined) {
      return this.closePromise;
    }
    this.closePromise = (async () => {
      await this.finalize(this.summaryStatus);
      await this.sink.close();
    })();
    return this.closePromise;
  }

  private statusLine(): string {
    const snapshot = this.stats.snapshot();
    const viewers = snapshot.currentViewer?.toLocaleString("en-US") ?? "--";
    return `${this.state} @${this.creatorUsername} | VIEWERS ${viewers} | PEAK ${snapshot.peakViewer.toLocaleString("en-US")} | COMMENTS ${snapshot.comments} | GIFTS ${snapshot.gifts} | LIKES ${snapshot.likes} | FOLLOWS ${snapshot.follows} | SHARES ${snapshot.shares}\n`;
  }

  private pushRecentEvent(eventLine: string): void {
    this.recentEvents.push(eventLine);
    if (this.recentEvents.length > this.maxRecentEvents) {
      this.recentEvents.splice(0, this.recentEvents.length - this.maxRecentEvents);
    }
  }

  private renderInteractive(): string {
    const snapshot = this.stats.snapshot();
    const currentViewer = snapshot.currentViewer?.toLocaleString("en-US") ?? "--";
    const lines = [
      "\u001b[2J\u001b[H",
      `${this.state} @${this.creatorUsername}`,
      `Session ID: ${snapshot.sessionId ?? "--"}`,
      `Room ID: ${this.roomId}`,
      `Viewers: ${currentViewer} | Peak: ${snapshot.peakViewer.toLocaleString("en-US")}`,
      `Comments: ${snapshot.comments} | Gifts: ${snapshot.gifts} | Likes: ${snapshot.likes} | Follows: ${snapshot.follows} | Shares: ${snapshot.shares}`,
      `Viewer samples: ${snapshot.viewerSamples}`,
      "",
      "Recent events",
      ...(this.recentEvents.length === 0 ? ["--"] : this.recentEvents),
      "",
    ];
    if (this.summaryWritten) {
      lines.push(formatSessionSummary(snapshot, this.summaryStatus));
    }
    return `${lines.join("\n")}\n`;
  }
}
