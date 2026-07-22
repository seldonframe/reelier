---
name: github-repo-metadata-nextjs
description: Public GitHub repo metadata pull for vercel/next.js — stars, open issues, license, identity — read-only
license: MIT
---

# GitHub repo metadata — vercel/next.js

Inputs: (none — replays green as-is; see the personalization note)

<!--
  Personalization: swap `vercel/next.js` in the URL for your own
  `owner/repo`.

  Honesty note: this hits the UNAUTHENTICATED GitHub REST API (60 req/hr
  per IP). A rate-limited run returns 403, the `status == 200` assert
  fails, and the receipt records a real failure — it never silently
  passes. That is the intended behavior, not a flake to paper over.

  Endpoint verified live on 2026-07-22: 200, full_name "vercel/next.js",
  license.spdx_id "MIT".
-->

Counts move; identity doesn't. The assertions pin the shape (non-negative
counters, a present license) and identity (`full_name`), never a specific
star count that would rot the day someone stars the repo.

## Steps

### Step 1 — Repo metadata, counters, and license
- intent: Fetch public repo metadata for vercel/next.js and check stars/issues/license/identity
- action: http.get {"url": "https://api.github.com/repos/vercel/next.js"}
- assert: status == 200
- assert: json.stargazers_count >= 0
- assert: json.open_issues_count >= 0
- assert: json.full_name == "vercel/next.js"
- assert: json.license.spdx_id is string
- bind: stars = json.stargazers_count
- bind: license = json.license.spdx_id
- effect: read
