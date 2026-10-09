# TikTok Live Monitor

An open-source TikTok LIVE tracker and real-time monitor for chat, gifts, viewers, likes, follows, shares and session events. Built with TypeScript and Node.js, it keeps the provider adapter separate from the monitoring core and future event outputs.

> Unofficial community project. It is not affiliated with TikTok or ByteDance, and it does not require a LiveSift account or Private Gateway.

English | [简体中文](./README-zh.md) | [Disclaimer](./DISCLAIMER-en.md) | [Third-party notices](./THIRD_PARTY_NOTICES-en.md) | [Alpha release notes](./RELEASE_NOTES-en.md)

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

The username may include a leading `@`. The CLI reports connection state, live room information, and the session ID shared by lifecycle events; it shows a readable offline message when the creator is not live. A LiveSift login, `LIVESIFT_GATEWAY_URL`, or Private `/v1/events` endpoint is not required for this Public flow.

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

# Archive each session in a new directory with a separate metadata file.
npm run dev -- @username --output-dir ./data

# JSONL events only on stdout; status and diagnostics go to stderr.
npm run dev -- --json @username | jq -c .

# Send equivalent JSONL events to stdout and a file.
npm run dev -- @username --json --output ./data/session.jsonl > session.stdout.jsonl

# Replay the checked-in session fixture offline.
npm run dev -- --replay examples/session.jsonl --json
npm run dev -- --replay examples/session.jsonl --json --output-dir ./data/replays
```

`--output <path>` resolves relative paths from the current working directory, creates missing parent directories, and truncates the target file before connecting. It does not append to an existing file. If the provider fails before producing an event, the initialized file remains empty. A path that cannot be created or opened fails before any TikTok connection is attempted.

`--output-dir <directory>` creates a new archive directory for each session using the Creator key, UTC start date/time, and session ID. Each archive contains `events.jsonl` and `session.metadata.json`; existing session directories are never overwritten. The option is mutually exclusive with `--output`. See [`docs/export-formats-en.md`](./docs/export-formats-en.md) for the directory naming, metadata statuses, schemas, and verification commands.

`--json` keeps stdout machine-readable: every event is one complete JSON object per line, while connection status, shutdown messages, and diagnostics are written to stderr. Combining `--json` and `--output` writes the same event objects, in the same order, to both sinks.

`--replay <path>` validates and immediately replays one complete core `LiveEvent` JSONL session without a username, TikTok connection, Webhook, or Gateway request. The input is limited to 16 MiB and is fully validated before any output file is opened or truncated. It accepts `--json`, `--output`, and `--output-dir`; it cannot be combined with a username, `--webhook`, or `--webhook-header`. See [`docs/export-formats-en.md`](./docs/export-formats-en.md) for the lifecycle and identity requirements.

The repository includes a deterministic session example at [`examples/session.jsonl`](./examples/session.jsonl). Validate it one line at a time with:

```bash
jq -e . examples/session.jsonl >/dev/null
npm test -- --run test/session-fixture.test.ts test/live-event-contract.test.ts
```

See [`docs/export-formats-en.md`](./docs/export-formats-en.md) and [`examples/README-en.md`](./examples/README-en.md) for export formats, fixtures, schema and Webhook validation. Recorded package and Docker acceptance results are in [`examples/export-verification.md`](./examples/export-verification.md).

The same guide describes `csv-draft-v1` and its fixed 15 columns. [`examples/session.csv`](./examples/session.csv) mirrors the nine-event JSONL fixture, and [`examples/session-csv-escaping.csv`](./examples/session-csv-escaping.csv) covers commas, quotes, and embedded line breaks. Validate both with `npm test -- --run test/csv-draft.test.ts`. CSV remains a documentation draft; the CLI has no CSV exporter or `--csv` option. PK/battle notes are a separate protocol draft; `pk_started` and `pk_ended` are not core events, are rejected by core replay, and are unsupported by Private ingest. The Public repository does not yet ship a PK parser or fixture; see [`docs/pk-battle-protocol-draft-en.md`](./docs/pk-battle-protocol-draft-en.md).

## Docker offline replay

Build the production image from the repository root. The build downloads the base image and locked npm dependencies; the resulting help and replay commands run without container networking:

```bash
docker build -t tiktok-live-monitor:local .
docker run --rm --network none tiktok-live-monitor:local --help
docker run --rm --network none \
  -e LIVESIFT_GATEWAY_URL=http://127.0.0.1:1 \
  tiktok-live-monitor:local --replay /app/examples/session.jsonl --json
```

The image includes the production CLI, schema, fixture, and format guide, and runs as the non-root `node` user. Host replay needs Docker only; it does not use host Node.js, tsx, Vitest, TikTok credentials, or a LiveSift account.

To export to a host directory, match the container process UID/GID to the host user or make the mount writable by the image's `node` user (UID/GID 1000):

```bash
mkdir -p ./data
docker run --rm --network none --user "$(id -u):$(id -g)" \
  -v "$PWD/data:/data" tiktok-live-monitor:local \
  --replay /app/examples/session.jsonl --json --output-dir /data
```

The host user must be able to write the mounted directory; a read-only mount fails with a permission diagnostic and non-zero exit. Mount ownership can be adjusted with `chown 1000:1000 ./data` on Linux when using the image's default user.

## Offline terminal demo

Replay the checked-in fixture through the production terminal renderer without connecting to TikTok, a Webhook, or any LiveSift service:

```bash
npm run demo:terminal
npm run demo:terminal:preview
npm run demo:terminal:record
```

Playback takes about 18 seconds. The static [text preview](./examples/terminal-demo.txt) is portable to files and non-interactive terminals; the [asciinema v2 capture](./examples/terminal-demo.cast) can be played with `asciinema play examples/terminal-demo.cast`. The record command regenerates both files from [`examples/session.jsonl`](./examples/session.jsonl). These checked-in assets are versioned for package `0.1.0-alpha.1` and use only synthetic fixture identities.

The fixture replay and CLI sink acceptance results are recorded in [`examples/terminal-demo-verification.md`](./examples/terminal-demo-verification.md).

The demo verifies renderer behavior, not provider connectivity. A real LIVE connection uses TikTok-Live-Connector and its Euler Stream signing service, whose availability and protocol compatibility are controlled by third parties. No Web UI, LiveSift account, or Private Gateway is used by the demo. Current viewer uses the latest valid `occurredAt` timestamp, so an older event received later does not move the displayed value backward; peak viewer remains the highest valid sample. Renderer panels and summaries stay in human-readable output and never enter JSONL files or Webhook payloads.

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
- A username that fails local validation or provider resolution is reported as `INVALID_USERNAME` and exits before a LIVE session is created.
- Network, authentication, room-resolution, or third-party provider failures are reported as `CONNECTION_FAILED` with a readable reason and a non-zero exit.
- Invalid URLs, headers or output paths fail before a TikTok connection is attempted. Read the usage text on stderr and correct the argument.
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
