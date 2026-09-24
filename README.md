# TikTok Live Monitor

An open-source TikTok LIVE tracker and real-time monitor for chat, gifts, viewers, likes, follows, shares and session events. Built with TypeScript and Node.js, it keeps the provider adapter separate from the monitoring core and future event outputs.

> Unofficial community project. It is not affiliated with TikTok or ByteDance, and it does not require a LiveSift account or Private Gateway.

English | [简体中文](./README-zh.md) | [Disclaimer](./DISCLAIMER-en.md) | [Third-party notices](./THIRD_PARTY_NOTICES-en.md) | [Alpha release notes](./RELEASE_NOTES-en.md) | [Release checklist](./ALPHA_RELEASE_CHECKLIST-en.md)

## Requirements

- Node.js 20 or later
- npm 10 or later
- `jq` is useful for inspecting JSONL output
- Docker is optional for container-based runs

## Quick start from source

```bash
git clone <repository-url>
cd tiktok-live-monitor
npm ci
npm run build
npm run start -- --help
npm run dev -- @username
```

The username may include a leading `@`. The CLI reports connection state and live room information, and shows a readable offline message when the creator is not live. A LiveSift login, `LIVESIFT_GATEWAY_URL`, or Private `/v1/events` endpoint is not required for this Public flow.

When the alpha package is available from npm, the same CLI can be started from a clean environment with:

```bash
npx --yes tiktok-live-monitor --help
npx --yes tiktok-live-monitor @username
```

To run the local container after building it:

```bash
docker build -t tiktok-live-monitor:local .
docker run --rm tiktok-live-monitor:local --help
docker run --rm tiktok-live-monitor:local @username --output /tmp/session.jsonl
```

The image runs as the non-root `node` user. Its entrypoint and the npm binary accept the same arguments. The `/app` working directory is writable for relative output paths; mount a writable host directory when the session file must survive the container:

```bash
docker run --rm -v "$PWD/data:/data" tiktok-live-monitor:local \
  @username --output /data/session.jsonl
```

The runtime user must have write permission for mounted output directories. If your host volume uses a different owner, adjust it before running or pass an explicit compatible `--user` to Docker.

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
npm test -- --run test/session-fixture.test.ts test/live-event-contract.test.ts
```

See [`examples/README-en.md`](./examples/README-en.md) for the fixture, schema and Webhook validation map.

## Webhook integration

Send the same normalized `LiveEvent` payload to any HTTP or HTTPS endpoint:

```bash
tiktok-live-monitor @username \
  --webhook https://example.com/live-events \
  --webhook-header "Authorization: Bearer $WEBHOOK_TOKEN" \
  --webhook-header "X-Source: livesift"
```

The request is a JSON `POST` with `Content-Type: application/json`. Each event is attempted at most three times; retry delays increase exponentially. Network errors, timeouts, and non-2xx responses are reported to diagnostics, but a failed Webhook never stops LIVE monitoring or local Console/JSONL output. An explicit `--webhook` works with any absolute HTTP/HTTPS endpoint and does not require a `/v1/events` path. The built-in Private Gateway compatibility setting remains available through `LIVESIFT_GATEWAY_URL`; an explicit `--webhook` takes precedence and the environment value receives the `/v1/events` suffix when needed.

Webhook delivery is best-effort. The CLI does not persist a delivery queue, store credentials, deduplicate events, or guarantee at-least-once delivery. Keep tokens in environment variables or a secret manager; header values are never included in failure diagnostics.

To verify an integration locally, run the deterministic Webhook tests and inspect the mock request payload:

```bash
npm test -- --run test/webhook.test.ts
npm run typecheck
```

Every request body is the same complete `LiveEvent` object emitted by `--json` and `--output`, so it can be validated with `schemas/live-event.schema.json` or replayed from `test/fixtures/webhook-event.json`. The deterministic Webhook test covers headers, payload equivalence, retries and best-effort failure behavior without a LiveSift account.

## Common commands

```bash
npm run dev -- @username  # Run the development CLI with tsx
npm test                  # Run Vitest unit tests
npm run typecheck         # Run the TypeScript type checker
npm run lint              # Run ESLint
npm run format:check      # Check Prettier formatting
npm run build             # Build the Node.js distribution
npm run start -- --help   # Run the built CLI
```

## Troubleshooting

- An offline creator is a valid Public result. The CLI prints an offline message and exits non-zero without emitting lifecycle events.
- Invalid usernames, URLs, headers or output paths fail before a TikTok connection is attempted. Read the usage text on stderr and correct the argument.
- In `--json` mode stdout contains only JSONL events; connection status and diagnostics are written to stderr.
- A Webhook outage is best-effort: local Console/JSONL output continues, while the endpoint error includes the event ID and final reason but never the Header value.
- TikTok-Live-Connector uses Euler Stream for WebSocket signing. Provider availability and limits are controlled by independent third parties; see [third-party notices](./THIRD_PARTY_NOTICES.md).

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

Use of this software remains subject to the [disclaimer](./DISCLAIMER.md), applicable TikTok platform terms and the notices for third-party dependencies.
