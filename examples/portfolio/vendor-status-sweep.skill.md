---
name: vendor-status-sweep
description: One-sweep status check of npm and GitHub public status pages — read-only, no account needed
---

# Vendor status sweep

Inputs: (none — works as-is for any project; these two vendors are upstream of almost everyone)

<!--
  Both endpoints are public Statuspage v2 APIs — same shape, no auth.
  `status.indicator` is "none" when all systems are operational, else
  "minor" / "major" / "critical". The assertions pin the SHAPE (the field
  exists and is a string), not the value — a vendor incident should show up
  in the bound values on the receipt, not fail the replay: the skill's job
  is "did the status API answer honestly", not "is the vendor having a good
  day".

  Endpoints verified live on 2026-07-21: both 200, both indicator "none".
-->

## Steps

### Step 1 — npm status
- intent: Fetch the npm public status page API and confirm a well-formed status indicator
- action: http.get {"url": "https://status.npmjs.org/api/v2/status.json"}
- assert: status == 200
- assert: json.status.indicator is string
- bind: npm_indicator = json.status.indicator
- bind: npm_status = json.status.description
- effect: read

### Step 2 — GitHub status
- intent: Fetch the GitHub public status page API and confirm a well-formed status indicator
- action: http.get {"url": "https://www.githubstatus.com/api/v2/status.json"}
- assert: status == 200
- assert: json.status.indicator is string
- bind: github_indicator = json.status.indicator
- bind: github_status = json.status.description
- effect: read
