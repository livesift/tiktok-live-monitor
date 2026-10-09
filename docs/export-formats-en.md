# Public Export Formats

This document defines the Public CLI's core `LiveEvent` JSONL output and session metadata archive. `LiveEvent` follows the v1 contract in the [JSON Schema](../schemas/live-event.schema.json). Metadata uses a separate [JSON Schema](../schemas/session-metadata.schema.json) and is never written as an event line, stdout output, or Webhook payload.

## JSONL

JSONL files use UTF-8 encoding. Each line is one complete JSON object and the file ends with a newline. Line order is the order in which the sink successfully receives and writes events. The file has no array wrapper, blank data rows, CLI status text, or session summary. The v1 core types are `session_started`, `session_ended`, `comment`, `gift`, `like`, `follow`, `share`, and `viewer_count`. Event fields, optional `actor`/`raw`, type-specific data, and UTC time fields are defined by the schema and the [nine-event example](../examples/session.jsonl).

All events in one session share `session.id`, the Creator reference, and, when available, `session.roomId`. The first line is the only `session_started` event and the last line is the only `session_ended` event. The ending event carries the start time, end time, and end reason. JSONL does not contain metadata rows.

The existing `--output <path>` mode resolves relative paths from the current working directory, creates missing parent directories before connecting, and opens the target in truncate mode. An existing target is overwritten and no metadata file is created.

## CSV Draft

`examples/session.csv` is a `csv-draft-v1` exchange-format draft corresponding to the core JSONL fixture. It does not mean that the CLI supports CSV export. The column order is fixed at 15 columns; the first row is the header and each event occupies one CSV record:

```text
id,platform,type,occurredAt,receivedAt,sessionId,roomId,creatorUsername,creatorUserId,creatorNickname,actorUserId,actorUsername,actorNickname,dataJson,rawJson
```

Identity fields are expanded from the `session`, `creator`, and `actor` objects. `dataJson` is the compact JSON string for the complete `data` object. `rawJson` contains the complete `raw` value when present and is otherwise empty. There is no metadata row; event order matches JSONL order.

Files use UTF-8 without a BOM and CRLF record separators. A missing optional scalar is an empty field, not `null`. An explicit numeric `0` is written as `0` and must not be treated as missing. JSON types and values inside `dataJson` and `rawJson` are not converted. This draft does not promise to distinguish a missing scalar from an empty string.

The format follows RFC 4180 quoting: a cell containing a comma, double quote, CR, or LF is enclosed in double quotes, and an internal double quote is written as two double quotes. CRLF inside a quoted cell belongs to that field and does not start a new record. The special-text example is [`session-csv-escaping.csv`](../examples/session-csv-escaping.csv). Validate it and the nine-event fixture with:

```bash
npm test -- --run test/csv-draft.test.ts
```

CSV remains a format and test draft. There is no CSV exporter and no `--csv` CLI option.

## Directory Archives

With explicit `--output-dir <directory>`, the CLI creates a new directory for each session:

```text
<directory>/<creator-key>/<UTC-YYYY-MM-DD>/<UTC-HHmmssSSS>_<session-key>/
  events.jsonl
  session.metadata.json
```

Path keys use a `c-` or `s-` prefix followed by the hexadecimal bytes of the original UTF-8 identity. The original values remain in metadata. The date and time come from `session_started.data.startedAt` in UTC and do not depend on the host timezone. Directories are created exclusively; an existing session directory fails rather than being appended to or overwritten. `--output` and `--output-dir` are mutually exclusive. Without either option, no local file is written.

## Session Metadata

Each directory archive has one `session.metadata.json` file. Its fields and strict types are defined by `schemas/session-metadata.schema.json`. `schemas/fixtures/valid-session-metadata.json` shows a completed archive and `schemas/fixtures/recording-session-metadata.json` shows an unfinished snapshot.

