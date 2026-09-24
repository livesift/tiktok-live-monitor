# TikTok Live Monitor

用于追踪 TikTok LIVE 的开源实时命令行工具，支持评论、礼物、观看人数、点赞、关注、分享和 session 事件。项目采用 TypeScript 和 Node.js，通过独立模块隔离 provider 与监控核心及后续输出。

> 非官方社区项目，与 TikTok 或 ByteDance 无隶属关系；Public CLI 不要求 LiveSift 账号或 Private Gateway。

[English](./README.md) | 简体中文 | [免责声明](./DISCLAIMER.md) | [English Disclaimer](./DISCLAIMER-en.md) | [第三方说明](./THIRD_PARTY_NOTICES.md) | [English Third-party Notices](./THIRD_PARTY_NOTICES-en.md) | [Alpha 发布说明](./RELEASE_NOTES.md) | [English Release Notes](./RELEASE_NOTES-en.md) | [发布清单](./ALPHA_RELEASE_CHECKLIST.md) | [English Checklist](./ALPHA_RELEASE_CHECKLIST-en.md)

## 环境要求

- Node.js 20 或更高版本
- npm 10 或更高版本
- `jq`（用于检查 JSONL，可选）
- Docker（使用容器运行时可选）

## 从源码快速开始

```bash
git clone <repository-url>
cd tiktok-live-monitor
npm ci
npm run build
npm run start -- --help
npm run dev -- @username
```

用户名可以带一个前导 `@`。CLI 会输出连接状态和直播间信息；主播未开播时会输出可读的离线提示。Public 流程不需要 LiveSift 登录、`LIVESIFT_GATEWAY_URL` 或 Private `/v1/events` endpoint。

Alpha package 发布到 npm 后，可以在全新环境直接运行相同的 CLI：

```bash
npx --yes tiktok-live-monitor --help
npx --yes tiktok-live-monitor @username
```

构建本地镜像后，可以不安装本地 Node.js 运行：

```bash
docker build -t tiktok-live-monitor:local .
docker run --rm tiktok-live-monitor:local --help
docker run --rm tiktok-live-monitor:local @username --output /tmp/session.jsonl
```

镜像使用非 root 的 `node` 用户运行，entrypoint 与 npm binary 使用相同参数。`/app` 工作目录支持相对输出路径；需要保留 session 文件时，请挂载可写的宿主目录：

```bash
docker run --rm -v "$PWD/data:/data" tiktok-live-monitor:local \
  @username --output /data/session.jsonl
```

挂载目录必须允许容器运行用户写入；如果宿主目录属于其他 UID/GID，请先调整权限，或为 Docker 指定兼容的 `--user`。

默认模式会把连接状态和事件摘要以人类可读文本写入 stdout。使用 `--output` 保存同一场直播的 JSONL，或在 stdout 要交给脚本处理时使用 `--json`。

## Session JSONL 输出

```bash
# 保留人类可读终端输出，同时写入会话 JSONL 文件。
npm run dev -- @username --output ./data/session.jsonl

# stdout 只有 JSONL 事件；状态和诊断信息写入 stderr。
npm run dev -- --json @username | jq -c .

# stdout 和文件同时接收等价的 JSONL 事件。
npm run dev -- @username --json --output ./data/session.jsonl > session.stdout.jsonl
```

`--output <path>` 会以当前工作目录为基准解析相对路径，递归创建缺失的父目录，并在连接前以 truncate 模式打开目标文件，不会追加到旧文件。如果 provider 在产生事件前连接失败，已经初始化的文件会保持为空；路径无法创建或打开时，CLI 会在连接 TikTok 前失败。

`--json` 保证 stdout 可被机器处理：每个事件都是一行完整 JSON object；连接状态、关闭消息和诊断信息写入 stderr。组合使用 `--json` 与 `--output` 时，两个 sink 会按相同顺序写入同一批事件。

仓库提供确定性的会话示例 [`examples/session.jsonl`](./examples/session.jsonl)，可以逐行使用以下命令校验：

```bash
jq -e . examples/session.jsonl >/dev/null
npm test -- --run test/session-fixture.test.ts test/live-event-contract.test.ts
```

参见 [`examples/README.md`](./examples/README.md) 或 [`examples/README-en.md`](./examples/README-en.md)，了解 fixture、schema 和 Webhook 的验证对应关系。

## Webhook 集成

可以把同一份规范化 `LiveEvent` 发送到任意 HTTP 或 HTTPS endpoint：

