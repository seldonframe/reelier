Files changed

- `.superpowers/sdd/task-2c2-certification-cli-report.md`
- `docs/runbooks/live-certification.md`
- `src/authority/certification/export.ts`
- `src/authority/certification/initializer.ts`
- `src/authority/certification/preflight.ts`
- `src/authority/certification/readiness.ts`
- `src/authority/cli.ts`
- `src/cli.ts`
- `test/authority/certification-export.test.ts`
- `test/authority/certification-initializer.test.ts`
- `test/authority/certification-preflight.test.ts`
- `test/authority/certification-readiness.test.ts`
- `test/authority/certify-cli.test.ts`

## What changed per file

- `.superpowers/sdd/task-2c2-certification-cli-report.md`: records the exact Task 2C2 review scope, implementation, deviations, verification output, and remaining risks.
- `docs/runbooks/live-certification.md`: documents the v2 initialized expert workflow, reference-only preflight, unsigned readiness semantics, export verification, and the boundary with legacy live runners and later signing.
- `src/authority/certification/initializer.ts`: validates v2 before writing, stages a complete sibling workspace and atomically renames it, derives task/Job Card/root-grant/Cell/signer IDs from the config digest, validates resume state, and converges concurrent identical initialization.
- `src/authority/certification/preflight.ts`: performs deterministic selected-scenario-only local inspection; reports only non-secret resource/cleanup commitments, credential-reference status, topology state, and runner/test digests or absence; performs no secret resolution, provider calls, runtime probes, or network I/O.
- `src/authority/certification/readiness.ts`: writes immutable content-addressed readiness candidates explicitly marked awaiting human signature, authorization absent, non-dispatchable, and completeness unchecked.
- `src/authority/certification/export.ts`: creates a closed linked evidence package and verifies every schema, digest, selected-scenario commitment, identifier edge, and artifact link offline while retaining all certification/signature/completion/completeness claims as unchecked.
- `src/authority/cli.ts`: exposes `certify init`, initialized `preflight`, `seal-readiness`, `export`, and unsigned-package `verify` with closed redacted JSON and deterministic exits; the new preflight intercept disables the legacy environment fallback. Explicit `--key` preserves the pre-existing signed release-evidence verifier.
- `src/cli.ts`: parses `--scenario` as an exact value and documents the private expert command surface.
- `test/authority/certification-export.test.ts`: covers closed export verification, deep tampering, substitution, missing links, open schemas, and refusal to treat an unsigned candidate as authority.
- `test/authority/certification-initializer.test.ts`: covers invalid/no-partial initialization, deterministic resume and internally generated IDs, and concurrent atomic convergence including the Windows `EPERM` rename race.
- `test/authority/certification-preflight.test.ts`: covers exact selected-only scope, secret non-disclosure/non-resolution, runner/test digest or absence, completeness honesty, and scenario substitution refusal.
- `test/authority/certification-readiness.test.ts`: covers content addressing, immutable/idempotent sealing, generated identifiers, unsigned/non-dispatchable semantics, and tamper refusal.
- `test/authority/certify-cli.test.ts`: replaces legacy fallback expectations with v2 initialized-flow coverage for parsing, closed output, exit codes, redaction, sealing, export, offline verification, and tamper refusal.

## Deviations from the plan

- No extension to `src/authority/host/release-evidence.ts` was necessary. Task 2C2's unsigned preparation package has a separate closed format so it cannot be confused with signed release evidence.
- The initialized workspace convention is the deterministic sibling `<config-directory>/certification`; `--workspace` remains available for isolated/test operation. Subsequent documented commands need no config argument.
- Existing Task 3+ live `run`, `activate-codex`, and explicitly keyed signed-manifest verification paths were preserved. They do not accept the unsigned readiness candidate as authority, and the initialized preflight returns before the legacy environment/provider-probe implementation can run.
- Local runner and test evidence uses conventional `inputs/runners/*.json` and `inputs/tests/*.json` files inside the initialized workspace. Missing directories are recorded as `absent`, never inferred as passing.

## Test results

Focused certification suite after the concurrent-initialization fix:

```text
ℹ tests 13
ℹ suites 0
ℹ pass 13
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 876.964
```

Build:

```text
> reelier@0.32.1 build
> tsc -p tsconfig.json && node scripts/build-authority-contract.mjs --copy-schemas && node scripts/build-packs.mjs

built cloudflare_api_token, cloudflare_dns, github_issue_labels, gmail, gmail_labels, hubspot_slack_information_flow, neon_database, slack_channel_topic, stripe, vercel_deployment
```

Fresh full suite after the final production change:

```text
ℹ tests 2789
ℹ suites 0
ℹ pass 2788
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 245514.3587
```

## Open risks

- The export is internally tamper-evident and link-coherent but intentionally unauthenticated until Task 3 human signing. Verification therefore reports signature verification, provider certification, completion, and completeness as `unchecked`.
- A filesystem owner can change read-only file permissions; offline verification detects changed bytes but immutability is not a substitute for the later signed trust boundary.
- Pre-existing live runner commands still consume their legacy configuration path until their owning task migrates them. This task does not grant or dispatch through those commands.
- Runner/test input digests attest only the supplied local artifacts. Their semantic certification and live provider evidence remain later gates.
