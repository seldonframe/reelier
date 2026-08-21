# Files changed

- `.superpowers/sdd/2026-08-21-genuine-governed-outcome-composition/task-4c-brief.md`
- `docs/superpowers/plans/2026-08-21-genuine-governed-outcome-composition.md`
- `scripts/build-packs.mjs`
- `src/authority/gate.ts`
- `src/authority/governed-effect-commitment.ts`
- `src/authority/host/dispatch.ts`
- `src/authority/host/effect-transports.ts`
- `src/authority/host/github-linear-mission-runtime.ts`
- `src/authority/host/github-release-runner.ts`
- `src/authority/host/governed-outcome-composition.ts`
- `src/authority/host/index.ts`
- `src/authority/host/linear-outcome-runner.ts`
- `src/authority/host/local.ts`
- `src/authority/host/outcome-kernel-fs-storage.ts`
- `src/authority/host/outcome-kernel.ts`
- `src/authority/host/prepared-dispatch.ts`
- `src/authority/host/receipts.ts`
- `src/authority/pack.ts`
- `src/authority/packs/github-linear-outcomes.ts`
- `src/packs/conformance.ts`
- `src/packs/github-release/compile.ts`
- `src/packs/index.ts`
- `src/packs/linear-outcomes/compile.ts`
- `src/packs/linear-outcomes/index.ts`
- `src/packs/linear-outcomes/manifest.ts`
- `src/packs/linear-outcomes/reconcile.ts`
- `src/packs/linear-outcomes/source.ts`
- `test/acceleration-preflight.test.ts`
- `test/authority/dispatch-coordinator.test.ts`
- `test/authority/effect-transports.test.ts`
- `test/authority/gate.test.ts`
- `test/authority/github-linear-mission-runtime.test.ts`
- `test/authority/github-linear-outcomes.test.ts`
- `test/authority/github-release-runner.test.ts`
- `test/authority/github-release-serve-fixture.ts`
- `test/authority/governed-effect-commitment.test.ts`
- `test/authority/governed-outcome-composition.test.ts`
- `test/authority/linear-outcomes-pack.test.ts`
- `test/authority/outcome-kernel-fs-storage.test.ts`
- `test/authority/outcome-kernel.test.ts`
- `test/packs/conformance.test.ts`
- `test/packs/github-release.test.ts`
- `.superpowers/sdd/2026-08-21-genuine-governed-outcome-composition/task-4c-report.md`

## What changed

### Tracked scope

- `.superpowers/sdd/2026-08-21-genuine-governed-outcome-composition/task-4c-brief.md` and `docs/superpowers/plans/2026-08-21-genuine-governed-outcome-composition.md` record the exact scope amendments for Linear conformance inventory, prepared fallback forwarding, executable release fixture, prepared refusal preservation, and generated pack inventory assertions.

### Phase 1: durable ledger commitment join

- `src/authority/governed-effect-commitment.ts` adds the closed canonical `GovernedEffectCommitmentV1`. Its digest binds definition alias, signed Path-C contract digest, Task-4 tool-effect contract digest, transport-binding digest, compiled-effect-input digest, request/model commitment, operation kind, and reviewed policy/pack/definition digests.
- `src/packs/github-release/compile.ts` emits that commitment from verified signed compiler inputs. Existing GitHub policy/effect behavior remains compatible; callers cannot supply the commitment directly.
- `src/authority/gate.ts` exposes only genuine, newly accepted, gate-keyed reservation authority and current-authority revalidation. Exact-existing remains redacted/readback-only and never receives a reminted handle.
- `src/authority/pack.ts` and `src/authority/packs/github-linear-outcomes.ts` carry the reviewed Task-4 contract/binding metadata needed to rederive the join.
- `test/authority/governed-effect-commitment.test.ts`, `test/authority/gate.test.ts`, and `test/packs/github-release.test.ts` pin closed parsing, substitution refusal, genuine gate authority, and full restart rederivation from canonical ledger effect bytes without WeakMap authority.

