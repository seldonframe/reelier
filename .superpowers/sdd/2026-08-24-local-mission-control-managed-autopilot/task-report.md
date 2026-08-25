# Local Mission Control + Managed Autopilot implementation report

## Scope and identity

- Reviewed Operator base: `f67729f59229675ca0ea945b1da93e1e50181e6a`.
- Exact production/package implementation head before this report refresh: `b43ff110`.
- Branch: `codex/operator-authority-cell-full`.
- Draft review: `https://github.com/seldonframe/reelier/pull/130`.
- Exact changed-file inventory: `git diff --name-only f67729f59229675ca0ea945b1da93e1e50181e6a..b43ff110`.
- The dirty root checkout was not edited. All work was performed in the isolated Operator and Cloud worktrees.

## Implemented product boundary

- Bare `reelier init` now enters free, accountless Local Mission Control while the pre-existing expert init modes remain available.
- Codex and Claude Code are detected, imported, launched, observed, stopped, and resumed only through bounded, ownership-checked adapters.
- Harness lifecycle, Outcome lifecycle, and attention state remain distinct. A clean agent exit cannot become a reconciled Outcome.
- Local state is an append-only, closed, bounded, root-bound journal with content-addressed independent evidence and deterministic restart reconstruction.
- Imported histories are observe-only and persist no prompts, reasoning, model output, provider bodies, credentials, or raw error text.
- Deterministic attention detects stalls, wall-clock limits, repeated failures, repository drift, missing evidence, and the supported exposed resource limits without authorizing any write.
- Public run options bind explicit token, cost, context-growth, wall-clock, and restart-loop ceilings into durable mission state; exact resume preserves those limits instead of silently widening them.
- The secured loopback board provides current-repository focus, a global switcher, separate state axes, evidence, owned controls, mission launch, and an exception inbox. Its browser capability is fragment-only, ephemeral, origin/CSRF bound, and removed from the URL after load.
- The board exposes elapsed time plus available token/cost/context telemetry and filters independently by harness lifecycle, Outcome lifecycle, attention state, and harness without grading telemetry as authority.
- Exact reviewed external consequences produce one quiet native-or-Autopilot handoff. Local edits do not. The handoff and staged target bundle are signed, expiring, one-shot, target-bound, and contain no prompt or credential.
- Contextual CLI help explains what Managed Autopilot enables only after the user invokes the exact handoff; free Mission Control has no artificial mission cap and no generic upgrade nag.
- Dead journal-owner locks are recovered only after bounded process-liveness proof. Named expert `reelier init <agent>` retains its isolated legacy bootstrap path and never performs the global Mission Control history import.
- Autonomy measurement counts only unique reconciled Outcome references over explicit active human-attention intervals and exports a signed redacted bundle.
- Release identity is `0.33.0-beta.0`; prereleases resolve only to the npm `beta` dist-tag.

## Installed-package proof

An exact tarball was built and installed outside every repository:

