---
name: jsdelivr-npm-package-stats
description: Version and dist-tag shape check for the react package via the jsDelivr data API — read-only
license: MIT
---

# jsDelivr npm package stats

Inputs: (none — replays green as-is; see the personalization note)

<!--
  Personalization: swap the literal `react` at the end of the URL for your
  own npm package name.

  Why an agent would replay this: jsDelivr's data API mirrors npm's tag and
  version list from a CDN's point of view — a useful cross-check that a
  package is resolvable through the CDN path, not just the registry.
  Read-only, no auth.

  Endpoint verified live on 2026-07-22: 200, tags.latest a semver string,
  versions a non-empty array.
-->

The assertions pin shape, not the exact version — a new React release
should not break this replay.

## Steps

### Step 1 — Tags and versions from jsDelivr
- intent: Fetch jsDelivr's package data for react and confirm a well-formed tags/versions shape
- action: http.get {"url": "https://data.jsdelivr.com/v1/package/npm/react"}
- assert: status == 200
- assert: json.tags.latest matches /^\d+\./
- assert: json.versions is array
- bind: latest = json.tags.latest
- effect: read