### Phase 2: prepared coordinator authority and publication

- `src/authority/host/dispatch.ts` passes one exact coordinator call through prepare, revokes it in `finally`, revalidates current admitted authority before commit/send, resolves only exact durable coordinator publication heads, sequences publication before terminal transitions, and retains legacy one-argument adapters. Immediate prepared readback runs only for absent/`not-attempted` reconciliation, so already matched release results are not degraded.
- `src/authority/host/prepared-dispatch.ts` retains a bounded inert deterministic refusal reason through the same closed prepared outcome boundary. This preserves existing GitHub refusal semantics; no other provider field was opened.
- `src/authority/host/effect-transports.ts` binds the original Path-C coordinator call before host-binding or provider access and uses the exact compiled contract/reservation authority.
- `src/authority/host/github-release-runner.ts` forwards the optional coordinator call only through its prepared fallback. The coordinator publication wrapper remains the sole terminal publication authority; runner journals never substitute for it.
- `src/authority/host/outcome-kernel.ts` accepts only opaque governed kernel authority, verifies the durable join, and adopts exact terminal Outcome/receipt identity without verifier rerun or rewrite. The legacy equal-digest path remains available when governed authority is absent.
- `src/authority/host/outcome-kernel-fs-storage.ts` adds signed-journal lifecycle indexing while delegating verified receipt authority to the coordinator head.
- `test/authority/dispatch-coordinator.test.ts`, `test/authority/effect-transports.test.ts`, `test/authority/github-release-runner.test.ts`, `test/authority/outcome-kernel.test.ts`, and `test/authority/outcome-kernel-fs-storage.test.ts` pin call lifecycle, current-authority timing, publication ordering, bounded refusal compatibility, exact terminal adoption, index-only journals, and recovery without resend.

### Phase 3: signed Linear pack and exact governed profile

- `src/packs/linear-outcomes/manifest.ts`, `compile.ts`, `source.ts`, `reconcile.ts`, and `index.ts` add the signed Path-C `linear_evidence_comment_v1` and `linear_status_transition_v1` definitions. Status binds the exact verified comment predecessor and durable receipt requirement.
- `src/packs/index.ts`, `src/packs/conformance.ts`, and `scripts/build-packs.mjs` register the Linear pack, exact two aliases, and source inventory.
- `src/authority/host/governed-outcome-composition.ts` and `src/authority/packs/github-linear-outcomes.ts` admit only the exact ordered five-alias profile and compatible reviewed GitHub repository plus Linear workspace/team/project/issue scope.
- `src/authority/host/index.ts` exports the supported composition roots.
- `test/authority/linear-outcomes-pack.test.ts`, `test/authority/governed-outcome-composition.test.ts`, `test/authority/github-linear-outcomes.test.ts`, `test/packs/conformance.test.ts`, and `test/acceleration-preflight.test.ts` pin the exact five aliases, two Linear definitions, twelve unique generated pack manifests, GitHub's four-alias exception, Linear's two-alias exception, and single-definition status for every other pack.

### Phase 4: genuine runtime and restart

- `src/authority/host/local.ts` exposes the genuine admitted local Cell components used by the composition while preserving the ordinary single-definition default.
- `src/authority/host/github-linear-mission-runtime.ts` removes the fake runtime ledger, direct structural handles, unconditional authorization, self-created activation, raw authority input, and generic provider. It composes the signed local Cell, real gate, `FsAuthorityLedger`, prepared coordinator/publication, governed Outcome kernel, branded GitHub executor, concrete Linear executor, and exact predecessor policy.
- Runtime execution is sequential: candidate, pull request, merge, comment, status. Every effect receives its own genuine gate reservation and coordinator receipt publication. An ambiguous merge stops before Linear reservation. Restart recreates runtime, journal, runner, and Cell composition; exact merge reconciliation is readback-only, performs no second merge write, then unlocks comment and status.
- Reconciled restart adoption requires all three authorities: rederived canonical ledger commitment, indexed signed verified Outcome, and exact coordinator terminal head whose receipt equals the ledger result digest. It never reruns the verifier and never rewrites Outcome or receipt identity.
- `test/authority/github-release-serve-fixture.ts` adds only an opt-in executable candidate with real signed bytes/digests; default fixture behavior is unchanged.
- `test/authority/github-linear-mission-runtime.test.ts` proves raw legacy refusal before filesystem/provider access, a primary Linear-only mission with exactly two writes and two authoritative reads plus zero GitHub runner calls/reservations, and the full five-definition candidate→PR→ambiguous merge→recreate/readback→comment→status path with exactly one merge write.

