# Local Mission Control + Managed Autopilot implementation report

## Scope and identity

- Reviewed Operator base: `f67729f59229675ca0ea945b1da93e1e50181e6a`.
- Exact production/package source head: `225893a4`.
- Branch: `codex/operator-authority-cell-full`.
- Draft review: `https://github.com/seldonframe/reelier/pull/130`.
- Exact changed-file inventory: `git diff --name-only f67729f59229675ca0ea945b1da93e1e50181e6a..225893a4`.
- The dirty root checkout was not edited. All work was performed in the isolated Operator and Cloud worktrees.

## Implemented product boundary

- Bare `reelier init` now enters free, accountless Local Mission Control while the pre-existing expert init modes remain available.
- Codex and Claude Code are detected, imported, launched, observed, stopped, and resumed only through bounded, ownership-checked adapters.
- Harness lifecycle, Outcome lifecycle, and attention state remain distinct. A clean agent exit cannot become a reconciled Outcome.
- Local state is an append-only, closed, bounded, root-bound journal with content-addressed independent evidence and deterministic restart reconstruction.
- Imported histories are observe-only and persist no prompts, reasoning, model output, provider bodies, credentials, or raw error text.
- Deterministic attention detects stalls, wall-clock limits, repeated failures, repository drift, missing evidence, and the supported exposed resource limits without authorizing any write.
- The secured loopback board provides current-repository focus, a global switcher, separate state axes, evidence, owned controls, mission launch, and an exception inbox. Its browser capability is fragment-only, ephemeral, origin/CSRF bound, and removed from the URL after load.
- Exact reviewed external consequences produce one quiet native-or-Autopilot handoff. Local edits do not. The handoff and staged target bundle are signed, expiring, one-shot, target-bound, and contain no prompt or credential.
- Autonomy measurement counts only unique reconciled Outcome references over explicit active human-attention intervals and exports a signed redacted bundle.
- Release identity is `0.33.0-beta.0`; prereleases resolve only to the npm `beta` dist-tag.

## Installed-package proof

An exact tarball was built and installed outside every repository:

- Tarball: `C:\Users\maxim\AppData\Local\Temp\reelier-beta-pack-0.33.0-beta.0-225893a4\reelier-0.33.0-beta.0.tgz`.
- Tarball SHA-256: `604c85f6f440b111d4dc3a1a775326957e0dd7151fdb438dd74c8f108510a24b`.
- Disposable consumer: `C:\Users\maxim\AppData\Local\Temp\reelier-packed-customer-225893a4-20260824`.
- `npm pack` rebuilt production output before packaging and then verified the universal native artifacts; stale `dist` cannot silently enter this release path.
- `reelier init --no-open --json` completed in about 25 seconds and reported both installed product-ready harnesses, 1,792 imported missions, accountless Local Mission Control, and a loopback board. `reelier operator doctor` then independently reported a readable journal and that neither an account nor Cloud was required.
- The installed package exports the Operator, managed handoff, canonical quartet, and genuine host runtime. The canonical quartet remains `reelier_agent_status`, `reelier_outcome_proposal`, `reelier_outcome_request`, and `reelier_outcome_status`.
- The tarball contains the Linux and Windows bootstrap binaries plus the universal native manifest.
- The disposable state audit covered 1,792 files / 1,742,946 bytes and found no prompt, reasoning, model output, provider body, credential, API key, bearer token, authorization header, password, or secret record key.

## Verification

- Operator-focused matrix: 89 tests, 88 pass, 0 fail, 1 declared Windows-symlink privilege skip.
- Production build: exit 0; 12 packs built.
- Production TypeScript: exit 0.
- Test TypeScript: exit 0.
- Real board accessibility checks: semantic landmarks and labels, complete keyboard focus order, visible focus, no current-page console errors, no horizontal overflow at 320 CSS pixels, no interactive target below 44 by 44 CSS pixels, and all normal foreground colors at least 4.5:1 on the mission sheet.
- Board capability disappears from `location.hash` immediately after load; unauthenticated API state remains 401.
- Cross-platform native candidate assembled earlier in the same release line: universal manifest SHA-256 `effa688a2fd215af7379a7569cecad79530e5a6cbf05d98fbe308e94cedd5d38`, Linux binary SHA-256 `42b32b799f1a15d2ac078296222894d4bd8befcb18e3b257a75dd468e44db879`, Windows binary SHA-256 `8e74f4239aafb093cc8087a9022ca33ef260ecbd352789a7d018e5081f8f5c59`.

## Cloud integration state

- Managed Autopilot lives on the separate reviewed Cloud branch and reuses Neon lifecycle authority, passkey activation, Stripe canonical subscription state, exact GitHub/Linear bindings, the seven reviewed definitions, the one-shot Cell authority, brokered execution, authoritative readback, receipts, and no-resend ambiguity recovery.
- Cloud draft review: `https://github.com/seldonframe/reelier-cloud/pull/72`.
- Cloud local gate at head `07c067f`: 1,919 tests, 1,917 pass, 0 fail, 2 honest skips; typecheck, production build, and Drizzle check exit 0.
- Live disposable Neon schema gate reports 76 tables / 836 columns and migrations through `0051`; no provider write was performed.
- Production deployment `dpl_CPB5Tq3RDEmcSJvFEUJ4mTGxZoyh` is `READY` and aliased to `https://www.reelier.com`; public root, pricing, Autopilot, and DB health probes return 200.
- The fresh `iad` Fly Cell `reelier-autopilot-customer-1-20260824` runs image `sha256:427d7d0cf9051f99f1c6acd2751ea5d2c57e0c9a981eca99a1a8543b8f7bf393`, refuses unauthenticated health with 401, pins the exact reviewed seven-definition and Outcome ABI roots during startup, and remains `certifying`, not `ready`, because no fabricated tenant-scoped activation or provider binding was inserted.

## Open gates and explicit non-claims

- Exact-head GitHub CI and independent review are still required before merging, tagging, publishing, or promoting the npm prerelease.
- The beta package is built and installed but is not published to npm. No `latest` promotion occurred.
- The exact target-selection rendezvous and local mission compiler are implemented, but Customer #1 still must complete the authenticated browser payment/provider/passkey ceremony. The disposable GitHub repository is intentionally empty, so no exact base SHA or provider-write ceremony exists yet.
- Stripe payment, GitHub/Linear provider writes, Fly Cell promotion to `ready`, and cleanup remain explicit ceremonies. None was simulated or claimed complete.
- No 10x or 100x product claim is made. The implementation can record the measurements, but the matched ten-session, ten-Outcome, and 100-Outcome experiments have not been run.
- Free Mission Control observes only supported local surfaces. Invisible direct shell/provider writes remain unknown coverage, never governed or complete.
