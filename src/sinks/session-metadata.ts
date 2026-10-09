import type { LiveEventType, LiveEventCreator, LiveEventSession } from "../events/types.js";

export const SESSION_METADATA_SCHEMA_ID = "urn:livesift:schema:session-metadata:v1";
export const LIVE_EVENT_SCHEMA_ID = "urn:livesift:schema:live-event:v1";

export type SessionExportSource = "live" | "replay";
export type SessionExportStatus = "recording" | "completed" | "interrupted" | "failed";

export type SessionEventCounts = Record<LiveEventType, number>;

export interface SessionMetadata {
  metadataSchemaVersion: 1;
  eventSchemaId: typeof LIVE_EVENT_SCHEMA_ID;
  packageVersion: string;
  source: SessionExportSource;
  platform: "tiktok";
  session: LiveEventSession;
  creator: LiveEventCreator;
  startedAt: string;
  endedAt: string | null;
  endReason: string | null;
  status: SessionExportStatus;
  eventCount: number;
  eventCounts: SessionEventCounts;
  eventsFile: "events.jsonl";
}

export function emptySessionEventCounts(): SessionEventCounts {
  return {
    session_started: 0,
    session_ended: 0,
    comment: 0,
    gift: 0,
    like: 0,
    follow: 0,
    share: 0,
    viewer_count: 0,
  };
}
