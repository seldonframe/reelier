Files changed

- `.superpowers/sdd/task-2c2-certification-cli-report.md`
- `docs/runbooks/live-certification.md`
- `src/authority/certification/commitment.ts`
- `src/authority/certification/export.ts`
- `src/authority/certification/filesystem.ts`
- `src/authority/certification/initializer.ts`
- `src/authority/certification/preflight.ts`
- `src/authority/certification/readiness.ts`
- `src/authority/cli.ts`
- `src/cli.ts`
- `test/authority/certification-export.test.ts`
- `test/authority/certification-filesystem.test.ts`
- `test/authority/certification-initializer.test.ts`
- `test/authority/certification-preflight.test.ts`
- `test/authority/certification-readiness.test.ts`
- `test/authority/certify-cli.test.ts`

## What changed per file

- `.superpowers/sdd/task-2c2-certification-cli-report.md`: records the exact review scope, implementation, deviations, fix commits, verification output, and remaining risks.
- `docs/runbooks/live-certification.md`: documents strict selection, the immutable initialization authority root versus subordinate selection digests, snapshot-consistent export, preparation versus signing phases, private publication, path/stage confinement, and later signing/live-run boundaries.
- `src/authority/certification/commitment.ts`: defines the full initialization commitment and a distinct selected-projection commitment bound beneath the stable initialization root.
- `src/authority/certification/initializer.ts`: validates before writing, records initialized scenarios, refuses linked paths, atomically publishes a complete sibling workspace, derives permanent IDs, converges concurrent publication, and scopes loser cleanup to the verified canonical creation parent, exact workspace-derived stage prefix, and per-attempt cryptographic owner marker.
- `src/authority/certification/filesystem.ts`: performs bounded local checks that reject links and directory identity changes observed across requested/canonical ancestry and `stat`/`lstat`; allows ordinary Windows case and 8.3 aliases; retains file-handle identity, containment, and private atomic publication; and explicitly does not claim exclusive confinement against hostile concurrent same-user mutation.
- `src/authority/certification/preflight.ts`: validates the actual immutable initialization artifact, preserves its stable root and IDs, binds selection, inventories selected artifacts, performs no secret resolution/network I/O, and keeps local filesystem trust explicitly `unchecked`.
- `src/authority/certification/readiness.ts`: copies the stable initialization root and IDs, binds selection, refuses incomplete preparation, and never upgrades the preflight's unchecked local trust into authority.
- `src/authority/certification/export.ts`: exports the actual initialization artifact, preserves root/ID continuity, enforces selected-subset coherence and snapshot drift checks, self-verifies before publication, excludes private payloads, and makes no verified exclusive-filesystem claim.
- `src/authority/cli.ts`: exposes the initialized workflow with closed redacted JSON and deterministic exits; selection commands reject missing/conflicting/unknown selection, unknown flags, and extra positionals. Explicit `--key` preserves the pre-existing signed release-evidence verifier.
- `src/cli.ts`: parses exact scenario values, rejects duplicate or missing scenario arguments and duplicate `--all`, and documents the expert surface.
- `test/authority/certification-export.test.ts`: covers two-scenario initialization through one-scenario preflight/seal/export/verify with identical root and all five IDs, actual initialization equality, selected-only evidence, subset coherence, deterministic drift, deep tampering, fully rehashed substitution, missing links, open schemas, and unsigned-authority refusal.
- `test/authority/certification-filesystem.test.ts`: covers static linked runner directories/artifacts/output paths, absence of external writes, real Windows 8.3/case aliases for file/workspace/creation-parent paths, one-argument production ABI, and honest `trust: unchecked`/no-`verified` output.
- `test/authority/certification-initializer.test.ts`: covers invalid/no-partial initialization, deterministic resume/IDs, barrier-synchronized concurrent publication through canonical and real Windows short-name paths, owned-loser cleanup, foreign-stage preservation, workspace/config/snapshot links, and junction-parent refusal.
- `test/authority/certification-preflight.test.ts`: covers explicit exact selection, cross-scenario non-disclosure, secret non-resolution, phase-specific readiness, input digests/absence, and substitution refusal.
- `test/authority/certification-readiness.test.ts`: covers complete-preparation sealing, incomplete-preparation refusal, private content addressing, idempotence, generated IDs, unsigned/non-dispatchable semantics, and tamper refusal.
- `test/authority/certify-cli.test.ts`: exhaustively closes init/preflight/seal/export/verify command shapes, duplicate/missing options, conflicts, extra positionals, closed output, phase-correct exits, redaction, sealing, export, offline verification, and tamper refusal.

## Deviations from the plan

