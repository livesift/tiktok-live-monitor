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
- `src/cli`、`src/core`、`src/adapters/tiktok`、`src/events` 模块边界
- Vitest、ESLint、Prettier、tsx 和 tsup 开发工具
- TikTok LIVE 连接生命周期与用户名校验的实现入口

评论、礼物、点赞、观众数、JSONL 导出和 Webhook 会在后续迭代中加入。

## 开发约定

第三方 TikTok 客户端只能在 `src/adapters/tiktok` 中使用。核心监控接口不暴露第三方库的类型，避免 provider 变更影响 CLI 和后续事件处理模块。

## TikTok 连接方式

TikTok Live Monitor 当前默认使用 TikTok-Live-Connector 作为 TikTok LIVE 数据 Provider。

TikTok-Live-Connector 的 WebSocket 签名依赖第三方服务 Euler Stream。Euler Stream 提供免费 Community 套餐，但属于独立
第三方服务，并具有自己的额度和服务条款。

本项目通过 Provider 抽象隔离该依赖，后续可以增加其他 Provider 或自托管实现。

## 许可证

本项目使用 Apache-2.0 License，详见 [LICENSE](./LICENSE)。
