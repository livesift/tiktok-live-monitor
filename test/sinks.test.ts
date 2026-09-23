import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ConsoleSink,
  HumanEventSink,
  JsonlEventSink,
  JsonlSink,
  OutputCoordinator,
  QueuedWritableSink,
  initializeOutputFile,
  serializeJsonlEvent,
  type LiveEvent,
  type TextSink,
  type WritableStreamLike,
} from "../src/index.js";

const startedAt = "2026-09-21T10:00:00.000Z";
const endedAt = "2026-09-21T10:01:00.000Z";

function event(id: string, type: LiveEvent["type"] = "comment"): LiveEvent {
  if (type === "session_started") {
    return {
      id,
      platform: "tiktok",
      type,
      occurredAt: startedAt,
      receivedAt: startedAt,
      session: { id: "session-1", roomId: "room-1" },
      creator: { username: "creator" },
      data: { startedAt },
    };
  }
  if (type === "session_ended") {
    return {
      id,
      platform: "tiktok",
      type,
      occurredAt: endedAt,
      receivedAt: endedAt,
      session: { id: "session-1", roomId: "room-1" },
      creator: { username: "creator" },
      data: { startedAt, endedAt, reason: "stream_end" },
    };
  }
  return {
    id,
    platform: "tiktok",
    type,
    occurredAt: startedAt,
    receivedAt: startedAt,
    session: { id: "session-1", roomId: "room-1" },
    creator: { username: "creator" },
    data: type === "comment" ? { text: `message-${id}` } : {},
  } as LiveEvent;
}

class FakeWritable extends EventEmitter implements WritableStreamLike {
  readonly chunks: string[] = [];
  writeResults: boolean[] = [];
  writeError: Error | undefined;
  endError: Error | undefined;
  endCalls = 0;
  finishOnEnd = true;
  drainDuringWrite = false;

  write(chunk: string): boolean {
    this.chunks.push(chunk);
    if (this.writeError !== undefined) {
      this.emit("error", this.writeError);
    }
    const canContinue = this.writeResults.shift() ?? true;
    if (!canContinue && this.drainDuringWrite) {
      this.emit("drain");
    }
    return canContinue;
  }

  end(): unknown {
    this.endCalls += 1;
    if (this.endError !== undefined) {
      queueMicrotask(() => this.emit("error", this.endError));
    } else if (this.finishOnEnd) {
      queueMicrotask(() => this.emit("finish"));
    }
    return this;
  }

  releaseDrain(): void {
    this.emit("drain");
  }
}

class MemoryTextSink implements TextSink {
  readonly chunks: string[] = [];
  closeCalls = 0;
  failure: Error | undefined;
  writeDelay = 0;

  async write(chunk: string): Promise<void> {
    if (this.writeDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.writeDelay));
    }
    this.chunks.push(chunk);
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
  }
}

describe("serializeJsonlEvent", () => {
  it("serializes each event as one complete newline-terminated JSON value", () => {
    const lines = [event("event-1"), event("event-2")].map(serializeJsonlEvent);

    expect(lines).toHaveLength(2);
    expect(lines.every((line) => line.endsWith("\n"))).toBe(true);
    expect(lines.map((line) => JSON.parse(line))).toEqual([event("event-1"), event("event-2")]);
    expect(lines.join("")).toBe(
      `${JSON.stringify(event("event-1"))}\n${JSON.stringify(event("event-2"))}\n`,
    );
  });

  it("does not emit a partial line when JSON serialization fails", () => {
    const invalid = event("event-invalid") as LiveEvent & { raw: unknown };
    invalid.raw = BigInt(1);
    const text = new MemoryTextSink();
    const sink = new JsonlEventSink(text);

    expect(() => serializeJsonlEvent(invalid)).toThrow(TypeError);
    expect(() => sink.write(invalid)).toThrow(TypeError);
    expect(text.chunks).toEqual([]);
  });
});