- No extension to `src/authority/host/release-evidence.ts` was necessary. The unsigned preparation package has a separate closed format so it cannot be confused with signed release evidence.
- The initialized workspace convention is the deterministic sibling `<config-directory>/certification`; `--workspace` remains available for isolated/test operation.
- Existing Task 3+ live `run`, `activate-codex`, and explicitly keyed signed-manifest verification paths were preserved. They do not accept the unsigned readiness candidate as authority.
- Runner/test evidence uses `<scenario>.json` or `<scenario>--<name>.json` under `inputs/runners/` and `inputs/tests/`. Missing selected evidence blocks sealing; unselected files are never inventoried.
- Hosted run `31531461819` exposed a Windows-only false positive: GitHub's ordinary `C:\Users\RUNNER~1\...` short-name path was expanded by `realpath`, so lexical path equality incorrectly treated it as a reparse traversal. A local ordinary `SQUIRR~1` alias reproduced the same failure with `lstat().isSymbolicLink() === false`; component inspection now distinguishes aliases from actual links.
- Portable Node has no handle-relative no-follow traversal, so no finite sequence of walks and `stat` calls can prove exclusive confinement against hostile concurrent same-user replacement. The local check rejects only links and identity changes it observes; this boundary remains `unchecked`, and later managed dispatch requires the isolated Authority Cell/certified topology.
- Hosted Windows run `31536093711` left one owned `.certification.staging-*` after concurrent initialization. Local short-name reproduction confirmed the canonical staging parent failed a lexical comparison against the original alias parent before owner validation. Cleanup now uses the already verified canonical creation parent; the exact prefix and owner-token gates remain unchanged.

## Review-fix commits

- `9f88dc6`, `560a2f2`: RED coverage for strict selection/readiness and adversarial export/filesystem behavior.
- `0b85b9f`: strict selected-only preparation, semantic verification, sanitized export, private publication, and filesystem confinement.
- `51880f7`, `4e10628`: initial deterministic concurrent initialization and stage handling; the age-based recovery behavior was superseded by `a9477a3`.
- `23f17e7`: phase-boundary and operator workflow documentation.
- `896eced`, `bd31396`: fully reforged derived-input-status and duplicate-`--all` RED/GREEN.
- `d484956`: selected artifact symlink regression, green against the confinement implementation.
- `eefbd39`, `b56522d`: RED/GREEN for one private/sanitized commitment root, fully rehashed substitution refusal, exact-snapshot readiness, re-observation, drift refusal, and pre-publication self-verification.
- `47ddca6`, `e3633c2`: RED/GREEN for init path confinement, exact mapped-link refusal, private temp-mode publication, and closed expert CLI commands.
- `ada5dd6`, `a9477a3`: RED/GREEN for no creation through junction parents, cryptographically owned stage cleanup, foreign-stage preservation, and the expanded expert-command argument matrix.
- `9cc3045`: documents the final commitment, snapshot, publication, and confinement guarantees.
- `822c7ae`, `7956d34`: RED coverage for stable two-scenario initialization authority across a one-scenario subset, offline subset coherence, and real-workspace resume through a junction parent.
- `32e407f`: preserves the immutable initialization root and IDs, adds subordinate selection commitments, exports the actual initialization artifact, enforces offline continuity/subset coherence, and rejects canonical workspace mismatch.
- `43f39b4`: documents stable initialization authority versus selected preparation scope.
- `3c13f42`, `133f24a`: RED/GREEN for ordinary Windows short-name ancestry while preserving linked-leaf and junction-parent refusal.
- `a3092b4`: corrects the runbook to describe component inspection and legitimate Windows aliases.
- `5135cd7`, `d41d5d9`, `b634f6e`: earlier finite-check race hardening and documentation; the reviewer identified its irreducible post-check boundary, so its production hook and universal wording were superseded below.
- `5890448`, `12770df`: RED/GREEN removing the race hook from production ABI, preserving static/alias defenses, and pinning local filesystem trust to `unchecked` without a `verified` rendering.
- `a1dc127`: documents the bounded local check and isolated Authority Cell/topology requirement for managed dispatch.
- `3e02715`, `ae32a52`: RED/GREEN for deterministic concurrent initialization through a real Windows short-name alias and cleanup scoped to the canonical creation parent without weakening owner matching.
- `80b8e1a`: documents canonical owned-stage cleanup and foreign-stage preservation.

## Test results

Focused certification and adjacent runner suite after the final production change (`npx tsc -p tsconfig.test.json` followed by the ten selected compiled specs):

```text
ℹ tests 61
ℹ suites 0
ℹ pass 61
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2543.1582
```

No-sleep initializer stress after the final production change:

```text
initializer stress iterations passed: 20/20
```

Build:

```text
> reelier@0.32.1 build
> tsc -p tsconfig.json && node scripts/build-authority-contract.mjs --copy-schemas && node scripts/build-packs.mjs

built cloudflare_api_token, cloudflare_dns, github_issue_labels, gmail, gmail_labels, hubspot_slack_information_flow, neon_database, slack_channel_topic, stripe, vercel_deployment
```

Fresh full Windows suite after the final production change:

```text
ℹ tests 2809
ℹ suites 0
ℹ pass 2808
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 313734.1126
```

## Open risks

- The export is internally tamper-evident and semantically link-coherent but intentionally unauthenticated until Task 3 human signing. Signature verification, provider certification, completion, and completeness remain `unchecked`.
- A filesystem owner can replace private local files; content addressing and offline verification detect changed bytes, but this is not a substitute for the later signed trust boundary.
- Hostile concurrent same-user filesystem mutation after a local path check is explicitly `unchecked`; portable Node cannot provide handle-relative no-follow traversal. Managed autonomous dispatch must depend on isolated Authority Cell/topology controls instead.
- Foreign or interrupted staging directories are deliberately never age- or name-deleted and may require operator cleanup; only the current attempt's exact owner-marked stage is removable automatically.
- Pre-existing live runner commands still consume their legacy configuration path until their owning task migrates them. This task does not grant or dispatch.
- Runner/test input digests attest only supplied local artifacts. Semantic runner certification and live provider evidence remain later gates.
