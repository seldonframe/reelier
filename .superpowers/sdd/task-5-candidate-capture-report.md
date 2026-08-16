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
  boundary. The review fix makes every supplied v0 capture non-passing, emits explicit failed
  `invalid-candidate` reports for malformed, stale, identity-invalid, digest-invalid, malformed-JSON,
  and secret-bearing input, and reserves `not-tested`/`candidate-missing` for actual absence. Runtime
  capture uses the current system clock; deterministic clock entry points are explicitly test-only.
  Raw payload traversal rejects transport and credential fields and common token forms recursively;
  invalid reports retain at most a checker-computed raw digest and never raw JSON.
- `conformance/candidate-capture/v0/capture.schema.json` defines the closed supplied-or-missing input
  envelope. Caller-supplied `evaluatedAt` was removed: freshness evaluation time is runtime-owned.
- `conformance/candidate-capture/v0/report.schema.json` defines the closed report variants. It admits
  no `passed` status. `not-tested` is restricted to absent candidates; supplied classifications and
  `invalid-candidate` are failed-only, with closed identity, capture/evidence mode, freshness,
  artifact, binding, reason, and non-claim relationships.
- `conformance/candidate-capture/v0/README.md` documents runtime-owned freshness, failed-only supplied
  reports, explicit invalid-candidate behavior, recursive transport/credential rejection, digest-only
  output, and CLI exit codes 1/2 with no v0 exit-code-0 report.
- `test/candidate-capture-conformance.test.ts` contains genuine RED/GREEN coverage for all five
  harnesses, malformed supplied input classification, identity mismatch, trusted runtime freshness,
  backdated replay, future/invalid timestamps, recursive URL/URI/endpoint/header/cookie/auth/token/
  secret/password/API-key/access-key rejection, common bearer/sk-/ghp-/xox-/npm_/eyJ forms,
  digest-only reports, CLI malformed-input classification, and standalone schema cross-fields.
- `docs/superpowers/plans/2026-08-16-five-harness-conformance.md` records the approved closed Task 5
  allowlist and objective. It was created/modified earlier in Task 5 and was not changed in this fix
  round.
- `.superpowers/sdd/task-5-candidate-capture-report.md` records cumulative Task 5 scope and the review
  fix's TDD, commits, verification, deviations, and risks.

Deviations from the plan and why

- No file-scope deviation. The review fix changed the initial implementation's live-candidate
  success behavior to failed-only v0 reports because a detached standalone capture cannot honestly
  authenticate supplier identity or prove execution. This implements the review finding and the
  plan's requirement that unknown, unchecked, and unsupported evidence never become a pass.
- The initial implementation accepted caller-supplied `evaluatedAt`; the fix removes it and adds
  test-named deterministic clock helpers so production/CLI evaluation uses trusted runtime time.
- No external provider, network, credential, GitHub, email, push, merge, formatter, codemod, or
  package-surface change was used. No file outside the Task 5 allowlist was modified.

TDD evidence

The emitting test build ran before each focused test command:

```text
npx tsc -p tsconfig.test.json --pretty false
node --test --test-concurrency=1 dist-test/test/candidate-capture-conformance.test.js
```

The first review-fix RED exited 1 for the intended missing behavior. Verbatim tail:

```text
✖ standalone report schema is failed-only and closes every classification cross-field state (21.3235ms)
✔ CLI absence emits a closed not-tested report without a synthetic candidate (153.8837ms)
✖ CLI malformed supplied input emits invalid-candidate instead of generic absence (173.4759ms)
ℹ tests 12
ℹ suites 0
ℹ pass 1
ℹ fail 11
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 523.6094
```

The CLI failure was specifically the prohibited fallback:

```text
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
+ actual - expected

+ 'not-tested'
- 'failed'
```

After the first GREEN, a second schema-focused RED proved that canonical identity and evidence
non-claim cross-fields were still open. Verbatim tail:

```text
✖ standalone report schema is failed-only and closes every classification cross-field state (37.8153ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 208.0515
```

The final focused GREEN tail is included in Final verification below.

Commits

Initial Task 5:

- `cb60a9b` — `test: define black-box candidate capture boundary`
- `0286c11` — `feat: add black-box candidate capture boundary`
- `cf49f91` — `fix: accept bound raw adapter reports`
- `e5ea5bf` — `docs: record Task 5 capture evidence`
- `57c425e` — `docs: add Task 5 implementation report`

Review fix:

- `d260c3b` — `test: close candidate capture trust boundary`
- `095e25d` — `test: close capture report cross fields`
- `c3dd63c` — `fix: fail closed candidate capture reports`
- `d18d79c` — `docs: align candidate capture failure semantics`
- Report update commit: pending this report-only commit.

Final verification

Commands, in order:

```text
npx tsc --noEmit --pretty false
npx tsc -p tsconfig.test.json --pretty false
node --test --test-concurrency=1 dist-test/test/candidate-capture-conformance.test.js dist-test/test/coverage-envelope-conformance.test.js dist-test/test/semantic-matrix-conformance.test.js dist-test/test/aggregate-conformance.test.js dist-test/test/agent-adapter-conformance.test.js dist-test/test/continuity/conformance-runner.test.js
node scripts/build-authority-contract.mjs --check
node scripts/build-bootstrap-contract.mjs --check
git diff --check
```

All exit codes were 0. Both typechecks, both contract checks, and `git diff --check` emitted no
output. Verbatim test tail:

```text
✔ invalid source reports cannot publish semantic checks (0.2338ms)
✔ listed missing evidence must be explicit and CLI failures remain schema-valid (390.3892ms)
✔ a passed matrix cannot contain unsupported top-level harness rows (0.5854ms)
✔ explicit missing evidence cannot coexist with a candidate or report (0.2736ms)
ℹ tests 64
ℹ suites 0
ℹ pass 64
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 4824.2008
```

Allowlist audit before the report-only commit:

```text
conformance/candidate-capture/v0/README.md
conformance/candidate-capture/v0/capture.schema.json
conformance/candidate-capture/v0/check.mjs
conformance/candidate-capture/v0/report.schema.json
test/candidate-capture-conformance.test.ts
```

Every path is in the closed Task 5 allowlist. This report is the sixth review-fix path and is also
allowlisted.

Open risks

- No actual live harness candidate was supplied. Codex, Claude Code, Eve, Grok Build, and Grok Bot
  live execution therefore remain unproved by Task 5.
- Harness and adapter instance digests are unkeyed assertions. They bind relabeling and mutation
  within the supplied envelope but do not authenticate who supplied it; v0 reports remain failed.
- The recursive detector closes the named transport/credential keys and common token signatures but
  cannot prove that an arbitrary opaque string is not a secret. Producers must still remove secrets
  before capture. Raw payloads are processed locally but never emitted in reports.
- The conservative URL/token boundary can reject benign payload fields or strings matching a banned
  shape. This fail-closed false-positive risk is intentional for a credential-free detached boundary.
