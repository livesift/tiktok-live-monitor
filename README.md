# TikTok Live Monitor

An open-source CLI for connecting to TikTok LIVE. Built with TypeScript and Node.js, it keeps the provider adapter separate from the monitoring core and future event outputs.

中文版：[README-zh.md](./README-zh.md)

## Requirements

- Node.js 20 or later
- npm 10 or later

## Quick start

```bash
git clone <repository-url>
cd tiktok-live-monitor
npm install
npm run dev -- @username
```

The username may include a leading `@`. The Day 1 connection flow reports the connection state and live room information, and shows a readable offline message when the creator is not live.

## Common commands

```bash
npm run dev -- @username  # Run the development CLI with tsx
npm test                  # Run Vitest unit tests
npm run typecheck         # Run the TypeScript type checker
npm run lint              # Run ESLint
npm run build             # Build the Node.js distribution
```

## Capabilities

The initial project setup provides the foundation for the next iterations:

- Node.js 20+ and TypeScript project configuration
- Module boundaries for `src/cli`, `src/core`, `src/adapters/tiktok`, and `src/events`
- Vitest, ESLint, Prettier, tsx, and tsup development tooling
- An implementation boundary for TikTok LIVE connection lifecycle and username validation

Comments, gifts, likes, viewer counts, JSONL export, and Webhook output will be added in later iterations.

## Development conventions

Third-party TikTok clients must only be used inside `src/adapters/tiktok`. The core monitoring interface does not expose provider-specific types, so a provider change will not affect the CLI or future event processing modules.

## License

This project is licensed under the Apache-2.0 License. See [LICENSE](./LICENSE).
