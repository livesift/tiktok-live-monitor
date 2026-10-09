#!/usr/bin/env node

import { Command, CommanderError } from "commander";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MonitorError, normalizeMonitorError } from "../core/errors.js";
import { installSignalHandlers, MonitorController, type SignalSource } from "../core/monitor.js";
import type { LiveProvider } from "../core/provider.js";
import { readReplayFile } from "../core/replay.js";
import { normalizeCreatorUsername } from "../core/username.js";
import { gatewayUrlFromEnvironment, resolveGatewayEventsEndpoint } from "../events/gateway.js";
import { TikTokLiveConnectorProvider } from "../providers/tiktok-live-connector/provider.js";
import { SessionStats } from "./session-stats.js";
import {
  formatSessionSummary,
  summaryStatusForEndReason,
  TerminalRenderer,
} from "./terminal-renderer.js";
import type { SessionSummaryStatus } from "./terminal-renderer.js";
export { formatLiveEvent } from "./terminal-renderer.js";
import {
  JsonlSink,
  OutputCoordinator,
  QueuedWritableSink,
  WebhookEventSink,
  initializeOutputFile,
  prepareSessionOutputDirectory,
  parseWebhookHeader,
  SessionDirectorySink,
  type EventSink,
  type TextSink,
  type WebhookHeader,
  type WritableStreamLike,
} from "../sinks/index.js";
import type { SessionExportSource } from "../sinks/session-metadata.js";

export interface CliWriter {
  write(message: string): unknown;
  isTTY?: boolean;
  once?: WritableStreamLike["once"];
  off?: WritableStreamLike["off"];
  end?: WritableStreamLike["end"];
}

