# Disclaimer

English version: [DISCLAIMER-en.md](./DISCLAIMER-en.md)

## 非官方项目

TikTok Live Monitor 是独立的开源社区项目，与 TikTok、ByteDance 或其关联公司无隶属、赞助或认可关系。项目不使用或声称代表 TikTok 官方 API，也不保证 TikTok 平台或第三方 provider 的接口长期稳定。

## 使用责任

使用者负责确认自己的采集、保存、转发和分析行为符合适用法律、TikTok 平台条款、当地隐私/数据保护要求以及目标账号的授权范围。请不要使用本工具绕过访问控制、收集不必要的个人信息或泄露 Webhook 凭证。

## Alpha 限制

当前版本为 `0.1.0-alpha.1`。TikTok-Live-Connector 通过 Euler Stream 完成 WebSocket signing；二者均为独立第三方服务，可能有自己的额度、条款、可用性和协议变化。Public CLI 的 Webhook 是 best-effort，不提供持久化投递队列、凭证存储、事件去重或至少一次投递保证。

软件按 Apache-2.0 License 提供，不对特定用途的可用性、准确性、连续性或不侵权作额外保证。使用前请阅读 [LICENSE](./LICENSE)、[第三方说明](./THIRD_PARTY_NOTICES.md) 和 [Alpha 发布说明](./RELEASE_NOTES.md)。
