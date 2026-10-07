import type { LiveEvent } from "../events/types.js";

export interface SessionStatsSnapshot {
  readonly sessionId: string | null;
  readonly comments: number;
  readonly gifts: number;
  readonly likes: number;
  readonly follows: number;
  readonly shares: number;
  readonly viewerSamples: number;
  readonly currentViewer: number | null;
  readonly peakViewer: number;
}

export class SessionStats {
  private sessionId: string | undefined;
  private readonly processedEventIds = new Set<string>();
  private comments = 0;
  private gifts = 0;
  private likes = 0;
  private follows = 0;
  private shares = 0;
  private viewerSamples = 0;
  private currentViewer: number | null = null;
  private latestViewerAt: number | undefined;
  private peakViewer = 0;

  bindSession(sessionId: string): void {
    if (typeof sessionId !== "string" || sessionId.trim() === "") {
      throw new Error("Session id must not be empty.");
    }
    if (this.sessionId !== undefined && this.sessionId !== sessionId) {
      throw new Error(`SessionStats is bound to session ${this.sessionId}.`);
    }
    this.sessionId = sessionId;
  }

  add(event: LiveEvent): boolean {
    if (typeof event.id !== "string" || event.id.trim() === "") {
      throw new Error("LiveEvent id must not be empty.");
    }
    if (typeof event.session?.id !== "string" || event.session.id.trim() === "") {
      throw new Error("LiveEvent session id must not be empty.");
    }
    this.bindSession(event.session.id);
    if (this.processedEventIds.has(event.id)) {
      return false;
    }
    this.processedEventIds.add(event.id);

    switch (event.type) {
      case "comment":
        this.comments += 1;
        break;
      case "gift":
        this.gifts += 1;
        break;
      case "like":
        this.likes += 1;
        break;
      case "follow":
        this.follows += 1;
        break;
      case "share":
        this.shares += 1;
        break;
      case "viewer_count":
        this.addViewerSample(event);
        break;
      case "session_started":
      case "session_ended":
        break;
    }

    return true;
  }

  snapshot(): SessionStatsSnapshot {
    return Object.freeze({
      sessionId: this.sessionId ?? null,
      comments: this.comments,
      gifts: this.gifts,
      likes: this.likes,
      follows: this.follows,
      shares: this.shares,
      viewerSamples: this.viewerSamples,
      currentViewer: this.currentViewer,
      peakViewer: this.peakViewer,
    });
  }

  private addViewerSample(event: LiveEvent<"viewer_count">): void {
    const viewerCount = event.data.viewerCount;
    const occurredAt = Date.parse(event.occurredAt);
    if (!Number.isSafeInteger(viewerCount) || viewerCount < 0 || !Number.isFinite(occurredAt)) {
      return;
    }

    this.viewerSamples += 1;
    this.peakViewer = Math.max(this.peakViewer, viewerCount);
    if (this.latestViewerAt === undefined || occurredAt >= this.latestViewerAt) {
      this.latestViewerAt = occurredAt;
      this.currentViewer = viewerCount;
    }
  }
}
