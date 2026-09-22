import type { LiveEvent } from "../events/types.js";
import { serializeJsonlEvent } from "./jsonl.js";

export interface TextSink {
  write(chunk: string): Promise<void>;
  close(): Promise<void>;
  readonly failure?: Error;
}

export interface EventSink {
  write(event: LiveEvent): Promise<void>;
  close(): Promise<void>;
  readonly failure?: Error;
}

export type LiveEventFormatter = (event: LiveEvent) => string;

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export class JsonlEventSink implements EventSink {
  constructor(private readonly sink: TextSink) {}

  get failure(): Error | undefined {
    return this.sink.failure;
  }

  write(event: LiveEvent): Promise<void> {
    return this.sink.write(serializeJsonlEvent(event));
  }

  close(): Promise<void> {
    return this.sink.close();
  }
}

export class HumanEventSink implements EventSink {
  constructor(
    private readonly sink: TextSink,
    private readonly format: LiveEventFormatter,
  ) {}

  get failure(): Error | undefined {
    return this.sink.failure;
  }

  write(event: LiveEvent): Promise<void> {
    return this.sink.write(this.format(event));
  }

  close(): Promise<void> {
    return this.sink.close();
  }
}

export class OutputCoordinator {
  private queue: Promise<void> = Promise.resolve();
  private firstFailure: Error | undefined;
  private closePromise: Promise<void> | undefined;

  constructor(private readonly sinks: readonly EventSink[]) {}

  get failure(): Error | undefined {
    return (
      this.firstFailure ??
      this.sinks.map((sink) => sink.failure).find((failure) => failure !== undefined)
    );
  }

  async write(event: LiveEvent): Promise<void> {
    if (this.closePromise !== undefined) {
      throw new Error("Cannot write after the coordinator has started closing.");
    }

    const write = this.queue.then(async () => {
      const failure = this.failure;
      if (failure !== undefined) {
        throw failure;
      }
      await Promise.all(this.sinks.map((sink) => sink.write(event)));
    });
    this.queue = write.catch((error: unknown) => {
      this.firstFailure ??= asError(error);
    });
    return write;
  }

  async close(): Promise<void> {
    if (this.closePromise !== undefined) {
      return this.closePromise;
    }

    this.closePromise = (async () => {
      await this.queue;
      const results = await Promise.allSettled(this.sinks.map((sink) => sink.close()));
      const failure =
        this.failure ??
        results.find((result): result is PromiseRejectedResult => result.status === "rejected")
          ?.reason;
      if (failure !== undefined) {
        throw failure;
      }
    })();
    return this.closePromise;
  }
}