### Independent-review fix round

- `src/authority/host/outcome-kernel.ts` and `src/authority/host/github-linear-mission-runtime.ts` require all five Outcomes and their exact coordinator publication heads to be verified. A later success cannot overwrite an earlier failed or partial effect, and restart after the Linear comment preserves the exact verified predecessor only through the coordinator head.
- `src/authority/host/effect-transports.ts`, `src/authority/host/github-release-runner.ts`, and `src/authority/host/linear-outcome-runner.ts` bind branded execution to the durable request ID, governed effect digest, exact coordinator call, reviewed contract/binding, and canonical release-pack membership. The runtime uses only the branded GitHub and Linear executors; the generic GitHub verifier/provider path is absent. Legacy generic transports retain their exact three-field conditional authority shape, but branded paths refuse it before provider access.
- The GitHub model request ID must equal the authenticated durable request ID. The coordinator delegate separately binds reservation ID and governed effect digest; reservation identity is never substituted for model identity. Candidate, pull request, merge, Linear comment, and Linear status each consume their own exact coordinator call. Status additionally consumes the exact predecessor arm without confusing it with the comment call.
- `src/authority/host/dispatch.ts` revalidates the same signed gate authority before prepare, after prepare/host resolution, after budget consumption immediately before prepared CAS, and again after CAS/publication immediately before send. The late-revocation falsifier records zero provider calls.
- `src/authority/gate.ts` exposes an opaque readback-only recovery linkage for an accepted reservation that crashed before indexing. Restart reconstructs it only from durable ledger intent, signed decision index, ingress linkage, current signed authority, and contract; it neither exposes a handle nor remints or sends. If no provider write crossed the boundary, genuine coordinator recovery cancels the orphan and records an honest terminal non-success, so retries converge instead of remaining pending.
- `src/authority/host/receipts.ts`, `src/authority/host/governed-outcome-composition.ts`, and `src/authority/host/local.ts` closure-bind exact publication readback to the publisher-specific factory captured by the local coordinator composition. A second genuine publisher/root, a copied or cloned factory, a duck-typed resolver/query, and a substituted readback capability cannot resolve or authorize the first publisher's head. The coordinator publication head remains the sole verified authority; journals remain indexes only.
- `test/authority/github-linear-outcomes.test.ts` gives every intended branded-success reservation its authenticated durable request ID. The direct legacy-envelope comment/status probes remain deliberately unbranded and prove zero provider writes.

### Final-review fix round

