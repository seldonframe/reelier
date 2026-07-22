---
name: endoflife-python-support-check
description: Python release cycle and EOL dates from endoflife.date — read-only, useful before upgrading a runtime
license: MIT
---

# Python EOL support check

Inputs: (none — replays green as-is)

<!--
  Why an agent would replay this: same class of check as the Node.js
  variant, for Python — confirms the newest supported cycle before a CI
  image or lockfile pins a Python version. Read-only, no auth.

  Endpoint verified live on 2026-07-22: 200, first entry cycle "3.14",
  latest a semver-looking string.
-->

The assertions pin shape (a real cycle id, a semver-looking `latest`,
an EOL date string), never the exact values that roll forward every
release.

## Steps

### Step 1 — Newest Python release cycle
- intent: Fetch the Python release table from endoflife.date and confirm the newest cycle has a well-formed shape
- action: http.get {"url": "https://endoflife.date/api/python.json"}
- assert: status == 200
- assert: json.0.cycle is string
- assert: json.0.latest matches /^\d+\./
- assert: json.0.eol is string
- bind: cycle = json.0.cycle
- bind: latest = json.0.latest
- bind: eol = json.0.eol
- effect: read
