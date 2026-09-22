import { randomUUID } from "node:crypto";
import { buildLiveEvent, type LiveEventContext } from "../events/normalize.js";
import type { LiveEvent, LiveEventCreator, LiveEventSession } from "../events/types.js";

export interface SessionLifecycleOptions {
  clock?: () => Date;
  idFactory?: () => string;
  eventIdFactory?: () => string;
}

export interface SessionStartInput {
  roomId: string;
  creator: LiveEventCreator;
}

interface ActiveSession {
  context: LiveEventContext;
  startedAt: string;
  ended: boolean;
}

function asValidDate(value: unknown, fallback: Date): Date {
  const date = value instanceof Date ? value : new Date(value as string | number);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

export class SessionLifecycle {
  private readonly clock: () => Date;
  private readonly idFactory: () => string;
  private readonly eventIdFactory: () => string;
  private activeSession: ActiveSession | undefined;

  constructor(options: SessionLifecycleOptions = {}) {
    this.clock = options.clock ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
    this.eventIdFactory = options.eventIdFactory ?? randomUUID;
  }

  get context(): LiveEventContext | undefined {
    return this.activeSession?.context;
  }

  get isActive(): boolean {
    return this.activeSession !== undefined && !this.activeSession.ended;
  }

  start(input: SessionStartInput): LiveEvent<"session_started"> {
    if (this.isActive) {
      throw new Error("A live session is already active.");
    }

    const startedAt = this.clock().toISOString();
    const session: LiveEventSession = {
      id: `session-${this.idFactory()}`,
      roomId: input.roomId,
    };
    const context: LiveEventContext = {
      session,
      creator: input.creator,
      startedAt,
    };

    this.activeSession = {
      context,
      startedAt,
      ended: false,
    };

    return buildLiveEvent("session_started", { startedAt }, context, {
      id: this.eventIdFactory(),
      occurredAt: startedAt,
      receivedAt: startedAt,
    });
  }

  finish(reason: string, endedAt?: unknown): LiveEvent<"session_ended"> | undefined {
    const activeSession = this.activeSession;
    if (activeSession === undefined || activeSession.ended) {
      return undefined;
    }

    const end = asValidDate(endedAt, this.clock());
    const started = new Date(activeSession.startedAt);
    if (end.getTime() < started.getTime()) {
      throw new Error("A live session cannot end before it starts.");
    }

    const endedAtValue = end.toISOString();
    const event = buildLiveEvent(
      "session_ended",
      {
        startedAt: activeSession.startedAt,
        endedAt: endedAtValue,
        reason,
      },
      activeSession.context,
      {
        id: this.eventIdFactory(),
        occurredAt: endedAtValue,
        receivedAt: this.clock().toISOString(),
      },
    );
    activeSession.ended = true;
    return event;
  }
}
