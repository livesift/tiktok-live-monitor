# TikTok Live Monitor

用于连接 TikTok LIVE 的开源命令行工具。项目采用 TypeScript 和 Node.js，连接 provider 与后续事件输出通过独立模块隔离，方便本地开发和持续扩展。

English version: [README.md](./README.md)

## 环境要求

- Node.js 20 或更高版本
- npm 10 或更高版本

## 快速开始

```bash
git clone <repository-url>
cd tiktok-live-monitor
npm install
npm run dev -- @username
```

用户名可以带一个前导 `@`。CLI 连接流程会输出连接状态和直播房间信息；主播未开播时会输出可读的离线提示。

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
```

## Webhook 集成

可以把同一份规范化 `LiveEvent` 发送到任意 HTTP 或 HTTPS endpoint：

```bash
npm run dev -- @username \
  --webhook https://example.com/live-events \
  --webhook-header "Authorization: Bearer $WEBHOOK_TOKEN" \
  --webhook-header "X-Source: livesift"
```

请求使用 JSON `POST` 和 `Content-Type: application/json`。每个事件最多尝试 3 次，重试等待时间按指数递增。网络错误、超时和非 2xx 响应会写入诊断信息，但 Webhook 失败不会停止 LIVE 监控，也不会阻止本地 Console/JSONL 输出。已有 Gateway 兼容配置仍可通过 `LIVESIFT_GATEWAY_URL` 使用；显式 `--webhook` 优先，环境变量 endpoint 在需要时自动补全 `/v1/events`。

Webhook 是 best-effort 投递：CLI 不提供持久化投递队列、凭证存储、事件去重或至少一次投递保证。建议通过环境变量或 secret manager 注入 token；失败诊断不会记录 Header 值。

可以使用确定性的 Webhook 测试验证本地集成，并检查 mock 请求 payload：

```bash
npm test -- --run test/webhook.test.ts
npm run typecheck
```

每个请求 body 都是与 `--json` 和 `--output` 相同的完整 `LiveEvent` 对象，可以使用 `schemas/live-event.schema.json` 校验，也可以重放 `test/fixtures/webhook-event.json`。

## 常用命令

```bash
npm run dev -- @username  # 使用 tsx 运行开发 CLI
npm test                  # 执行 Vitest 单元测试
npm run typecheck        # 执行 TypeScript 类型检查
npm run lint              # 执行 ESLint
npm run build             # 构建 Node.js 发布产物
```

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
