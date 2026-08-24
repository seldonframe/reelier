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
