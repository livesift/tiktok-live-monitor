import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { LiveEvent } from "../src/events/types.js";
import type { TextSink } from "../src/sinks/output.js";
import {
  assertSessionDirectoryDoesNotExist,
  createSessionDirectory,
  prepareSessionOutputDirectory,
  sessionDirectoryPath,
} from "../src/sinks/session-directory.js";
import { SessionDirectorySink } from "../src/sinks/session-directory-sink.js";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sessionFixture = (await readFile(join(projectRoot, "examples/session.jsonl"), "utf8"))
  .trimEnd()
  .split("\n")
  .map((line) => JSON.parse(line) as LiveEvent);

async function temporaryDirectory(): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), "tiktok-session-export-")));
}

describe("session archive directory helpers", () => {
  it("resolves a relative archive root against the working directory", async () => {
    const cwd = await temporaryDirectory();
    const root = await prepareSessionOutputDirectory("nested/archive", { cwd });

    expect(root).toBe(join(cwd, "nested/archive"));
    expect(sessionDirectoryPath(root, "creator", "2026-03-01T10:11:12.345Z", "session-1")).toBe(
      join(root, "c-63726561746f72", "2026-03-01", "101112345_s-73657373696f6e2d31"),
    );
  });

  it("uses the UTC lifecycle date even when the event crosses midnight", () => {
    const path = sessionDirectoryPath(
      "/tmp/archive",
      "creator",
      "2026-03-01T23:59:59.999Z",
      "session/../1",
    );

    expect(path).toContain(join("2026-03-01", "235959999_s-73657373696f6e2f2e2e2f31"));
    expect(path).not.toContain(join("..", "1"));
  });

  it("rejects unsafe and empty identities before creating a path", () => {
    const path = sessionDirectoryPath(
      "/tmp/archive",
      "creator/../../outside",
      "2026-03-01T00:00:00Z",
      ".",
    );

    expect(path.startsWith("/tmp/archive/")).toBe(true);
    expect(path.split("/")).not.toContain("..");
    expect(() => sessionDirectoryPath("/tmp/archive", " ", "2026-03-01T00:00:00Z", "id")).toThrow(
      "identity must not be empty",
    );
    expect(() => sessionDirectoryPath("/tmp/archive", "creator", "invalid", "id")).toThrow(
      "start time is invalid",
    );
  });

  it("rejects a symbolic-link archive root", async () => {
    const parent = await temporaryDirectory();
    const target = join(parent, "target");
    const link = join(parent, "archive-link");
    await mkdir(target);
    await symlink(target, link);

    await expect(prepareSessionOutputDirectory(link)).rejects.toThrow("symbolic link");
  });

  it("rejects a symbolic-link creator directory beneath the archive root", async () => {
    const parent = await temporaryDirectory();
    const root = join(parent, "archive");
    const target = join(parent, "outside");
    await mkdir(root);
    await mkdir(target);
    await symlink(target, join(root, "c-63726561746f72"));
    const path = sessionDirectoryPath(root, "creator", "2026-03-01T00:00:00Z", "session-1");

    await expect(createSessionDirectory(path)).rejects.toThrow("symbolic link");
    await expect(readdir(target)).resolves.toEqual([]);
  });

  it("creates session directories exclusively and preserves existing contents", async () => {
    const root = await temporaryDirectory();
    const path = sessionDirectoryPath(root, "creator", "2026-03-01T00:00:00Z", "session-1");
    await mkdir(resolve(path, ".."), { recursive: true });
    await createSessionDirectory(path);
    await writeFile(join(path, "sentinel"), "keep");

    await expect(createSessionDirectory(path)).rejects.toMatchObject({ code: "EEXIST" });
    await expect(assertSessionDirectoryDoesNotExist(path)).rejects.toThrow("already exists");
    await expect(readFile(join(path, "sentinel"), "utf8")).resolves.toBe("keep");
  });

  it("rejects a non-directory root before archive creation", async () => {
    const parent = await temporaryDirectory();
    const root = join(parent, "archive-file");
    await writeFile(root, "not a directory");

    await expect(prepareSessionOutputDirectory(root)).rejects.toThrow();
  });

  it.skipIf(typeof process.getuid === "function" && process.getuid() === 0)(
    "rejects a root directory without write permission",
    async () => {
      const parent = await temporaryDirectory();
      const root = join(parent, "read-only");
      await mkdir(root);
      await chmod(root, 0o500);

      await expect(prepareSessionOutputDirectory(root)).rejects.toThrow();
    },
  );
});

