# v0.1.0-alpha.1 Alpha 发布清单

English version: [ALPHA_RELEASE_CHECKLIST-en.md](./ALPHA_RELEASE_CHECKLIST-en.md)

本清单用于维护者在创建 `v0.1.0-alpha.1` tag 前复核 Public OSS 发布候选版本。它只记录可审查的构建和文档状态，不会触发 npm、Docker 或 GitHub 的自动发布。

## 版本与合规

- [x] `package.json` 版本为 `0.1.0-alpha.1`，binary 为 `tiktok-live-monitor`，Node.js 要求为 `>=20`，许可证为 Apache-2.0。
- [x] `npm pack --dry-run --json` 清单只包含 `dist`、schema、examples、README、免责声明、第三方说明、release notes、清单和 LICENSE；不包含测试凭证、`node_modules` 或本地环境文件。
- [x] README、[免责声明](./DISCLAIMER.md)、[第三方说明](./THIRD_PARTY_NOTICES.md) 和 [alpha release notes](./RELEASE_NOTES.md) 已说明 TikTok/ByteDance 无隶属关系、第三方 provider 限制、平台条款责任和 Webhook best-effort 边界。

## 自动化门禁

- [x] `.github/workflows/ci.yml` 在 Node.js 20 上执行 `npm ci`、format、lint、typecheck、test、build、`npm pack --dry-run` 和 `release:check`。
- [x] CI 路径过滤仅覆盖 Public 工程源码、fixture、schema、Docker、文档和发布配置；权限为 `contents: read`，没有账号、token 或真实直播 smoke。
- [x] `release:check` 校验 package metadata、dist 入口、README 关键命令、schema fixture、JSONL 和本清单；缺失文件或不一致时返回非零。

## 本地验收记录（2026-09-24）

- [x] 在临时干净目录使用 Node.js `v25.6.1`（满足 `>=20`）和 npm `11.9.0` 执行离线 `npm ci`；依赖来自本机缓存，未访问 registry。
- [x] 执行 `npm run build`，生成 `dist/cli/index.js`、`dist/index.js` 及声明文件。
- [x] 执行 `npm run start -- --help`，成功展示 username、JSONL、Webhook 和源码/Docker 入口，未要求 LiveSift 登录。
- [x] 执行 `jq -e . examples/session.jsonl`、session fixture 测试和 `LiveEvent` schema 测试；5 个相关测试通过。
- [x] 执行 Webhook mock 测试；6 个测试通过，覆盖 JSON POST、Header、payload 等价性、重试和 best-effort 失败。
- [x] 执行受控 provider smoke：`TikTokLiveConnectorProvider` fake client、CLI Console/JSONL sink 和注入式 Webhook mock 共 39 个测试通过，确认 session/event ID 稳定、生命周期顺序和 schema 一致。
- [x] 在未设置 `LIVESIFT_GATEWAY_URL` 和 LiveSift 凭证的情况下，非法 Webhook 参数在连接前以非零退出；未执行真实账号连接。

临时目录中的 TCP mock 受本机沙箱禁止绑定 `127.0.0.1` 影响；同一 Webhook 测试在 Public 工程工作区通过，属于环境限制，不是实现失败。真实 TikTok LIVE smoke 仍需发布者在受控账号和明确在线主播下单独复核。

## Tag 与发布边界

准备命令（由发布者在最终审查后手动执行）：

```bash
git tag -a v0.1.0-alpha.1 -m "Release v0.1.0-alpha.1"
git push origin v0.1.0-alpha.1
```

- [x] 当前变更未执行 `git tag`、`npm publish`、`docker push` 或 GitHub Release 创建。
- [x] 发布前仍需人工复核 provider 版本、第三方 license/服务条款、真实直播状态和 registry/镜像目标；CI 只证明确定性门禁通过。
