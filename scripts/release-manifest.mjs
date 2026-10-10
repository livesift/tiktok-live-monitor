import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expectedVersion = "0.1.0";

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, npm_config_loglevel: "error" },
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} 失败: ${result.error?.message ?? result.stderr?.trim() ?? `exit ${result.status}`}`,
    );
  }
  return result.stdout;
}

const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
if (packageJson.version !== expectedVersion) {
  throw new Error(`package version 必须为 ${expectedVersion}`);
}

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const packSummary = JSON.parse(run(npmCommand, ["pack", "--dry-run", "--json"]));
const packMetadata = Array.isArray(packSummary) ? packSummary[0] : packSummary;
if (packMetadata?.name !== packageJson.name || packMetadata?.version !== expectedVersion) {
  throw new Error("npm tarball 的 name/version 与 package.json 不一致");
}
const revisionFromGit = run("git", ["rev-parse", "HEAD"]).trim();
const revision = process.env.GITHUB_SHA?.trim() || revisionFromGit || "unknown";
const explicitTag = process.env.RELEASE_TAG?.trim();
const githubRef = process.env.GITHUB_REF?.trim();
const tagFromRef = githubRef?.startsWith("refs/tags/")
  ? githubRef.slice("refs/tags/".length)
  : undefined;
const suppliedTag = explicitTag || tagFromRef;
if (suppliedTag !== undefined && suppliedTag !== `v${expectedVersion}`) {
  throw new Error(`release tag 必须为 v${expectedVersion}`);
}
const cliHelp = spawnSync(process.execPath, [resolve(root, "dist/cli/index.js"), "--help"], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 4 * 1024 * 1024,
});
if (cliHelp.error || cliHelp.status !== 0 || !cliHelp.stdout.includes("--replay <path>")) {
  throw new Error("built CLI --help 验证失败");
}

const summary = {
  schemaVersion: 1,
  package: {
    name: packageJson.name,
    version: packageJson.version,
    license: packageJson.license,
    engines: packageJson.engines,
    binary: packageJson.bin?.[packageJson.name],
  },
  source: {
    commit: revision,
    tag: suppliedTag || null,
  },
  tarball: {
    mode: "dry-run",
    name: packMetadata?.name,
    version: packMetadata?.version,
    filename: packMetadata?.filename,
    size: packMetadata?.size,
    unpackedSize: packMetadata?.unpackedSize,
    shasum: packMetadata?.shasum,
    integrity: packMetadata?.integrity,
    files: (packMetadata?.files ?? [])
      .map((entry) => entry.path)
      .filter((file) => typeof file === "string")
      .sort(),
  },
  cli: {
    helpVerified: true,
  },
};

const outputIndex = process.argv.indexOf("--output");
const outputPath = outputIndex === -1 ? undefined : process.argv[outputIndex + 1];
if (outputPath === undefined || outputPath === "") {
  console.log(JSON.stringify(summary, null, 2));
} else {
  const absoluteOutput = resolve(root, outputPath);
  mkdirSync(dirname(absoluteOutput), { recursive: true });
  writeFileSync(absoluteOutput, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`Release manifest written: ${outputPath}`);
}