- Tarball: `C:\Users\maxim\AppData\Local\Temp\reelier-beta-pack-b43ff110-20260824\reelier-0.33.0-beta.0.tgz`.
- Tarball SHA-256: `DF2CA05269209395DC1799C1CBED9C3EB87268DF6E57A0635E42D38BD9E016F8`.
- Disposable consumer: `C:\Users\maxim\AppData\Local\Temp\reelier-packed-customer-b43ff110-20260824`.
- `npm pack` rebuilt production output before packaging and then verified the universal native artifacts; stale `dist` cannot silently enter this release path.
- The exact `b43ff110` installed package ran `reelier operator doctor` followed by `reelier init --no-open --json` and reported both installed product-ready harnesses, 1,806 imported missions, accountless Local Mission Control, and a loopback board. The independent doctor reported a readable journal and that neither an account nor Cloud was required.
- The installed package exports the Operator, managed handoff, canonical quartet, and genuine host runtime. The canonical quartet remains `reelier_agent_status`, `reelier_outcome_proposal`, `reelier_outcome_request`, and `reelier_outcome_status`.
- The tarball contains the Linux and Windows bootstrap binaries plus the universal native manifest.
- The disposable state audit covered 1,808 files / 1,757,844 bytes and found no prompt, reasoning, model output, provider body, credential, API key, bearer token, authorization header, password, or secret record key.
- A fresh installed-package mission in `C:\Users\maxim\AppData\Local\Temp\reelier-customer1-local-proof-7332fbac` launched the installed Codex harness, created and locally committed only `mission-control-proof.txt` (`57e563b`), and returned `locally-observed` with one independent Git evidence reference. It did not claim a provider Outcome. The real-path run exposed and fixed the public `--harness` parser, two fast-child process races, and Codex's local approval mode before this proof was accepted.
- The packed Operator journals its target-selection secrets before network dispatch. Exact concurrent retries converge on one Cloud rendezvous, and an expired still-pending rendezvous is refreshed only when the exact original poll and browser secrets are presented. A copied or crossed secret refuses. The installed package reopened Customer #1 mission `917a0dd2-0d02-4ced-b44f-245d2d6aa34b` without reminting it; GitHub identity and Linear Connect now succeed, while target selection correctly waits for a project with two bounded issues.

## Verification

- Fresh exact-tree Windows suite at `b43ff110`: 3,884 tests, 3,864 pass, 0 fail, 20 declared platform/prerequisite skips; duration 866,526.519 ms. The previously failing real CLI restart test completes in about five seconds after restoring expert-init isolation.
- Hosted release run `32783992799`, Ubuntu job `97612767233`, completed the supported test command with 3,870 passing tests and no supported-test failure. The job then failed in the separate README badge check because the committed badge still encoded 3,861. The badge update is therefore derived from that immutable hosted run; it is not evidence of a newly skipped or removed test.
- The first Ubuntu release rerun exposed four stale beta-version pins rather than a platform defect: one restart assertion, two portable skill vintages, and the generated Claude plugin manifest. The sources now derive or declare `0.33`, generated packages are synchronized, and the exact focused regression matrix is 14/14 green.
- Production build: exit 0; 12 packs built.
- Production TypeScript: exit 0.
- Test TypeScript: exit 0.
- Real board accessibility checks: semantic landmarks and labels, complete keyboard focus order, visible focus, no current-page console errors, no horizontal overflow at 320 CSS pixels, no interactive target below 44 by 44 CSS pixels, and all normal foreground colors at least 4.5:1 on the mission sheet.
- Board capability disappears from `location.hash` immediately after load; unauthenticated API state remains 401.
- Cross-platform native candidate assembled earlier in the same release line: universal manifest SHA-256 `effa688a2fd215af7379a7569cecad79530e5a6cbf05d98fbe308e94cedd5d38`, Linux binary SHA-256 `42b32b799f1a15d2ac078296222894d4bd8befcb18e3b257a75dd468e44db879`, Windows binary SHA-256 `8e74f4239aafb093cc8087a9022ca33ef260ecbd352789a7d018e5081f8f5c59`.

## Cloud integration state

- Managed Autopilot lives on the separate reviewed Cloud branch and reuses Neon lifecycle authority, passkey activation, Stripe canonical subscription state, exact GitHub/Linear bindings, the seven reviewed definitions, the one-shot Cell authority, brokered execution, authoritative readback, receipts, and no-resend ambiguity recovery.
- Cloud draft review: `https://github.com/seldonframe/reelier-cloud/pull/72`.
- Cloud local gate at implementation head `b86cdd6`: 1,923 tests, 1,921 pass, 0 fail, 2 honest skips; typecheck, production build, and Drizzle check exit 0.
- Live disposable Neon schema gate reports 76 tables / 836 columns and migrations through `0051`. The new catalog gate independently reports 25 expected managed tables, all with forced tenant/trust-domain RLS and 25 scoped policies; no provider write was performed.
- Production deployment `dpl_DouYG788tKhP9QSWff2NpHkPK2cY` is `READY` and aliased to `https://www.reelier.com`; public root, pricing, Autopilot, and DB health probes return 200.
- The fresh `iad` Fly Cell `reelier-autopilot-customer-1-20260824` has one started Machine (`83693ec1476018`, version 16), refuses unauthenticated health with 401, and has the required named secret slots deployed without exposing their values. It remains `certifying`, not `ready`, because no fabricated tenant-scoped activation or provider binding was inserted; authenticated readiness correctly requires the exact tenant and trust-domain lineage.

