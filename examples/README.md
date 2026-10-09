# Examples and Fixtures

English version: [README-en.md](./README-en.md)

本目录和相邻的 `schemas/`、`test/fixtures/` 提供不依赖网络的 Public 输出验证素材。

## Session JSONL

`session.jsonl` 是一场确定性 session 的九行 JSONL 示例，包含 `session_started`、两条 `viewer_count`、`comment`、`gift`、`like`、`follow`、`share` 和 `session_ended`。每行都是独立的 `LiveEvent` object，共享同一个 `session.id`。

```bash
jq -e . examples/session.jsonl >/dev/null
npm test -- --run test/session-fixture.test.ts test/live-event-contract.test.ts
```

目录归档和 `session.metadata.json` 的格式、命名与状态见[导出格式说明](../docs/export-formats.md)。`schemas/fixtures/valid-session-metadata.json` 与 `recording-session-metadata.json` 分别展示完整归档和未结束快照。

使用正式 CLI 离线回放同一份完整 fixture，无需 username、TikTok、Webhook 或 Gateway：

```bash
npm run dev -- --replay examples/session.jsonl --json
npm run dev -- --replay examples/session.jsonl --json --output ./data/replay.jsonl
npm run dev -- --replay examples/session.jsonl --json --output-dir ./data/replays
```

Replay 输入上限为 16 MiB；CLI 会在初始化输出前验证 JSONL、核心事件 schema、共同身份和唯一首尾 lifecycle。该命令与约 18 秒的终端 Demo 不同，会即时写出事件。完整限制和失败行为见[导出格式说明](../docs/export-formats.md)。

## CSV 草稿与 PK/battle 边界

`session.csv` 使用固定 15 列的 `csv-draft-v1` 草稿格式，与九条 JSONL 核心 fixture 对应；`session-csv-escaping.csv` 覆盖逗号、双引号和字段内 CRLF。校验列顺序、JSON 字段与文本往返：

```bash
npm test -- --run test/csv-draft.test.ts
```

这只是数据交换格式草稿，不提供 CSV 导出器或 `--csv` 参数。PK/battle 说明见[独立协议草稿](../docs/pk-battle-protocol-draft.md)：`pk_started`、`pk_ended` 不属于核心八种 LiveEvent，不能通过核心 replay，也不受 Private ingest 支持。本仓库目前没有 PK parser 或 PK fixture。

构建包与 Docker 的回放/目录归档命令、退出码、九条 fixture 对照及 Docker 环境记录见[导出验收记录](./export-verification.md)。

## 终端 Demo

`terminal-demo.txt` 是 production `TerminalRenderer` 的行式输出预览；`terminal-demo.cast` 是对应的 asciinema v2 capture，时长约 18 秒。回放和重新生成命令为：

```bash
npm run demo:terminal
npm run demo:terminal:preview
npm run demo:terminal:record
```

回放仅使用 `session.jsonl`，不访问网络、真实直播、LiveSift 账号或 Private Gateway。capture 的 package 版本记录为 `0.1.0-alpha.1`。

fixture 回放 stdout/stderr、JSONL、Webhook mock 和时长验收记录见 [`terminal-demo-verification.md`](./terminal-demo-verification.md)。

## Schema fixtures

`schemas/fixtures/manifest.json` 列出合法和非法的 `LiveEvent` fixture；`test/live-event-contract.test.ts` 会按 manifest 使用 `schemas/live-event.schema.json` 校验它们。运行：

```bash
npm test -- --run test/live-event-contract.test.ts
```

## Webhook fixture

`test/fixtures/webhook-event.json` 是 Webhook 测试使用的完整事件 envelope。它与 JSONL 输出共用同一 schema；`test/support/mock-webhook.ts` 提供确定性 HTTP mock，用于检查方法、Header、body、重试和失败隔离。

```bash
npm test -- --run test/webhook.test.ts
```

Webhook body 应当与同一事件写入 JSONL 的行等价。上述命令均为本地确定性测试，不要求 LiveSift 登录、Private Gateway 或真实 TikTok LIVE。

## Docker 离线回放

在仓库根目录构建 production 镜像。构建会下载基础镜像和锁定的 npm 依赖；运行帮助和 fixture replay 时可禁用容器网络：

```bash
docker build -t tiktok-live-monitor:local .
docker run --rm --network none tiktok-live-monitor:local --help
docker run --rm --network none \
  -e LIVESIFT_GATEWAY_URL=http://127.0.0.1:1 \
  tiktok-live-monitor:local --replay /app/examples/session.jsonl --json
```

镜像包含 CLI、schema、fixture 和导出格式说明，默认使用非 root 的 `node` 用户。宿主只需 Docker，不依赖宿主 Node.js、tsx、Vitest、TikTok 凭证或 LiveSift 账号。

要让宿主立即读取目录归档，可将容器用户设为当前宿主 UID/GID，或确保挂载目录对默认镜像用户（UID/GID 1000）可写：

```bash
mkdir -p ./data
docker run --rm --network none --user "$(id -u):$(id -g)" \
  -v "$PWD/data:/data" tiktok-live-monitor:local \
  --replay /app/examples/session.jsonl --json --output-dir /data
```

只读挂载会返回权限诊断和非零退出码。Linux 上使用默认镜像用户时，可以执行 `chown 1000:1000 ./data` 赋予写权限。
