# v0.1.0-alpha.1 Alpha Release Checklist

Use this checklist to review the Public OSS release candidate before creating the `v0.1.0-alpha.1` tag. It records auditable build and documentation status only; it does not trigger npm, Docker, or GitHub publishing.

## Version and Compliance

- [x] `package.json` declares version `0.1.0-alpha.1`, binary `tiktok-live-monitor`, Node.js `>=20`, and Apache-2.0.
- [x] `npm pack --dry-run --json` contains only `dist`, schemas, examples, README files, disclaimers, third-party notices, release notes, checklists, and LICENSE; no test credentials, `node_modules`, or local environment files are included.
- [x] The README files, [Disclaimer](./DISCLAIMER-en.md), [Third-party Notices](./THIRD_PARTY_NOTICES-en.md), and [Alpha Release Notes](./RELEASE_NOTES-en.md) disclose the lack of TikTok/ByteDance affiliation, third-party provider limits, platform-term responsibility, and best-effort Webhook behavior.

## Automated Gates

- [x] `.github/workflows/ci.yml` runs `npm ci`, format, lint, typecheck, test, build, `npm pack --dry-run`, and `release:check` on Node.js 20.
- [x] CI path filters cover only Public source, fixtures, schemas, Docker, documentation, and release configuration; permissions are `contents: read`, with no account, token, or real-live smoke step.
- [x] `release:check` validates package metadata, the dist entry point, README commands, schema fixtures, JSONL, and this checklist, and exits non-zero for missing or inconsistent files.

## Local Verification (2026-09-24)

- [x] In a temporary clean directory, offline `npm ci` ran with Node.js `v25.6.1` (satisfying `>=20`) and npm `11.9.0`; dependencies came from the local cache without registry access.
- [x] `npm run build` generated `dist/cli/index.js`, `dist/index.js`, and declaration files.
- [x] `npm run start -- --help` displayed username, JSONL, Webhook, and source/Docker entry points without requiring a LiveSift login.
- [x] `jq -e . examples/session.jsonl`, session fixture tests, and `LiveEvent` schema tests passed; five related tests passed.
- [x] Webhook mock tests passed; six tests covered JSON POST, headers, payload equivalence, retries, and best-effort failures.
- [x] A controlled provider smoke passed 39 tests covering the `TikTokLiveConnectorProvider` fake client, CLI Console/JSONL sinks, and injected Webhook mock, confirming stable session/event IDs, lifecycle ordering, and schema compatibility.
- [x] With `LIVESIFT_GATEWAY_URL` and LiveSift credentials unset, an invalid Webhook parameter failed before connection with a non-zero exit; no real-account connection was attempted.

The temporary-directory TCP mock was blocked by the local sandbox's prohibition on binding `127.0.0.1`; the same Webhook test passed in the Public project workspace. This is an environment limitation, not an implementation failure. A real TikTok LIVE smoke remains a separate maintainer check with a controlled account and an explicitly live creator.

## Tag and Publishing Boundary

Commands prepared for a maintainer after final review:

```bash
git tag -a v0.1.0-alpha.1 -m "Release v0.1.0-alpha.1"
git push origin v0.1.0-alpha.1
```

- [x] This change did not run `git tag`, `npm publish`, `docker push`, or create a GitHub Release.
- [x] Before publishing, review provider versions, third-party licenses and service terms, real-live status, and registry/image targets; CI proves deterministic gates only.