## Open gates and explicit non-claims

- Exact-head GitHub CI and independent review are still required before merging, tagging, publishing, or promoting the npm prerelease.
- The beta package is built and installed but is not published to npm. No `latest` promotion occurred.
- The exact target-selection rendezvous and local mission compiler are implemented, but Customer #1 still must complete GitHub authentication and the browser payment/provider/passkey ceremony. The disposable GitHub repository contains only the inert pinned base fixture at `e8efa8b49e9bd3dfdcfa1828f27ca90ab098ecd7`; the governed candidate commit `f0028f570c633239ac683207826dcb950707f774` exists locally only and has not been pushed, opened as a PR, merged, released, deployed, or sent to Linear.
- Stripe payment, GitHub/Linear provider writes, Fly Cell promotion to `ready`, and cleanup remain explicit ceremonies. None was simulated or claimed complete.
- No 10x or 100x product claim is made. The implementation can record the measurements, but the matched ten-session, ten-Outcome, and 100-Outcome experiments have not been run.
- Free Mission Control observes only supported local surfaces. Invisible direct shell/provider writes remain unknown coverage, never governed or complete.

## Beta evidence checkpoint — 2026-08-24

This checkpoint supersedes the earlier release-candidate status without changing its historical evidence.

### Exact identities

- Exact tested OSS implementation head: `a3aefe94ab7eaa4dd6aa5f1c0393e7a77a78590e`.
- Exact reviewed Cloud implementation head: `b86cdd63a509529257a90888663e7dedf28fc1ce`.
- OSS review: `https://github.com/seldonframe/reelier/pull/130`.
- Cloud review: `https://github.com/seldonframe/reelier-cloud/pull/72`.
- npm `latest` remains `0.32.0`. No `beta` or `latest` publication was performed.

### Exact beta artifact

- Version: `0.33.0-beta.0`.
- Tarball: `C:\Users\maxim\AppData\Local\Temp\reelier-beta-checkpoint-a3aefe94-20260824\reelier-0.33.0-beta.0.tgz`.
- SHA-256: `DCA08C69A3D7263718E4F843D7AB5EB6D2204C453855FC49D8DF6C653AD0BADD`.
- npm SHA-1: `41ce48b7f1bda5cc2cb91bd78e30133c348e016a`.
- npm integrity: `sha512-F7drKpUnKqCmMOyX8egkP6sUmsNcEko68XrJPFVz/g0Fer7vCzFIE2oOkGEnkMOA7o+0r4Vt2z5GKkt+aLQS2g==`.
- Disposable installed consumer: `C:\Users\maxim\AppData\Local\Temp\reelier-beta-install-a3aefe94-20260824`.
- The installed package reports Local Mission Control ready, detects Codex and Claude Code, imports 1,806 missions, requires neither an account nor Cloud, and reconstructs a readable journal.
- The installed `reelier init --no-open --json` result is `ready`; the state audit covered 1,808 files / 1,757,841 bytes and found none of the forbidden prompt, reasoning, model-output, provider-body, credential, API-key, bearer, authorization, password, or secret record keys.

### Independently demonstrated capabilities

