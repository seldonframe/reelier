---
name: pypi-latest-version
description: Latest published version of the Flask package from the PyPI JSON API — read-only, no account needed
license: MIT
---

# PyPI latest version

Inputs: (none — replays green as-is)

<!--
  Why an agent would replay this: confirms PyPI's public JSON API for a
  package is still answering with a well-formed version string before you
  depend on it in a build script or dependency-bump job. Read-only, no auth.

  Endpoint verified live on 2026-07-22: 200, info.name "Flask", version
  matches semver.
-->

The assertion pins the **shape** (a semver-looking string, the right
package identity), never the exact version — a new Flask release should
not break this replay.

## Steps

### Step 1 — Package metadata from PyPI
- intent: Fetch PyPI's JSON metadata for the flask package and confirm identity + a semver-looking version
- action: http.get {"url": "https://pypi.org/pypi/flask/json"}
- assert: status == 200
- assert: json.info.name == "Flask"
- assert: json.info.version matches /^\d+\.\d+/
- bind: version = json.info.version
- effect: read
