---
name: endoflife-ubuntu-lts-check
description: Ubuntu release cycle, LTS flag, and EOL date from endoflife.date — read-only, useful before pinning a base image
license: MIT
---

# Ubuntu LTS support check

Inputs: (none — replays green as-is)

<!--
  Why an agent would replay this: same class of check as the Node.js/Python
  variants, for Ubuntu — confirms the newest release cycle and whether it's
  flagged LTS before a Dockerfile or CI runner pins a base image. Read-only,
  no auth.

  Endpoint verified live on 2026-07-22: 200, first entry cycle "26.04",
  lts true, eol a date string.
-->

The assertions pin shape (a real cycle id, a boolean LTS flag, an EOL date
string), never the specific dates that roll forward every release.

## Steps

### Step 1 — Newest Ubuntu release cycle
- intent: Fetch the Ubuntu release table from endoflife.date and confirm the newest cycle has a well-formed shape
- action: http.get {"url": "https://endoflife.date/api/ubuntu.json"}
- assert: status == 200
- assert: json.0.cycle is string
- assert: json.0.eol is string
- bind: cycle = json.0.cycle
- bind: lts = json.0.lts
- bind: eol = json.0.eol
- effect: read
