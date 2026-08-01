---
name: hermetic-e2e-fixture
description: Offline fixture for scripts/e2e-local.mjs's local end-to-end determinism smoke — every step intentionally avoids network so replay never depends on the outside world.
---

Fixture skill for `scripts/e2e-local.mjs`. Neither step below references a
tool in this CLI's default (no `--wrap`) tool set — only `http.get`/
`http.post` are registered by default, and both hit the real network, which
this fixture must never do. `local.noop` doesn't exist, so `reelier run`
fails Step 1 deterministically ("Unknown tool") with zero network
reachability, and Step 2 is deterministically marked skipped. The point
isn't that the run passes — it's that running the exact same binary against
the exact same file twice produces byte-identical run records.

## Steps

### Step 1 — Probe a local-only check
- intent: exercise the runner's template-fill + dispatch path with a tool that doesn't exist, so nothing ever reaches the network
- action: local.noop {"probe": "hermetic"}
- effect: read
- assert: status == 200

### Step 2 — Never reached
- intent: prove the runner marks a downstream step "skipped" after step 1 diverges
- action: local.noop {"probe": "unreached"}
- effect: read
- assert: status == 200
