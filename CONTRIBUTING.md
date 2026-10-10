# 贡献指南

English readers can use the [English README](./README.md). This repository contains the Public OSS monitor in `public/tiktok-live-monitor`; Private LiveSift services and credentials are outside this repository.

## 贡献范围

Public v0.1.0 承诺单 Creator 的公开 TikTok LIVE 实时采集、标准化 `LiveEvent`、Console/JSONL/session 目录/Webhook 导出和离线 replay。贡献应保持这些边界，不加入登录、SaaS 账号、Private Gateway、私有 `/v1/events` 或凭证采集逻辑。

第三方 TikTok 客户端只能位于 `src/providers/tiktok-live-connector`。新增事件字段、事件类型、导出格式或 provider 行为时，请同时更新 schema、fixture、测试和双语文档，并在 [CHANGELOG](./CHANGELOG.md) 记录用户可见变化。

## 环境与安装

- Node.js 20 或更高版本
- npm 10 或更高版本
- Docker（需要执行容器 smoke 时）

在仓库根目录执行：

```bash
npm ci
npm run build
```

真实 TikTok LIVE、Webhook token、LiveSift 登录和 Private Gateway 不是本地开发的必需条件。请只使用仓库中的合成 fixture 或你有权使用的脱敏数据。

## 提交前检查

按以下顺序运行 Public 验证：

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm pack --dry-run --json
npm run release:manifest -- --output artifacts/release/package-manifest.json
npm run release:check
npm run docker:smoke
```

`npm test` 覆盖确定性 unit/contract 测试；`npm run release:manifest` 生成包含 source commit 和 tarball 文件清单的版本摘要；`npm run release:check` 检查 package、文档、schema 和终端 Demo；`npm run docker:smoke` 构建带 OCI labels 的生产镜像并执行禁网帮助/replay 验收。外部 provider smoke 必须单独记录，不得让离线 CI 依赖主播在线状态。发布前请按文档仓库 `doc/ops/release-checklist-v0.1.0.md` 和 `doc/ops/public-oss-ghcr-docker-release.md` 比对各渠道。

## 文档、fixture 与变更记录

- 修改 CLI 参数或输出时，更新 [英文 README](./README.md)、[中文 README](./README-zh.md) 和对应 examples 文档。
- 修改 `LiveEvent`、session metadata 或导出格式时，更新 `schemas/`、`examples/` 和相关 contract 测试。
- 用户可见行为变化需要在 [CHANGELOG](./CHANGELOG.md) 和 [English Changelog](./CHANGELOG-en.md) 同步记录；发布边界见 [RELEASE_NOTES](./RELEASE_NOTES.md)。
- 合规和 provider 限制必须与 [DISCLAIMER](./DISCLAIMER.md) 和 [THIRD_PARTY_NOTICES](./THIRD_PARTY_NOTICES.md) 保持一致。
- 不要提交 token、Cookie、Webhook Header、真实账号、个人数据、`.env` 文件、`node_modules` 或本地导出目录。

## Pull Request

请使用 [Issue templates](https://github.com/livesift/tiktok-live-monitor/tree/main/.github/ISSUE_TEMPLATE/) 先描述 Bug 或 Feature，再提交 PR。PR 描述应包含：

- 变更目的和影响的 Public 入口
- 可复现的命令、Node/Docker 环境和脱敏输出
- 新增或更新的测试、fixture、schema、文档和 changelog
- 与 LiveSift Private 服务边界相关的影响说明（如适用）

提交前请确认 CI 所需命令通过，并确保 PR 不包含凭证或未经授权的数据。安全问题请遵循 [SECURITY.md](./SECURITY.md) 的私密披露流程，不要创建公开漏洞 Issue。

## 相关入口

- [Apache-2.0 License](./LICENSE)
- [免责声明](./DISCLAIMER.md) / [English Disclaimer](./DISCLAIMER-en.md)
- [第三方说明](./THIRD_PARTY_NOTICES.md) / [English Third-party Notices](./THIRD_PARTY_NOTICES-en.md)
- [v0.1.0 发布说明](./RELEASE_NOTES.md) / [English Release Notes](./RELEASE_NOTES-en.md)
- [安全披露](./SECURITY.md)