describe("QueuedWritableSink", () => {
  it("preserves order and waits for backpressure before the next write", async () => {
    const stream = new FakeWritable();
    stream.writeResults = [false, true];
    const sink = new QueuedWritableSink(stream);

    const first = sink.write("first\n");
    const second = sink.write("second\n");
    await Promise.resolve();
    expect(stream.chunks).toEqual(["first\n"]);
    expect(stream.chunks).not.toContain("second\n");

    stream.releaseDrain();
    await Promise.all([first, second]);
    expect(stream.chunks).toEqual(["first\n", "second\n"]);
  });

  it("handles a writable that emits drain synchronously", async () => {
    const stream = new FakeWritable();
    stream.writeResults = [false];
    stream.drainDuringWrite = true;
    const sink = new QueuedWritableSink(stream);

    await sink.write("sync-drain\n");
    expect(stream.chunks).toEqual(["sync-drain\n"]);
  });

  it("exposes the first write failure and does not leave a partial promise", async () => {
    const stream = new FakeWritable();
    const failure = new Error("write failed");
    stream.writeError = failure;
    const sink = new QueuedWritableSink(stream);

    await expect(sink.write("bad\n")).rejects.toBe(failure);
    expect(sink.failure).toBe(failure);
    await expect(sink.close()).rejects.toBe(failure);
    expect(stream.chunks).toEqual(["bad\n"]);
  });

  it("drains and closes exactly once, surfacing close errors", async () => {
    const stream = new FakeWritable();
    const sink = new QueuedWritableSink(stream);
    await sink.write("complete\n");
    const firstClose = sink.close();
    const secondClose = sink.close();

    expect(firstClose).toBe(secondClose);
    await firstClose;
    expect(stream.endCalls).toBe(1);
    await sink.close();
    expect(stream.endCalls).toBe(1);

    const errorStream = new FakeWritable();
    errorStream.endError = new Error("close failed");
    const errorSink = new QueuedWritableSink(errorStream);
    await expect(errorSink.close()).rejects.toThrow("close failed");
  });

  it("can leave an owned stdout-like stream open", async () => {
    const stream = new FakeWritable();
    const sink = new QueuedWritableSink(stream, { endOnClose: false });
    await sink.write("line\n");
    await sink.close();

    expect(stream.endCalls).toBe(0);
  });
});

describe("event sinks and output coordinator", () => {
  it("exports stable ConsoleSink and JsonlSink names", () => {
    expect(ConsoleSink).toBe(HumanEventSink);
    expect(JsonlSink).toBe(JsonlEventSink);
  });

  it("writes human and JSONL representations and fans out equivalent events", async () => {
    const human = new MemoryTextSink();
    const json = new MemoryTextSink();
    const humanSink = new HumanEventSink(human, (item) => `HUMAN ${item.id}\n`);
    const jsonSink = new JsonlEventSink(json);
    const coordinator = new OutputCoordinator([humanSink, jsonSink]);
    const events = [event("event-1"), event("event-2", "session_ended")];

    for (const item of events) {
      await coordinator.write(item);
    }
    await coordinator.close();

    expect(human.chunks).toEqual(["HUMAN event-1\n", "HUMAN event-2\n"]);
    expect(json.chunks.map((line) => JSON.parse(line))).toEqual(events);
    expect(human.closeCalls).toBe(1);
    expect(json.closeCalls).toBe(1);
  });

  it("serializes concurrent event writes before closing all sinks", async () => {
    const json = new MemoryTextSink();
    json.writeDelay = 5;
    const coordinator = new OutputCoordinator([new JsonlEventSink(json)]);

    const writes = [coordinator.write(event("event-1")), coordinator.write(event("event-2"))];
    await coordinator.close();
    await Promise.all(writes);

    expect(json.chunks.map((line) => JSON.parse(line).id)).toEqual(["event-1", "event-2"]);
    expect(json.closeCalls).toBe(1);
  });
});

describe("initializeOutputFile", () => {
  it("creates nested parents and truncates an existing file", async () => {
    const root = await mkdtemp(join(tmpdir(), "tiktok-live-monitor-"));
    const target = join(root, "nested", "session.jsonl");
    await mkdir(join(root, "nested"), { recursive: true });
    await writeFile(target, "old content\n");

    const output = await initializeOutputFile("nested/session.jsonl", { cwd: root });
    await output.sink.write(serializeJsonlEvent(event("new-event")));
    await output.sink.close();

    expect(output.path).toBe(target);
    expect(await readFile(target, "utf8")).toBe(serializeJsonlEvent(event("new-event")));
  });

  it("fails before creating a stream when a parent path is a file", async () => {
    const root = await mkdtemp(join(tmpdir(), "tiktok-live-monitor-"));
    await writeFile(join(root, "not-a-directory"), "file");

    await expect(
      initializeOutputFile("not-a-directory/session.jsonl", { cwd: root }),
    ).rejects.toBeTruthy();
  });
});
