---
name: rubygems-latest-version
description: Latest published version and download count for the Rails gem from the RubyGems API — read-only
license: MIT
---

# RubyGems latest version

Inputs: (none — replays green as-is)

<!--
  Why an agent would replay this: RubyGems' public gem-metadata API is a
  common upstream for Ruby dependency tooling. This confirms it still
  answers with the expected shape before a build or audit job relies on it.
  No auth, no account.

  Endpoint verified live on 2026-07-22: 200, name "rails", downloads a
  non-negative number.
-->

Download counts and versions move every release; the assertions pin shape
and identity, never a specific number.

## Steps

### Step 1 — Gem metadata from RubyGems
- intent: Fetch RubyGems' public metadata for the rails gem and confirm identity + non-negative counters
- action: http.get {"url": "https://rubygems.org/api/v1/gems/rails.json"}
- assert: status == 200
- assert: json.name == "rails"
- assert: json.downloads >= 0
- assert: json.version is string
- bind: version = json.version
- bind: downloads = json.downloads
- effect: read
