import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  GiftEventData,
  LikeEventData,
  LiveEvent,
  LiveEventActor,
  LiveEventCreator,
  LiveEventDataByType,
  LiveEventSession,
  LiveEventType,
  ViewerCountEventData,
} from "./types.js";

const timestampSchema = z.string().datetime({ offset: false });
const sessionSchema = z
  .object({
    id: z.string().min(1),
    roomId: z.string().min(1).optional(),
  })
  .strict();
const creatorSchema = z
  .object({
    username: z.string().min(1),
    userId: z.string().min(1).optional(),
    nickname: z.string().min(1).optional(),
  })
  .strict();
const actorSchema = z
  .object({
    userId: z.string().min(1).optional(),
    username: z.string().min(1).optional(),
    nickname: z.string().min(1).optional(),
  })
  .strict();
const extensionDataSchema = z.record(z.unknown());
const commentDataSchema = z
  .object({ text: z.string() })
  .passthrough();
const giftDataSchema = z
  .object({
    giftId: z.string().min(1).optional(),
    giftName: z.string().min(1).optional(),
    count: z.number().int().nonnegative().optional(),
    diamondCount: z.number().int().nonnegative().optional(),
  })
  .passthrough()
  .refine((data) => Object.keys(data).length > 0);
const likeDataSchema = z
  .object({
    count: z.number().int().nonnegative().optional(),
    total: z.number().int().nonnegative().optional(),
  })
  .passthrough()
  .refine((data) => Object.keys(data).length > 0);
const viewerCountDataSchema = z
  .object({ viewerCount: z.number().int().nonnegative() })
  .passthrough();
const baseEventSchema = z
  .object({
    id: z.string().min(1),
    platform: z.literal("tiktok"),
    occurredAt: timestampSchema,
    receivedAt: timestampSchema,
    session: sessionSchema,
    creator: creatorSchema,
    actor: actorSchema.optional(),
    raw: z.unknown().optional(),
  })
  .strict();

export const liveEventSchema = z.discriminatedUnion("type", [
  baseEventSchema.extend({ type: z.literal("session_started"), data: extensionDataSchema }),
  baseEventSchema.extend({ type: z.literal("session_ended"), data: extensionDataSchema }),
  baseEventSchema.extend({ type: z.literal("comment"), data: commentDataSchema }),
  baseEventSchema.extend({ type: z.literal("gift"), data: giftDataSchema }),
  baseEventSchema.extend({ type: z.literal("like"), data: likeDataSchema }),
  baseEventSchema.extend({ type: z.literal("follow"), data: extensionDataSchema }),
  baseEventSchema.extend({ type: z.literal("share"), data: extensionDataSchema }),
  baseEventSchema.extend({ type: z.literal("viewer_count"), data: viewerCountDataSchema }),
]);

export interface LiveEventContext {
  session: LiveEventSession;
  creator: LiveEventCreator;
}

export interface BuildLiveEventOptions {
  occurredAt?: unknown;
  receivedAt?: unknown;
  actor?: LiveEventActor;
  raw?: unknown;
  id?: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  const candidate = typeof value === "number" ? value : Number(value);
  return Number.isFinite(candidate) ? candidate : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  const candidate = finiteNumber(value);
  return candidate !== undefined && Number.isInteger(candidate) && candidate >= 0
    ? candidate
    : undefined;
}

function toDate(value: unknown): Date | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = Math.abs(value) < 1_000_000_000_000 ? value * 1000 : value;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return toDate(numeric);
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  return undefined;
}

function eventTimestamp(payload: unknown, fallback: Date): string {
  const record = asRecord(payload);
  const common = asRecord(record?.common);
  return (toDate(common?.createTime ?? record?.timestampMs ?? record?.timestamp) ?? fallback).toISOString();
}

function compactActor(payload: unknown): LiveEventActor | undefined {
  const record = asRecord(payload);
  const user = asRecord(record?.user);
  if (user === undefined) {
    return undefined;
  }

  const actor: LiveEventActor = {
    userId: nonEmptyString(user.id),
    username: nonEmptyString(user.displayId) ?? nonEmptyString(user.uniqueId),
    nickname: nonEmptyString(user.nickname),
  };

  return Object.values(actor).some((value) => value !== undefined) ? actor : undefined;
}

function optionalEventData(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}

function giftData(payload: unknown): GiftEventData | undefined {
  const record = asRecord(payload);
  const gift = asRecord(record?.gift);
  const data = optionalEventData({
    giftId: nonEmptyString(record?.giftId),
    giftName: nonEmptyString(gift?.name),
    count:
      nonNegativeInteger(record?.repeatCount) ??
      nonNegativeInteger(record?.groupCount) ??
      nonNegativeInteger(record?.comboCount) ??
      1,
    diamondCount: nonNegativeInteger(gift?.diamondCount),
  }) as GiftEventData;

  return Object.keys(data).length > 0 ? data : undefined;
}

