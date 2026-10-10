import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import Ajv from "ajv";

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
const imageSource = "https://github.com/livesift/tiktok-live-monitor";
const gitRevisionResult = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: projectRoot,
  encoding: "utf8",
});
const imageRevision =
  process.env.GITHUB_SHA?.trim() || gitRevisionResult.stdout?.trim() || "unknown";
const fixtureText = await readFile(path.join(projectRoot, "examples/session.jsonl"), "utf8");
const fixture = fixtureText
  .trimEnd()
  .split("\n")
  .map((line) => JSON.parse(line));
const dockerIgnore = await readFile(path.join(projectRoot, ".dockerignore"), "utf8");
assert.match(dockerIgnore, /^node_modules\/$/m, ".dockerignore must exclude host dependencies.");
assert.match(dockerIgnore, /^dist\/$/m, ".dockerignore must exclude host build output.");
const metadataSchema = JSON.parse(
  await readFile(path.join(projectRoot, "schemas/session-metadata.schema.json"), "utf8"),
);
const validateMetadata = new Ajv({ allErrors: true }).compile(metadataSchema);
const imageTag = `livesift-public-smoke:${process.pid}`;
let imageBuilt = false;
let writableDirectory;
const hostUser =
  typeof process.getuid === "function" && typeof process.getgid === "function"
    ? `${process.getuid()}:${process.getgid()}`
    : undefined;

