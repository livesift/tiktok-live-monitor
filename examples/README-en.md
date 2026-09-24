# Examples and Fixtures

This directory and the adjacent `schemas/` and `test/fixtures/` directories provide network-free Public output verification materials.

## Session JSONL

`session.jsonl` is a deterministic five-line session example containing `session_started`, `comment`, `gift`, `viewer_count`, and `session_ended` in that order. Each line is an independent `LiveEvent` object sharing the same `session.id`.

```bash
jq -e . examples/session.jsonl >/dev/null
npm test -- --run test/session-fixture.test.ts test/live-event-contract.test.ts
```

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