export interface CliConfiguration {
  username?: string;
  json: boolean;
  replay?: string;
  output?: string;
  outputDirectory?: string;
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

const usage = "Usage: tiktok-live-monitor <username> or --replay <path>";

function packageVersion(): string {
  const packagePath = resolve(dirname(fileURLToPath(import.meta.url)), "../../package.json");
  return (JSON.parse(readFileSync(packagePath, "utf8")) as { version: string }).version;
}

type CliParseResult = CliConfiguration | { help: string };

export function parseCliOptions(args: readonly string[]): CliParseResult {
  const errors: string[] = [];
  const help: string[] = [];
  const program = new Command()
    .name("tiktok-live-monitor")
    .description("Monitor a TikTok LIVE session or replay one JSONL session offline.")
    .usage("[options] [username]")
    .argument("[username]", "TikTok LIVE creator username")
    .option("--json", "write JSONL events to stdout; diagnostics go to stderr")
    .option("-o, --output <path>", "write JSONL events to a truncated file")
    .option("--output-dir <directory>", "archive each session in a new directory")
    .option("--replay <path>", "replay one validated JSONL session without network access")
    .option("--webhook <url>", "POST normalized events to an HTTP endpoint")
    .option(
      "--webhook-header <header>",
      'add a webhook header using the "Name: value" format; repeatable',
      (value: string, previous: string[] = []) => [...previous, value],
      [],
    )
    .addHelpText(
      "after",
      '\nExamples:\n  tiktok-live-monitor @creator\n  tiktok-live-monitor @creator --json --output ./data/session.jsonl\n  tiktok-live-monitor --replay ./examples/session.jsonl --json\n  tiktok-live-monitor @creator --webhook https://example.test/events --webhook-header "Authorization: Bearer TOKEN"\n',
    )
    .allowExcessArguments(false)
    .exitOverride()
    .configureOutput({
      writeOut: (message) => help.push(message),
      writeErr: (message) => errors.push(message),
      outputError: (message) => errors.push(message),
    });

  let rawUsername: string | undefined;
  program.action((username: string | undefined) => {
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

  const options = program.opts<{
    json?: boolean;
    output?: string;
    outputDir?: string;
    replay?: string;
    webhook?: string;
    webhookHeader?: string[];
  }>();
  if (options.replay !== undefined && options.replay.trim() === "") {
    throw new MonitorError("INVALID_USERNAME", `${usage}\nReplay path must not be empty.`);
  }
  if (options.replay !== undefined && rawUsername !== undefined) {
    throw new MonitorError(
      "INVALID_USERNAME",
      `${usage}\n--replay cannot be used with a username.`,
    );
  }
  if (options.replay === undefined && rawUsername === undefined) {
    throw new MonitorError("INVALID_USERNAME", usage);
  }
  if (
    options.replay !== undefined &&
    (options.webhook !== undefined || (options.webhookHeader?.length ?? 0) > 0)
  ) {
    throw new MonitorError(
      "INVALID_USERNAME",
      `${usage}\n--replay cannot be used with --webhook or --webhook-header.`,
    );
  }

  let username: string | undefined;
  if (rawUsername !== undefined) {
    try {
      username = normalizeCreatorUsername(rawUsername);
    } catch (error) {
      const normalizedError = normalizeMonitorError(error, "INVALID_USERNAME");
      throw new MonitorError("INVALID_USERNAME", `${usage}\n${normalizedError.message}`, {
        cause: error,
      });
    }
  }
  if (options.output !== undefined && options.output.trim() === "") {
    throw new MonitorError("INVALID_USERNAME", `${usage}\nOutput path must not be empty.`);
  }
  if (options.outputDir !== undefined && options.outputDir.trim() === "") {
    throw new MonitorError("INVALID_USERNAME", `${usage}\nOutput directory must not be empty.`);
  }
  if (options.output !== undefined && options.outputDir !== undefined) {
    throw new MonitorError(
      "INVALID_USERNAME",
      `${usage}\n--output and --output-dir cannot be used together.`,
    );
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
    json: options.json === true,
    ...(username === undefined ? {} : { username }),
    ...(options.replay === undefined ? {} : { replay: options.replay }),
    ...(options.output === undefined ? {} : { output: options.output }),
    ...(options.outputDir === undefined ? {} : { outputDirectory: options.outputDir }),
    ...(options.webhook === undefined ? {} : { webhook: options.webhook }),
    ...(webhookHeaders === undefined || webhookHeaders.length === 0 ? {} : { webhookHeaders }),
  };
}

export function parseCreatorUsername(args: readonly string[]): string {
  const parsed = parseCliOptions(args);
  if ("help" in parsed || parsed.username === undefined) {
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

interface CliEventOutputs {
  sessionStats: SessionStats;
  terminalRenderer: TerminalRenderer | undefined;
  sessionDirectorySink: SessionDirectorySink | undefined;
  outputCoordinator: OutputCoordinator;
}

async function initializeEventOutputs(
  configuration: CliConfiguration,
  stdout: CliWriter,
  source: SessionExportSource,
  additionalSinks: readonly EventSink[] = [],
): Promise<CliEventOutputs> {
  let outputFile: Awaited<ReturnType<typeof initializeOutputFile>> | undefined;
  if (configuration.output !== undefined) {
    try {
      outputFile = await initializeOutputFile(configuration.output);
    } catch (error) {
      throw new Error(`Output initialization failed: ${errorMessage(error)}`, { cause: error });
    }
  }

  let sessionOutputRoot: string | undefined;
  if (configuration.outputDirectory !== undefined) {
    try {
      sessionOutputRoot = await prepareSessionOutputDirectory(configuration.outputDirectory);
    } catch (error) {
      throw new Error(`Output directory initialization failed: ${errorMessage(error)}`, {
        cause: error,
      });
    }
  }

  const stdoutTextSink = createWriterTextSink(stdout);
  const sessionStats = new SessionStats();
  const terminalRenderer = configuration.json
    ? undefined
    : new TerminalRenderer(stdoutTextSink, {
        stats: sessionStats,
        interactive: stdout.isTTY === true,
      });
  const eventSinks: EventSink[] = [
    configuration.json ? new JsonlSink(stdoutTextSink) : terminalRenderer!,
  ];
  if (outputFile !== undefined) {
    eventSinks.push(new JsonlSink(outputFile.sink));
  }
  const sessionDirectorySink =
    sessionOutputRoot === undefined
      ? undefined
      : new SessionDirectorySink({
          root: sessionOutputRoot,
          packageVersion: packageVersion(),
          source,
        });
  if (sessionDirectorySink !== undefined) {
    eventSinks.push(sessionDirectorySink);
  }
  eventSinks.push(...additionalSinks);

  return {
    sessionStats,
    terminalRenderer,
    sessionDirectorySink,
    outputCoordinator: new OutputCoordinator(eventSinks),
  };
}

async function runReplayCli(
  configuration: CliConfiguration,
  stdout: CliWriter,
  stderr: CliWriter,
  options: CliOptions,
): Promise<number> {
  let events;
  try {
    events = await readReplayFile(configuration.replay!);
  } catch (error) {
    stderr.write(`${errorMessage(error)}\n`);
    return 1;
  }

  let outputs: CliEventOutputs;
  try {
    outputs = await initializeEventOutputs(configuration, stdout, "replay");
  } catch (error) {
    stderr.write(`${errorMessage(error)}\n`);
    return 1;
  }

  const signalSource = options.signalSource ?? process;
  let signalRequested = false;
  const onSignal = (): void => {
    signalRequested = true;
  };
  signalSource.once("SIGINT", onSignal);
  signalSource.once("SIGTERM", onSignal);

  let writtenCount = 0;
  let exitCode = 0;
  let replayError: unknown;
  try {
    for (const event of events) {
      if (signalRequested) {
        break;
      }
      if (outputs.terminalRenderer === undefined) {
        outputs.sessionStats.add(event);
      }
      await outputs.outputCoordinator.write(event);
      writtenCount += 1;
    }
  } catch (error) {
    replayError = error;
  } finally {
    signalSource.removeListener("SIGINT", onSignal);
    signalSource.removeListener("SIGTERM", onSignal);
  }

  const complete = writtenCount === events.length;
  if (!complete && signalRequested) {
    replayError ??= new Error("Replay interrupted before all events were written.");
  }
  if (replayError !== undefined) {
    exitCode = 1;
    stderr.write(`Replay error: ${errorMessage(replayError)}\n`);
  }

  const lastEvent = events.at(-1)!;
  const summaryStatus: SessionSummaryStatus =
    exitCode === 0 && lastEvent.type === "session_ended"
      ? summaryStatusForEndReason(lastEvent.data.reason)
      : "failed";
  try {
    if (outputs.terminalRenderer !== undefined) {
      await outputs.terminalRenderer.finalize(summaryStatus);
    } else if (outputs.sessionStats.snapshot().sessionId !== null) {
      stderr.write(formatSessionSummary(outputs.sessionStats.snapshot(), summaryStatus));
    }
  } catch (error) {
    exitCode = 1;
    stderr.write(`Output error: ${errorMessage(error)}\n`);
  }

  try {
    await outputs.outputCoordinator.close();
  } catch (error) {
    exitCode = 1;
    stderr.write(`Output error: ${errorMessage(error)}\n`);
  }

  try {
    const archiveStatus =
      exitCode !== 0 ? "failed" : summaryStatus === "interrupted" ? "interrupted" : "completed";
    await outputs.sessionDirectorySink?.finish(archiveStatus);
  } catch (error) {
    exitCode = 1;
    stderr.write(`Output error: ${errorMessage(error)}\n`);
  }

  return exitCode;
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

  if (configuration.replay !== undefined) {
    return runReplayCli(configuration, stdout, stderr, options);
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

  const provider = options.provider ?? new TikTokLiveConnectorProvider();
  let outputs: CliEventOutputs;
  try {
    outputs = await initializeEventOutputs(
      configuration,
      stdout,
      "live",
      webhookSink === undefined ? [] : [webhookSink],
    );
  } catch (error) {
    stderr.write(`${errorMessage(error)}\n`);
    return 1;
  }
  const { sessionStats, terminalRenderer, sessionDirectorySink, outputCoordinator } = outputs;
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
  let summaryStatus: SessionSummaryStatus = "completed";
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
    if (configuration.json) {
      const isNewEvent = sessionStats.add(event);
      if (isNewEvent && event.type === "session_ended") {
        summaryStatus = summaryStatusForEndReason(event.data.reason);
      }
    } else if (event.type === "session_ended") {
      summaryStatus = summaryStatusForEndReason(event.data.reason);
    }

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

  statusWriter.write(`Connecting to @${configuration.username!}...\n`);

  const removeSignalHandlers = installSignalHandlers(monitor, {
    source: options.signalSource,
    onSignal: () => {
      signalRequested = true;
      terminalRenderer?.markInterrupted();
    },
    onExit: (code) => {
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
        summaryStatus = "failed";
      }
      await flushOutputEvents();
      const finalStatus: SessionSummaryStatus =
        shutdownCode === 1 ? "failed" : signalRequested ? "interrupted" : summaryStatus;
      try {
        if (terminalRenderer !== undefined) {
          await terminalRenderer.finalize(finalStatus);
        } else if (sessionStats.snapshot().sessionId !== null) {
          stderr.write(formatSessionSummary(sessionStats.snapshot(), finalStatus));
        }
      } catch (error) {
        shutdownCode = 1;
        if (!outputFailureReported) {
          outputFailureReported = true;
          stderr.write(`Output error: ${errorMessage(error)}\n`);
        }
      }
      try {
        await outputCoordinator.close();
      } catch (error) {
        shutdownCode = 1;
        if (!outputFailureReported) {
          outputFailureReported = true;
          stderr.write(`Output error: ${errorMessage(error)}\n`);
        }
      }
      try {
        const archiveStatus =
          shutdownCode === 1 || summaryStatus === "failed"
            ? "failed"
            : signalRequested || summaryStatus === "interrupted"
              ? "interrupted"
              : "completed";
        await sessionDirectorySink?.finish(archiveStatus);
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
    const session = await monitor.connect(configuration.username!);
    if (terminalRenderer !== undefined) {
      terminalRenderer.bindSession(session.username, session.sessionId, session.roomId);
    } else {
      sessionStats.bindSession(session.sessionId);
    }
    if (configuration.json || stdout.isTTY !== true) {
      statusWriter.write("LIVE detected\n");
      statusWriter.write("Connected.\n");
      statusWriter.write(`Room ID: ${session.roomId}\n`);
      statusWriter.write(`Session ID: ${session.sessionId}\n`);
    }

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
