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
- `src/authority/host/local.ts`
- `src/authority/host/outcome-kernel-fs-storage.ts`
- `src/authority/host/outcome-kernel.ts`
- `src/authority/host/prepared-dispatch.ts`
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

## Deviations from the plan

- No implementation behavior was broadened beyond tracked amendments. `src/packs/conformance.ts`, `src/authority/host/github-release-runner.ts`, `test/authority/github-release-runner.test.ts`, `test/authority/github-release-serve-fixture.ts`, `src/authority/host/prepared-dispatch.ts`, and `test/acceleration-preflight.test.ts` were touched only after their exact amendments were committed.
- `src/authority/host/prepared-dispatch.ts` became necessary because deterministic GitHub refusals cross two closed dispatch sanitizers. Both now preserve only an inert, non-empty reason bounded to 4096 characters.
- The full suite was run once but produced no terminal aggregate: it hung for more than eleven minutes in the obsolete Task-5 `continuity/eve-kill-resume.test` outcome scenario after the checkpoint scenario completed. Genuine Task4C refuses that raw legacy runtime before the provider boundary, so the fixture's unbounded wait for a provider-fault marker can never settle. Per final direction, the hanging full suite was not rerun.
- Actual packed-consumer execution was unavailable in this clean Windows worktree. `npm pack` correctly refused because `native/bootstrap-helper/manifest.json` and the universal Linux+Windows artifacts are absent. The matching-host builder cannot produce the Linux artifact on Windows; no artifact was fabricated or downloaded. Static package/packed-harness tests passed.

## Test results

### Final build and exact Task4C gates

```text
> reelier@0.32.1 build
> node scripts/build-authority-contract.mjs --check && node scripts/build-bootstrap-contract.mjs --check && tsc -p tsconfig.json && node scripts/build-authority-contract.mjs --copy-schemas && node scripts/build-packs.mjs

built cloudflare_api_token, cloudflare_dns, github_issue_labels, github_release, gmail, gmail_labels, hubspot_slack_information_flow, linear_outcomes, neon_database, slack_channel_topic, stripe, vercel_deployment
ℹ tests 47
ℹ suites 0
ℹ pass 47
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 28313.0594
```

The wider focused Task4C authority/pack/runtime/conformance run also passed 140/140 before the final narrowed rerun.

### Legacy GitHub release compatibility

```text
ℹ tests 66
ℹ suites 0
ℹ pass 66
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 22995.7557
```

### Package and compatibility specs

```text
ℹ tests 32
ℹ suites 0
ℹ pass 31
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 15448.812
```

The skip is the declared `public governed Linux factory evidence` test, which requires an already available Linux Node executor.

### Contract checks

```text
{"v":"reelier.agent-adapter-conformance-report/v0","status":"passed","adapterId":"xai.grok-build",...}
{"v":"reelier.agent-adapter-conformance-report/v0","status":"passed","adapterId":"xai.grok-bot",...}
{"v":"reelier.continuity-adapter-conformance-report/v1","status":"passed","maturity":"reproduced","adapterId":"core",...}
```

`check:outcome-profile-contract` passed. Authority and bootstrap contract checks passed as the first two build steps.

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
