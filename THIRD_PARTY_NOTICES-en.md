# Third-Party Notices

This document records important third-party runtime dependencies and service boundaries for the Public alpha. It does not change the project's Apache-2.0 License and does not represent a warranty from any third party.

## TikTok-Live-Connector

- npm dependency: `tiktok-live-connector`
- Purpose: connect to TikTok LIVE and receive provider events
- Boundary: not an official TikTok SDK; it is a community-maintained reverse-engineering provider, and TikTok protocol changes may break connections or event fields
- License and current version: use `package.json`, the npm package manifest, and the upstream repository's published license as the source of truth; review the actual declaration before release

## Euler Stream

- Purpose: WebSocket signing service used by TikTok-Live-Connector
- Boundary: independent third-party service that may have Community tier quotas, service terms, availability limits, and network restrictions
- Credentials: the Public CLI does not write Euler Stream or LiveSift credentials into event payloads; never commit tokens to the repository or shell history

## Node.js and npm Ecosystem

Node.js, npm, Commander, Zod, tsup, Vitest, ESLint, Prettier, and other dependencies are each governed by their own licenses. Review the complete dependency tree with:

```bash
npm ci
npm ls --all
npm pack --dry-run --json
```

Users and publishers should review the lockfile, package metadata, upstream licenses, and service terms before distribution. The project's Apache-2.0 grant does not expand the license granted for any third-party service or dependency.