- `src/authority/gate.ts` transfers a mandatory, closure-bound governed revalidator with the accepted reservation handle. `src/authority/host/dispatch.ts` invokes that same authority after asynchronous prepare/host resolution, immediately before prepared CAS, and again after CAS/publication immediately before send. Certified HTTPS identity remains a separate check. A composed-runtime revocation during host resolution leaves the exact reservation `reserved` with `sendStarted: false` and records zero provider calls.
- `src/authority/host/local.ts` reloads the current deployment through the same externally pinned Job Card trust material for every revalidation, requires the original tenant and signed Job Card identity, and therefore observes deployment revocation rather than trusting the activation-time snapshot.
- `src/authority/host/receipts.ts` writes durable receipt nodes as root-bound v2 preimages containing a stable digest of the resolved publication root. Reopening the same root preserves restart/no-resend behavior; copying a valid chain to a different genuine root refuses. Legacy v1 nodes fail closed without silent rewrite.
- `src/authority/host/effect-transports.ts` preserves legacy executor authority as exactly three fields (`contractDigest`, `bindingDigest`, `reservationId`) and introduces a distinct opaque governed authority with exactly two additional fields (`requestId`, `governedEffectDigest`). GitHub and Linear branded executors require the governed seam; generic or legacy compilation cannot infer it from a request ID.
- `src/authority/host/github-linear-mission-runtime.ts` records honest terminal mission failure and stops all later reservations after deterministic candidate, pull-request, or comment refusal. Candidate stops after one blob attempt; PR stops after one candidate plus one PR attempt; comment completes the three GitHub effects then stops after one comment attempt; every case makes zero later writes.
- All five branded writes refuse direct, copied, and replayed coordinator calls without unintended provider access. Accepted-before-index recovery cancels only the exact opaque-linked orphan; an unrelated genuine reserved reservation retains its exact byte/state digest.
- Sequential status execution presents the already verified comment request to the kernel for read-only durable adoption. The predecessor verifier is a throwing falsifier, the adopted receipt ref must exactly equal the original ref, and provider counters prove only the status send is new. No predecessor verifier rerun, receipt rewrite, remint, or comment resend is possible.

Final-review RED/GREEN commits from immutable `18f60a5e` are: `479aa54c`, `482f4dff`, `bf2308cf`, `a1163c54`, `544ff254`, `64170428`, `399de048`, `b10bc82a`, `d4e4540b`, `2987652b`, `66c88b60`, `d83deb81`, `4a3fbb6e`, `f4ae419a`, `3d934c3d`, `03de7acf`, `13d02f34`, and `c7001780`.

## Deviations from the plan

- No implementation behavior was broadened beyond tracked amendments. `src/packs/conformance.ts`, `src/authority/host/github-release-runner.ts`, `test/authority/github-release-runner.test.ts`, `test/authority/github-release-serve-fixture.ts`, `src/authority/host/prepared-dispatch.ts`, and `test/acceleration-preflight.test.ts` were touched only after their exact amendments were committed.
- `src/authority/host/prepared-dispatch.ts` became necessary because deterministic GitHub refusals cross two closed dispatch sanitizers. Both now preserve only an inert, non-empty reason bounded to 4096 characters.
- The full suite was run once but produced no terminal aggregate: it hung for more than eleven minutes in the obsolete Task-5 `continuity/eve-kill-resume.test` outcome scenario after the checkpoint scenario completed. Genuine Task4C refuses that raw legacy runtime before the provider boundary, so the fixture's unbounded wait for a provider-fault marker can never settle. Per final direction, the hanging full suite was not rerun.
- Actual packed-consumer execution was unavailable in this clean Windows worktree. `npm pack` correctly refused because `native/bootstrap-helper/manifest.json` and the universal Linux+Windows artifacts are absent. The matching-host builder cannot produce the Linux artifact on Windows; no artifact was fabricated or downloaded. Static package/packed-harness tests passed.
- One verification command initially invoked the parameterized `check:agent-adapter` script without its required candidate argument. It correctly returned the machine-readable usage failure `usage: check.mjs <candidate.json>`. The two repository-pinned candidates were then supplied explicitly and both passed; this was an invocation correction, not an implementation change.

## Test results

### Final focused Task4C gate

```text
ℹ tests 150
ℹ suites 0
ℹ pass 150
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 53892.4582
```

This gate covers the gate, prepared coordinator, governed and legacy transport seams, root-bound receipts, governed publication, Outcome kernel, full signed composite and Linear-only runtimes, reviewed GitHub/Linear packs, and shared pack conformance. The publication adversaries prove publisher/root B, copied chains, factory clones/copies, and substituted resolver/query capabilities cannot adopt publisher/root A's terminal head.

