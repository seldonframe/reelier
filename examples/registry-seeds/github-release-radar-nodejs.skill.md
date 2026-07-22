---
name: github-release-radar-nodejs
description: Latest published GitHub release for nodejs/node — read-only radar over the unauthenticated GitHub API
license: MIT
---

# GitHub release radar — nodejs/node

Inputs: (none — replays green as-is; see the personalization note)

<!--
  Personalization: swap `nodejs/node` in the URL for any `owner/repo` whose
  releases you track.

  Honesty note: this hits the UNAUTHENTICATED GitHub REST API (60 req/hr
  per IP). A rate-limited run returns 403, the `status == 200` assert
  fails, and the receipt records a real failure — it never silently
  passes. That is the intended behavior, not a flake to paper over.

  Endpoint verified live on 2026-07-22: 200, tag_name "v26.5.0", id a
  numeric release id.
-->

The assertions pin shape and identity (a real tag string, a numeric id),
never the exact tag — a new Node.js release should not break this replay.

## Steps

### Step 1 — Latest published release
- intent: Fetch the latest published GitHub release for nodejs/node and confirm a well-formed tag + id
- action: http.get {"url": "https://api.github.com/repos/nodejs/node/releases/latest"}
- assert: status == 200
- assert: json.tag_name matches /^v\d+\./
- assert: json.id is number
- bind: tag = json.tag_name
- effect: read
