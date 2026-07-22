---
name: weekly-metrics-digest
description: One-run digest of a project's public footprint — npm weekly downloads + GitHub stars + latest version — read-only
---

<!-- synced from seldonframe/reelier examples/portfolio — edit there -->

# Weekly metrics digest

Inputs: (none — this file replays green as-is; see the personalization note)

<!--
  Personalization: swap the two literals for your own project — `reelier`
  (the npm package name, used in the downloads URL and the registry URL) and
  `seldonframe/reelier` (the GitHub owner/repo). The skill grammar has no
  default-value syntax for {{var}} holes — an unbound {{var}} is an explicit
  error, never a guessed fallback — so this file ships with literals that
  work with zero flags.

  Where the single-metric skills each answer one question, this one rolls
  three public sources into a SINGLE receipt — a project's whole public
  footprint in one replay. Each step binds its metric; nothing is pinned, so
  the digest stays value-fresh week to week.

  Endpoints verified live on 2026-07-21: all three 200 — downloads 422,
  stars 1, latest version "0.14.0".
-->

Three sources, one digest. Each step asserts the **shape** (a 200 and a
non-negative or well-formed value) and **binds** the number onto the receipt —
the counts move every week, so the receipt records the fresh digest instead of
pinning a value that would rot tomorrow.

## Steps

### Step 1 — npm weekly downloads
- intent: Fetch the trailing-7-day npm download count for the reelier package
- action: http.get {"url": "https://api.npmjs.org/downloads/point/last-week/reelier"}
- assert: status == 200
- assert: json.downloads >= 0
- assert: json.package is string
- bind: downloads = json.downloads
- effect: read

### Step 2 — GitHub stars
- intent: Fetch public repo metadata for seldonframe/reelier and read its star count and identity
- action: http.get {"url": "https://api.github.com/repos/seldonframe/reelier"}
- assert: status == 200
- assert: json.stargazers_count >= 0
- assert: json.full_name is string
- bind: stars = json.stargazers_count
- effect: read

### Step 3 — Latest published version
- intent: Fetch the latest published version of reelier from the npm registry
- action: http.get {"url": "https://registry.npmjs.org/reelier/latest"}
- assert: status == 200
- assert: json.version matches /^\d+\./
- bind: version = json.version
- effect: read
