# Contributing

The Public OSS monitor lives in `public/tiktok-live-monitor`. Public v0.1.0 does not depend on LiveSift SaaS. Private LiveSift services, SaaS accounts, gateways, and credentials are outside this repository.

## Scope

Public v0.1.0 supports one Creator at a time, normalized `LiveEvent` records, Console/JSONL/session-directory/Webhook exports, and offline replay. Keep contributions within these boundaries. Do not add login flows, SaaS account requirements, Private Gateway calls, private `/v1/events` endpoints, or credential collection.

Third-party TikTok clients must remain under `src/providers/tiktok-live-connector`. When changing event fields, event types, export formats, or provider behavior, update the schema, fixtures, tests, and both language README files. Record user-visible changes in both changelogs.

## Environment

- Node.js 20 or later
- npm 10 or later
- Docker for container smoke checks

From the repository root:

```bash
npm ci
npm run build
```

A real TikTok LIVE session, Webhook token, LiveSift login, or Private Gateway is not required for local development. Use the checked-in synthetic fixtures or data that you are authorized to process and have redacted.

## Required checks

Run the Public validation sequence before submitting a change:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm pack --dry-run --json
npm run release:manifest -- --output artifacts/release/package-manifest.json
npm run release:check
npm run docker:smoke
```

`npm test` covers deterministic unit and contract tests. `npm run release:manifest` records the source commit and tarball file list. `npm run release:check` validates package metadata, documentation, schemas, and the terminal demo. `npm run docker:smoke` builds an OCI-labelled production image and checks help/replay with networking disabled.

Release operators should use the `doc/ops/` documentation repository for the release checklist and GHCR/Docker procedure. Provider smoke results must be recorded separately and must not make offline CI depend on a creator being live.

## Docs, fixtures, and changelogs

- Update [`README.md`](./README.md), [`README-zh.md`](./README-zh.md), and the relevant examples when changing CLI arguments or output.
- Update `schemas/`, `examples/`, and contract tests when changing `LiveEvent`, session metadata, or an export format.
- Record user-visible behavior changes in [`CHANGELOG-en.md`](./CHANGELOG-en.md) and [`CHANGELOG.md`](./CHANGELOG.md). Release boundaries are documented in [`RELEASE_NOTES-en.md`](./RELEASE_NOTES-en.md).
- Keep compliance and provider limits consistent with [`DISCLAIMER-en.md`](./DISCLAIMER-en.md) and [`THIRD_PARTY_NOTICES-en.md`](./THIRD_PARTY_NOTICES-en.md).
- Never commit tokens, Cookies, Webhook headers, real accounts, personal data, `.env` files, `node_modules`, or local export directories.

## Pull requests

Use the [Issue templates](https://github.com/livesift/tiktok-live-monitor/tree/main/.github/ISSUE_TEMPLATE/) to describe a bug or feature before opening a pull request. Include:

- The purpose and affected Public entry points
- Reproduction commands, Node/Docker environment, and redacted output
- New or updated tests, fixtures, schemas, documentation, and changelogs
- Any impact on the boundary between Public code and Private LiveSift services

Confirm that the CI commands pass and that the pull request contains no credentials or unauthorized data. Report security issues through [`SECURITY-en.md`](./SECURITY-en.md), never through a public bug issue.

## Related entry points

- [Apache-2.0 License](./LICENSE)
- [Disclaimer](./DISCLAIMER-en.md) / [中文免责声明](./DISCLAIMER.md)
- [Third-party notices](./THIRD_PARTY_NOTICES-en.md) / [中文第三方说明](./THIRD_PARTY_NOTICES.md)
- [v0.1.0 release notes](./RELEASE_NOTES-en.md) / [中文发布说明](./RELEASE_NOTES.md)
- [Security disclosure](./SECURITY-en.md) / [安全披露](./SECURITY.md)
