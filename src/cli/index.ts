#!/usr/bin/env node

import { Command } from "commander";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { MonitorError, normalizeMonitorError } from "../core/errors.js";
import { installSignalHandlers, MonitorController, type SignalSource } from "../core/monitor.js";
import type { LiveProvider } from "../core/provider.js";
import { normalizeCreatorUsername } from "../core/username.js";
import type { LiveEvent } from "../events/types.js";
import {
  gatewayUrlFromEnvironment,
  GatewayEventClient,
} from "../events/gateway.js";
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
  gatewayUrl?: string;
  gatewayFetch?: typeof fetch;
}

const usage = "Usage: tiktok-live-monitor <username>";

function actorLabel(event: LiveEvent): string {
  return (
    event.actor?.username ??
    event.actor?.nickname ??
    event.actor?.userId ??
    "unknown"
  );
}

function eventTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "--:--:--" : date.toISOString().slice(11, 19);
}

function count(value: number | undefined): string {
  return value === undefined ? "-" : value.toLocaleString("en-US");
}

export function formatLiveEvent(event: LiveEvent): string {
  const prefix = `[${eventTime(event.occurredAt)}]`;

  switch (event.type) {
    case "session_started":
      return `${prefix} SESSION STARTED\n`;
    case "session_ended":
      return `${prefix} SESSION ENDED\n`;
    case "comment":
      return `${prefix} COMMENT ${actorLabel(event)}: ${event.data.text}\n`;
    case "gift":
      return `${prefix} GIFT ${actorLabel(event)}: ${event.data.giftName ?? "Gift"} x${count(event.data.count)}\n`;
    case "like":
      return `${prefix} LIKES ${actorLabel(event)}: +${count(event.data.count)} (total ${count(event.data.total)})\n`;
    case "viewer_count":
      return `${prefix} VIEWERS ${event.data.viewerCount.toLocaleString("en-US")}\n`;
    case "follow":
      return `${prefix} FOLLOW ${actorLabel(event)}\n`;
    case "share":
      return `${prefix} SHARE ${actorLabel(event)}\n`;
  }
}

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
  const gatewayUrl = options.gatewayUrl ?? gatewayUrlFromEnvironment();
  let gatewayClient: GatewayEventClient | undefined;
  if (gatewayUrl !== undefined) {
    try {
      gatewayClient = new GatewayEventClient(gatewayUrl, { fetchImpl: options.gatewayFetch });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid Gateway URL.";
      stderr.write(`Invalid Gateway URL: ${message}\n`);
      return 1;
    }
  }

  const pendingGatewayEvents = new Set<Promise<void>>();
  const flushGatewayEvents = async (): Promise<void> => {
    await Promise.all([...pendingGatewayEvents]);
  };
  const sendToGateway = (event: LiveEvent): void => {
    if (gatewayClient === undefined) {
      return;
    }

    const delivery = gatewayClient.send(event).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown Gateway error.";
      stderr.write(`${message}\n`);
    });
    pendingGatewayEvents.add(delivery);
    void delivery.finally(() => pendingGatewayEvents.delete(delivery));
  };
  const monitor = new MonitorController(provider);
  const keepAlive = options.keepAlive ?? true;
  monitor.onEvent((event) => {
    stdout.write(formatLiveEvent(event));
    sendToGateway(event);
  });

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
      await flushGatewayEvents();
      return 0;
    }

    const exitCode = await shutdown;
    removeSignalHandlers();
    await monitor.disconnect();
    await flushGatewayEvents();
    return exitCode;
  } catch (error) {
    removeSignalHandlers();
    stderr.write(`${normalizeMonitorError(error).message}\n`);
    await monitor.disconnect();
    await flushGatewayEvents();
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
