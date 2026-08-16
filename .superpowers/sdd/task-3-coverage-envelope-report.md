# Files changed

- `conformance/coverage-envelope/v0/check.mjs`
- `conformance/coverage-envelope/v0/input.schema.json`
- `conformance/coverage-envelope/v0/report.schema.json`
- `test/coverage-envelope-conformance.test.ts`
- `.superpowers/sdd/task-3-coverage-envelope-report.md`

## What changed per file

- `conformance/coverage-envelope/v0/check.mjs` — binds Codex and Claude Code inputs to the exact built-in adapter digests; derives a SHA-256 provenance commitment over harness, adapter, source, route, and claim evidence; keeps discovery-only envelopes failed/observed; incorporates bounded source freshness and rejects future observations; validates report cross-field semantics; prioritizes bypass evidence over wrapped evidence; and emits an honest null/empty refusal envelope instead of fabricated identities.
- `conformance/coverage-envelope/v0/input.schema.json` — pins each harness to its built-in adapter ID and digest and accepts paired source `observedAt`/`freshUntil` evidence.
- `conformance/coverage-envelope/v0/report.schema.json` — closes the new provenance and source-freshness fields, permits null identities only for machine-readable refusal, and adds the explicit non-authorizing/freshness/refusal reasons.
- `test/coverage-envelope-conformance.test.ts` — adds genuine regressions for discovery-only enforcement, fake adapter identity, provenance tampering, stale/future source evidence, future route evidence, harness/adapter mismatch, route-host mismatch, route subset/mapping mismatch, verified claims without evidence, conflicting bypass reasons, and fabricated CLI fallback identities.
- `.superpowers/sdd/task-3-coverage-envelope-report.md` — records round-2 scope, exact RED/GREEN evidence, verification, deviations, and risks.

## Deviations from the plan

None. Changes stayed within Task 3's approved file list. No `src/` file, external provider, credential, network service, repository-wide suite, push, or merge was touched. The pre-existing untracked `docs/superpowers/plans/2026-08-16-five-harness-conformance.md` remains untouched.

One non-evidence attempt ran `npx tsc --noEmit -p tsconfig.test.json` followed by the compiled test and therefore exercised stale `dist-test` output. It is intentionally excluded from RED/GREEN evidence. Every evidentiary focused run used the required emitting build first.

## Test results

### RED — fail-fast emitting build and focused regressions

Command:

```text
npx tsc -p tsconfig.test.json
node --test dist-test/test/coverage-envelope-conformance.test.js
```

Exit code: `1`

Verbatim tail:

```text
✖ discovery-only input cannot retain enforced mode even when caller marks every field verified (0.8327ms)
✖ the input contract binds the exact built-in adapter digest and report provenance (0.6154ms)
✖ source freshness is bounded and future-dated route or source observations are rejected (0.2121ms)
✖ report validation enforces harness, route mapping, subset, and verified-evidence invariants (0.2727ms)
✖ bypass reasons override conflicting wrapped evidence (0.5502ms)
✖ CLI refusal remains a closed schema-valid non-success envelope (159.4038ms)
ℹ tests 10
ℹ suites 0
ℹ pass 4
ℹ fail 6
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 497.2768

✖ failing tests:

✖ discovery-only input cannot retain enforced mode even when caller marks every field verified (0.8327ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

  'passed' !== 'failed'

✖ the input contract binds the exact built-in adapter digest and report provenance (0.6154ms)
  AssertionError [ERR_ASSERTION]: Missing expected exception.

✖ source freshness is bounded and future-dated route or source observations are rejected (0.2121ms)
  TypeError: coverage envelope input is invalid: data/sources/0 must NOT have additional properties, data/sources/0 must NOT have additional properties

✖ report validation enforces harness, route mapping, subset, and verified-evidence invariants (0.2727ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

  true !== false

✖ bypass reasons override conflicting wrapped evidence (0.5502ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected

  + [
  +   'route_1111111111111111111111111111111111111111111111111111111111111111'
  + ]
  - []

✖ CLI refusal remains a closed schema-valid non-success envelope (159.4038ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected

  + {
  +   id: 'codex',
  +   instanceIdentityDigest: 'sha256:1111111111111111111111111111111111111111111111111111111111111111'
  + }
  - null
```

### GREEN — final fail-fast emitting build and full focused suite

Command:

```text
npx tsc -p tsconfig.test.json
node --test dist-test/test/coverage-envelope-conformance.test.js
```

Exit code: `0`

Verbatim tail:

```text
✔ Codex and Claude discovery rows map to an observed envelope without gaining enforcement (23.0515ms)
✔ catalog-only, stale, and unwrapped route evidence are explicit non-success (1.166ms)
✔ verified completeness cannot override bypasses or unknown routing (0.4435ms)
✔ unknown, uncovered, unchecked, absent, and pending evidence never passes (0.8472ms)
✔ discovery-only input cannot retain enforced mode even when caller marks every field verified (0.3926ms)
✔ the input contract binds the exact built-in adapter digest and report provenance (0.9922ms)
✔ source freshness is bounded and future-dated route or source observations are rejected (0.5032ms)
✔ report validation enforces harness, route mapping, subset, and verified-evidence invariants (0.3575ms)
✔ bypass reasons override conflicting wrapped evidence (0.2316ms)
✔ CLI refusal remains a closed schema-valid non-success envelope (145.5318ms)
ℹ tests 10
ℹ suites 0
ℹ pass 10
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 456.3032
```

### Production and test typechecks plus whitespace

Command:

```text
npx tsc --noEmit
npx tsc --noEmit -p tsconfig.test.json
git diff --check
```

Exit code: `0`

Verbatim output: empty.

## Open risks

- This remains a detached conformance mapper, not an authenticated transport. Its provenance digest detects report mutation and binds all included commitments, while exact built-in adapter digests prevent adapter substitution; it does not prove that caller-supplied source bytes existed. The safety boundary is that discovery-only input is categorically non-authorizing and cannot become passed/enforced.
- Source timestamps remain optional on legacy input. Their absence is normalized to null, makes aggregate freshness `absent`, and adds `source-freshness-absent`; supplied timestamps are bounded to 24 hours and future observations are rejected.
- Null harness/adapter identities are accepted only for a failed, observed, empty refusal envelope with null provenance. They are never accepted as passing or enforced evidence.
- No repository-wide suite was run, per the round-2 instruction.
