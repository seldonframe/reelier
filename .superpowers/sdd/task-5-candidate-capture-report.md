Files changed

- `conformance/candidate-capture/v0/check.mjs`
- `conformance/candidate-capture/v0/capture.schema.json`
- `conformance/candidate-capture/v0/report.schema.json`
- `conformance/candidate-capture/v0/README.md`
- `test/candidate-capture-conformance.test.ts`
- `docs/superpowers/plans/2026-08-16-five-harness-conformance.md`
- `.superpowers/sdd/task-5-candidate-capture-report.md`

What changed per file

- `conformance/candidate-capture/v0/check.mjs` implements the detached five-harness capture
  boundary. Every supplied v0 capture remains non-passing. Malformed, stale, identity-invalid,
  digest-invalid, malformed-JSON, and sensitive inputs emit failed `invalid-candidate`; only actual
  absence emits `not-tested`/`candidate-missing`. Runtime freshness uses the system clock, with
  deterministic clock entry points named test-only. Fix round 2 recursively rejects nested
  transport objects; protocol, host, port, socket, and connection fields; PostgreSQL, MySQL,
  MongoDB, Redis, and AMQP connection strings; every `scheme://` URI; headers, cookies, auth, and
  credential-like assignments and values. The exact required semantic identity path
  `descriptor.agentHost` remains accepted. Invalid reports retain at most a checker-computed raw
  digest and never raw JSON. Extra CLI arguments now emit failed `invalid-candidate`; only no path
  emits `candidate-missing`.
- `conformance/candidate-capture/v0/capture.schema.json` defines the closed supplied-or-missing
  input envelope. Freshness evaluation time is runtime-owned and cannot be supplied by callers.
- `conformance/candidate-capture/v0/report.schema.json` defines failed-only supplied reports and
  closes identity, classification, freshness, artifact, binding, reason, and non-claim cross-fields.
- `conformance/candidate-capture/v0/README.md` documents the non-passing boundary, generic recursive
  transport/credential rejection, exact semantic identity exception, digest-only output, and CLI
  exit semantics. Valid semantic reports remain admissible only when they contain no rejected
  transport or credential material.
- `test/candidate-capture-conformance.test.ts` covers all five harnesses, missing and malformed
  candidates, identity/digest/freshness failures, schema cross-fields, generic transport fields and
  connection URIs, Basic/Bearer and other credential-like values, digest-only reports, a safe
  semantic-report control, and no-path versus extra-argument CLI behavior.
- `docs/superpowers/plans/2026-08-16-five-harness-conformance.md` records the approved closed Task 5
  allowlist and objective. It was changed in the original Task 5 work and not in fix round 2.
- `.superpowers/sdd/task-5-candidate-capture-report.md` records cumulative scope, deviations,
  commits, verbatim verification tails, and risks. Fix round 2 replaces the previous pending commit
  placeholder with actual evidence.

Deviations from the plan and why

- No file-scope deviation. The first review fix changed the initial live-candidate success behavior
  to failed-only v0 reports because a detached standalone capture cannot authenticate its supplier
  or prove execution. This follows the plan's requirement that unknown, unchecked, and unsupported
  evidence never become a pass.
- Caller-supplied `evaluatedAt` was removed in the first review fix so production and CLI evaluation
  use trusted runtime time; deterministic clocks remain test-only.
- Fix round 2 uses one narrow compatibility exception for the candidate contract's required
  `descriptor.agentHost` identity field. No generic `host` field is accepted. This is an
  implementation detail within the approved boundary, not a scope deviation.
- No external provider, network, credential, GitHub, email, push, merge, formatter, codemod, or
  package-surface change was used. No file outside the Task 5 allowlist was modified.

TDD evidence

Fix round 2 first ran the emitting test build, then the focused Task 5 test. RED exited 1 because
nested `transport.host/port` returned `live-candidate-observed` rather than `invalid-candidate`, and
extra CLI arguments exited 2 rather than 1. The safe semantic-report control passed during RED.
Verbatim RED tail:

```text
ℹ tests 14
ℹ suites 0
ℹ pass 12
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 703.0444
```

After the implementation, the focused Task 5 suite passed 14/14 before the GREEN commit.

Commits

Initial Task 5 and first review fix:

- `cb60a9b` — `test: define black-box candidate capture boundary`
- `0286c11` — `feat: add black-box candidate capture boundary`
- `cf49f91` — `fix: accept bound raw adapter reports`
- `e5ea5bf` — `docs: record Task 5 capture evidence`
- `57c425e` — `docs: add Task 5 implementation report`
- `d260c3b` — `test: close candidate capture trust boundary`
- `095e25d` — `test: close capture report cross fields`
- `c3dd63c` — `fix: fail closed candidate capture reports`
- `d18d79c` — `docs: align candidate capture failure semantics`
- `7b19eb9` — `docs: record Task 5 capture fix evidence`

Fix round 2:

- `fa1507f` — `test: close candidate capture transport boundary`
- `0052b13` — `fix: reject generic capture transport data`
- `9508d24` — `docs: define generic capture rejection`

The actual fix-round-2 code/test/documentation evidence HEAD before this report update is
`9508d24a5fb94a3168535450a18f3c49fb8a77f5`. No commit is listed as pending.

Final verification

Commands ran in this order:

```text
npx tsc -p tsconfig.test.json --pretty false
node --test --test-concurrency=1 dist-test/test/candidate-capture-conformance.test.js dist-test/test/coverage-envelope-conformance.test.js dist-test/test/semantic-matrix-conformance.test.js dist-test/test/aggregate-conformance.test.js dist-test/test/agent-adapter-conformance.test.js dist-test/test/continuity/conformance-runner.test.js
npx tsc --noEmit --pretty false
node scripts/build-authority-contract.mjs --check
node scripts/build-bootstrap-contract.mjs --check
git diff --check
```

The emitting build, production typecheck, both contract checks, and `git diff --check` exited 0 with
no output. Verbatim test tail:

```text
✔ invalid source reports cannot publish semantic checks (0.217ms)
✔ listed missing evidence must be explicit and CLI failures remain schema-valid (468.6455ms)
✔ a passed matrix cannot contain unsupported top-level harness rows (0.7459ms)
✔ explicit missing evidence cannot coexist with a candidate or report (0.337ms)
ℹ tests 66
ℹ suites 0
ℹ pass 66
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 5202.7678
```

The cumulative allowlist audit at evidence HEAD `9508d24` was:

```text
.superpowers/sdd/task-5-candidate-capture-report.md
conformance/candidate-capture/v0/README.md
conformance/candidate-capture/v0/capture.schema.json
conformance/candidate-capture/v0/check.mjs
conformance/candidate-capture/v0/report.schema.json
docs/superpowers/plans/2026-08-16-five-harness-conformance.md
test/candidate-capture-conformance.test.ts
```

Every path is in the closed Task 5 allowlist. Fix round 2 itself modified only `check.mjs`, its
focused test, the candidate-capture README, and this report.

Open risks

- No actual live harness candidate was supplied. Codex, Claude Code, Eve, Grok Build, and Grok Bot
  live execution therefore remain unproved by Task 5.
- Harness and adapter instance digests are unkeyed assertions. They bind relabeling and mutation
  within the supplied envelope but do not authenticate who supplied it; v0 reports remain failed.
- The recursive detector closes generic transport/connection fields, all `scheme://` URIs, and the
  named credential signatures, but cannot prove that an arbitrary opaque string is not a secret.
  Producers must still remove secrets before capture. Raw payloads are processed locally but never
  emitted in reports.
- The conservative boundary can reject benign payload fields or strings matching a banned shape.
  This fail-closed false-positive risk is intentional for a credential-free detached boundary.
