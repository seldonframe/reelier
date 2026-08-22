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
- Installed packed-consumer Operator contract: pass. The published `reelier/operator` barrel
  exposes the model-agnostic harness/session/handoff surface, while `reelier/authority/host`
  exposes the unchanged canonical quartet; no credentials are included.
- The cross-platform CI pack job now runs this same installed-consumer assertion on the downloaded
  authority tarball before native authority tests.
- The packed-consumer script also self-creates and cleans an npm tarball when invoked without an
  argument, so `npm run test:packed-operator-contract` is directly executable on Windows as well
  as in the CI artifact path.
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

The latest full repository suite completed with 3,805 tests: 3,783 passed, 2 failed, and 20 skipped
(exit code 1; approximately 845 seconds). One failure was the Operator help inventory: the source
dispatch set was subsequently corrected to include `operator`, and the targeted compiled help
oracle passes. The remaining failure is the missing universal native bootstrap-helper manifest,
which must be assembled from matching Linux and Windows artifacts by the existing CI matrix and
was not fabricated locally. The certified-dispatch latency-ordering reproducer has been fixed and
its focused native route/latency tests pass. The adapter-contract digest, malformed-init output,
and Windows/Linux host-seam assertions were corrected; their targeted compiled tests pass. The
pinned Eve fixture dependency was installed from its lockfile and the real Eve continuity matrix
passed 10/10 (about 79 seconds). No unsupported skip was added.
The Operator-focused tests and all release gates above passed in the same worktree. No provider,
browser, cloud, billing, or credential action occurred. Managed Cloud Task 0-5 remains an
external prerequisite and is not claimed complete by this OSS slice.
