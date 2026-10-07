# Examples and Fixtures

English version: [README-en.md](./README-en.md)

本目录和相邻的 `schemas/`、`test/fixtures/` 提供不依赖网络的 Public 输出验证素材。

## Session JSONL

`session.jsonl` 是一场确定性 session 的九行 JSONL 示例，包含 `session_started`、两条 `viewer_count`、`comment`、`gift`、`like`、`follow`、`share` 和 `session_ended`。每行都是独立的 `LiveEvent` object，共享同一个 `session.id`。

```bash
jq -e . examples/session.jsonl >/dev/null
npm test -- --run test/session-fixture.test.ts test/live-event-contract.test.ts
```

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
