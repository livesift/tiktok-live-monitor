import { createReadStream } from "node:fs";
import { parseLiveEvent } from "../events/normalize.js";
import type { LiveEvent } from "../events/types.js";

export const MAX_REPLAY_BYTES = 16 * 1024 * 1024;

export class ReplayInputError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ReplayInputError";
  }
}

function describeSchemaError(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "issues" in error &&
    Array.isArray(error.issues)
  ) {
    return error.issues
      .map((issue: { path?: unknown[]; message?: string }) => {
        const path =
          Array.isArray(issue.path) && issue.path.length > 0 ? issue.path.join(".") : "$";
        return `${path}: ${issue.message ?? "invalid value"}`;
      })
      .join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}

function sameSessionIdentity(first: LiveEvent, next: LiveEvent): boolean {
  return (
    first.session.id === next.session.id &&
    first.session.roomId === next.session.roomId &&
    first.creator.username === next.creator.username &&
    first.creator.userId === next.creator.userId &&
    first.creator.nickname === next.creator.nickname
  );
}

function validateSession(events: readonly LiveEvent[], source: string): void {
  const starts = events.flatMap((event, index) =>
    event.type === "session_started" ? [index] : [],
  );
  const ends = events.flatMap((event, index) => (event.type === "session_ended" ? [index] : []));

  if (starts.length !== 1) {
    const line = starts[1] === undefined ? 1 : starts[1] + 1;
    throw new ReplayInputError(
      `${source}:${line}: replay must contain exactly one session_started event.`,
    );
  }
  if (starts[0] !== 0) {
    throw new ReplayInputError(
      `${source}:${starts[0]! + 1}: session_started must be the first event.`,
    );
  }
  if (ends.length !== 1) {
    const line = ends[1] === undefined ? events.length : ends[1] + 1;
    throw new ReplayInputError(
      `${source}:${line}: replay must contain exactly one session_ended event.`,
    );
  }
  if (ends[0] !== events.length - 1) {
    throw new ReplayInputError(`${source}:${ends[0]! + 1}: session_ended must be the last event.`);
  }

  const first = events[0]!;
  const last = events.at(-1)!;
  if (first.type !== "session_started" || last.type !== "session_ended") {
    throw new ReplayInputError(
      `${source}: replay must begin with session_started and end with session_ended.`,
    );
  }

  for (const [index, event] of events.entries()) {
    if (!sameSessionIdentity(first, event)) {
      throw new ReplayInputError(
        `${source}:${index + 1}: all events must share the same session and creator identity.`,
      );
    }
  }

  if (Date.parse(first.data.startedAt) !== Date.parse(last.data.startedAt)) {
    throw new ReplayInputError(
      `${source}:${events.length}: session_ended.data.startedAt must match session_started.data.startedAt.`,
    );
  }
}

export function parseReplayJsonl(input: string, source = "<replay>"): LiveEvent[] {
  if (Buffer.byteLength(input, "utf8") > MAX_REPLAY_BYTES) {
    throw new ReplayInputError(
      `${source}: replay input exceeds the ${MAX_REPLAY_BYTES}-byte limit.`,
    );
  }
  if (input.length === 0) {
    throw new ReplayInputError(`${source}: replay input is empty.`);
  }

  const lines = input.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  if (lines.length === 0) {
    throw new ReplayInputError(`${source}: replay input is empty.`);
  }

  const events: LiveEvent[] = [];
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const lineNumber = index + 1;
    if (line.trim() === "") {
      throw new ReplayInputError(
        `${source}:${lineNumber}: blank JSONL data lines are not allowed.`,
      );
    }

    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ReplayInputError(`${source}:${lineNumber}: invalid JSON: ${message}`, {
        cause: error,
      });
    }

    try {
      events.push(parseLiveEvent(value));
    } catch (error) {
      throw new ReplayInputError(
        `${source}:${lineNumber}: invalid LiveEvent: ${describeSchemaError(error)}`,
        { cause: error },
      );
    }
  }

  validateSession(events, source);
  return events;
}

export async function readReplayFile(path: string): Promise<LiveEvent[]> {
  const chunks: Buffer[] = [];
  let size = 0;

  try {
    for await (const chunk of createReadStream(path)) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.byteLength;
      if (size > MAX_REPLAY_BYTES) {
        throw new ReplayInputError(
          `${path}: replay input exceeds the ${MAX_REPLAY_BYTES}-byte limit.`,
        );
      }
      chunks.push(bytes);
    }
  } catch (error) {
    if (error instanceof ReplayInputError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new ReplayInputError(`${path}: unable to read replay input: ${message}`, {
      cause: error,
    });
  }

  let input: string;
  try {
    input = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size));
  } catch (error) {
    throw new ReplayInputError(`${path}: replay input is not valid UTF-8.`, { cause: error });
  }

  return parseReplayJsonl(input, path);
}