### Final build and complete scoped Task4C gates

```text
> reelier@0.32.1 build
> node scripts/build-authority-contract.mjs --check && node scripts/build-bootstrap-contract.mjs --check && tsc -p tsconfig.json && node scripts/build-authority-contract.mjs --copy-schemas && node scripts/build-packs.mjs

built cloudflare_api_token, cloudflare_dns, github_issue_labels, github_release, gmail, gmail_labels, hubspot_slack_information_flow, linear_outcomes, neon_database, slack_channel_topic, stripe, vercel_deployment
```

Both `npx tsc -p tsconfig.test.json` and `npx tsc -p tsconfig.json` exited 0 with no diagnostics. `npm run build` passed, and a separate `node scripts/build-packs.mjs` produced the same exact twelve-pack inventory.

The generated-pack acceleration preflight passed freshly:

```text
ℹ tests 9
ℹ pass 9
ℹ fail 0
ℹ skipped 0
ℹ duration_ms 12169.8699
```

### Legacy GitHub release compatibility

```text
ℹ tests 66
ℹ suites 0
ℹ pass 66
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 27330.7046
```

### Package and compatibility specs

```text
ℹ tests 58
ℹ suites 0
ℹ pass 58
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2919.4185
```

This fresh set covers package exports, authority/profile/bootstrap package contracts, agent-adapter conformance, continuity conformance, and the core continuity package. The separately documented universal packed-consumer limitation remains unchanged because its Linux artifact prerequisite is unavailable on this Windows host.

### Contract checks

```text
{"v":"reelier.agent-adapter-conformance-report/v0","status":"passed","adapterId":"xai.grok-build",...}
{"v":"reelier.agent-adapter-conformance-report/v0","status":"passed","adapterId":"xai.grok-bot",...}
{"v":"reelier.continuity-adapter-conformance-report/v1","status":"passed","maturity":"reproduced","adapterId":"core",...}
```

Fresh, separate `check:authority-contract`, `check:bootstrap-contract`, and `check:outcome-profile-contract` invocations passed. The first zero-argument adapter invocation returned only the documented usage failure; the correctly parameterized `grok-build-observed.json`, `grok-bot-observed.json`, and `core-candidate.mjs` checks produced the passing reports above.

### Full-suite honest result

No aggregate exists because the single run hung in `continuity/eve-kill-resume.test` and was terminated. Before the hang, the observed non-Task4C failures were:

- Three `test/authority-runtime.test.ts` cases and two `test/authority/host-server.test.ts` cases: `AUTHORITY_CELL_LINUX_REQUIRED` on this Windows host.
- `test/authority/certification-lifecycle-authority.test.ts`: stale pinned adapter-contract digest (`7f46…` expected, current `cd09…`).
- `test/bootstrap-build-identity.test.ts`: missing universal native bootstrap manifest.
- `test/continuity/eve-binding-static.test.ts`: stale schema expectation omits the canonical `outcomeRef` field.
- `test/continuity/eve-governed-outcomes.test.ts`: obsolete raw Task-5 runtime options now correctly refuse before effects.
- `test/continuity/eve-kill-resume.test.ts`: obsolete raw Task-5 outcome path waits indefinitely for an unreachable provider-fault marker.

The initially stale generated pack count/predicate failure was fixed under amendments and is now green 9/9 in `test/acceleration-preflight.test.ts`.

## Open risks

- Task 5 must replace its Eve runtime construction with the genuine signed five-definition fixture before its recovery and native-action tests can resume. Its waits also need a bounded terminal failure so a pre-effect refusal cannot hang the full suite.
- The universal packed-consumer gate still needs the CI-built Linux and Windows native bootstrap artifacts. Run it in the existing matrix/assembly job; local Windows cannot honestly reproduce that universal prerequisite alone.
- The unrelated Windows platform-seam and stale adapter-digest assertions listed above remain outside Task4C scope.
- No external provider write, network publication, push, merge, tag, or release was performed.