- `metadataSchemaVersion` is metadata format version `1`; `eventSchemaId` identifies LiveEvent v1; `packageVersion` records the package version that created the archive.
- `source` is `live` or `replay`; `platform` is `tiktok`; `session` and `creator` retain the complete identity objects.
- `startedAt` comes from the start event. After an end event is successfully written, `endedAt` and `endReason` come from that event. Without a successfully written end event, both are `null`.
- `status` is `recording`, `completed`, `interrupted`, or `failed`. The initial snapshot is `recording`; the final state is written only after events are closed. A session ended by a signal is `interrupted`; write, close, or runtime failures are `failed`.
- `eventCount` and `eventCounts` count successfully written JSONL events and all eight event types, including both lifecycle events. Metadata is not refreshed for every event while recording, so counts in a `recording` snapshot are not real-time progress. Use final-state counts as the completeness contract.
- `eventsFile` is the fixed relative path `events.jsonl`.

Final metadata is written to a temporary file in the same directory and atomically renamed into place. A forced termination or filesystem error can leave metadata in `recording`; consumers must treat that archive as unfinished. Events and metadata are separate files and provide no cross-file transaction or power-loss recovery guarantee.

## Offline Replay

The production CLI can immediately replay one complete core `LiveEvent` JSONL session. Replay preserves event objects and file order, does not re-normalize or synthesize lifecycle events, and does not create a TikTok provider. Gateway environment variables are ignored and no Webhook or other HTTP request is sent.

```bash
npm run dev -- --replay examples/session.jsonl --json
npm run dev -- --replay examples/session.jsonl --json --output ./data/replay.jsonl
npm run dev -- --replay examples/session.jsonl --json --output-dir ./data/replays
```

Input must be UTF-8 JSONL of at most 16 MiB. It may have one normal final newline but no blank data rows. Every line must pass the core runtime schema. The file must contain exactly one session: the first line is the only `session_started`, the last line is the only `session_ended`, all events share the complete session/Creator identity, and the ending event's `startedAt` matches the start event. The CLI reads and validates the complete input before initializing output. Invalid input reports the source path and line or session constraint, leaves stdout empty, and does not truncate an existing `--output` file.

`--replay` does not require a username and cannot be combined with a username, `--webhook`, or `--webhook-header`. It supports `--json`, `--output`, and `--output-dir`. In JSON mode stdout contains only the original event lines; the replay summary and diagnostics go to stderr. Replay is immediate and is separate from the approximately 18-second terminal demo; it does not verify real provider connectivity.

## PK / Battle Draft

PK/battle is an independent protocol draft and is outside core `LiveEvent`. Core schema and replay accept only the eight types listed above. `pk_started`, `pk_ended`, and score/battle data cannot be encoded as core events. Public CLI replay rejects unknown PK types, and Private ingest does not accept them. The repository currently ships no PK schema, fixture, or parser; do not treat the draft as an executable command or a verified provider mapping.

See the [independent PK/battle protocol draft](./pk-battle-protocol-draft-en.md) for the proposed field boundaries. An unknown score must be represented as missing or unknown, never as a placeholder `0`.

## Local Verification

Export a deterministic fixture to a directory archive:

```bash
npm run dev -- @username --output-dir ./data
npm run dev -- --json @username --output-dir ./data > session.stdout.jsonl
npm run dev -- --replay examples/session.jsonl --json --output-dir ./data/replays
```

The first command keeps human-readable terminal output; the second sends JSONL events to stdout and status/summary text to stderr; the third is an offline replay and needs no account or network. The first two LIVE commands need a real LIVE connection. Run the focused archive, schema, and replay tests with:

```bash
npm test -- --run test/session-export.test.ts test/session-metadata.test.ts test/session-fixture.test.ts test/replay.test.ts test/replay-cli.test.ts
```

The archive root is checked for creatability and writability before connecting to the provider. A container mount must also be writable by the image runtime user.
