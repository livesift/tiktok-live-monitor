# v0.1.0

English version: [RELEASE_NOTES-en.md](./RELEASE_NOTES-en.md)

这是 Public OSS 的首次正式发行，支持用户在没有 LiveSift 登录的情况下连接一场公开 TikTok LIVE，并将同一份规范化事件输出到终端、JSONL 文件、session 目录或任意 HTTP/HTTPS Webhook endpoint。

## Included

- Node.js 20+ TypeScript CLI，提供 `tiktok-live-monitor` binary 和 `0.1.0` package
- 人类可读 Console 输出、`--json` JSONL stdout 和 `--output <path>` 文件输出
- 规范化 `LiveEvent` envelope、session lifecycle 和确定性 JSONL/schema fixtures
- 有状态终端 renderer、一次性 session 摘要、session 目录归档和无需网络的终端 Demo
- 通用 Webhook `POST`、可重复自定义 Header、每事件最多 3 次尝试和指数退避
- Webhook best-effort 失败语义：失败记录到诊断，不阻断本地输出和后续 LIVE 事件
- Apache-2.0 项目许可证，以及独立的免责声明和第三方依赖说明

## Current limitations

- 默认 provider 为 TikTok-Live-Connector，使用 Euler Stream 进行 WebSocket signing；二者均为非官方第三方依赖，可能受平台协议、额度和服务条款影响。
- 本版本不提供 LiveSift 登录、Private Gateway、持久化 Webhook 队列、凭证存储、去重或严格的至少一次投递保证。
- Webhook 只保证 best-effort HTTP 投递；endpoint 不可用时事件可能丢失，错误诊断不会包含 Header 值。
- Public CLI 连接公开直播时仍须遵守 TikTok 平台条款、隐私要求和适用法律；项目不代表 TikTok 或 ByteDance。
- 真实 TikTok LIVE smoke 结果受主播在线状态和第三方 provider 可用性影响，不作为离线 CI 的稳定性保证。

## 离线终端 Demo

在 Node.js 20+ 环境从源码回放或更新 capture：

```bash
npm run demo:terminal
npm run demo:terminal:preview
npm run demo:terminal:record
```

回放约 18 秒，只消费合成 `examples/session.jsonl` fixture，不连接 TikTok、Webhook、LiveSift 或 Private Gateway，也不需要 Web UI 或 LiveSift 账号。[文本预览](./examples/terminal-demo.txt) 与 [asciinema v2 capture](./examples/terminal-demo.cast) 对应 package `0.1.0`；可用 `asciinema play examples/terminal-demo.cast` 播放 capture。Demo 验证 renderer，不代表 TikTok-Live-Connector 或 Euler Stream 等第三方 provider 可用。当前 viewer 按最新有效 `occurredAt` 时间确定；终端摘要不会写入 JSONL 或 Webhook。

Fixture 回放和 CLI sink 的验收结果见 [`examples/terminal-demo-verification.md`](./examples/terminal-demo-verification.md)。

## Verification before tagging

在创建 `v0.1.0` tag 前，发布者应在 Node.js 20+ 环境完成：

```bash
npm ci
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm pack --dry-run --json
npm run release:manifest -- --output artifacts/release/package-manifest.json
npm run release:check
```

还应执行 [examples/README.md](./examples/README.md) 中的 JSONL、schema 和 Webhook fixture 检查，并确认 README、[DISCLAIMER.md](./DISCLAIMER.md)、[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) 与当前 package metadata 一致。逐项记录 package 摘要、Docker labels/digest、源提交和 Release notes 到文档仓库的 `doc/ops/release-checklist-v0.1.0.md`，并遵循 `doc/ops/public-oss-ghcr-docker-release.md`。

## Release status

本文件记录发布边界和验收入口。实际发布前请由维护者复核 provider 版本、第三方条款、license 清单和 registry 状态。
