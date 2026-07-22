---
name: cloudflare-status-sweep
description: Cloudflare's public Statuspage API status check — read-only, no account needed
license: MIT
---

# Cloudflare status sweep

Inputs: (none — works as-is; Cloudflare sits upstream of a huge share of the web)

<!--
  Same Statuspage v2 shape as the portfolio's vendor-status-sweep, for a
  different vendor. `status.indicator` is "none" when all systems are
  operational, else "minor" / "major" / "critical". The assertion pins the
  SHAPE, not the value — an incident should show up in the bound value on
  the receipt, not fail the replay.

  Endpoint verified live on 2026-07-22: 200, indicator "minor" (a real,
  live incident at verification time — the honest answer, not a fabricated
  "all clear").
-->

## Steps

### Step 1 — Cloudflare status
- intent: Fetch the Cloudflare public status page API and confirm a well-formed status indicator
- action: http.get {"url": "https://www.cloudflarestatus.com/api/v2/status.json"}
- assert: status == 200
- assert: json.status.indicator is string
- bind: indicator = json.status.indicator
- bind: description = json.status.description
- effect: read
