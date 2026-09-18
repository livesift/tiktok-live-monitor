#!/usr/bin/env node

import { Command } from "commander";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { MonitorError, normalizeMonitorError } from "../core/errors.js";
import { installSignalHandlers, MonitorController, type SignalSource } from "../core/monitor.js";
import type { LiveProvider } from "../core/provider.js";
import { normalizeCreatorUsername } from "../core/username.js";
import { TikTokLiveConnectorProvider } from "../providers/tiktok-live-connector/provider.js";

export interface CliWriter {
  write(message: string): unknown;
}

export interface CliOptions {
  provider?: LiveProvider;
  stdout?: CliWriter;
  stderr?: CliWriter;
  signalSource?: SignalSource;
  keepAlive?: boolean;
}

const usage = "Usage: tiktok-live-monitor <username>";

export function parseCreatorUsername(args: readonly string[]): string {
  const errors: string[] = [];
  const program = new Command()
    .name("tiktok-live-monitor")
    .argument("<username>")
    .allowExcessArguments(false)
    .exitOverride()
    .configureOutput({
      writeErr: (message) => errors.push(message),
      outputError: (message) => errors.push(message),
    });

  let rawUsername: string | undefined;
  program.action((username: string) => {
    rawUsername = username;
  });

  try {
    program.parse(["node", "tiktok-live-monitor", ...args]);
  } catch {
    const details = errors.join(" ").trim();
    throw new MonitorError("INVALID_USERNAME", details === "" ? usage : `${usage}\n${details}`);
  }

  if (rawUsername === undefined) {
    throw new MonitorError("INVALID_USERNAME", usage);
  }

  try {
    return normalizeCreatorUsername(rawUsername);
  } catch (error) {
    const normalizedError = normalizeMonitorError(error, "INVALID_USERNAME");
    throw new MonitorError("INVALID_USERNAME", `${usage}\n${normalizedError.message}`, {
      cause: error,
    });
  }
}

export async function runCli(
  args: readonly string[] = process.argv.slice(2),
  options: CliOptions = {},
): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  let username: string;

  try {
    username = parseCreatorUsername(args);
  } catch (error) {
    stderr.write(`${normalizeMonitorError(error, "INVALID_USERNAME").message}\n`);
    return 1;
  }

  const provider = options.provider ?? new TikTokLiveConnectorProvider();
  const monitor = new MonitorController(provider);
  const keepAlive = options.keepAlive ?? true;

  stdout.write(`Connecting to @${username}...\n`);

  let resolveShutdown: ((code: number) => void) | undefined;
  const shutdown = new Promise<number>((resolve) => {
    resolveShutdown = resolve;
  });
  const removeSignalHandlers = installSignalHandlers(monitor, {
    source: options.signalSource,
    onExit: (code) => {
      stdout.write("Disconnected.\n");
      resolveShutdown?.(code);
    },
  });

  try {
    const session = await monitor.connect(username);
    stdout.write("LIVE detected\n");
    stdout.write("Connected.\n");
    stdout.write(`Room ID: ${session.roomId}\n`);

    if (!keepAlive) {
      removeSignalHandlers();
      await monitor.disconnect();
      return 0;
    }

    const exitCode = await shutdown;
    removeSignalHandlers();
    return exitCode;
  } catch (error) {
    removeSignalHandlers();
    stderr.write(`${normalizeMonitorError(error).message}\n`);
    await monitor.disconnect();
    return 1;
  }
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMainModule) {
  void runCli().then((code) => {
    process.exitCode = code;
  });
}
