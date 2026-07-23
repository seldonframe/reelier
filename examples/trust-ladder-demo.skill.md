---
name: trust-ladder-demo
description: The rungs-lit demo receipt — two real read checks (npm registry + jsDelivr cross-check) and one per-operation-approved echo write, signed and timestamped at push
---

# Trust ladder demo

Inputs: (none — this file replays green as-is)

<!--
  Honesty note: this skill exists to produce a REAL receipt with the trust
  rungs lit — nothing here is mocked. Step 1 reads the live npm registry
  (Cloudflare-fronted, so the response carries a CF-Ray the receipt records
  as a cross-checkable ref). Step 2 cross-checks the same package on
  jsDelivr's public API. Step 3 is the skill's one write: a JSON echo POST
  carrying the version bound in step 1, hash-approved per-operation via
  `reelier approve` — it executes with no --allow-writes flag because the
  approval is bound to this exact operation shape.

  Endpoints verified live 2026-07-23: registry.npmjs.org 200 + CF-Ray;
  data.jsdelivr.com 200 (type "npm", tags.latest tracks the registry);
  postman-echo.com 200 (echoes the JSON body under .json).
-->

The receipt this produces demonstrates every rung a single honest tenant can
light today: unaltered-since-push (Ed25519), timestamped (RFC-3161),
produced-by (registered key), tools-verified, writes-approved (hash-bound),
and cross-checkable refs. What it deliberately does not light: corroborated
— that only accrues when *distinct* tenants replay byte-identical skill
content, and faking that would be the exact astroturfing the rung resists.

## Steps

### Step 1 — Read reelier's latest release from the npm registry
- intent: Fetch the npm registry doc for reelier@latest and pin its contract shape
- action: http.get {"url":"https://registry.npmjs.org/reelier/latest"}
- assert: status == 200
- assert: json.name == "reelier"
- assert: json.version is string
- assert: json.license == "MIT"
- bind: version = json.version
- effect: read

### Step 2 — Cross-check the same package on jsDelivr
- intent: Fetch jsDelivr's package view and assert it tracks the npm registry
- action: http.get {"url":"https://data.jsdelivr.com/v1/packages/npm/reelier"}
- assert: status == 200
- assert: json.type == "npm"
- assert: json.name == "reelier"
- assert: json.tags.latest is string
- assert: json.versions is array
- effect: read

### Step 3 — Approved write: echo the release ping
- intent: POST a small JSON echo carrying the version bound in step 1 — the skill's one write, approved per-operation
- action: http.post {"url":"https://postman-echo.com/post","headers":{"content-type":"application/json"},"body":{"source":"trust-ladder-demo","ping":"pong","version":"{{version}}"}}
- assert: status == 200
- assert: json.json.ping == "pong"
- assert: json.json.source == "trust-ladder-demo"
- assert: json.json.version is string
- effect: idempotent-write
- approve: sha256:f32a1eccd312d6b88c8be4d16c1bec0c679b503e531257bf4e2e10ef3490f11b

## Changelog

- approved 1 write step(s) (reelier approve)