- The exact Cloud head is green across browser, unit/build, four mutation partitions, test, and Vercel deployment checks.
- The live disposable Neon schema contains 76 tables / 836 columns; the catalog proof found 25/25 expected managed tables with forced tenant/trust-domain RLS and scoped policies.
- The fresh `iad` Fly Cell refuses unauthenticated health and remains honestly `certifying` because no tenant activation or provider binding was fabricated.
- The exact OSS head builds and packs the universal Windows/Linux native bootstrap artifacts, authority host boundary, public authority-factory evidence, Operator exports, canonical quartet, and managed handoff.
- Hosted Windows CI is green on the exact OSS head. Linux-container repetitions passed the N100 convergence gate three times and the complete Path C continuity file five times; the exact cut-after-apply scenario passed six focused repetitions.

### Hosted Linux residual and RC decision

- Hosted run `https://github.com/seldonframe/reelier/actions/runs/32795171216` is not a clean release gate.
- Its first Ubuntu attempt cancelled the isolated N100 convergence test at the 120-second test ceiling. The same exact build passed that gate on rerun and in three Linux-container repetitions in approximately 25–27 seconds.
- The rerun then completed the ordinary suite with 3,885 tests: 3,877 pass, 1 fail, 7 honest skips. The sole failure was `cut-after-apply failure counters expose real effects without duplicate action` after 30.122 seconds.
- The failure was fail-closed: one Outcome request, zero reservations, zero provider dispatches, and zero status reads. It did not duplicate or authorize an effect, but it failed to reach the intended crash boundary.
- Because the exact hosted Linux gate is retry-dependent, `0.33.0-beta.0` is an installable candidate, not a stable beta RC, and must not be published yet.

### Product-direction reconciliation

- The new GitHub-first direction does not conflict with completed RLS, journal, recovery, telemetry, exception, bounded-authority, credential-isolation, reconciliation, or four-state-honesty work.
- It supersedes the current first-user activation sequence that requires `github-selected -> linear-connected -> harness-linked`, and it supersedes treating the five-effect GitHub+Linear composite as the first customer proof.
- Linear remains a reviewed optional expansion. It must not block the first activation, first checked provider Outcome, or initial Codex/Claude cohort.

### Smallest completion path from this checkpoint

1. Make the Linux continuity gate deterministic without skipping it or weakening its zero-duplicate/zero-unauthorized-effect assertions.
2. Add a GitHub-only onboarding transition and a three-effect GitHub pack using the already reviewed candidate, PR, and exact-SHA merge definitions; preserve the seven-definition inventory for optional Linear use.
3. Complete one tenant-scoped activation and one authoritative GitHub Outcome with provider readback, receipt publication, and zero duplicate or unauthorized effects.
4. Pack, install, and publish the exact artifact only to the npm `beta` tag. Leave `latest` unchanged.
5. Freeze features except for activation blockers, false Outcome claims, unauthorized/duplicate-effect risks, crashes, or defects that materially increase supervision.
6. Run a no-help external Codex/Claude cohort on user-owned repositories and measure accepted Outcomes per active human minute, including setup, prompting, approval, checking, review, and rescue.

### Still absent

- No ready tenant-scoped managed Cell.
- No completed real GitHub provider Outcome.
- No npm beta publication.
- No no-help external user activation or repeat-use evidence.
- No measured reduction in active human attention and no 10x or 100x claim.

## Final bounded checkpoint — hosted RC foundation

This section supersedes only the earlier hosted-Linux residual and RC decision. It does not supersede the explicit product non-claims above.

### Exact tested identities

- Exact OSS implementation and evidence head: `e03482b521b3830ab99a0d9d14acb43bb860e42a`.
- Exact Cloud implementation head remains `b86cdd63a509529257a90888663e7dedf28fc1ce`.
- Exact hosted OSS run: `https://github.com/seldonframe/reelier/actions/runs/32798819294`.
- Every job in that run passed: Windows and Linux native builds, universal artifact assembly, packed authority boundary, public authority-factory evidence, Windows client tests, and Ubuntu host tests.
- Ubuntu aggregate: 3,887 tests; 3,880 pass; 0 fail; 7 declared skips; duration 531,219.943218 ms. The committed README badge independently matches the captured immutable test artifact.

