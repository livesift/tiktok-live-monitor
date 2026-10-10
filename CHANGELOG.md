# Changelog

English version: [CHANGELOG-en.md](./CHANGELOG-en.md)

## [0.1.0] - 2026-10-10

首次 Public OSS 正式发行。

### Added

- 支持单 Creator 的公开 TikTok LIVE 实时采集。
- 提供标准化 `LiveEvent` 事件和 session lifecycle。
- 支持人类可读 Console、JSONL stdout、显式文件、session 目录归档和通用 HTTP/HTTPS Webhook 导出。
- 提供 Node.js package、非 root Docker 镜像、离线 `--replay` 和确定性终端 Demo。
- Public CLI 可在没有 LiveSift 登录、SaaS 账号或 Private Gateway 的环境中运行。

### Boundaries

- 默认 provider 为非官方的 TikTok-Live-Connector，并依赖 Euler Stream 完成 WebSocket signing。
- Webhook 为 best-effort，不提供持久化队列、凭证存储、去重或至少一次投递保证。
- 使用者仍须遵守 TikTok 平台条款、隐私要求和适用法律；项目与 TikTok/ByteDance 无隶属关系。

详细命令和验证入口见 [README](./README.md)、[发布说明](./RELEASE_NOTES.md)、[免责声明](./DISCLAIMER.md)、[第三方说明](./THIRD_PARTY_NOTICES.md)、[贡献指南](./CONTRIBUTING.md) 和 [安全披露](./SECURITY.md)。
