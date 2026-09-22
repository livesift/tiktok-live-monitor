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

By default, connection status and event summaries are human-readable on stdout. Use `--output` to save the same session as JSONL, or use `--json` when stdout is consumed by a script.

## Session JSONL output

```bash
# Human-readable terminal output plus a truncated JSONL file.
npm run dev -- @username --output ./data/session.jsonl

# JSONL events only on stdout; status and diagnostics go to stderr.
npm run dev -- --json @username | jq -c .

# Send equivalent JSONL events to stdout and a file.
npm run dev -- @username --json --output ./data/session.jsonl > session.stdout.jsonl
```

`--output <path>` resolves relative paths from the current working directory, creates missing parent directories, and truncates the target file before connecting. It does not append to an existing file. If the provider fails before producing an event, the initialized file remains empty. A path that cannot be created or opened fails before any TikTok connection is attempted.

`--json` keeps stdout machine-readable: every event is one complete JSON object per line, while connection status, shutdown messages, and diagnostics are written to stderr. Combining `--json` and `--output` writes the same event objects, in the same order, to both sinks.

The repository includes a deterministic session example at [`examples/session.jsonl`](./examples/session.jsonl). Validate it one line at a time with:

```bash
jq -e . examples/session.jsonl >/dev/null
```

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
- Module boundaries for `src/cli`, `src/core`, `src/providers/tiktok-live-connector`, and `src/events`
- Vitest, ESLint, Prettier, tsx, and tsup development tooling
- An implementation boundary for TikTok LIVE connection lifecycle and username validation
- Deterministic session lifecycle events and JSONL output through `--json` and `--output`

The monitor reports connection state and readable summaries for supported TikTok events. JSONL output is intended for shell pipelines, fixture replay, and downstream analysis.

## Development conventions

Third-party TikTok clients must only be used inside `src/providers/tiktok-live-connector`. The core monitoring interface does not expose provider-specific types, so a provider change will not affect the CLI or future event processing modules.

## TikTok connectivity

TikTok Live Monitor currently uses TikTok-Live-Connector as its
default TikTok LIVE provider.

TikTok-Live-Connector uses Euler Stream for WebSocket signing.
Euler Stream provides a free community tier, but it is an independent
third-party service and may have its own limits and terms.

The provider layer is intentionally abstracted so alternative or
self-hosted implementations can be added in the future.

## License

This project is licensed under the Apache-2.0 License. See [LICENSE](./LICENSE).
