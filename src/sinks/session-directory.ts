import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, realpath, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";

export interface SessionDirectoryOptions {
  cwd?: string;
}

function safeKey(prefix: "c" | "s", value: string): string {
  if (value.trim() === "") {
    throw new Error("Session archive identity must not be empty.");
  }

  const encoded = Buffer.from(value, "utf8").toString("hex");
  if (encoded.length > 240) {
    throw new Error("Session archive identity is too long for a directory name.");
  }
  return `${prefix}-${encoded}`;
}

export function sessionDirectoryPath(
  root: string,
  creatorUsername: string,
  startedAt: string,
  sessionId: string,
): string {
  const startedAtDate = new Date(startedAt);
  if (Number.isNaN(startedAtDate.getTime())) {
    throw new Error("Session start time is invalid.");
  }

  const iso = startedAtDate.toISOString();
  const date = iso.slice(0, 10);
  const time = iso.slice(11, 23).replaceAll(":", "").replace(".", "");
  return join(root, safeKey("c", creatorUsername), date, `${time}_${safeKey("s", sessionId)}`);
}

async function assertNoSymlinkComponents(path: string): Promise<void> {
  const pathRoot = parse(path).root;
  let current = pathRoot;
  for (const segment of relative(pathRoot, path).split(sep).filter(Boolean)) {
    current = join(current, segment);
    try {
      const stats = await lstat(current);
      if (
        stats.isSymbolicLink() &&
        !(process.platform === "darwin" && (current === "/var" || current === "/tmp"))
      ) {
        throw new Error(`Session archive path must not contain a symbolic link: ${current}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw error;
    }
  }
}

export async function prepareSessionOutputDirectory(
  outputDirectory: string,
  options: SessionDirectoryOptions = {},
): Promise<string> {
  if (outputDirectory.trim() === "") {
    throw new Error("Output directory must not be empty.");
  }

  const workingDirectory = await realpath(options.cwd ?? process.cwd());
  const requestedRoot = isAbsolute(outputDirectory)
    ? resolve(outputDirectory)
    : resolve(workingDirectory, outputDirectory);
  await assertNoSymlinkComponents(requestedRoot);
  await mkdir(requestedRoot, { recursive: true });
  const rootStats = await lstat(requestedRoot);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error(`Output directory is not a regular directory: ${requestedRoot}`);
  }
  await assertNoSymlinkComponents(requestedRoot);

  const probePath = join(requestedRoot, `.livesift-write-test-${randomUUID()}`);
  const probe = await open(probePath, "wx", 0o600);
  try {
    await probe.close();
  } finally {
    await rm(probePath, { force: true });
  }

  return requestedRoot;
}

export async function createSessionDirectory(path: string): Promise<void> {
  await assertNoSymlinkComponents(path);
  await mkdir(dirname(path), { recursive: true });
  await assertNoSymlinkComponents(path);
  await mkdir(path, { recursive: false });
}

export async function assertSessionDirectoryDoesNotExist(path: string): Promise<void> {
  try {
    await lstat(path);
    throw new Error(`Session archive already exists: ${path}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}
