---
name: github-search-repos-shape
description: GitHub code-search shape check — top TypeScript repos by stars via the unauthenticated search API — read-only
license: MIT
---

# GitHub search repos shape

Inputs: (none — replays green as-is; see the personalization note)

<!--
  Personalization: swap the `q=language:typescript` query for any GitHub
  search-repositories query.

  Honesty note: this hits the UNAUTHENTICATED GitHub REST search API,
  which shares the same 60 req/hr per-IP budget as the other GitHub seeds
  in this set. A rate-limited run returns 403 (or a search-specific 422),
  the `status == 200` assert fails, and the receipt records a real
  failure — it never silently passes.

  Endpoint verified live on 2026-07-22: 200, total_count a large positive
  number, items a non-empty array.
-->

The assertions pin the shape (a positive total, a non-empty items array),
never the exact count or the top repo, both of which shift constantly.

## Steps

### Step 1 — Search repositories by language
- intent: Search GitHub for TypeScript repositories sorted by stars and confirm a well-formed result set
- action: http.get {"url": "https://api.github.com/search/repositories?q=language:typescript&sort=stars&order=desc"}
- assert: status == 200
- assert: json.total_count > 0
- assert: json.items is array
- bind: total_count = json.total_count
- effect: read
