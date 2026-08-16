# Eve live agent-adapter v0 proof

This bundle is produced by a real Eve 0.37.1 process running in a clean Linux Node 24 container.
The process invoked the frozen Reelier Adapter Contract v1 through the Eve tool loop and supplied
the complete v0 semantic vector:

`jobs.search` → `jobs.load` → `delegations.request` → `delegations.status` → `tasks.status` → `outcomes.invoke` → `outcomes.status`

The machine checker returned `passed` for all seven v0 checks. The outcome invocation was refused
because the adapter contract was frozen but the authority contract was deliberately pending for
this candidate; no provider dispatch or write was attempted.

This proves Eve’s live adapter boundary and contract semantics. It does not prove route
completeness, enforced topology, provider write correctness, production safety, or that every Eve
plugin route is covered. Those fields remain explicitly `unchecked`/`not-proved` in the evidence.

Recheck the candidate with:

```text
node conformance/agent-adapter/v0/check.mjs docs/evidence/eve-live-agent-adapter-v0-2026-08-16/candidate.json
```