### Linux continuity root cause and bounded repair

- The earlier hosted failure occurred before any durable reservation or provider dispatch. It was fail-closed but prevented the crash-boundary test from reaching its intended effect.
- Path C ingress now retries a runner failure at most once and only when refreshed durable truth still reports zero budget reservations and zero provider dispatches.
- Once either a reservation or provider dispatch exists, ingress never performs an internal retry. Existing post-budget and post-apply scenarios assert one runner attempt for the failed request; a later explicit client retry remains a distinct second attempt and reconciles without a duplicate provider action.
- Deterministic RED/GREEN tests cover transient pre-dispatch recovery and bounded persistent pre-dispatch refusal. Linux-container repetitions passed the complete Path C file five times before the exact hosted matrix passed.

### Exact installed beta checkpoint artifact

- Version: `0.33.0-beta.0`.
- Tarball: `C:\Users\maxim\AppData\Local\Temp\reelier-beta-rc-e03482b5-20260824\reelier-0.33.0-beta.0.tgz`.
- SHA-256: `AD1481B9DE25120AD2AFCC82F7A7415AF9BD8119A7AF6B17EF1BE1E01A82256D`.
- npm SHA-1: `6626c331248e551c28265b878974f58cb0a58645`.
- npm integrity: `sha512-QQf7qll4YTTAZTf7r4nbpG4iI4bC8QT/LdmpP0VPUbxvqnkX+8LffxBPboo0l7+17+uPyPyrdtMuu0ptm9UFGQ==`.
- Packed size: 1,777,503 bytes; unpacked size: 6,633,918 bytes; 743 entries.
- Disposable consumer: `C:\Users\maxim\AppData\Local\Temp\reelier-beta-customer-e03482b5-20260824`.
- The installed package reports Mission Control ready, detects Codex and Claude Code, imports 1,806 missions, reconstructs a readable journal, and requires neither an account nor Cloud.
- Its generated state contains 1,808 files / 1,757,842 bytes and zero forbidden prompt, reasoning, model-output, provider-body, credential, API-key, bearer, authorization, password, or secret record keys.
- The installed package exposes the Operator, signed managed handoff, canonical authority tools, reviewed host runtime, and matching Windows/Linux native artifacts.
- npm `latest` remains `0.32.0`. This tarball was not published to either `beta` or `latest`.

### Product-direction checkpoint

- Completed RLS, journal, recovery, telemetry, exception routing, bounded authority, provider reconciliation, credential isolation, and four-state honesty work remains aligned with the narrowed product direction.
- The one current conflict is onboarding composition: the Cloud state machine still requires Linear before harness linking, while the first real-user proof must be GitHub-only.
- The smallest next product change is a closed GitHub-only onboarding transition and three-effect pack using the reviewed candidate-publish, PR-ensure, and exact-SHA-merge definitions. Linear remains optional and the reviewed seven-definition inventory remains intact.
- After that change, the next acceptance boundary is one tenant-scoped authoritative GitHub Outcome with matching provider readback, receipt publication, zero duplicate effects, and zero unauthorized effects.
- Only after that Outcome should this candidate be published under the npm `beta` tag. `latest` must remain unchanged.

### Still absent at this final checkpoint

- No GitHub-only managed onboarding path.
- No ready tenant-scoped managed Cell.
- No completed authoritative GitHub provider Outcome.
- No npm beta publication.
- No no-help Codex/Claude external-user activation, repeat use, or measured accepted-Outcomes-per-active-human-minute improvement.

## GitHub-only customer-entry checkpoint — 2026-08-25

This section supersedes the earlier beta artifact and the statement that the packaged Operator still requires Linear. It does not supersede any absent real-provider or external-user Outcome.

### Product-direction compatibility

