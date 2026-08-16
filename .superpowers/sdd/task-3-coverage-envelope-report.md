# Files changed

- `conformance/coverage-envelope/v0/check.mjs`
- `.superpowers/sdd/task-3-coverage-envelope-report.md`

## What changed per file

- `conformance/coverage-envelope/v0/check.mjs` — changed the shared CLI fallback report from an empty, schema-invalid `sources` array to one closed `host-config` source row whose evidence is explicitly `absent` with reason `input-unavailable`. The fallback remains `failed`, remains in `observed` mode, retains an empty inventory and `no-routes-discovered`, and preserves exit code 2 for missing arguments and exit code 1 for rejected input.
- `.superpowers/sdd/task-3-coverage-envelope-report.md` — recorded the fix-round scope, exact RED/GREEN evidence, deviations, and remaining gap.

The existing regression in `test/coverage-envelope-conformance.test.ts` was retained unchanged from commit `8309dd9`. It exercises the real CLI process, asserts refusal exit code 2, parses stdout, validates the fallback against the closed report schema, and confirms non-success semantics.

## Deviations from the plan

None. The fix stayed within the Task 3 file list. The report schema was not weakened: `sources` still requires at least one item, and the fallback now honestly supplies an absent-evidence source row. The untracked `docs/superpowers/plans/2026-08-16-five-harness-conformance.md` file present before this fix round was not modified or staged.

## Test results

### Fail-fast compile before RED

Command:

```text
npx tsc --noEmit -p tsconfig.test.json
```

Exit code: `0`

Verbatim output: empty.

### RED — retained CLI refusal regression before the fix

Command:

```text
node --test --test-name-pattern "CLI refusal" dist-test/test/coverage-envelope-conformance.test.js
```

Exit code: `1`

Verbatim tail:

```text
✖ CLI refusal remains a closed schema-valid non-success envelope (139.8392ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 435.7986

✖ failing tests:

test at dist-test\test\coverage-envelope-conformance.test.js:167:1
✖ CLI refusal remains a closed schema-valid non-success envelope (139.8392ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

  false !== true

      at TestContext.<anonymous> (file:///C:/Users/maxim/CascadeProjects/reelier/.worktrees/five-harness-conformance/dist-test/test/coverage-envelope-conformance.test.js:172:12)
```

The failure was at `validateCoverageEnvelopeReport(report)`: the fallback emitted `sources: []`, while the closed report schema requires `sources.minItems: 1`.

### GREEN — focused CLI refusal regression after the fix

Command:

```text
node --test --test-name-pattern "CLI refusal" dist-test/test/coverage-envelope-conformance.test.js
```

Exit code: `0`

Verbatim tail:

```text
✔ CLI refusal remains a closed schema-valid non-success envelope (139.1577ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 413.2357
```

### Final fail-fast compile

Command:

```text
npx tsc --noEmit -p tsconfig.test.json
```

Exit code: `0`

Verbatim output: empty.

### Full focused coverage-envelope suite

Command:

```text
node --test dist-test/test/coverage-envelope-conformance.test.js
```

Exit code: `0`

Verbatim tail:

```text
✔ Codex and Claude discovery rows map to an observed envelope without gaining enforcement (23.5996ms)
✔ catalog-only, stale, and unwrapped route evidence are explicit non-success (1.0064ms)
✔ verified completeness cannot override bypasses or unknown routing (0.3623ms)
✔ unknown, uncovered, unchecked, absent, and pending evidence never passes (0.5078ms)
✔ only a fresh fully verified envelope can retain enforced mode and pass (0.2405ms)
✔ the input contract is exact and binds adapter identity to the harness (0.481ms)
✔ CLI refusal remains a closed schema-valid non-success envelope (134.9716ms)
ℹ tests 7
ℹ suites 0
ℹ pass 7
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 435.0605
```

### Production typecheck

Command:

```text
npx tsc --noEmit
```

Exit code: `0`

Verbatim output: empty.

### Diff whitespace check

Command:

```text
git diff --check
```

Exit code: `0`

Verbatim output: empty.

## Open risks

- Missing arguments, malformed JSON, unreadable input, schema rejection, and semantic rejection intentionally use the same generic absent-evidence fallback. The closed v0 report does not encode a more specific CLI-refusal cause.
- The fallback carries deterministic non-zero placeholder commitments because the closed v0 schema requires digest-shaped source, harness, and adapter identities even when input evidence is absent. They are paired with `evidenceStatus: "absent"` and must not be interpreted as observed source evidence.
- This fix round did not change discovery, authority, execution, completeness, provider outcome, receipt, Eve, or Grok behavior.
