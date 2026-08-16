# Files changed

- `conformance/coverage-envelope/v0/check.mjs`
- `conformance/coverage-envelope/v0/input.schema.json`
- `conformance/coverage-envelope/v0/report.schema.json`
- `test/coverage-envelope-conformance.test.ts`
- `.superpowers/sdd/task-3-coverage-envelope-report.md`

## What changed per file

- `conformance/coverage-envelope/v0/check.mjs` — makes v0 explicitly discovery-only; validates a caller commitment recomputed from the existing route adapter rows' `(routeId, evidenceDigest)` pairs; labels adapter/source provenance as asserted; separates whole-envelope integrity from provenance; recomputes reasons, route subsets, freshness, claims, status, adapter/harness identity, route evidence, and refusal semantics; and requires canonical, real, non-future observations with freshness bounded to the existing 24-hour route limit.
- `conformance/coverage-envelope/v0/input.schema.json` — restricts `requestedMode` to `observed` and requires `routeEvidenceDigest`.
- `conformance/coverage-envelope/v0/report.schema.json` — removes the unreachable passed/enforced branch, closes v0 to failed/observed discovery reports, replaces misleading `provenanceDigest` with explicit asserted `provenance` plus `integrityDigest`, and closes the new reason vocabulary.
- `test/coverage-envelope-conformance.test.ts` — adds regressions for mismatched adapter-produced evidence, removed reasons with recomputed integrity, contradictory source/status claims with recomputed integrity, malformed refusal reports, impossible canonical dates, future observations, and freshness beyond `MAX_ROUTE_FRESHNESS_MS` semantics.
- `.superpowers/sdd/task-3-coverage-envelope-report.md` — records round-3 scope, RED/GREEN and mutation evidence, verification, deviations, and residual risks.

## Deviations from the plan

None. The change is intentionally discovery-only because the existing route adapter output exposes route evidence commitments but does not expose a verifiable proof linking those rows back to adapter/source preimages. No `src/` file was modified. No external provider, credential, network service, push, merge, or repository-wide formatter was used. The pre-existing untracked `docs/superpowers/plans/2026-08-16-five-harness-conformance.md` remains untouched.

## Test results

### RED — required emitting build followed by focused suite

Commands:

```text
npx tsc -p tsconfig.test.json
node --test dist-test/test/coverage-envelope-conformance.test.js
```

Exit codes: `0`, `1`

Verbatim tail:

```text
ℹ tests 10
ℹ suites 0
ℹ pass 0
ℹ fail 10
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 454.6804

✖ failing tests:

✖ Codex and Claude discovery rows map to an observed envelope without gaining enforcement (19.3524ms)
  TypeError: coverage envelope input is invalid: data must NOT have additional properties

✖ the input contract binds built-in adapter identity and adapter-produced route evidence (0.7966ms)
  AssertionError [ERR_ASSERTION]: The input did not match the regular expression /route.*evidence|commitment/i.

✖ CLI refusal remains a closed schema-valid non-success envelope (144.5238ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected

  + undefined
  - null
```

### Mutation RED — exact reason recomputation removed

Commands:

```text
npx tsc -p tsconfig.test.json
node --test --test-name-pattern "report validation recomputes" dist-test/test/coverage-envelope-conformance.test.js
```

Exit codes: `0`, `1`

Verbatim tail:

```text
✖ report validation recomputes reasons, route mappings, evidence, claims, and status invariants (7.5376ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 291.1436

AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

true !== false
```

### Mutation RED — route evidence commitment check removed

Commands:

```text
npx tsc -p tsconfig.test.json
node --test --test-name-pattern "input contract binds" dist-test/test/coverage-envelope-conformance.test.js
```

Exit codes: `0`, `1`

Verbatim tail:

```text
✖ the input contract binds built-in adapter identity and adapter-produced route evidence (7.2038ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 284.5939

AssertionError [ERR_ASSERTION]: The input did not match the regular expression /route.*evidence|commitment/i. Input:

'TypeError: coverage envelope report is invalid: No errors'
```

### Mutation RED — canonical timestamp check removed

Commands:

```text
npx tsc -p tsconfig.test.json
node --test --test-name-pattern "source freshness is bounded" dist-test/test/coverage-envelope-conformance.test.js
```

Exit codes: `0`, `1`

Verbatim tail:

```text
✖ source freshness is bounded and future-dated route or source observations are rejected (6.8905ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 286.999

AssertionError [ERR_ASSERTION]: Missing expected exception.
```

### GREEN — final required emitting build and focused suite

Commands:

```text
npx tsc -p tsconfig.test.json
node --test dist-test/test/coverage-envelope-conformance.test.js
```

Exit codes: `0`, `0`

Verbatim focused-suite output:

```text
✔ Codex and Claude discovery rows map to an observed envelope without gaining enforcement (24.6837ms)
✔ catalog-only, stale, and unwrapped route evidence are explicit non-success (1.5692ms)
✔ discovery-only completeness claims cannot override bypasses or unknown routing (0.5077ms)
✔ unknown, uncovered, unchecked, absent, and pending evidence never passes (0.9086ms)
✔ the discovery-only contract rejects an enforced request and labels asserted provenance honestly (0.8445ms)
✔ the input contract binds built-in adapter identity and adapter-produced route evidence (1.1015ms)
✔ source freshness is bounded and future-dated route or source observations are rejected (1.0692ms)
✔ report validation recomputes reasons, route mappings, evidence, claims, and status invariants (0.8049ms)
✔ bypass reasons override conflicting wrapped evidence (0.3096ms)
✔ CLI refusal remains a closed schema-valid non-success envelope (144.4242ms)
ℹ tests 10
ℹ suites 0
ℹ pass 10
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 448.9859
```

### Typechecks

Command:

```text
npx tsc --noEmit
npx tsc --noEmit -p tsconfig.test.json
```

Exit code: `0`

Verbatim output: empty.

### Diff check

Command:

```text
git diff --check
```

Exit code: `0`

Verbatim output:

```text
warning: in the working copy of 'test/coverage-envelope-conformance.test.ts', LF will be replaced by CRLF the next time Git touches it
```

## Open risks

- Adapter and source provenance is deliberately asserted, not verified. The route evidence commitment proves that the envelope consumed the named adapter output rows without mutation; it does not prove which process produced those rows or validate hidden source preimages.
- This v0 contract cannot emit `passed` or `enforced`. A future verified contract needs adapter/source proof material exposed by the route adapter boundary and independently validated before it can authorize execution.
- Source timestamps remain optional for legacy discovery input. Missing source timestamps produce `source-freshness-absent`; supplied timestamps are canonicalized semantically and bounded to 24 hours.
