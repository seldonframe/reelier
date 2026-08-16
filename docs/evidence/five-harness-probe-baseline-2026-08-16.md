# Five-harness probe baseline — 2026-08-16

This is the read-only baseline for the five-harness experiment. It is bound to
`codex/five-harness-conformance` at `8d346cd` and records what was actually
observed on the local host. It is not live governed-execution evidence.

## Current matrix

| Harness | Evidence obtained | Current classification | What it proves | What it does not prove |
|---|---|---|---|---|
| Codex | `reelier coverage --host codex` | observed-only | The host config and discoverable plugin manifests can be inventoried; three top-level MCP entries were parsed and all were unwrapped. | Completeness, route enforcement, governed execution, provider outcome, or plugin traffic outside the observed inventory. |
| Claude Code | `reelier coverage --host claude-code --workspace .` | observed-only | Project, user, and plugin registries can be read; the inspected MCP entries were unwrapped, including URL routes with no native stdio wrap path. | Completeness, route enforcement, governed execution, provider outcome, or session-loaded plugins not persisted to disk. |
| Eve | agent-adapter v0 fixture checker | fixture-only | The detached semantic fixture satisfies the universal operation checks. | That Eve produced the fixture, live execution, route enforcement, or a provider outcome. |
| Grok Build | agent-adapter v0 fixture checker | fixture-only | The detached semantic fixture satisfies all seven v0 checks. | That Grok Build produced the fixture, live execution, route enforcement, or a provider outcome. |
| Grok Bot | agent-adapter v0 fixture checker | fixture-only | The detached semantic fixture satisfies all seven v0 checks. | That Grok Bot produced the fixture, live execution, route enforcement, or a provider outcome. |

## Gate status

The aggregate is not passing. No harness currently has authenticated live
governed-execution evidence. `observed`, `fixture-only`, `unchecked`,
`uncovered`, and `not-tested` remain non-success states.

The next evidence required is a detached capture supplied by each actual
harness instance. A capture may be classified as `live-candidate` only when it
comes from that harness's real invocation; the capture checker still does not
authenticate the supplier or prove enforcement. A missing or unsupported
adapter must remain explicitly `not-tested`.

## Substrate gate

The init/up branch is still the blocking substrate gate. The last clean Linux
run exposed an authority convergence timeout and Eve process-cleanup failure;
the init/up session is rerunning after installing the Eve fixture's own
dependencies. GitHub branch and protected-main tests remain deliberately
blocked until that Linux gate is green.
