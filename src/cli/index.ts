#!/usr/bin/env node

import { Command, CommanderError } from "commander";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { MonitorError, normalizeMonitorError } from "../core/errors.js";
import { installSignalHandlers, MonitorController, type SignalSource } from "../core/monitor.js";
import type { LiveProvider } from "../core/provider.js";
import { normalizeCreatorUsername } from "../core/username.js";
import type { LiveEvent } from "../events/types.js";
import { gatewayUrlFromEnvironment, resolveGatewayEventsEndpoint } from "../events/gateway.js";
import { TikTokLiveConnectorProvider } from "../providers/tiktok-live-connector/provider.js";
import {
  ConsoleSink,
  JsonlSink,
  OutputCoordinator,
  QueuedWritableSink,
  WebhookEventSink,
  initializeOutputFile,
  parseWebhookHeader,
  type EventSink,
  type TextSink,
  type WebhookHeader,
  type WritableStreamLike,
} from "../sinks/index.js";

export interface CliWriter {
  write(message: string): unknown;
  once?: WritableStreamLike["once"];
  off?: WritableStreamLike["off"];
  end?: WritableStreamLike["end"];
}

export interface CliConfiguration {
  username: string;
  json: boolean;
  output?: string;
  webhook?: string;
  webhookHeaders?: readonly WebhookHeader[];
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
  return event.actor?.username ?? event.actor?.nickname ?? event.actor?.userId ?? "unknown";
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

type CliParseResult = CliConfiguration | { help: string };

export function parseCliOptions(args: readonly string[]): CliParseResult {
  const errors: string[] = [];
  const help: string[] = [];
  const program = new Command()
    .name("tiktok-live-monitor")
    .description(
      "Monitor a TikTok LIVE session. Default output is human-readable; use --json for JSONL.",
    )
    .usage("[options] <username>")
    .argument("<username>", "TikTok LIVE creator username")
    .option("--json", "write JSONL events to stdout; diagnostics go to stderr")
    .option("-o, --output <path>", "write JSONL events to a truncated file")
    .option("--webhook <url>", "POST normalized events to an HTTP endpoint")
    .option(
      "--webhook-header <header>",
      'add a webhook header using the "Name: value" format; repeatable',
      (value: string, previous: string[] = []) => [...previous, value],
      [],
    )
    .addHelpText(
      "after",
      '\nExamples:\n  tiktok-live-monitor @creator\n  tiktok-live-monitor @creator --json --output ./data/session.jsonl\n  tiktok-live-monitor @creator --webhook https://example.test/events --webhook-header "Authorization: Bearer TOKEN"\n',
    )
    .allowExcessArguments(false)
    .exitOverride()
    .configureOutput({
      writeOut: (message) => help.push(message),
      writeErr: (message) => errors.push(message),
      outputError: (message) => errors.push(message),
    });

  let rawUsername: string | undefined;
  program.action((username: string) => {
    rawUsername = username;
  });

  try {
    program.parse(["node", "tiktok-live-monitor", ...args]);
  } catch (error) {
    if (error instanceof CommanderError && error.code === "commander.helpDisplayed") {
      return { help: help.join("") };
    }
    const details = errors.join(" ").trim();
    throw new MonitorError("INVALID_USERNAME", details === "" ? usage : `${usage}\n${details}`);
  }

  if (help.length > 0) {
    return { help: help.join("") };
  }

  if (rawUsername === undefined) {
    throw new MonitorError("INVALID_USERNAME", usage);
  }

  let username: string;
  try {
    username = normalizeCreatorUsername(rawUsername);
  } catch (error) {
    const normalizedError = normalizeMonitorError(error, "INVALID_USERNAME");
    throw new MonitorError("INVALID_USERNAME", `${usage}\n${normalizedError.message}`, {
      cause: error,
    });
  }

  const options = program.opts<{
    json?: boolean;
    output?: string;
    webhook?: string;
    webhookHeader?: string[];
  }>();
  if (options.output !== undefined && options.output.trim() === "") {
    throw new MonitorError("INVALID_USERNAME", `${usage}\nOutput path must not be empty.`);
  }
  if (options.webhook !== undefined && options.webhook.trim() === "") {
    throw new MonitorError("INVALID_USERNAME", `${usage}\nWebhook URL must not be empty.`);
  }
  let webhookHeaders: WebhookHeader[] | undefined;
  try {
    webhookHeaders = options.webhookHeader?.map(parseWebhookHeader);
  } catch (error) {
    throw new MonitorError("INVALID_USERNAME", `${usage}\n${errorMessage(error)}`, {
      cause: error,
    });
  }

  return {
    username,
    json: options.json === true,
    ...(options.output === undefined ? {} : { output: options.output }),
    ...(options.webhook === undefined ? {} : { webhook: options.webhook }),
    ...(webhookHeaders === undefined || webhookHeaders.length === 0 ? {} : { webhookHeaders }),
  };
}

export function parseCreatorUsername(args: readonly string[]): string {
  const parsed = parseCliOptions(args);
  if ("help" in parsed) {
    throw new MonitorError("INVALID_USERNAME", usage);
  }
  return parsed.username;
}

function createWriterTextSink(writer: CliWriter): TextSink {
  if (writer.once !== undefined && writer.end !== undefined) {
    return new QueuedWritableSink(writer as WritableStreamLike, { endOnClose: false });
  }

  return {
    async write(chunk: string): Promise<void> {
      await writer.write(chunk);
    },
    async close(): Promise<void> {
      // 测试 writer 和调用方注入的轻量 writer 不拥有需要关闭的底层资源。
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runCli(
  args: readonly string[] = process.argv.slice(2),
  options: CliOptions = {},
): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  let configuration: CliConfiguration;

  try {
    const parsed = parseCliOptions(args);
    if ("help" in parsed) {
      stdout.write(parsed.help);
      return 0;
    }
    configuration = parsed;
  } catch (error) {
    stderr.write(`${normalizeMonitorError(error, "INVALID_USERNAME").message}\n`);
    return 1;
  }

  const gatewayUrl = options.gatewayUrl ?? gatewayUrlFromEnvironment();
  const webhookUrl = configuration.webhook ?? gatewayUrl;
  let webhookSink: WebhookEventSink | undefined;
  if (webhookUrl !== undefined) {
    try {
      const endpoint =
        configuration.webhook === undefined ? resolveGatewayEventsEndpoint(webhookUrl) : webhookUrl;
      webhookSink = new WebhookEventSink(endpoint, {
        fetchImpl: options.gatewayFetch,
        headers: configuration.webhookHeaders,
        errorLabel: configuration.webhook === undefined ? "Gateway" : "Webhook",
        includeEndpointInError: configuration.webhook !== undefined,
        onError: (error) => stderr.write(`${error.message}\n`),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid Webhook URL.";
      stderr.write(
        `${configuration.webhook === undefined ? "Invalid Gateway URL" : "Invalid Webhook URL"}: ${message}\n`,
      );
      return 1;
    }
  }

  let outputFile: Awaited<ReturnType<typeof initializeOutputFile>> | undefined;
  if (configuration.output !== undefined) {
    try {
      outputFile = await initializeOutputFile(configuration.output);
    } catch (error) {
      stderr.write(`Output initialization failed: ${errorMessage(error)}\n`);
      return 1;
    }
  }

  const provider = options.provider ?? new TikTokLiveConnectorProvider();
  const stdoutTextSink = createWriterTextSink(stdout);
  const eventSinks: EventSink[] = [
    configuration.json
      ? new JsonlSink(stdoutTextSink)
      : new ConsoleSink(stdoutTextSink, formatLiveEvent),
  ];
  if (outputFile !== undefined) {
    eventSinks.push(new JsonlSink(outputFile.sink));
  }
  if (webhookSink !== undefined) {
    eventSinks.push(webhookSink);
  }
  const outputCoordinator = new OutputCoordinator(eventSinks);
  const statusWriter = configuration.json ? stderr : stdout;
  const pendingOutputEvents = new Set<Promise<void>>();
  const flushOutputEvents = async (): Promise<void> => {
    await Promise.allSettled([...pendingOutputEvents]);
  };

  const keepAlive = options.keepAlive ?? true;
  let resolveShutdown: (() => void) | undefined;
  const shutdown = new Promise<void>((resolve) => {
    resolveShutdown = resolve;
  });
  let shutdownRequested = false;
  let shutdownCode: number | undefined;
  let signalRequested = false;
  let outputFailureReported = false;
  let finalizePromise: Promise<number> | undefined;
  const monitor = new MonitorController(provider);

  const requestShutdown = (code: number, failure?: unknown): void => {
    if (failure !== undefined && !outputFailureReported) {
      outputFailureReported = true;
      stderr.write(`Output error: ${errorMessage(failure)}\n`);
    }
    if (shutdownCode === undefined || code !== 0) {
      shutdownCode = code;
    }
    if (!shutdownRequested) {
      shutdownRequested = true;
      resolveShutdown?.();
    }
    if (code !== 0) {
      void monitor.disconnect().catch((error: unknown) => {
        stderr.write(`${normalizeMonitorError(error).message}\n`);
      });
    }
  };

  monitor.onEvent((event) => {
    const output = outputCoordinator.write(event);
    pendingOutputEvents.add(output);
    void output
      .catch((error: unknown) => {
        requestShutdown(1, error);
      })
      .finally(() => pendingOutputEvents.delete(output));
    if (event.type === "session_ended") {
      requestShutdown(0);
    }
  });

  statusWriter.write(`Connecting to @${configuration.username}...\n`);

  const removeSignalHandlers = installSignalHandlers(monitor, {
    source: options.signalSource,
    onExit: (code) => {
      signalRequested = true;
      requestShutdown(code);
    },
  });

  const finalize = (): Promise<number> => {
    if (finalizePromise !== undefined) {
      return finalizePromise;
    }

    finalizePromise = (async () => {
      removeSignalHandlers();
      try {
        await monitor.disconnect();
      } catch (error) {
        shutdownCode = 1;
        stderr.write(`${normalizeMonitorError(error).message}\n`);
      }
      await flushOutputEvents();
      try {
        await outputCoordinator.close();
      } catch (error) {
        shutdownCode = 1;
        if (!outputFailureReported) {
          outputFailureReported = true;
          stderr.write(`Output error: ${errorMessage(error)}\n`);
        }
      }
      if (signalRequested) {
        statusWriter.write("Disconnected.\n");
      }
      return shutdownCode ?? 0;
    })();
    return finalizePromise;
  };

  try {
    const session = await monitor.connect(configuration.username);
    statusWriter.write("LIVE detected\n");
    statusWriter.write("Connected.\n");
    statusWriter.write(`Room ID: ${session.roomId}\n`);

    if (!keepAlive) {
      requestShutdown(0);
      return await finalize();
    }

    await shutdown;
    return await finalize();
  } catch (error) {
    if (!shutdownRequested) {
      shutdownCode = 1;
      stderr.write(`${normalizeMonitorError(error).message}\n`);
      requestShutdown(1);
    }
    return await finalize();
  }
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMainModule) {
  void runCli().then((code) => {
    process.exitCode = code;
  });
}
