# Continuity Adapter v1 conformance

A candidate exports `createCandidate(input)`, returning a closed descriptor plus `provision`, `adapter`, `counters`, and `close`. The adapter is exercised only through the public `reelier/continuity` surface; the fixture uses `reelier/authority` only for canonical request bytes and the Adapter Contract digest.

The checker runs ten isolated scenarios: host identity, identity isolation, resume projection, read-only open, cursor contention, ambiguity reconciliation, read-only status, semantic retry idempotency, request-ID conflict refusal, and verifier-only verified evidence.

Reports are closed records containing the v1 version, pass/fail status, reproduced maturity, candidate descriptor fields, per-check `{ id, status, detail }` records, and five explicit `not-proved` non-claims: content correctness, production readiness, safety, topology, and traffic completeness.

Run `npm run check:continuity-adapter -- ./path/to/candidate.mjs`. The command writes one JSON report line and exits 0 on pass, 1 on failure, or 2 for incorrect usage.

## Eve 0.39.0 process conformance

The Eve fixture adds a real-process matrix over Eve's public HTTP session and NDJSON stream routes. It uses Eve's local Workflow store, a temporary Reelier ledger, the deterministic `mockModel`, and the loopback-only hermetic Path C port. It makes no live model, provider, deployment, workflow-dispatch, ACP, or Grok Bot call.

Prerequisites on Windows are Node 24 (the report records and validates the exact `process.version`), Git, npm, and permission to bind local `127.0.0.1` ports. Antivirus or endpoint policy must allow the exact spawned Eve PID tree to be stopped with `taskkill`; the harness never enumerates processes or targets unrelated Node processes. From a clean checkout with root dependencies installed, run:

```powershell
npm ci
npm run check:continuity-eve
```

The conformance command reinstalls the fixture's exactly pinned dependency tree, builds Reelier, compiles the test graph, runs the generic adapter checker, executes the serialized Eve kill/resume matrix, and runs the focused Path C/Continuity suites. Allow roughly two to four minutes on a typical developer machine; package installation can add time on a cold npm cache. The underlying runner writes exactly one validated JSON report line to stdout; npm may print its normal script preamble around it.

The report's `ledgerHeadDigest` identifies the final verified Continuity segment, `receiptGraphDigest` identifies the verifier-produced native receipt graph, and `reportDigest` is SHA-256 over canonical report bytes with `artifacts.reportDigest` omitted. `maturity: "reproduced"` means the local matrix was executed, not that production readiness was established.

Every report explicitly carries these non-claims: content correctness, production readiness, safety, topology, and traffic completeness are `not-proved`; Grok Bot is `not-tested`. Passing proves only the bounded local conformance cases represented by the checks and artifacts.