```bash
npm run dev -- @username \
  --webhook https://example.com/live-events \
  --webhook-header "Authorization: Bearer $WEBHOOK_TOKEN" \
  --webhook-header "X-Source: livesift"
```

请求使用 JSON `POST` 和 `Content-Type: application/json`。每个事件最多尝试 3 次，重试等待时间按指数递增。网络错误、超时和非 2xx 响应会写入诊断信息，但 Webhook 失败不会停止 LIVE 监控，也不会阻止本地 Console/JSONL 输出。显式 `--webhook` 支持任意绝对 HTTP/HTTPS endpoint，不要求使用 `/v1/events` 路径。已有 Private Gateway 兼容配置仍可通过 `LIVESIFT_GATEWAY_URL` 使用；显式 `--webhook` 优先，环境变量 endpoint 在需要时自动补全 `/v1/events`。

Webhook 是 best-effort 投递：CLI 不提供持久化投递队列、凭证存储、事件去重或至少一次投递保证。建议通过环境变量或 secret manager 注入 token；失败诊断不会记录 Header 值。

可以使用确定性的 Webhook 测试验证本地集成，并检查 mock 请求 payload：

```bash
npm test -- --run test/webhook.test.ts
npm run typecheck
```

每个请求 body 都是与 `--json` 和 `--output` 相同的完整 `LiveEvent` 对象，可以使用 `schemas/live-event.schema.json` 校验，也可以重放 `test/fixtures/webhook-event.json`。
确定性的 Webhook 测试覆盖 Header、payload 等价性、重试和 best-effort 失败行为，不需要 LiveSift 账号。

## 常用命令

```bash
npm run dev -- @username  # 使用 tsx 运行开发 CLI
npm test                  # 执行 Vitest 单元测试
npm run typecheck        # 执行 TypeScript 类型检查
npm run lint              # 执行 ESLint
npm run format:check      # 检查 Prettier 格式
npm run build             # 构建 Node.js 发布产物
npm run start -- --help   # 运行构建后的 CLI
```

## 故障排查

- 主播离线是正常的 Public 结果。CLI 会输出离线提示并以非零状态退出，不会生成 lifecycle 事件。
- 用户名、URL、Header 或输出路径无效时，CLI 会在连接 TikTok 前失败；请根据 stderr 中的用法和错误修正参数。
- `--json` 模式下 stdout 只有 JSONL 事件，连接状态和诊断信息写入 stderr。
- Webhook endpoint 不可用时采用 best-effort 语义：本地 Console/JSONL 继续输出；错误包含事件 ID 和最终原因，但不会记录 Header 值。
- TikTok-Live-Connector 使用 Euler Stream 进行 WebSocket 签名。provider 的可用性和额度由独立第三方控制，详见[第三方说明](./THIRD_PARTY_NOTICES.md)。

## 当前能力

当前初始化工作为后续功能提供基础结构：

- Node.js 20+ 和 TypeScript 工程配置
- `src/cli`、`src/core`、`src/providers/tiktok-live-connector`、`src/events` 模块边界
- Vitest、ESLint、Prettier、tsx 和 tsup 开发工具
- TikTok LIVE 连接生命周期与用户名校验的实现入口
- 确定性的 session 生命周期事件，以及通过 `--json`、`--output` 提供的 JSONL 输出

CLI 会输出连接状态以及支持的 TikTok 事件摘要，也可以把完整 session 保存为 JSONL，供 shell 管道、fixture replay 和后续分析使用。

## 开发约定

第三方 TikTok 客户端只能在 `src/providers/tiktok-live-connector` 中使用。核心监控接口不暴露第三方库的类型，避免 provider 变更影响 CLI 和后续事件处理模块。

## TikTok 连接方式

TikTok Live Monitor 当前默认使用 TikTok-Live-Connector 作为 TikTok LIVE 数据 Provider。

TikTok-Live-Connector 的 WebSocket 签名依赖第三方服务 Euler Stream。Euler Stream 提供免费 Community 套餐，但属于独立
第三方服务，并具有自己的额度和服务条款。

本项目通过 Provider 抽象隔离该依赖，后续可以增加其他 Provider 或自托管实现。

## 许可证

本项目使用 Apache-2.0 License，详见 [LICENSE](./LICENSE)。

使用本软件仍须遵守[免责声明](./DISCLAIMER.md)、适用的 TikTok 平台条款和第三方依赖说明。
