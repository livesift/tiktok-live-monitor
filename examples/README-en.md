# Examples and Fixtures

This directory and the adjacent `schemas/` and `test/fixtures/` directories provide network-free Public output verification materials.

## Session JSONL

`session.jsonl` is a deterministic nine-line session example containing `session_started`, two `viewer_count` samples, `comment`, `gift`, `like`, `follow`, `share`, and `session_ended`. Each line is an independent `LiveEvent` object sharing the same `session.id`.

```bash
jq -e . examples/session.jsonl >/dev/null
npm test -- --run test/session-fixture.test.ts test/live-event-contract.test.ts
```

See the [English export format guide](../docs/export-formats-en.md) for directory archives and `session.metadata.json`. The `schemas/fixtures/valid-session-metadata.json` and `recording-session-metadata.json` files show completed and in-progress snapshots.

Replay the complete fixture through the production CLI without a username, TikTok connection, Webhook, or Gateway request:

```bash
npm run dev -- --replay examples/session.jsonl --json
npm run dev -- --replay examples/session.jsonl --json --output ./data/replay.jsonl
npm run dev -- --replay examples/session.jsonl --json --output-dir ./data/replays
```

Replay input is limited to 16 MiB. The CLI validates JSONL, the core event schema, shared identity, and the unique opening and closing lifecycle before initializing output. This command writes events immediately and is separate from the approximately 18-second terminal demo. See the [English export format guide](../docs/export-formats-en.md) for the input constraints and failure behavior.

## CSV Draft and PK/Battle Boundary

`session.csv` uses the fixed 15-column `csv-draft-v1` draft and corresponds to the nine-event core JSONL fixture. `session-csv-escaping.csv` covers commas, double quotes, and embedded CRLF. Validate the column order, JSON fields, and text round-trip with:

```bash
npm test -- --run test/csv-draft.test.ts
```

This is an exchange-format draft only; there is no CSV exporter or `--csv` option. See the [independent PK/battle protocol draft](../docs/pk-battle-protocol-draft-en.md): `pk_started` and `pk_ended` are outside the eight core `LiveEvent` types, fail core replay validation, and are unsupported by Private ingest. This repository does not yet ship a PK parser or fixture.

See the [export acceptance record](./export-verification.md) for package and Docker replay/archive commands, exit codes, nine-event fixture comparisons, and Docker environment details.

## Terminal Demo

`terminal-demo.txt` is a line-oriented preview from the production `TerminalRenderer`; `terminal-demo.cast` is the matching asciinema v2 capture with an approximately 18-second duration. Replay or regenerate the assets with:

```bash
npm run demo:terminal
npm run demo:terminal:preview
npm run demo:terminal:record
```

Playback uses only `session.jsonl`; it does not access the network, a real LIVE, a LiveSift account, or Private Gateway. The capture records package version `0.1.0-alpha.1`.

The fixture replay stdout/stderr, JSONL, Webhook mock, and duration evidence is recorded in [`terminal-demo-verification.md`](./terminal-demo-verification.md).

## Schema Fixtures

`schemas/fixtures/manifest.json` lists valid and invalid `LiveEvent` fixtures. `test/live-event-contract.test.ts` uses the manifest and `schemas/live-event.schema.json` to validate them:

```bash
npm test -- --run test/live-event-contract.test.ts
```

## Webhook Fixture

`test/fixtures/webhook-event.json` is the complete event envelope used by Webhook tests. It shares the JSONL schema, while `test/support/mock-webhook.ts` provides a deterministic HTTP mock for method, headers, body, retries, and failure isolation.

```bash
npm test -- --run test/webhook.test.ts
```

The Webhook body must be equivalent to the same event written as a JSONL line. All commands above are deterministic local tests and do not require a LiveSift login, Private Gateway, or a real TikTok LIVE.

## Docker Offline Replay

Build the production image from the repository root. Building downloads the base image and locked npm dependencies; runtime help and replay use no container network:

```bash
docker build -t tiktok-live-monitor:local .
docker run --rm --network none tiktok-live-monitor:local --help
docker run --rm --network none \
  -e LIVESIFT_GATEWAY_URL=http://127.0.0.1:1 \
  tiktok-live-monitor:local --replay /app/examples/session.jsonl --json
```

The image includes the CLI, schema, fixture, and export guide, and defaults to the non-root `node` user. Host replay requires Docker only, with no host Node.js, tsx, Vitest, TikTok credentials, or LiveSift account.

For a host-readable archive, run with the host user's UID/GID or make the bind mount writable by the default image user (UID/GID 1000):

```bash
mkdir -p ./data
docker run --rm --network none --user "$(id -u):$(id -g)" \
  -v "$PWD/data:/data" tiktok-live-monitor:local \
  --replay /app/examples/session.jsonl --json --output-dir /data
```

The mounted directory must be writable by the container process. A read-only mount fails with a permission diagnostic and non-zero exit. On Linux, `chown 1000:1000 ./data` grants write access to the image's default user.
