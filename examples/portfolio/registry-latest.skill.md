---
name: registry-latest
description: Latest published version of the reelier package from the npm registry — read-only
---

# Registry latest

Inputs: (none — this file replays green as-is; see the personalization note)

<!--
  Personalization: swap the literal `reelier` in the URL path for your own
  package name (the portfolio README's "Point these at YOUR project" section
  has the one-command version). The skill grammar has no default-value
  syntax for {{var}} holes — an unbound {{var}} is an explicit error, never
  a guessed fallback — so this file ships with a literal that works with
  zero flags.

  Endpoint verified live on 2026-07-21: 200, version "0.12.1".
-->

The version assertion is a **pattern**, never a pinned number — `^\d+\.`
holds for every release that will ever ship, so publishing a new version
changes the bound value on the receipt without breaking the replay.

## Steps

### Step 1 — Latest dist-tag from the registry
- intent: Fetch the latest published version of reelier from the npm registry and check it looks like semver
- action: http.get {"url": "https://registry.npmjs.org/reelier/latest"}
- assert: status == 200
- assert: json.version matches /^\d+\./
- bind: version = json.version
- effect: read
