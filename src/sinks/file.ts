import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { QueuedWritableSink } from "./stream.js";

export interface OutputFileOptions {
  cwd?: string;
  createStream?: (path: string) => WriteStream;
}

export interface OutputFile {
  path: string;
  sink: QueuedWritableSink;
}

function waitForOpen(stream: WriteStream): Promise<void> {
  return new Promise((resolveOpen, rejectOpen) => {
    const cleanup = (): void => {
      stream.off("open", onOpen);
      stream.off("error", onError);
    };
    const onOpen = (): void => {
      cleanup();
      resolveOpen();
    };
    const onError = (error: Error): void => {
      cleanup();
      rejectOpen(error);
    };

    stream.once("open", onOpen);
    stream.once("error", onError);
  });
}

export async function initializeOutputFile(
  outputPath: string,
  options: OutputFileOptions = {},
): Promise<OutputFile> {
  if (outputPath.trim() === "") {
    throw new Error("Output path must not be empty.");
  }

  const path = resolve(options.cwd ?? process.cwd(), outputPath);
  await mkdir(dirname(path), { recursive: true });
  const stream = (options.createStream ?? ((target) => createWriteStream(target, { flags: "w" })))(
    path,
  );
  await waitForOpen(stream);

  return { path, sink: new QueuedWritableSink(stream) };
}
