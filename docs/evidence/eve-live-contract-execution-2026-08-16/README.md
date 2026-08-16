# Eve live Adapter Contract execution — 2026-08-16

This bundle is a machine-checked semantic smoke run through the real Eve 0.37.1
HTTP process and session/tool loop. Eve first binds the live
`reelier.adapter-contract/v1` descriptor over a child stdio Reelier authority
process, then discovers and loads a job, requests a narrower delegation, invokes
the discovered job, and reads its status.

The invoke and status calls cross the existing authenticated loopback Path C
port. The report therefore records one authenticated provider dispatch and one
status read, plus a verifier-produced receipt graph. The dynamic job reference
is carried from `jobs.search` into `jobs.load` and `outcomes.invoke`.

Files:

- `live-contract-report.json` — closed report, contract binding, semantic transcript, Path C counters, and report digest.
- `adapter-events.jsonl` — events recorded inside the Eve tool process, including the complete contract descriptor response.
- `eve-stream-events.json` — raw Eve NDJSON stream rows proving the process/session boundary and tool-loop steps.
- `schema.json` — JSON Schema used by the runner to validate the report.

The evidence does not claim live-model execution, content correctness,
production readiness, safety, topology, or traffic completeness. It is separate
from the existing continuity kill/resume matrix; that matrix remains the
authority for process-cut and continuity criteria.

Re-run from the repository root after building Reelier and compiling the test
graph:

```powershell
node conformance/continuity-adapter/v1/eve-fixture/scripts/run-live-contract.mjs --out docs/evidence/eve-live-contract-execution-2026-08-16
```
