# Five-harness aggregate - 2026-08-16

The semantic matrix was rerun from the explicit manifest at
`docs/evidence/agent-adapter-mcp-probes-2026-08-16/manifest.json` after the clean Linux suite
was repaired and reproduced.

The aggregate remains `failed` intentionally. The five rows are still fixture-only or observed-only
adapter evidence; the process-boundary probes prove that the shared Reelier contract is callable,
not that each external harness invoked it. No `unknown`, `unchecked`, `absent`, or `not-tested`
state is upgraded to success.

| Harness | Current result | What is proved | What remains unproved |
| --- | --- | --- | --- |
| Codex | `fixture-only` / `not-tested` | Shared semantic vector and genuine Codex init/up observation | Codex invoking the live adapter, governed execution, route completeness |
| Claude Code | `fixture-only` / `not-tested` | Shared semantic vector and genuine route/authority observation | Claude Code invoking the live adapter, governed execution, route completeness |
| Eve | `fixture-only` / `not-tested` in the v0 matrix | Real Eve 0.37.1 process/tool loop, shared contract binding, dynamic job discovery/load, attenuated delegation, authenticated Path C dispatch, reservation, receipt, and continuity | External Eve-host adapter coverage and production topology; the v0 candidate surface remains non-passing |
| Grok Build | `fixture-only` / `not-tested` | Shared semantic vector | Live Grok Build adapter execution and coverage; the local CLI was unavailable |
| Grok Bot | `fixture-only` / `not-tested` | Shared semantic vector and a real session observation that did not simulate Reelier evidence | Live adapter execution, governed refusal, enforcement, coverage, outcome |

## Clean Linux verification

Fresh Node 24 Linux clone, dependency install, Reelier build, Eve fixture install, and the full
repository test suite completed:

```text
tests     3448
passed    3440
failed    0
cancelled 0
skipped   8   (platform-specific)
exit      0
```

The two blockers found in the first run were fixed: the Eve fixture now declares its isolated MCP
SDK dependency, Linux detached-process cleanup resolves the actual process group, and the cleanup
test distinguishes a killed zombie from a live descendant. The N100 authority convergence case
then passed in the full suite.

## GitHub Path A live-proxy proof

Separate from the five-row semantic aggregate, the existing Reelier live proxy was exercised against
the approved disposable repository `fixlyai/soloproof` and branch
`reelier/conformance-20260816`.

- exactly one provider write changed the predetermined file;
- the exact commit, tree, blob, and UTF-8 content were read back;
- the same request key returned `duplicate` with effect delta `0`;
- the persisted artifact checker passed 20 checks and the focused tests passed 6/6;
- the live trace is classified as Reelier Path A (`mcp --wrap`), not Path C.

Evidence: `docs/evidence/github-live-proxy-conformance-2026-08-16/`.

The Path A evidence does not claim complete write coverage, semantic content safety, a Linux
Authority Cell, pull-request creation, review, or merge.

## Protected-main substrate result

The separate disposable GitHub substrate test also completed against `fixlyai/soloproof`:

- direct push to protected `main` was rejected;
- exact branch readback and retry were proved;
- a normal PR merge was blocked while one approval was required;
- a temporary zero-approval policy profile merged through the protected PR path;
- protection was restored with administrator enforcement and one required approval.

This substrate result used raw Git/GitHub operations, not a Reelier Authority Cell. It therefore
proves GitHub branch protection and readback behavior, not Reelier-governed protected-main merge.

## Acceptance status

The current honest claim is:

> Reelier has one shared delegation contract, a reproduced Eve process/tool-loop proof, a real
> Path A live-proxy GitHub write with exact readback and safe retry, and a clean Linux suite. The
> remaining four harnesses are not yet live contract executions, and Path C/protected-main merge
> authority is not yet proven.

The next gate is to attach genuine external Codex, Claude Code, Grok Build, and Grok Bot contract
invocations (or record explicit unsupported results), then run the bounded 1 -> 5 -> 20 -> 100
scale experiment. Do not claim universal harness coverage or autonomous protected-main merging
until those boundaries have their own machine-checked evidence.