describe("SessionDirectorySink", () => {
  it("queues a complete session and atomically publishes matching metadata", async () => {
    const root = await temporaryDirectory();
    const sink = new SessionDirectorySink({
      root,
      packageVersion: "test-version",
      source: "replay",
    });

    await Promise.all(sessionFixture.map((event) => sink.write(event)));
    await sink.close();
    await sink.finish("completed");

    const archivePath = sink.archivePath;
    expect(archivePath).toBeDefined();
    const lines = (await readFile(join(archivePath!, "events.jsonl"), "utf8"))
      .trimEnd()
      .split("\n");
    expect(lines.map((line) => JSON.parse(line))).toEqual(sessionFixture);

    const metadata = JSON.parse(
      await readFile(join(archivePath!, "session.metadata.json"), "utf8"),
    ) as {
      status: string;
      eventCount: number;
      eventCounts: Record<string, number>;
      session: { id: string };
      creator: { username: string };
      startedAt: string;
      endedAt: string | null;
      endReason: string | null;
    };
    expect(metadata).toMatchObject({
      status: "completed",
      eventCount: sessionFixture.length,
      session: { id: "session-fixture-1" },
      creator: { username: "fixture_creator" },
      startedAt: "2026-09-21T10:00:00.000Z",
      endedAt: "2026-09-21T10:01:00.000Z",
      endReason: "stream_end",
    });
    expect(Object.values(metadata.eventCounts).reduce((sum, count) => sum + count, 0)).toBe(
      metadata.eventCount,
    );
  });

  it("keeps a recording snapshot when final metadata replacement fails", async () => {
    const root = await temporaryDirectory();
    let replaceCalls = 0;
    const sink = new SessionDirectorySink({
      root,
      packageVersion: "test-version",
      source: "replay",
      replaceMetadata: async (temporaryPath, metadataPath) => {
        replaceCalls += 1;
        if (replaceCalls > 1) {
          throw new Error("metadata rename failed");
        }
        const { rename } = await import("node:fs/promises");
        await rename(temporaryPath, metadataPath);
      },
    });

    for (const event of sessionFixture) {
      await sink.write(event);
    }
    await sink.close();
    await expect(sink.finish("completed")).rejects.toThrow("metadata rename failed");

    const metadata = JSON.parse(
      await readFile(join(sink.archivePath!, "session.metadata.json"), "utf8"),
    ) as { status: string; endedAt: string | null };
    expect(metadata).toEqual(expect.objectContaining({ status: "recording", endedAt: null }));
  });

  it("reports event write and close failures and records failed status", async () => {
    const root = await temporaryDirectory();
    let writes = 0;
    const chunks: string[] = [];
    const file: TextSink = {
      async write(chunk): Promise<void> {
        writes += 1;
        chunks.push(chunk);
        if (writes === 2) {
          throw new Error("event write failed");
        }
      },
      async close(): Promise<void> {
        throw new Error("event close failed");
      },
    };
    const sink = new SessionDirectorySink({
      root,
      packageVersion: "test-version",
      source: "replay",
      openEventFile: async () => file,
    });

    await sink.write(sessionFixture[0]!);
    await expect(sink.write(sessionFixture[1]!)).rejects.toThrow("event write failed");
    await expect(sink.close()).rejects.toThrow("event write failed");
    await expect(sink.finish("failed")).resolves.toBeUndefined();

    const metadata = JSON.parse(
      await readFile(join(sink.archivePath!, "session.metadata.json"), "utf8"),
    ) as { status: string; eventCount: number; endedAt: string | null };
    expect(metadata).toEqual(expect.objectContaining({ status: "failed", eventCount: 1 }));
    expect(metadata.endedAt).toBeNull();
    expect(writes).toBe(2);
    expect(JSON.parse(chunks[0]!)).toEqual(sessionFixture[0]);
  });

  it("marks a fully written session failed when closing its event file fails", async () => {
    const root = await temporaryDirectory();
    const closeError = new Error("event close failed");
    const file: TextSink = {
      async write(): Promise<void> {},
      async close(): Promise<void> {
        throw closeError;
      },
    };
    const sink = new SessionDirectorySink({
      root,
      packageVersion: "test-version",
      source: "replay",
      openEventFile: async () => file,
    });

    for (const event of sessionFixture) {
      await sink.write(event);
    }
    await expect(sink.close()).rejects.toBe(closeError);
    await sink.finish("completed");

    const metadata = JSON.parse(
      await readFile(join(sink.archivePath!, "session.metadata.json"), "utf8"),
    ) as { status: string; eventCount: number };
    expect(metadata).toEqual(expect.objectContaining({ status: "failed", eventCount: 9 }));
  });
});
