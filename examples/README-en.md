# Examples and Fixtures

This directory and the adjacent `schemas/` and `test/fixtures/` directories provide network-free Public output verification materials.

## Session JSONL

`session.jsonl` is a deterministic nine-line session example containing `session_started`, two `viewer_count` samples, `comment`, `gift`, `like`, `follow`, `share`, and `session_ended`. Each line is an independent `LiveEvent` object sharing the same `session.id`.

```bash
jq -e . examples/session.jsonl >/dev/null
npm test -- --run test/session-fixture.test.ts test/live-event-contract.test.ts
```

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
