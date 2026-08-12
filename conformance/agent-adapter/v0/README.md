# Agent adapter conformance v0

This directory freezes the consumer-side requirements for a universal Reelier agent channel while Path C's Adapter Contract v1 is still under construction.

It is a hermetic transcript checker. It does not connect to an agent, Authority Cell, network, provider, credential store, ledger, signer, or receipt service. Passing means only that the supplied fixture obeys this pre-freeze contract.

## Run it

```bash
npm run check:agent-adapter -- conformance/agent-adapter/v0/fixtures/grok-build-observed.json
npm run check:agent-adapter -- conformance/agent-adapter/v0/fixtures/grok-bot-observed.json
```

The checker writes one JSON report to stdout. Exit code `0` means every structural and semantic check passed, `1` means the candidate failed or could not be parsed, and `2` means the command was used incorrectly. Candidate values and stack traces are never included in failure reports.

## Candidate contract

`candidate.schema.json` closes the descriptor, authenticated session summary, interaction transcript, and coverage probes. The descriptor must remain:

- `fixture-only`;
- `host-authenticated`;
- unable to access provider credentials;
- bound to `pending-freeze` with no authority contract digest;
- observed by default, with observed and enforced modes declared;
- free of hard-coded job references.

The transcript uses a reversible record-state job only as a fixture. The job must originate in catalog discovery; it is not a Grok-specific or provider-specific tool.

## Semantic checks

- `universal-operations` — the adapter exposes only catalog, delegation, task-status, Outcome-invocation, and Outcome-status semantics.
- `dynamic-job-discovery` — load and invoke reuse a job returned by search.
- `host-bound-outcome-input` — Outcome input contains no authenticated identity or provider authority, including inside choices.
- `attenuated-child-principal` — the child identity and allocation are distinct and its effect budget is smaller.
- `pre-freeze-no-dispatch` — invocation refuses with `adapter-contract-pending`; dispatch and reconciliation remain absent and the result never passes.
- `observed-coverage-honesty` — observed mode remains available only with topology and completeness unchecked.
- `enforced-mode-unavailable` — enforced mode cannot activate before topology verifies.

## What passing does not mean

A passing v0 report does not prove that an adapter exists, that Grok used it, that any Outcome executed, that a provider write was bounded, that topology was enforced, or that traffic was complete. It never certifies safety, correctness, wisdom, fairness, or content quality.

After Path C publishes Adapter Contract v1, v0 remains historical evidence. A new black-box harness must bind the exact contract digest and probe the public MCP/HTTP boundary without importing private runner or ledger internals.
