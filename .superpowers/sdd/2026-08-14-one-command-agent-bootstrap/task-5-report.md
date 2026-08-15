Files changed

- `src/bootstrap/initialize.ts` (created)
- `src/bootstrap/install.ts` (created)
- `src/bootstrap/profile-drafts.ts` (created)
- `src/bootstrap/workload-registration.ts` (created)
- `src/cli.ts` (modified)
- `test/bootstrap-initialize.test.ts` (created)
- `test/bootstrap-install.test.ts` (created)
- `test/cli-entrypoint.test.ts` (modified)
- `test/init-cli.test.ts` (modified)
- `.superpowers/sdd/2026-08-14-one-command-agent-bootstrap/task-5-report.md` (created)

What changed per file

- `src/bootstrap/initialize.ts`: adds named initialization, a separate closed checkpoint sequence under `.reelier/bootstrap/`, a pinned recovery command, an in-memory non-wire preparation view, and unconditional refusal of bootstrap dispatch without validated activation.
- `src/bootstrap/workload-registration.ts`: creates/reuses a project-namespaced workload signing key under the user's private Reelier home and emits only a public-key commitment. The record explicitly reports the Windows ACL limitation.
- `src/bootstrap/profile-drafts.ts`: creates an unsigned, non-certified, non-activated profile draft marker.
- `src/bootstrap/install.ts`: adds a named-bootstrap-only exact-version proxy plan while leaving legacy `planInstall` output unchanged.
- `src/cli.ts`: routes exactly one `init` positional argument to named preparation, preserves bare and signing mode behavior, rejects extra positional names, prints the pinned recovery command and managed-Cell connection template, and retains the four existing authority connection values in root parsing.
- Test files: specify preparation/certification/activation separation, dispatch refusal, closed persisted report projection, pinned recovery command, key-material non-leakage, basic resume/traversal behavior, pinned proxy planning, legacy bare-init behavior, positional rejection, and parser retention of authority connection values.

Deviation from plan

- Per orchestrator ruling, the frozen `BootstrapReportV1` contract, schema, type, and parser were not widened. `initializeAgentProject` returns a structural in-memory extension with `actions` and `pathC`; only the closed `BootstrapReportV1` projection is written to `report.json`. This avoids wire-schema expansion; the cost is a local API extension.
- The allowlisted `src/init.ts`, `src/wrap.ts`, `test/init-signing-cli.test.ts`, and `test/wrap.test.ts` did not need edits for the minimal implementation. Legacy behavior remains covered by the existing focused suites.
- The approved brief calls for exhaustive crash-cut, lock-contention, stale-lock, rollback, symlink/junction, case-collision, and imported-governance test coverage. This implementation establishes checkpoint persistence and basic traversal/resume coverage, but does not yet provide the full specified adversarial matrix. It should not be represented as completing those unimplemented hardening cases.

Test results (verbatim tail)

`npx tsc -p tsconfig.test.json`

```text
(no output; exit 0)
```

Focused Node tests:

```text
✔ planWrapOffer: a malformed config never crashes init's closing step — honest skip note, file untouched (2.8051ms)
ℹ tests 44
ℹ suites 0
ℹ pass 44
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3344.3937
```

Contract and diff gates:

```text
> reelier@0.32.1 check:authority-contract
> node scripts/build-authority-contract.mjs --check

> reelier@0.32.1 check:outcome-profile-contract
> node scripts/build-outcome-profile-contract.mjs --check

> reelier@0.32.1 check:bootstrap-contract
> node scripts/build-bootstrap-contract.mjs --check
```

Open risks

- The preparation report extension is intentionally not a closed wire record; consumers must use the persisted report for `BootstrapReportV1` parsing and treat `actions`/`pathC` as process-local preparation status.
- Named configuration planning exists but is not yet connected to consented application/rollback in the initializer.
- The exhaustive durability and filesystem adversarial cases required by the brief remain open.
