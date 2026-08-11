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
- `docs/runbooks/live-certification.md`: documents strict selection, the shared private/sanitized commitment root, snapshot-consistent export, preparation versus signing phases, private publication, path/stage confinement, and later signing/live-run boundaries.
- `src/authority/certification/commitment.ts`: defines the closed sanitized selected projection and binds its digest together with the complete private-config digest into one commitment root used by generated IDs, readiness, and export.
- `src/authority/certification/initializer.ts`: validates before writing, refuses linked config/workspace/snapshot/staging paths, never creates through a linked parent, atomically publishes a complete sibling workspace, derives IDs from the commitment root, validates resume, converges concurrent publication, and removes only the exact stage carrying its per-attempt unguessable owner marker.
- `src/authority/certification/filesystem.ts`: confines reads and private content-addressed writes with `lstat`/`realpath`, containment and inode checks, link/junction/reparse-point refusal, and atomic no-overwrite hard-link publication from a `0600` temporary file without pathname chmod after publication.
- `src/authority/certification/preflight.ts`: requires explicit scenario/all selection, inventories only regular artifacts mapped to selected scenarios, rejects exact mapped links instead of treating them as absent, reports preparation readiness separately from signature absence, and performs no secret resolution, runtime/provider calls, or network I/O.
- `src/authority/certification/readiness.ts`: derives a candidate from an exact preflight snapshot, refuses incomplete preparation, and writes private content-addressed candidates marked preparation-ready, awaiting human signature, signature absent, authorization absent, non-dispatchable, and completeness unchecked.
- `src/authority/certification/export.ts`: binds the sanitized selected projection to the private config in one root, builds readiness from one preflight snapshot, re-observes inputs and refuses drift, self-verifies before publication, excludes private path/reference payloads, and semantically recomputes generated IDs, statuses, schemas, digests, commitments, and links offline.
- `src/authority/cli.ts`: exposes the initialized workflow with closed redacted JSON and deterministic exits; selection commands reject missing/conflicting/unknown selection, unknown flags, and extra positionals. Explicit `--key` preserves the pre-existing signed release-evidence verifier.
- `src/cli.ts`: parses exact scenario values, rejects duplicate or missing scenario arguments and duplicate `--all`, and documents the expert surface.
- `test/authority/certification-export.test.ts`: covers sanitized/private export, shared-root recomputation, deterministic snapshot drift, deep tampering, fully rehashed ID/readiness contradictions, fully rehashed public-fact substitution, missing links, open schemas, and unsigned-authority refusal.
- `test/authority/certification-filesystem.test.ts`: covers linked runner directories, selected artifact symlinks where supported, linked readiness output directories, and absence of external writes.
- `test/authority/certification-initializer.test.ts`: covers invalid/no-partial initialization, deterministic resume/IDs, barrier-synchronized concurrent publication, foreign-stage preservation, workspace/config/snapshot links, and no external parent creation through junctions.
- `test/authority/certification-preflight.test.ts`: covers explicit exact selection, cross-scenario non-disclosure, secret non-resolution, phase-specific readiness, input digests/absence, and substitution refusal.
- `test/authority/certification-readiness.test.ts`: covers complete-preparation sealing, incomplete-preparation refusal, private content addressing, idempotence, generated IDs, unsigned/non-dispatchable semantics, and tamper refusal.
- `test/authority/certify-cli.test.ts`: exhaustively closes init/preflight/seal/export/verify command shapes, duplicate/missing options, conflicts, extra positionals, closed output, phase-correct exits, redaction, sealing, export, offline verification, and tamper refusal.

## Deviations from the plan

- No extension to `src/authority/host/release-evidence.ts` was necessary. The unsigned preparation package has a separate closed format so it cannot be confused with signed release evidence.
- The initialized workspace convention is the deterministic sibling `<config-directory>/certification`; `--workspace` remains available for isolated/test operation.
- Existing Task 3+ live `run`, `activate-codex`, and explicitly keyed signed-manifest verification paths were preserved. They do not accept the unsigned readiness candidate as authority.
- Runner/test evidence uses `<scenario>.json` or `<scenario>--<name>.json` under `inputs/runners/` and `inputs/tests/`. Missing selected evidence blocks sealing; unselected files are never inventoried.

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

## Test results

Focused certification and adjacent runner suite after the final production change (`npx tsc -p tsconfig.test.json` followed by the ten selected compiled specs):

```text
ℹ tests 56
ℹ suites 0
ℹ pass 56
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2431.2741
```

Build:

```text
> reelier@0.32.1 build
> tsc -p tsconfig.json && node scripts/build-authority-contract.mjs --copy-schemas && node scripts/build-packs.mjs

built cloudflare_api_token, cloudflare_dns, github_issue_labels, gmail, gmail_labels, hubspot_slack_information_flow, neon_database, slack_channel_topic, stripe, vercel_deployment
```

Fresh full suite after the final production change:

```text
ℹ tests 2804
ℹ suites 0
ℹ pass 2803
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 344008.018
```

## Open risks

- The export is internally tamper-evident and semantically link-coherent but intentionally unauthenticated until Task 3 human signing. Signature verification, provider certification, completion, and completeness remain `unchecked`.
- A filesystem owner can replace private local files; content addressing and offline verification detect changed bytes, but this is not a substitute for the later signed trust boundary.
- Foreign or interrupted staging directories are deliberately never age- or name-deleted and may require operator cleanup; only the current attempt's exact owner-marked stage is removable automatically.
- Pre-existing live runner commands still consume their legacy configuration path until their owning task migrates them. This task does not grant or dispatch.
- Runner/test input digests attest only supplied local artifacts. Semantic runner certification and live provider evidence remain later gates.