function likeData(payload: unknown): LikeEventData | undefined {
  const record = asRecord(payload);
  const data = optionalEventData({
    count: nonNegativeInteger(record?.count),
    total: nonNegativeInteger(record?.total),
  }) as LikeEventData;

  return Object.keys(data).length > 0 ? data : undefined;
}

function viewerCountData(payload: unknown): ViewerCountEventData | undefined {
  const record = asRecord(payload);
  // 不同版本的 tiktok-live-connector 使用过 viewerCount 和 total；
  // totalUser/popularity 作为兼容字段保留。部分消息会把 popularity 默认置为 0，
  // 因此不能使用简单的 ??，否则会遮蔽后续字段中的实际人数。
  const candidates = [
    record?.viewerCount,
    record?.total,
    record?.totalUser,
    record?.popularity,
  ]
    .map(nonNegativeInteger)
    .filter((value): value is number => value !== undefined);
  const data = candidates.find((value) => value > 0) ?? candidates[0];

  return data === undefined ? undefined : { viewerCount: data };
}

function socialEventType(payload: unknown): "follow" | "share" | undefined {
  const record = asRecord(payload);
  const action = nonEmptyString(record?.action)?.toLowerCase();
  if (action?.includes("share") || nonEmptyString(record?.shareType) !== undefined) {
    return "share";
  }

  if (
    action?.includes("follow") ||
    nonNegativeInteger(record?.followCount) !== undefined ||
    nonNegativeInteger(record?.followType) !== undefined
  ) {
    return "follow";
  }

  return undefined;
}

export function buildLiveEvent<TType extends LiveEventType>(
  type: TType,
  data: LiveEventDataByType[TType],
  context: LiveEventContext,
  options: BuildLiveEventOptions = {},
): LiveEvent<TType> {
  const receivedAt = toDate(options.receivedAt) ?? new Date();
  const event = {
    id: options.id ?? randomUUID(),
    platform: "tiktok" as const,
    type,
    occurredAt: (toDate(options.occurredAt) ?? receivedAt).toISOString(),
    receivedAt: receivedAt.toISOString(),
    session: context.session,
    creator: context.creator,
    ...(options.actor === undefined ? {} : { actor: options.actor }),
    data,
    ...(options.raw === undefined ? {} : { raw: options.raw }),
  };

  return liveEventSchema.parse(event) as LiveEvent<TType>;
}

export function parseLiveEvent(input: unknown): LiveEvent {
  return liveEventSchema.parse(input) as LiveEvent;
}

export function normalizeTikTokEvent(
  providerType: string,
  payload: unknown,
  context: LiveEventContext,
): LiveEvent | undefined {
  const receivedAt = new Date();
  const options: BuildLiveEventOptions = {
    occurredAt: eventTimestamp(payload, receivedAt),
    receivedAt,
    actor: compactActor(payload),
    raw: payload,
  };

  switch (providerType) {
    case "sessionStarted":
      return buildLiveEvent("session_started", {}, context, options);
    case "streamEnd":
      return buildLiveEvent("session_ended", { reason: "stream_end" }, context, options);
    case "chat": {
      const content = nonEmptyString(asRecord(payload)?.content);
      return content === undefined
        ? undefined
        : buildLiveEvent("comment", { text: content }, context, options);
    }
    case "gift": {
      const data = giftData(payload);
      return data === undefined ? undefined : buildLiveEvent("gift", data, context, options);
    }
    case "like": {
      const data = likeData(payload);
      return data === undefined ? undefined : buildLiveEvent("like", data, context, options);
    }
    case "roomUser": {
      const data = viewerCountData(payload);
      return data === undefined
        ? undefined
        : buildLiveEvent("viewer_count", data, context, options);
    }
    case "follow":
    case "share":
    case "social": {
      const type = providerType === "social" ? socialEventType(payload) : providerType;
      if (type === undefined) {
        return undefined;
      }

      const record = asRecord(payload);
      const data = optionalEventData({
        action: nonEmptyString(record?.action),
        shareType: nonEmptyString(record?.shareType),
        shareTarget: nonEmptyString(record?.shareTarget),
        shareCount: nonNegativeInteger(record?.shareCount),
        followType: nonNegativeInteger(record?.followType),
      });
      return buildLiveEvent(type, data, context, options);
    }
    default:
      return undefined;
  }
}
