import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TerminalRenderer } from "../src/cli/terminal-renderer.js";
import { liveEventSchema } from "../src/events/normalize.js";
import type { LiveEvent } from "../src/events/types.js";
import type { TextSink } from "../src/sinks/output.js";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const examplesDirectory = resolve(projectRoot, "examples");
const fixturePath = resolve(examplesDirectory, "session.jsonl");
const capturePath = resolve(examplesDirectory, "terminal-demo.cast");
const previewPath = resolve(examplesDirectory, "terminal-demo.txt");
const packageMetadata = JSON.parse(
  await readFile(resolve(projectRoot, "package.json"), "utf8"),
) as { version: string };
const args = new Set(process.argv.slice(2));

if (args.has("--preview")) {
  process.stdout.write(await readFile(previewPath, "utf8"));
} else {
  const unknownArgs = [...args].filter((arg) => arg !== "--record" && arg !== "--fast");
  if (unknownArgs.length > 0) {
    throw new Error(`Unknown option: ${unknownArgs.join(" ")}`);
  }
  if (args.has("--record") && args.has("--fast")) {
    throw new Error("--record requires the normal 18-second playback.");
  }

  const lines = (await readFile(fixturePath, "utf8")).trimEnd().split("\n");
  const events = lines.map((line) => liveEventSchema.parse(JSON.parse(line)) as LiveEvent);
  const sessionIds = new Set(events.map((event) => event.session.id));
  if (sessionIds.size !== 1 || events[0]?.type !== "session_started") {
    throw new Error(
      "The terminal demo fixture must contain one session and begin with session_started.",
    );
  }
  if (events.at(-1)?.type !== "session_ended") {
    throw new Error("The terminal demo fixture must end with session_ended.");
  }

  const outputChunks: string[] = [];
  const castEvents: Array<[number, "o", string]> = [];
  let elapsedMilliseconds = 0;
  const sink: TextSink = {
    async write(chunk: string): Promise<void> {
      process.stdout.write(chunk);
      outputChunks.push(chunk);
      castEvents.push([elapsedMilliseconds / 1000, "o", chunk]);
    },
    async close(): Promise<void> {},
  };
  const renderer = new TerminalRenderer(sink, { interactive: false });

  for (const [index, event] of events.entries()) {
    if (index > 0) {
      if (!args.has("--fast")) {
        await new Promise((done) => setTimeout(done, 2_250));
      }
      elapsedMilliseconds += 2_250;
    }
    await renderer.write(event);
  }
  await renderer.close();

  if (args.has("--record")) {
    const captureHeader = {
      version: 2,
      width: 160,
      height: 40,
      timestamp: 0,
      env: { SHELL: "/bin/sh", TERM: "dumb" },
      title: `tiktok-live-monitor terminal demo v${packageMetadata.version}`,
      packageVersion: packageMetadata.version,
    };
    const capture = [
      JSON.stringify(captureHeader),
      ...castEvents.map((event) => JSON.stringify(event)),
      "",
    ].join("\n");
    await Promise.all([
      writeFile(capturePath, capture, "utf8"),
      writeFile(previewPath, outputChunks.join(""), "utf8"),
    ]);
    process.stderr.write(`Updated ${capturePath} and ${previewPath}\n`);
  }
}
