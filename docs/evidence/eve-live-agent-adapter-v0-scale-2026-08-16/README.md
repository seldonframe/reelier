# Eve live agent-adapter v0 scale proof

This bundle is the machine-generated result of a clean Linux Node 24 run using Eve 0.37.1. Every
worker launched a real Eve process and drove the same frozen Reelier Adapter Contract v1 semantic
vector through the Eve tool loop:

`jobs.search` → `jobs.load` → `delegations.request` → `delegations.status` → `tasks.status` → `outcomes.invoke` → `outcomes.status`

Final results:

| level | final workers | peak concurrency | unique tasks/principals | result |
|---:|---:|---:|---:|---|
| 1 | 1 | 1 | 1 / 1 | passed |
| 5 | 5 | 2 | 5 / 5 | passed |
| 20 | 20 | 2 | 20 / 20 | passed |
| 100 | 100 | 2 | 100 / 100 | passed |

One 100-level worker initially hit an Eve session-boundary timeout. The runner preserved that
failed attempt and performed one explicit retry with a new identity; the retry passed. This is
reported in `scale-report.json` under `recoveredAfterRetry`, not hidden.

The scale proves bounded live adapter execution, semantic equivalence, identity isolation, and
fail-closed recovery at these levels. It does not prove provider writes, retry idempotency for a
real external effect, route completeness, or production safety; those remain explicit non-claims.
