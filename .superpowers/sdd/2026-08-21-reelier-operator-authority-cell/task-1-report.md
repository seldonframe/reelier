# Operator + Authority Cell implementation report

This implementation adds the first local Operator vertical without creating a second authority
protocol: a closed Codex / Claude Code / Grok Build registry, atomic non-secret workspace state,
one-command onboarding, bounded harness process adapters, a local supervisor, restart-safe redacted
session metadata, a genuine-runtime bridge, and provider-neutral managed/customer-hosted handoff
and usage contracts. The Operator cannot mint authority, select provider accounts, access
credentials, or claim a verified Outcome. Local completeness remains `unchecked` until the existing
Cell returns an authoritative receipt.

Verification on the reviewed OSS authority base:

- Operator-focused tests: 22/22 pass.
- Genuine Task4C runtime: 5/5 end-to-end tests pass.
- Grok Build agent-adapter conformance: 7/7 checks pass.
- Core continuity-adapter conformance: 10/10 checks pass; maturity remains `reproduced`.
- Outcome-profile contract: pass.
- Production and test TypeScript builds: pass.
- Pack generation and authority/bootstrap contracts: pass.
- Operator-evidence acceleration preflight: four controlled commands, all exit code 0.
- `git diff --check`: pass.

The process adapter emits only event digests; it does not persist prompt text, model output,
provider bodies, credentials, or environment values. The supervisor keeps harness lifecycle and
Cell lifecycle separate: a clean harness exit is not a successful Outcome, and a refused Cell
result remains refused. Session persistence stores only request IDs, prompt digests, harness/Cell
lifecycle labels, and optional receipt references. Recreating a supervisor returns that redacted
state read-only; it does not relaunch a harness, resend an Outcome, or mint authority.

The local Cell module is an adapter over an already-created genuine Cell runtime, including an
explicit bridge for `createGitHubLinearMissionRuntimeV1`; it does not introduce a parallel ledger,
generic executor, or receipt store. Evidence and review calls remain delegated to that runtime.

The managed handoff is intentionally not Cloud OAuth or billing. It is a one-shot signed contract
containing only opaque provider-account and authority/contract references. Vercel Connect, AWS,
Vault, Cloudflare, and enterprise IAM remain replaceable credential backends owned by the managed
or customer-hosted executor. Initial plan constants are provider-neutral: free local, $49 managed
Personal (10 concurrent executions), $299 managed Team (50), and Enterprise customer-hosted.
Receipts are never metered.

The full repository suite completed with 3,793 tests: 3,759 passed, 12 failed, and 22 skipped
(exit code 1; approximately 564 seconds). The failures are outside this Operator slice and are
the known Windows/Linux Authority Cell host checks, a certification digest expectation, native
route latency ordering, the missing universal native bootstrap-helper manifest, an installed Eve
fixture dependency/health prerequisite, and related pre-existing continuity/platform assertions.
The Operator-focused tests and all release gates above passed in the same worktree. No provider,
browser, cloud, billing, or credential action occurred. Managed Cloud Task 0-5 remains an
external prerequisite and is not claimed complete by this OSS slice.
