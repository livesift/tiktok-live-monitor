import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const textCache = new Map();

function fail(message) {
  failures.push(message);
}

function readJson(relativePath) {
  const absolutePath = resolve(root, relativePath);
  try {
    return JSON.parse(readFileSync(absolutePath, "utf8"));
  } catch (error) {
    fail(
      `无法读取 JSON ${relativePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}

function readText(relativePath) {
  if (textCache.has(relativePath)) {
    return textCache.get(relativePath);
  }
  try {
    const content = readFileSync(resolve(root, relativePath), "utf8");
    textCache.set(relativePath, content);
    return content;
  } catch (error) {
    fail(
      `无法读取发布文档 ${relativePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
    textCache.set(relativePath, undefined);
    return undefined;
  }
}

function requireFile(relativePath) {
  const absolutePath = resolve(root, relativePath);
  if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
    fail(`缺少发布文件: ${relativePath}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

const packageJson = readJson("package.json");
if (packageJson === undefined) {
  fail("无法读取 package.json，停止发布检查。");
} else {
  assert(packageJson.version === "0.1.0-alpha.1", "package version 必须为 0.1.0-alpha.1");
  assert(packageJson.license === "Apache-2.0", "package license 必须为 Apache-2.0");
  assert(packageJson.engines?.node === ">=20", "package engines.node 必须为 >=20");
  assert(
    packageJson.bin?.["tiktok-live-monitor"] === "dist/cli/index.js",
    "CLI binary 必须指向 dist/cli/index.js",
  );
  assert(
    packageJson.scripts?.["demo:terminal"] === "tsx scripts/terminal-demo.ts" &&
      packageJson.scripts?.["demo:terminal:record"] === "tsx scripts/terminal-demo.ts --record" &&
      packageJson.scripts?.["demo:terminal:preview"] === "tsx scripts/terminal-demo.ts --preview",
    "terminal demo npm scripts 必须指向本地 fixture 回放入口",
  );
  const requiredFiles = [
    "dist",
    "schemas",
    "examples",
    "docs",
    "README.md",
    "README-zh.md",
    "DISCLAIMER.md",
    "DISCLAIMER-en.md",
    "THIRD_PARTY_NOTICES.md",
    "THIRD_PARTY_NOTICES-en.md",
    "RELEASE_NOTES.md",
    "RELEASE_NOTES-en.md",
    "LICENSE",
  ];
  assert(
    requiredFiles.every((file) => packageJson.files?.includes(file)),
    "package files 白名单必须覆盖所有可发布目录和文档",
  );
}

for (const relativePath of [
  "dist/cli/index.js",
  "README.md",
  "README-zh.md",
  "DISCLAIMER.md",
  "DISCLAIMER-en.md",
  "THIRD_PARTY_NOTICES.md",
  "THIRD_PARTY_NOTICES-en.md",
  "RELEASE_NOTES.md",
  "RELEASE_NOTES-en.md",
  "LICENSE",
  "schemas/live-event.schema.json",
  "schemas/fixtures/manifest.json",
  "docs/export-formats.md",
  "docs/export-formats-en.md",
  "docs/pk-battle-protocol-draft.md",
  "docs/pk-battle-protocol-draft-en.md",
  "examples/session.jsonl",
  "examples/session.csv",
  "examples/session-csv-escaping.csv",
  "examples/export-verification.md",
  "examples/terminal-demo.cast",
  "examples/terminal-demo.txt",
  "examples/terminal-demo-verification.md",
  "examples/README.md",
  "examples/README-en.md",
]) {
  requireFile(relativePath);
}

for (const relativePath of [
  "README.md",
  "README-zh.md",
  "examples/README.md",
  "examples/README-en.md",
  "docs/export-formats.md",
  "docs/export-formats-en.md",
  "docs/pk-battle-protocol-draft.md",
  "docs/pk-battle-protocol-draft-en.md",
]) {
  const content = readText(relativePath);
  if (content === undefined) {
    continue;
  }
  const links = content.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g);
  for (const [, target] of links) {
    if (target === undefined || /^(?:https?:|mailto:|#)/i.test(target)) {
      continue;
    }
    const localTarget = decodeURIComponent(target.split("#", 1)[0] ?? "");
    if (localTarget === "") {
      continue;
    }
    const absoluteTarget = resolve(dirname(resolve(root, relativePath)), localTarget);
    const projectRelativeTarget = relative(root, absoluteTarget);
    assert(
      projectRelativeTarget !== "" &&
        !isAbsolute(projectRelativeTarget) &&
        !projectRelativeTarget.startsWith(".."),
      `${relativePath} 的本地链接超出项目目录: ${target}`,
    );
    requireFile(projectRelativeTarget);
  }
}

const readmeTokens = ["--json", "--output", "--webhook", "npm run build", "docker build"];
for (const relativePath of ["README.md", "README-zh.md"]) {
  const content = readText(relativePath);
  if (content === undefined) {
    continue;
  }
  for (const token of readmeTokens) {
    assert(content.includes(token), `${relativePath} 缺少发布入口或限制说明: ${token}`);
  }
}

const languageReadmeTokens = {
  "README.md": [
    "DISCLAIMER-en.md",
    "THIRD_PARTY_NOTICES-en.md",
    "RELEASE_NOTES-en.md",
    "examples/README-en.md",
  ],
  "README-zh.md": [
    "DISCLAIMER.md",
    "THIRD_PARTY_NOTICES.md",
    "RELEASE_NOTES.md",
    "examples/README.md",
  ],
};
for (const [relativePath, tokens] of Object.entries(languageReadmeTokens)) {
  const content = readText(relativePath);
  if (content === undefined) {
    continue;
  }
  for (const token of tokens) {
    assert(content.includes(token), `${relativePath} 缺少对应语言的发布入口: ${token}`);
  }
}

const schema = readJson("schemas/live-event.schema.json");
const manifest = readJson("schemas/fixtures/manifest.json");
const validateSchema =
  schema === undefined ? undefined : new Ajv({ allErrors: true }).compile(schema);
if (manifest !== undefined && validateSchema !== undefined) {
  assert(
    Array.isArray(manifest.fixtures) && manifest.fixtures.length > 0,
    "schema fixture manifest 不能为空",
  );
  for (const fixtureInfo of manifest.fixtures) {
    const fixture = readJson(`schemas/fixtures/${fixtureInfo.file}`);
    if (fixture === undefined) {
      continue;
    }
    const valid = validateSchema(fixture);
    assert(valid === fixtureInfo.valid, `schema fixture 结果不符合 manifest: ${fixtureInfo.file}`);
  }
}

const jsonlPath = resolve(root, "examples/session.jsonl");
if (existsSync(jsonlPath)) {
  const lines = readFileSync(jsonlPath, "utf8").trimEnd().split("\n");
  assert(
    lines.length > 0 && lines.every((line) => line.trim() !== ""),
    "examples/session.jsonl 必须包含非空 JSONL 行",
  );
  for (const [index, line] of lines.entries()) {
    try {
      const event = JSON.parse(line);
      assert(
        validateSchema?.(event) === true,
        `examples/session.jsonl 第 ${index + 1} 行未通过 LiveEvent schema`,
      );
    } catch (error) {
      fail(
        `examples/session.jsonl 第 ${index + 1} 行不是合法 LiveEvent: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

const demoDocumentation = ["README.md", "README-zh.md", "RELEASE_NOTES.md", "RELEASE_NOTES-en.md"];
const demoDocumentationTokens = [
  "npm run demo:terminal",
  "npm run demo:terminal:record",
  "npm run demo:terminal:preview",
  "examples/terminal-demo.cast",
  "examples/terminal-demo.txt",
  "examples/terminal-demo-verification.md",
  "](./examples/terminal-demo.cast)",
  "](./examples/terminal-demo.txt)",
  "asciinema play examples/terminal-demo.cast",
  "TikTok-Live-Connector",
  "Euler Stream",
];
const demoAccessTokens = {
  "README.md": ["Web UI", "LiveSift account"],
  "README-zh.md": ["Web UI", "LiveSift 账号"],
  "RELEASE_NOTES.md": ["Web UI", "LiveSift 账号"],
  "RELEASE_NOTES-en.md": ["Web UI", "LiveSift account"],
};
for (const relativePath of demoDocumentation) {
  const content = readText(relativePath);
  if (content === undefined) {
    continue;
  }
  for (const token of demoDocumentationTokens) {
    assert(content.includes(token), `${relativePath} 缺少 Demo 入口或资产链接: ${token}`);
  }
  for (const token of demoAccessTokens[relativePath]) {
    assert(content.includes(token), `${relativePath} 缺少 Demo 访问限制说明: ${token}`);
  }
  assert(
    content.includes(packageJson?.version ?? ""),
    `${relativePath} 未标明与当前 package 一致的 Demo 版本`,
  );
}

const demoCapturePath = resolve(root, "examples/terminal-demo.cast");
const demoPreviewPath = resolve(root, "examples/terminal-demo.txt");
if (existsSync(demoCapturePath) && existsSync(demoPreviewPath)) {
  const captureLines = readFileSync(demoCapturePath, "utf8").trimEnd().split("\n");
  let captureHeader;
  let captureEvents = [];
  try {
    captureHeader = JSON.parse(captureLines[0] ?? "");
    captureEvents = captureLines.slice(1).map((line) => JSON.parse(line));
  } catch (error) {
    fail(
      `terminal-demo.cast 不是合法的 asciinema v2 capture: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  assert(captureHeader?.version === 2, "terminal-demo.cast 必须使用 asciinema v2 格式");
  assert(
    captureHeader?.packageVersion === packageJson?.version,
    "terminal-demo.cast 的 packageVersion 必须与 package.json 一致",
  );
  const outputEvents = captureEvents.filter(
    (event) => Array.isArray(event) && event[1] === "o" && typeof event[2] === "string",
  );
  const capturedOutput = outputEvents.map((event) => event[2]).join("");
  const duration = outputEvents.at(-1)?.[0];
  assert(
    typeof duration === "number" && duration >= 15 && duration <= 25,
    "terminal-demo.cast 时长必须在 15–25 秒之间",
  );
  assert(
    capturedOutput === readFileSync(demoPreviewPath, "utf8"),
    "terminal-demo.txt 必须与 asciinema capture 的 stdout 完全一致",
  );
  for (const token of [
    "LIVE @fixture_creator",
    "VIEWERS 1,842",
    "PEAK 1,842",
    "COMMENT viewer_one:",
    "GIFT viewer_two: Rose x2",
    "LIKES viewer_three:",
    "FOLLOW viewer_four",
    "SHARE viewer_five",
    "SESSION SUMMARY",
    "Status: completed",
  ]) {
    assert(capturedOutput.includes(token), `terminal demo 缺少核心输出: ${token}`);
  }
  assert(!capturedOutput.includes("\u001b"), "terminal demo 不得包含 ANSI 控制序列");

  const sensitivePatterns = [
    /\bAuthorization\s*:/i,
    /\bBearer\s+[A-Za-z0-9._~+/-]{8,}/i,
    /\b(?:WEBHOOK_TOKEN|LIVESIFT_GATEWAY_URL)\s*=/i,
    /\b(?:Cookie|X-API-Key)\s*:/i,
  ];
  for (const pattern of sensitivePatterns) {
    assert(!pattern.test(capturedOutput), `terminal demo 可能包含敏感值: ${pattern}`);
  }

  const fixtureEvents = existsSync(jsonlPath)
    ? readFileSync(jsonlPath, "utf8")
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line))
    : [];
  const fixtureUsernames = new Set();
  for (const event of fixtureEvents) {
    if (typeof event.creator?.username === "string") {
      fixtureUsernames.add(event.creator.username);
      assert(
        /^fixture_[a-z0-9_]+$/.test(event.creator.username),
        "demo fixture creator 必須使用脫敏 fixture_ username",
      );
    }
    if (typeof event.actor?.username === "string") {
      fixtureUsernames.add(event.actor.username);
      assert(
        /^viewer_[a-z0-9_]+$/.test(event.actor.username),
        "demo fixture actor 必須使用脫敏 viewer_ username",
      );
    }
  }
  for (const username of fixtureUsernames) {
    assert(capturedOutput.includes(username), `terminal demo 未知 username: ${username}`);
  }
}

const verificationNote = readText("examples/terminal-demo-verification.md");
if (verificationNote !== undefined) {
  for (const token of [
    packageJson?.version ?? "",
    "18.34 秒",
    "test/terminal-acceptance.test.ts",
    "stdout",
    "stderr",
    "Webhook mock",
    "逐字节相同",
  ]) {
    assert(verificationNote.includes(token), `Demo 验收记录缺少证据: ${token}`);
  }
}

const extraRequiredFile = process.env.RELEASE_CHECK_REQUIRED_FILE?.trim();
if (extraRequiredFile !== undefined && extraRequiredFile !== "") {
  const extraPath = resolve(root, extraRequiredFile);
  const relativeExtraPath = relative(root, extraPath);
  assert(
    !isAbsolute(extraRequiredFile) &&
      relativeExtraPath !== "" &&
      !relativeExtraPath.startsWith(".."),
    "RELEASE_CHECK_REQUIRED_FILE 必须是项目目录内的相对路径",
  );
  requireFile(relativeExtraPath);
}

if (failures.length > 0) {
  console.error("Release check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    "Release check passed: package metadata, docs, fixtures, LiveEvent JSONL and terminal demo are valid.",
  );
}