- The narrowed GitHub-first direction does not conflict with the durable journal, crash recovery, bounded authority, credential isolation, four-state honesty, reconciliation, exception routing, or attention telemetry already implemented.
- The actual conflict was at the customer entry point: Cloud accepted the GitHub-only v3 target, but `reelier operator autopilot` still opened mandatory Linear target selection and compiled the seven-definition v2 bundle.
- The packaged Operator now compiles and signs the same closed GitHub-only v3 target Cloud accepts: candidate publish, PR ensure, exact-SHA merge, maximum three writes, no Linear target, and no Linear authority.
- The existing seven-definition compiler remains available for the optional GitHub+Linear expansion. No reviewed ABI, definition alias, or seven-definition pack digest changed.

### Exact implementation and release-candidate evidence

- RED commit: `797b687e0b80d7e5c6056ee9d280898d44ac7b61`.
- GREEN implementation head: `90858491863613beeaccf5d534c36610b822bd77`.
- Exact release-candidate package head: `9f91fb56351990b4497002202b26740f56bc7267` (the implementation head plus the independently reproduced Linux badge correction).
- Focused GitHub-only parsing, compilation, staging, handoff, and CLI tests: 22 pass, 0 fail.
- Packed-consumer contract: pass; an installed package exposes the GitHub-only compiler, parses the v3 target, proves exactly three writes, and has no Linear field.
- Exact full local aggregate: 3,890 tests; 3,870 pass; 0 fail; 20 explicit platform/prerequisite skips; duration 776,587.4962 ms.
- Exact-head hosted CI: [run 32807161506](https://github.com/seldonframe/reelier/actions/runs/32807161506), attempt 2, success. Linux and Windows native builds, universal assembly, packed Authority boundary, public factory evidence, Windows tests, and Ubuntu tests all passed.
- Ubuntu aggregate from the exact hosted artifact: 3,890 tests; 3,883 pass; 0 fail; 0 cancelled; 7 explicit skips; duration 527,933.950247 ms. The README badge check passed against that same artifact.
- Attempt 1 reached 2,313 passes with 0 assertion failures before the CI wrapper terminated it at 20 minutes (`exit 124`); rerunning only the failed Ubuntu job on the same commit completed successfully. No timeout or test scope was changed.
- Exact-head DeepSec: [run 32807161518](https://github.com/seldonframe/reelier/actions/runs/32807161518), success.
- Fresh tarball: `C:\Users\maxim\AppData\Local\Temp\reelier-beta-rc-9f91fb56-20260825\reelier-0.33.0-beta.0.tgz`.
- SHA-256: `57CF4CD183A412A731F8B17CE78DEEA1382C5A6DDE27083CBA4771B0271619BA`.
- npm SHA-1: `deec20e3ef66264b83c598423161b66b7d584a1e`.
- npm integrity: `sha512-ggKvaw6wGpGZjKGT+qlk0MMEfu10AxuACjI5YcUjZuzX//GKSU6WCr6zy/7m7Kf5LTZtFib4QsCIA6PSX4wwzg==`.
- Packed size: 1,778,139 bytes; unpacked size: 6,639,331 bytes; 743 entries.
- Disposable install: `C:\Users\maxim\AppData\Local\Temp\reelier-beta-installed-9f91fb56-20260825`.
- The installed binary reported `0.33.0-beta.0`, detected Codex and Claude Code, imported 1,806 missions, returned accountless `ready`, and bound its board to loopback.
- The installed state audit covered 1,808 files / 1,757,863 bytes and found zero forbidden prompt, reasoning, model-output, provider-body, credential, API-key, bearer, authorization, password, or secret fields. The exact test-owned loopback board process was stopped and its port released.
- npm `latest` remains outside this ceremony. This artifact has not been published to either `beta` or `latest`.

### Remaining beta proof, deliberately not inferred

- No tenant-scoped Cell is Ready.
- No real GitHub provider Outcome, authoritative provider readback, receipt, or offline-verified real-user reconciliation exists.
- No no-help Codex/Claude cohort has activated or repeated the product.
- Accepted Outcomes per active human minute has not been measured, so no 10x or 100x claim is supported.
