---
name: api-contract-drift-watch
description: Schema-shape contract check of a public JSON API (PyPI's pip metadata) — required fields present + value types, read-only
---

<!-- synced from seldonframe/reelier examples/portfolio — edit there -->

# API contract drift watch

Inputs: (none — this file replays green as-is; see the personalization note)

<!--
  Personalization: point this at YOUR production API. Swap the URL for your
  own JSON endpoint and rewrite the `json.<path> is <type>` asserts to the
  required fields and types of YOUR contract (the portfolio README's "Point
  these at YOUR project" section has the one-command version for the simplest
  case — a different PyPI package). The skill grammar has no default-value
  syntax for {{var}} holes — an unbound {{var}} is an explicit error, never a
  guessed fallback — so this file ships with literals that replay green with
  zero flags.

  Honesty note: this hits the UNAUTHENTICATED PyPI JSON API (no key, no
  rate-limit gate for a single read). If PyPI ever drops or retypes one of
  these fields — the exact breaking change every pip client would feel — the
  matching `is <type>` assert fails and the receipt records a real failure. It
  never silently passes. That is the whole point, not a flake to paper over.

  Endpoint verified live on 2026-07-21: 200; info.name "pip",
  info.version "26.1.2", urls is array (2), releases is object, last_serial a number.
-->

This is a **shape** check, not a value check: the assertions pin the contract
— which fields must exist and what type each must be, across two nesting
levels (`info.*`, top-level `urls`/`releases`/`last_serial`) — never a
specific version string that would rot on the next release. A breaking change
to the API's shape fails the replay; a routine new release does not.

## Steps

### Step 1 — Assert the PyPI package-metadata contract holds
- intent: Fetch the PyPI JSON metadata for pip and assert the schema shape — required fields present with the right types
- action: http.get {"url": "https://pypi.org/pypi/pip/json"}
- assert: status == 200
- assert: json.info.name is string
- assert: json.info.version is string
- assert: json.info.package_url is string
- assert: json.urls is array
- assert: json.releases is set
- assert: json.last_serial is number
- bind: name = json.info.name
- bind: version = json.info.version
- bind: last_serial = json.last_serial
- effect: read
