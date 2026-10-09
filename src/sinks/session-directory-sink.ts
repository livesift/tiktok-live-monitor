import { createWriteStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { LiveEvent, LiveEventType } from "../events/types.js";
import { initializeOutputFile } from "./file.js";
import { serializeJsonlEvent } from "./jsonl.js";
import type { EventSink, TextSink } from "./output.js";
import {
  emptySessionEventCounts,
  LIVE_EVENT_SCHEMA_ID,
  type SessionEventCounts,
  type SessionExportSource,
  type SessionExportStatus,
  type SessionMetadata,
} from "./session-metadata.js";
import {
  assertSessionDirectoryDoesNotExist,
  createSessionDirectory,
  sessionDirectoryPath,
} from "./session-directory.js";

export interface SessionDirectorySinkOptions {
  root: string;
  packageVersion: string;
  source: SessionExportSource;
  openEventFile?: (path: string) => Promise<TextSink>;
  replaceMetadata?: (temporaryPath: string, metadataPath: string) => Promise<void>;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function sameIdentity(left: LiveEvent, right: LiveEvent): boolean {
  return (
    left.session.id === right.session.id &&
    left.session.roomId === right.session.roomId &&
    left.creator.username === right.creator.username &&
    left.creator.userId === right.creator.userId &&
    left.creator.nickname === right.creator.nickname
  );
}

async function openJsonlFile(path: string): Promise<TextSink> {
  const output = await initializeOutputFile(path, {
    createStream: (target) => createWriteStream(target, { flags: "wx", mode: 0o600 }),
  });
  return output.sink;
}

async function atomicWriteMetadata(
  metadataPath: string,
  metadata: SessionMetadata,
  replace: (temporaryPath: string, targetPath: string) => Promise<void>,
): Promise<void> {
  const temporaryPath = `${metadataPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(metadata, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await replace(temporaryPath, metadataPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export class SessionDirectorySink implements EventSink {
  private readonly openEventFile: (path: string) => Promise<TextSink>;
  private readonly replaceMetadata: (temporaryPath: string, metadataPath: string) => Promise<void>;
  private queue: Promise<void> = Promise.resolve();
  private firstFailure: Error | undefined;
  private fileSink: TextSink | undefined;
  private directory: string | undefined;
  private metadata: SessionMetadata | undefined;
  private metadataPath: string | undefined;
  private closePromise: Promise<void> | undefined;
  private finishPromise: Promise<void> | undefined;

  constructor(private readonly options: SessionDirectorySinkOptions) {
    this.openEventFile = options.openEventFile ?? openJsonlFile;
    this.replaceMetadata = options.replaceMetadata ?? rename;
  }

  get failure(): Error | undefined {
    return this.firstFailure ?? this.fileSink?.failure;
  }

  get archivePath(): string | undefined {
    return this.directory;
  }

  get snapshot(): SessionMetadata | undefined {
    return this.metadata === undefined ? undefined : structuredClone(this.metadata);
  }

  write(event: LiveEvent): Promise<void> {
    if (this.closePromise !== undefined) {
      return Promise.reject(
        new Error("Cannot write after the session archive has started closing."),
      );
    }

    const write = this.queue.then(() => this.writeEvent(event));
    this.queue = write.catch((error: unknown) => {
      this.firstFailure ??= asError(error);
    });
    return write;
  }

  close(): Promise<void> {
    if (this.closePromise !== undefined) {
      return this.closePromise;
    }

    this.closePromise = (async () => {
      await this.queue;
      if (this.fileSink !== undefined) {
        try {
          await this.fileSink.close();
        } catch (error) {
          this.firstFailure ??= asError(error);
        }
      }
      if (this.failure !== undefined) {
        throw this.failure;
      }
    })();
    return this.closePromise;
  }

  finish(status: SessionExportStatus): Promise<void> {
    if (this.finishPromise !== undefined) {
      return this.finishPromise;
    }

    this.finishPromise = (async () => {
      await this.queue;
      if (this.metadata === undefined || this.metadataPath === undefined) {
        return;
      }
      if (status !== "failed" && this.metadata.endedAt === null) {
        throw new Error("Cannot finalize a session archive without session_ended.");
      }

      this.metadata.status = this.failure === undefined ? status : "failed";
      await atomicWriteMetadata(this.metadataPath, this.metadata, this.replaceMetadata);
    })();
    return this.finishPromise;
  }

  private async writeEvent(event: LiveEvent): Promise<void> {
    if (this.firstFailure !== undefined) {
      throw this.firstFailure;
    }

    if (this.metadata === undefined) {
      await this.startArchive(event);
    } else if (this.firstEvent === undefined || !sameIdentity(this.firstEvent, event)) {
      throw new Error("All events in a session archive must share one session and creator.");
    }

    if (this.metadata === undefined || this.fileSink === undefined) {
      throw new Error("Session archive did not initialize.");
    }
    if (this.metadata.endedAt !== null) {
      throw new Error("Cannot write events after session_ended.");
    }

    await this.fileSink.write(serializeJsonlEvent(event));
    this.metadata.eventCount += 1;
    this.metadata.eventCounts[event.type as LiveEventType] += 1;

    if (event.type === "session_ended") {
      this.metadata.endedAt = event.data.endedAt;
      this.metadata.endReason = event.data.reason;
    }
  }

  private firstEvent: LiveEvent | undefined;

  private async startArchive(event: LiveEvent): Promise<void> {
    if (event.type !== "session_started") {
      throw new Error("A session archive must begin with session_started.");
    }
    if (event.session.id.trim() === "" || event.creator.username.trim() === "") {
      throw new Error("Session archive requires a session ID and creator username.");
    }

    const directory = sessionDirectoryPath(
      this.options.root,
      event.creator.username,
      event.data.startedAt,
      event.session.id,
    );
    await assertSessionDirectoryDoesNotExist(directory);
    await createSessionDirectory(directory);
    this.directory = directory;
    this.metadataPath = join(directory, "session.metadata.json");
    this.fileSink = await this.openEventFile(join(directory, "events.jsonl"));
    this.firstEvent = event;
    const eventCounts: SessionEventCounts = emptySessionEventCounts();
    this.metadata = {
      metadataSchemaVersion: 1,
      eventSchemaId: LIVE_EVENT_SCHEMA_ID,
      packageVersion: this.options.packageVersion,
      source: this.options.source,
      platform: event.platform,
      session: structuredClone(event.session),
      creator: structuredClone(event.creator),
      startedAt: event.data.startedAt,
      endedAt: null,
      endReason: null,
      status: "recording",
      eventCount: 0,
      eventCounts,
      eventsFile: "events.jsonl",
    };
    await this.writeMetadata();
  }

  private async writeMetadata(): Promise<void> {
    if (this.metadata === undefined || this.metadataPath === undefined) {
      throw new Error("Session archive metadata is not initialized.");
    }
    await atomicWriteMetadata(this.metadataPath, this.metadata, this.replaceMetadata);
  }
}
