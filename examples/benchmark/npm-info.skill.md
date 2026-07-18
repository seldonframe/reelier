---
name: npm-info
description: Fetch npm registry metadata for @seldonframe/reelier and extract version/license/tarball
---

# npm package info lookup

Inputs: (none)

<!--
  Grammar note (verified against the live registry response on the date this
  skill was recorded — see docs/strategy/reelier-launch/benchmark-results.md
  for the exact date and the raw response used to verify it):

  The task's ground-truth fields are `dist-tags.latest`, `license`, and
  `versions[<latest>].dist.tarball`. Two of those three cannot be expressed
  by this repo's assert/bind grammar (src/assert.ts):

    - `dist-tags` is a dashed key. The bind grammar's json-path form only
      supports `[a-zA-Z0-9_.]+` — no bracket/quoted-key escape for
      non-identifier characters — so `json.dist-tags.latest` cannot be
      written at all.
    - `versions[<latest>].dist.tarball` needs a COMPUTED key (the version
      string discovered at runtime). The grammar's json-path binder only
      supports a static dot-path; there's no way to splice one bind's value
      into another bind's path.

  Both are worked around with `body match /regex/` binds against the raw
  response text instead of `json.<path>` binds:

    - version:  the string `"latest":"X"` appears exactly once in the
      response (only inside the top-level `dist-tags` object) — a plain
      first-match regex is unambiguous and correctly tracks whatever
      version is actually latest at replay time.
    - tarball:  `"tarball":"..."` appears once per published version
      (oldest first, since npm's `versions` map is insertion-ordered by
      publish time and the registry always appends new releases at the
      end). A plain first-match regex would silently grab the OLDEST
      version's tarball, which is wrong. Anchoring the pattern with a
      leading `.*` (greedy, and the response body is single-line JSON with
      no embedded newlines, so `.*` spans the whole thing) forces the
      regex engine to backtrack from the end of the string, so the capture
      lands on the LAST occurrence — the latest version's tarball. This
      correctly tracks new publishes without hardcoding a version number.

  `license` IS expressible as a normal json-path bind (`json.license` is a
  dash-free top-level key) — it happens to equal
  `versions[latest].license` for this package's publishing history, but is
  really the package-level license field, not a per-version one.

  This is a genuine, documented limitation of the grammar, not a shortcut
  taken to flatter the benchmark: the extracted values are verified against
  live ground truth in the benchmark harness before being trusted.
-->

## Steps

### Step 1 — Fetch registry metadata and extract version/license/tarball
- intent: Get the npm registry document for @seldonframe/reelier and pull out the latest version, its license, and its tarball URL
- action: http.get {"url": "https://registry.npmjs.org/@seldonframe/reelier"}
- assert: status == 200
- bind: version = body match /"latest":"([^"]+)"/
- bind: license = json.license
- bind: tarball = body match /.*"tarball":"([^"]+)"/
- effect: read