function docker(args, label, expectedStatus = 0) {
  const result = spawnSync("docker", args, {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(`${label}: unable to run Docker: ${result.error.message}`);
  }
  if (result.status !== expectedStatus) {
    throw new Error(
      [
        `${label}: expected exit ${expectedStatus}, received ${result.status ?? "no status"}.`,
        `Command: docker ${args.join(" ")}`,
        result.stdout.trimEnd(),
        result.stderr.trimEnd(),
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return result;
}

function parseJsonl(stdout, label) {
  assert.ok(stdout.endsWith("\n"), `${label}: JSONL stdout must end in a newline.`);
  const lines = stdout.trimEnd().split("\n");
  assert.ok(
    lines.every((line) => line.trim() !== ""),
    `${label}: stdout contains a blank line.`,
  );
  return lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${label}: invalid JSON on stdout line ${index + 1}.`, { cause: error });
    }
  });
}

function assertEvents(actual, label) {
  assert.equal(actual.length, fixture.length, `${label}: event count differs from fixture.`);
  assert.deepEqual(actual, fixture, `${label}: events differ from the checked-in fixture.`);
}

async function main() {
  docker(
    [
      "build",
      "--build-arg",
      `VERSION=${packageJson.version}`,
      "--build-arg",
      `SOURCE=${imageSource}`,
      "--build-arg",
      `VCS_REF=${imageRevision}`,
      "--tag",
      imageTag,
      ".",
    ],
    "Docker image build",
  );
  imageBuilt = true;

  const labels = JSON.parse(
    docker(
      ["image", "inspect", "--format", "{{json .Config.Labels}}", imageTag],
      "Inspect OCI labels",
    ).stdout.trim(),
  );
  assert.equal(labels["org.opencontainers.image.version"], packageJson.version);
  assert.equal(labels["org.opencontainers.image.source"], imageSource);
  assert.equal(labels["org.opencontainers.image.revision"], imageRevision);

  const imageUser = docker(
    ["image", "inspect", "--format", "{{.Config.User}}", imageTag],
    "Inspect runtime user",
  ).stdout.trim();
  assert.equal(imageUser, "node", "Production image must run as the non-root node user.");

  docker(
    [
      "run",
      "--rm",
      "--network",
      "none",
      "--entrypoint",
      "node",
      imageTag,
      "-e",
      'const fs=require("node:fs"); for (const file of ["/app/docs/export-formats.md", "/app/docs/export-formats-en.md", "/app/docs/pk-battle-protocol-draft.md", "/app/docs/pk-battle-protocol-draft-en.md", "/app/schemas/live-event.schema.json", "/app/schemas/session-metadata.schema.json", "/app/examples/session.jsonl", "/app/examples/session.csv", "/app/examples/session-csv-escaping.csv", "/app/examples/export-verification.md"]) fs.accessSync(file);',
    ],
    "Check production image assets",
  );

  const help = docker(["run", "--rm", "--network", "none", imageTag, "--help"], "Offline CLI help");
  assert.match(help.stdout, /--output-dir <directory>/);
  assert.match(help.stdout, /--replay <path>/);

  const packageHelp = spawnSync(
    process.execPath,
    [path.join(projectRoot, "dist/cli/index.js"), "--help"],
    { cwd: projectRoot, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
  if (packageHelp.error || packageHelp.status !== 0) {
    throw new Error(`Package CLI help failed: ${packageHelp.error?.message ?? packageHelp.stderr}`);
  }
  assert.equal(packageHelp.stdout, help.stdout, "Docker and package CLI help must match.");

  const replay = docker(
    [
      "run",
      "--rm",
      "--network",
      "none",
      "--env",
      "LIVESIFT_GATEWAY_URL=http://127.0.0.1:1",
      imageTag,
      "--replay",
      "/app/examples/session.jsonl",
      "--json",
    ],
    "Offline JSON replay",
  );
  assertEvents(parseJsonl(replay.stdout, "Offline JSON replay"), "Offline JSON replay");

  const packageReplay = spawnSync(
    process.execPath,
    [
      path.join(projectRoot, "dist/cli/index.js"),
      "--replay",
      path.join(projectRoot, "examples/session.jsonl"),
      "--json",
    ],
    { cwd: projectRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  if (packageReplay.error || packageReplay.status !== 0) {
    throw new Error(
      `Package CLI replay failed: ${packageReplay.error?.message ?? packageReplay.stderr}`,
    );
  }
  assertEvents(parseJsonl(packageReplay.stdout, "Package JSON replay"), "Package JSON replay");

  writableDirectory = await mkdtemp(path.join(tmpdir(), "livesift-docker-smoke-"));
  await chmod(writableDirectory, 0o777);
  // 让宿主用户能够读取和清理容器生成的 0600 归档文件。
  const writableRunArgs = [
    "run",
    "--rm",
    "--network",
    "none",
    ...(hostUser === undefined ? [] : ["--user", hostUser]),
    "--mount",
    `type=bind,src=${writableDirectory},dst=/data`,
    imageTag,
    "--replay",
    "/app/examples/session.jsonl",
    "--json",
    "--output-dir",
    "/data",
  ];
  const archive = docker(writableRunArgs, "Writable mounted archive");
  assertEvents(parseJsonl(archive.stdout, "Writable mounted archive"), "Mounted stdout");

  const creatorKey = `c-${Buffer.from(fixture[0].creator.username, "utf8").toString("hex")}`;
  const sessionKey = `s-${Buffer.from(fixture[0].session.id, "utf8").toString("hex")}`;
  const startedAt = new Date(fixture[0].data.startedAt).toISOString();
  const date = startedAt.slice(0, 10);
  const time = startedAt.slice(11, 23).replaceAll(":", "").replace(".", "");
  const archiveDirectory = path.join(writableDirectory, creatorKey, date, `${time}_${sessionKey}`);
  const eventLines = (await readFile(path.join(archiveDirectory, "events.jsonl"), "utf8"))
    .trimEnd()
    .split("\n");
  assertEvents(
    eventLines.map((line) => JSON.parse(line)),
    "Mounted events.jsonl",
  );

  const metadata = JSON.parse(
    await readFile(path.join(archiveDirectory, "session.metadata.json"), "utf8"),
  );
  assert.ok(validateMetadata(metadata), JSON.stringify(validateMetadata.errors));
  assert.equal(metadata.packageVersion, packageJson.version);
  assert.equal(metadata.source, "replay");
  assert.equal(metadata.status, "completed");
  assert.equal(metadata.eventCount, fixture.length);
  assert.equal(metadata.eventsFile, "events.jsonl");
  assert.deepEqual(metadata.session, fixture[0].session);
  assert.deepEqual(metadata.creator, fixture[0].creator);
  assert.equal(metadata.startedAt, fixture[0].data.startedAt);
  assert.equal(metadata.endedAt, fixture.at(-1).data.endedAt);
  assert.equal(
    Object.values(metadata.eventCounts).reduce((sum, count) => sum + count, 0),
    fixture.length,
  );

  const readOnly = docker(
    [
      "run",
      "--rm",
      "--network",
      "none",
      "--mount",
      `type=bind,src=${writableDirectory},dst=/data,readonly`,
      imageTag,
      "--replay",
      "/app/examples/session.jsonl",
      "--output-dir",
      "/data",
    ],
    "Read-only mounted archive failure",
    1,
  );
  assert.match(readOnly.stderr, /Output directory initialization failed/);
  assert.match(readOnly.stderr, /read-only|permission denied|EROFS/i);

  const files = await readdir(archiveDirectory);
  assert.deepEqual(files.sort(), ["events.jsonl", "session.metadata.json"]);
  console.log(
    "Docker smoke passed: offline help/replay, writable archive, schema, and read-only failure.",
  );
}

try {
  await main();
} catch (error) {
  console.error(`Docker smoke failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  if (imageBuilt) {
    try {
      docker(["image", "rm", "--force", imageTag], "Remove smoke image");
    } catch (error) {
      console.error(
        `Docker smoke cleanup warning: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (writableDirectory !== undefined) {
    await rm(writableDirectory, { recursive: true, force: true });
  }
}
