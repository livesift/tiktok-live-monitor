# Independent PK / Battle Protocol Draft

This document records the future PK/battle protocol scope. It does not define an extension to the Public core `LiveEvent` contract and is not a stable schema for writing or replaying user data.

## Status

The Public repository currently has no PK draft schema, manifest, PK fixture, or PK parser. Core JSONL replay handles only complete sessions made of the eight core `LiveEvent` types. The supported private Go ingest enum contains the same eight types. This document provides no CLI option or parser command, and it does not claim that TikTok-Live-Connector field mappings have been verified against real samples.

## Candidate Semantics

An independent PK draft envelope should distinguish at least `pk_started` and `pk_ended` and preserve these semantics for later validation:

| Semantic           | Draft scope                                | Still to verify                                            |
| ------------------ | ------------------------------------------ | ---------------------------------------------------------- |
| Battle identity    | An identifier that relates one PK interval | Provider source and lifecycle stability                    |
| Participants       | Available identities for both sides        | Side order, missing identities, and anonymous participants |
| Stage time         | PK start and end times                     | Units, timezone, reconnects, and duplicate callbacks       |
| Score              | Original scores observed for both sides    | Precision, accumulation, and relationship to gifts         |
| Provider extension | Unstable provider-specific raw fields      | Allowed fields, redaction, and compatibility policy        |

These are semantic questions, not a promise of fixed JSON field names, units, or score calculations. Missing or unknown values must remain missing or unknown; `0` is valid only when the input explicitly supplies zero.

## Compatibility Boundary

| Type                                                         | Current ownership          | Public replay                         | Private ingest                             |
| ------------------------------------------------------------ | -------------------------- | ------------------------------------- | ------------------------------------------ |
| `session_started`, `session_ended`                           | Core LiveEvent v1          | Accepts the unique session boundaries | Supported                                  |
| `comment`, `gift`, `like`, `follow`, `share`, `viewer_count` | Core LiveEvent v1          | Validated by the core schema          | Supported                                  |
| `pk_started`, `pk_ended`, score/battle                       | Independent protocol draft | Rejected; outside core replay input   | Unsupported; outside the ingest event enum |

The core enum and wire contract can change only after a separate review and synchronized Public/Private schema update. A PK draft must not be disguised as a core `LiveEvent` or sent to the current Gateway/Webhook ingest path.

## Verification State

Public replay tests reject both `pk_started` and `pk_ended` as unknown core event types. A future parser delivery must add a versioned schema, valid and invalid fixtures, and a deterministic offline validation command. This draft does not claim those artifacts exist. The current JSONL and metadata formats are described in the [English export format guide](./export-formats-en.md).
