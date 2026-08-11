Files changed

- `.superpowers/sdd/task-2c2-certification-cli-report.md`
- `docs/runbooks/live-certification.md`
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
- `docs/runbooks/live-certification.md`: documents strict selection, selected artifact naming, preparation versus signing phases, sanitized private export, confinement, and the later signing/live-run boundaries.
- `src/authority/certification/initializer.ts`: validates before writing, stages and atomically renames a complete sibling workspace, derives all internal IDs through one pure config-digest function, validates resume, deterministically converges concurrent publication, cleans contender stages, and reclaims safely identified stale interrupted stages.
- `src/authority/certification/filesystem.ts`: confines reads and private content-addressed writes with `lstat`/`realpath`, containment and inode checks, link/junction/reparse-point refusal, and atomic no-overwrite hard-link publication at `0600`.
- `src/authority/certification/preflight.ts`: requires explicit scenario/all selection, inventories only artifacts mapped to selected scenarios, reports preparation readiness separately from signature absence, and performs no secret resolution, runtime/provider calls, or network I/O.
- `src/authority/certification/readiness.ts`: refuses incomplete preparation and writes private content-addressed candidates marked preparation-ready, awaiting human signature, signature absent, authorization absent, non-dispatchable, and completeness unchecked.
- `src/authority/certification/export.ts`: exports only a closed sanitized selected projection; excludes secret-reference payloads and local Authority/Codex/Fly/evidence paths; semantically recomputes generated IDs, preflight statuses/missing/readiness, schemas, digests, commitments, and links offline.
- `src/authority/cli.ts`: exposes the initialized workflow with closed redacted JSON and deterministic exits; selection commands reject missing/conflicting/unknown selection, unknown flags, and extra positionals. Explicit `--key` preserves the pre-existing signed release-evidence verifier.
- `src/cli.ts`: parses exact scenario values, rejects duplicate or missing scenario arguments and duplicate `--all`, and documents the expert surface.
- `test/authority/certification-export.test.ts`: covers sanitized/private export, deep tampering, fully rehashed ID/readiness contradictions, substitution, missing links, open schemas, and unsigned-authority refusal.
- `test/authority/certification-filesystem.test.ts`: covers linked runner directories, selected artifact symlinks where supported, linked readiness output directories, and absence of external writes.
- `test/authority/certification-initializer.test.ts`: covers invalid/no-partial initialization, deterministic resume/IDs, barrier-synchronized concurrent publication with staging cleanup, and stale interrupted-stage recovery.
- `test/authority/certification-preflight.test.ts`: covers explicit exact selection, cross-scenario non-disclosure, secret non-resolution, phase-specific readiness, input digests/absence, and substitution refusal.
- `test/authority/certification-readiness.test.ts`: covers complete-preparation sealing, incomplete-preparation refusal, private content addressing, idempotence, generated IDs, unsigned/non-dispatchable semantics, and tamper refusal.
- `test/authority/certify-cli.test.ts`: covers strict command shape, duplicate/conflicting/unknown arguments, closed output, phase-correct exits, redaction, sealing, export, offline verification, and tamper refusal.

## Deviations from the plan

- No extension to `src/authority/host/release-evidence.ts` was necessary. The unsigned preparation package has a separate closed format so it cannot be confused with signed release evidence.
- The initialized workspace convention is the deterministic sibling `<config-directory>/certification`; `--workspace` remains available for isolated/test operation.
- Existing Task 3+ live `run`, `activate-codex`, and explicitly keyed signed-manifest verification paths were preserved. They do not accept the unsigned readiness candidate as authority.
- Runner/test evidence uses `<scenario>.json` or `<scenario>--<name>.json` under `inputs/runners/` and `inputs/tests/`. Missing selected evidence blocks sealing; unselected files are never inventoried.

## Review-fix commits

- `9f88dc6`, `560a2f2`: RED coverage for strict selection/readiness and adversarial export/filesystem behavior.
- `0b85b9f`: strict selected-only preparation, semantic verification, sanitized export, private publication, and filesystem confinement.
- `51880f7`, `4e10628`: deterministic concurrent initialization and interrupted-stage recovery RED/GREEN.
- `23f17e7`: phase-boundary and operator workflow documentation.
- `896eced`, `bd31396`: fully reforged derived-input-status and duplicate-`--all` RED/GREEN.
- `d484956`: selected artifact symlink regression, green against the confinement implementation.

## Test results

Focused certification and review-regression suite after the final production change:

```text
ℹ tests 44
ℹ suites 0
ℹ pass 44
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1631.8103
```

Build:

```text
> reelier@0.32.1 build
> tsc -p tsconfig.json && node scripts/build-authority-contract.mjs --copy-schemas && node scripts/build-packs.mjs

built cloudflare_api_token, cloudflare_dns, github_issue_labels, gmail, gmail_labels, hubspot_slack_information_flow, neon_database, slack_channel_topic, stripe, vercel_deployment
```

Fresh full suite after the final production change:

```text
ℹ tests 2799
ℹ suites 0
ℹ pass 2798
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 344419.3766
```

## Open risks

- The export is internally tamper-evident and semantically link-coherent but intentionally unauthenticated until Task 3 human signing. Signature verification, provider certification, completion, and completeness remain `unchecked`.
- A filesystem owner can replace private local files; content addressing and offline verification detect changed bytes, but this is not a substitute for the later signed trust boundary.
- Interrupted staging directories are reclaimed only after five minutes so active concurrent initialization is not mistaken for abandoned work.
- Pre-existing live runner commands still consume their legacy configuration path until their owning task migrates them. This task does not grant or dispatch.
- Runner/test input digests attest only supplied local artifacts. Semantic runner certification and live provider evidence remain later gates.
