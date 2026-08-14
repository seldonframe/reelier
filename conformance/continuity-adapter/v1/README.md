# Continuity Adapter v1 conformance

A candidate exports `createCandidate(input)`, returning a closed descriptor plus `provision`, `adapter`, `counters`, and `close`. The adapter is exercised only through the public `reelier/continuity` surface; the fixture uses `reelier/authority` only for canonical request bytes and the Adapter Contract digest.

The checker runs ten isolated scenarios: host identity, identity isolation, resume projection, read-only open, cursor contention, ambiguity reconciliation, read-only status, semantic retry idempotency, request-ID conflict refusal, and verifier-only verified evidence.

Reports are closed records containing the v1 version, pass/fail status, reproduced maturity, candidate descriptor fields, per-check `{ id, status, detail }` records, and five explicit `not-proved` non-claims: content correctness, production readiness, safety, topology, and traffic completeness.

Run `npm run check:continuity-adapter -- ./path/to/candidate.mjs`. The command writes one JSON report line and exits 0 on pass, 1 on failure, or 2 for incorrect usage.
