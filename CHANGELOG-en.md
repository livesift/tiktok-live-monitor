# Changelog

中文版本：[CHANGELOG.md](./CHANGELOG.md)

## [0.1.0] - 2026-10-10

First public OSS release.

### Added

- Real-time monitoring for one public TikTok LIVE creator.
- Normalized `LiveEvent` records and session lifecycle events.
- Human-readable Console output, JSONL stdout, explicit file output, session-directory archives, and generic HTTP/HTTPS Webhook export.
- A Node.js package, non-root Docker image, offline `--replay`, and a deterministic terminal demo.
- A standalone Public CLI that runs without a LiveSift login, SaaS account, or Private Gateway.

### Boundaries

- The default provider is the unofficial TikTok-Live-Connector and it uses Euler Stream for WebSocket signing.
- Webhook delivery is best-effort and does not provide a durable queue, credential storage, deduplication, or an at-least-once guarantee.
- Users must follow TikTok platform terms, privacy requirements, and applicable law. The project is not affiliated with TikTok or ByteDance.

See the [README](./README.md), [release notes](./RELEASE_NOTES-en.md), [disclaimer](./DISCLAIMER-en.md), [third-party notices](./THIRD_PARTY_NOTICES-en.md), [contributing guide](./CONTRIBUTING.md), and [security policy](./SECURITY.md) for commands and verification entry points.
