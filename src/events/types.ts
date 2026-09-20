export const LIVE_EVENT_TYPES = [
  "session_started",
  "session_ended",
  "comment",
  "gift",
  "like",
  "follow",
  "share",
  "viewer_count",
] as const;

export type LiveEventType = (typeof LIVE_EVENT_TYPES)[number];

export interface LiveEventSession {
  id: string;
  roomId?: string;
}

export interface LiveEventCreator {
  username: string;
  userId?: string;
  nickname?: string;
}

export interface LiveEventActor {
  userId?: string;
  username?: string;
  nickname?: string;
}

export type SessionEventData = Record<string, unknown>;

export interface CommentEventData extends Record<string, unknown> {
  text: string;
}

export interface GiftEventData extends Record<string, unknown> {
  giftId?: string;
  giftName?: string;
  count?: number;
  diamondCount?: number;
}

export interface LikeEventData extends Record<string, unknown> {
  count?: number;
  total?: number;
}

export type FollowEventData = Record<string, unknown>;

export type ShareEventData = Record<string, unknown>;

export interface ViewerCountEventData extends Record<string, unknown> {
  viewerCount: number;
}

export interface LiveEventDataByType {
  session_started: SessionEventData;
  session_ended: SessionEventData;
  comment: CommentEventData;
  gift: GiftEventData;
  like: LikeEventData;
  follow: FollowEventData;
  share: ShareEventData;
  viewer_count: ViewerCountEventData;
}

export interface LiveEventBase {
  id: string;
  platform: "tiktok";
  occurredAt: string;
  receivedAt: string;
  session: LiveEventSession;
  creator: LiveEventCreator;
  actor?: LiveEventActor;
  raw?: unknown;
}

export type LiveEvent<TType extends LiveEventType = LiveEventType> =
  TType extends LiveEventType
    ? LiveEventBase & {
        type: TType;
        data: LiveEventDataByType[TType];
      }
    : never;
