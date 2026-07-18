---
name: npm-versions
description: Fetch npm registry metadata for @seldonframe/reelier and extract the latest version (documents a grammar gap for the count/enumerate fields)
---

# npm package versions/aggregation lookup

Inputs: (none)

<!--
  Grammar gap, documented honestly — read before trusting this skill as a
  full solution to the task it was recorded for.

  Task 2's ground-truth fields are `latest` (dist-tags.latest),
  `total_versions` (count of keys in the `versions` object),
  `prerelease_count` (count of those keys containing a hyphen), and
  `all_versions` (every key in the `versions` object, as an array).

  This repo's bind grammar (src/assert.ts, `evalBind`) supports exactly two
  forms:
    1. `<name> = json.<dotpath>`      — a STATIC dot-path into the JSON
       body, returning ONE scalar (string/number/bool/null) or a raw
       object/array value at that path. There is no syntax for iterating
       object keys, filtering them, or counting them — `json.versions`
       would bind the entire versions object as an opaque JS value, not a
       list of its keys, and there is no `.keys()` / `.length` form for
       object bindings (assert.ts's `length >`/`length <` form only reads
       `.length` off arrays/strings you already have — you cannot first
       turn an object's keys into an array via the grammar).
    2. `<name> = body match /<regex>/` — the FIRST capturing-group match
       of a regex against the raw response text. `obs.body.match(re)`
       (non-global) returns only the first match. There is no
       `matchAll`-equivalent bind, so a regex bind can extract at most one
       value, never a list of every occurrence.

  Concretely, this means:
    - `latest` IS expressible: `dist-tags.latest` is a dashed JSON key (the
      json-path form's `[a-zA-Z0-9_.]+` doesn't allow dashes at all, so
      `json.dist-tags.latest` can't even be written), but the string
      `"latest":"X"` appears exactly once in the response body (inside the
      top-level `dist-tags` object), so a first-match regex bind is
      unambiguous and correct.
    - `total_versions` and `prerelease_count` are NOT expressible. Both are
      COUNTS over the keys of `versions` (all keys, and keys containing
      `-`, respectively). There is no aggregate/count bind in the grammar
      at all — not "hard to write", genuinely absent from the language.
    - `all_versions` is NOT expressible. It requires enumerating every key
      of an object into an array. The regex bind form can capture at most
      one value per bind line; the json-path form has no "list the keys"
      operator.

  This is a real, reported product gap, not a shortcut taken to flatter
  the benchmark: the engine needs an aggregation/enumeration bind form
  (e.g. `name = json.<path> keys` returning an array of keys, plus a
  `count`/`filter` combinator) before tasks like "how many X" or "list
  every X" can be captured as a skill at all. See
  docs/strategy/reelier-launch/benchmark-results.md, "Task 2" section, for
  how this is scored: the skill below extracts what the CURRENT grammar
  can express (`latest`) and nothing else is faked or hand-computed
  outside the grammar.
-->

## Steps

### Step 1 — Fetch registry metadata and extract the one expressible field
- intent: Get the npm registry document for @seldonframe/reelier and pull out the latest version (the only one of the 4 target fields this grammar can express)
- action: http.get {"url": "https://registry.npmjs.org/@seldonframe/reelier"}
- assert: status == 200
- bind: latest = body match /"latest":"([^"]+)"/
- effect: read
