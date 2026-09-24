import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

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
  const requiredFiles = [
    "dist",
    "schemas",
    "examples",
    "README.md",
    "README-zh.md",
    "DISCLAIMER.md",
    "DISCLAIMER-en.md",
    "THIRD_PARTY_NOTICES.md",
    "THIRD_PARTY_NOTICES-en.md",
    "RELEASE_NOTES.md",
    "RELEASE_NOTES-en.md",
    "ALPHA_RELEASE_CHECKLIST.md",
    "ALPHA_RELEASE_CHECKLIST-en.md",
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
  "ALPHA_RELEASE_CHECKLIST.md",
  "ALPHA_RELEASE_CHECKLIST-en.md",
  "LICENSE",
  "schemas/live-event.schema.json",
  "schemas/fixtures/manifest.json",
  "examples/session.jsonl",
  "examples/README.md",
  "examples/README-en.md",
]) {
  requireFile(relativePath);
}

const readmeTokens = ["--json", "--output", "--webhook", "npm run build", "docker build"];
for (const relativePath of ["README.md", "README-zh.md"]) {
  const content = readFileSync(resolve(root, relativePath), "utf8");
  for (const token of readmeTokens) {
    assert(content.includes(token), `${relativePath} 缺少发布入口或限制说明: ${token}`);
  }
}

const languageReadmeTokens = {
  "README.md": [
    "DISCLAIMER-en.md",
    "THIRD_PARTY_NOTICES-en.md",
    "RELEASE_NOTES-en.md",
    "ALPHA_RELEASE_CHECKLIST-en.md",
    "examples/README-en.md",
  ],
  "README-zh.md": [
    "DISCLAIMER.md",
    "THIRD_PARTY_NOTICES.md",
    "RELEASE_NOTES.md",
    "ALPHA_RELEASE_CHECKLIST.md",
    "examples/README.md",
  ],
};
for (const [relativePath, tokens] of Object.entries(languageReadmeTokens)) {
  const content = readFileSync(resolve(root, relativePath), "utf8");
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
    "Release check passed: package metadata, docs, fixtures and LiveEvent JSONL are valid.",
  );
}
