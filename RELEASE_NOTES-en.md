# v0.1.0-alpha.1

This Public OSS alpha release lets users connect to a public TikTok LIVE without a LiveSift login and send the same normalized events to the terminal, a JSONL file, or any HTTP/HTTPS Webhook endpoint.

## Included

- Node.js 20+ TypeScript CLI with the `tiktok-live-monitor` binary
- Human-readable Console output, JSONL stdout through `--json`, and file output through `--output <path>`
- Normalized `LiveEvent` envelopes, session lifecycle events, and deterministic JSONL/schema fixtures
- Generic Webhook `POST`, repeatable custom headers, up to three attempts per event, and exponential backoff
- Best-effort Webhook failures: diagnostics are reported without stopping local output or subsequent LIVE events
- Apache-2.0 project license with separate disclaimer and third-party notices

## Current Limitations

- The default provider is TikTok-Live-Connector, which uses Euler Stream for WebSocket signing; both are unofficial third-party dependencies subject to platform protocol changes, quotas, and service terms.
- This version does not provide LiveSift login, Private Gateway, a durable Webhook queue, credential storage, deduplication, or a strict at-least-once delivery guarantee.
- Webhook delivery is best-effort HTTP delivery. Events may be lost when an endpoint is unavailable, and diagnostics never include Header values.
- Public CLI users must follow TikTok platform terms, privacy requirements, and applicable law. The project does not represent TikTok or ByteDance.
- Real TikTok LIVE smoke results depend on creator availability and third-party provider health and are not a stability guarantee for offline CI.

## Verification Before Tagging

Before creating the `v0.1.0-alpha.1` tag, the publisher should complete the following in a Node.js 20+ environment:

```bash
npm ci
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm pack --dry-run --json
npm run release:check
```

Also run the JSONL, schema, and Webhook fixture checks in [examples/README-en.md](./examples/README-en.md), and confirm that the README, [Disclaimer](./DISCLAIMER-en.md), [Third-party Notices](./THIRD_PARTY_NOTICES-en.md), and package metadata are consistent.

## Release Status

This file records release boundaries and verification entry points. It does not automatically publish an npm package, Docker image, or GitHub Release. A maintainer must review provider versions, third-party terms, the license inventory, and registry state before distribution.
