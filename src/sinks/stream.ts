export interface WritableStreamLike {
  write(chunk: string): boolean;
  end(): unknown;
  once(event: "drain" | "error" | "finish", listener: (error?: Error) => void): unknown;
  off?(event: "drain" | "error" | "finish", listener: (error?: Error) => void): unknown;
}

export interface QueuedWritableSinkOptions {
  endOnClose?: boolean;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export class QueuedWritableSink {
  private readonly endOnClose: boolean;
  private queue: Promise<void> = Promise.resolve();
  private firstFailure: Error | undefined;
  private closePromise: Promise<void> | undefined;

  constructor(
    private readonly stream: WritableStreamLike,
    options: QueuedWritableSinkOptions = {},
  ) {
    this.endOnClose = options.endOnClose ?? true;
    this.stream.once("error", (error) => {
      this.recordFailure(asError(error));
    });
  }

  get failure(): Error | undefined {
    return this.firstFailure;
  }

  write(chunk: string): Promise<void> {
    if (this.closePromise !== undefined) {
      return Promise.reject(new Error("Cannot write after the sink has started closing."));
    }

    const write = this.queue.then(async () => {
      this.throwIfFailed();
      await this.writeChunk(chunk);
    });
    this.queue = write.catch((error: unknown) => {
      this.recordFailure(asError(error));
    });
    return write;
  }

  close(): Promise<void> {
    if (this.closePromise !== undefined) {
      return this.closePromise;
    }

    this.closePromise = (async () => {
      await this.queue;
      this.throwIfFailed();
      if (this.endOnClose) {
        await this.endStream();
      }
      this.throwIfFailed();
    })();
    return this.closePromise;
  }

  private async writeChunk(chunk: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanup = (): void => {
        this.stream.off?.("drain", onDrain);
        this.stream.off?.("error", onError);
      };
      const finish = (error?: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        if (error === undefined) {
          resolve();
        } else {
          reject(error);
        }
      };
      const onDrain = (): void => finish();
      const onError = (error?: Error): void => finish(asError(error));

      this.stream.once("error", onError);
      this.stream.once("drain", onDrain);
      const canContinue = this.stream.write(chunk);
      if (canContinue) {
        finish();
      }
    });
  }

  private async endStream(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanup = (): void => {
        this.stream.off?.("finish", onFinish);
        this.stream.off?.("error", onError);
      };
      const finish = (error?: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        if (error === undefined) {
          resolve();
        } else {
          reject(error);
        }
      };
      const onFinish = (): void => finish();
      const onError = (error?: Error): void => finish(asError(error));

      this.stream.once("finish", onFinish);
      this.stream.once("error", onError);
      this.stream.end();
    });
  }

  private recordFailure(error: Error): void {
    this.firstFailure ??= error;
  }

  private throwIfFailed(): void {
    if (this.firstFailure !== undefined) {
      throw this.firstFailure;
    }
  }
}
