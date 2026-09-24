# Third-Party Notices

English version: [THIRD_PARTY_NOTICES-en.md](./THIRD_PARTY_NOTICES-en.md)

本文件记录 Public alpha 运行时的重要第三方依赖和服务边界。它不改变项目自身的 Apache-2.0 License，也不代表任何第三方为本项目提供担保。

## TikTok-Live-Connector

- npm 依赖：`tiktok-live-connector`
- 用途：连接 TikTok LIVE 并接收 provider 事件
- 边界：非 TikTok 官方 SDK，属于社区维护的 reverse-engineering provider；TikTok 协议变化可能导致连接或事件字段失效
- 许可证和当前版本：以 `package.json`、npm package manifest 及其上游仓库发布的 license 为准；发布前应复核依赖版本的实际声明

## Euler Stream

- 用途：TikTok-Live-Connector 的 WebSocket signing 服务
- 边界：独立第三方服务，可能有 Community tier 的额度、服务条款、可用性和网络限制
- 凭证：Public CLI 不把 Euler Stream 或 LiveSift 凭证写入事件 payload；不要把任何 token 提交到仓库或命令历史

## Node.js 与 npm 生态

Node.js、npm、Commander、Zod、tsup、Vitest、ESLint、Prettier 及其他依赖分别受其各自许可证约束。完整依赖树可通过以下命令审查：

```bash
npm ci
npm ls --all
npm pack --dry-run --json
```

使用者和发布者应在正式分发前复核 lockfile、package metadata、上游 license 和服务条款。项目 Apache-2.0 授权不会扩大第三方服务或依赖的授权范围。
