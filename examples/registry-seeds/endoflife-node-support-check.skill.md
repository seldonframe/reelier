---
name: endoflife-node-support-check
description: Node.js release cycle and EOL dates from endoflife.date — read-only, useful before upgrading a runtime
license: MIT
---

# Node.js EOL support check

Inputs: (none — replays green as-is)

<!--
  Why an agent would replay this: endoflife.date is the canonical public
  source for "is this runtime still supported" checks — a useful gate
  before a CI job pins a Node version. Read-only, no auth.

  Endpoint verified live on 2026-07-22: 200, first entry cycle "26",
  latest a semver-looking string.
-->

The assertions pin the shape of the newest entry (a real cycle id and a
semver-looking `latest`), never a specific version number that will roll
forward every release.

## Steps

### Step 1 — Newest Node.js release cycle
- intent: Fetch the Node.js release table from endoflife.date and confirm the newest cycle has a well-formed shape
- action: http.get {"url": "https://endoflife.date/api/nodejs.json"}
- assert: status == 200
- assert: json.0.cycle is string
- assert: json.0.latest matches /^\d+\./
- assert: json.0.eol is string
- bind: cycle = json.0.cycle
- bind: latest = json.0.latest
- bind: eol = json.0.eol
- effect: read
