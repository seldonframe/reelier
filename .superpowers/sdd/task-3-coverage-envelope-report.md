# Files changed

- `conformance/coverage-envelope/v0/check.mjs`
- `conformance/coverage-envelope/v0/report.schema.json`
- `test/coverage-envelope-conformance.test.ts`
- `.superpowers/sdd/task-3-coverage-envelope-brief.md`
- `.superpowers/sdd/task-3-coverage-envelope-report.md`

## What changed per file

- `conformance/coverage-envelope/v0/check.mjs` — expands the route evidence commitment from
  `(routeId, evidenceDigest)` pairs to every original `RouteCoverageV1` semantic field; adds a
  complete original-input commitment; requires the original closed adapter input when validating
  an ordinary report; compares harness/adapter identity, route semantics, source
  identities/statuses, claims, and evaluation time to that input; and independently recomputes
  routing, freshness, subsets, reasons, mode, status, provenance, and whole-report integrity.
- `conformance/coverage-envelope/v0/report.schema.json` — closes provenance over the new
  `inputCommitmentDigest` as well as the full-semantic `routeEvidenceDigest`.
- `test/coverage-envelope-conformance.test.ts` — updates commitment fixtures and ordinary report
  validation to supply the original input; proves a report without that input is rejected; and
  adds genuine RED/GREEN regressions for a fully recomputed route-status upgrade and a fully
  recomputed claim upgrade.
- `.superpowers/sdd/task-3-coverage-envelope-brief.md` — explicitly defines v0 as discovery-only:
  enforced input is schema-rejected, accepted ordinary reports remain `observed`/`failed`, and no
  enforced pass is possible until a trusted live adapter provenance channel exists.
- `.superpowers/sdd/task-3-coverage-envelope-report.md` — records round-4 scope, exact RED/GREEN
  evidence, the discovery-only deviation/gap, commits, verification, and remaining risks.

## Deviations from the plan and why

The intended coverage envelope included an enforced mode, but this v0 adapter boundary has no
trusted live provenance channel proving that the supplied rows and commitments came from the named
running adapter. Enforced input is therefore rejected as invalid/non-success, and v0 cannot emit
`passed` or `enforced`. This is an explicit gap, not a simulated enforced pass. The full-input and
route commitments provide mutation resistance only when validation receives the original closed
input; they do not turn asserted provenance into verified provenance.

No file outside the Task 3 brief's approved list was modified. `input.schema.json` did not require a
round-4 edit because it already closes `requestedMode` to `observed`. No `src/` file, external call,
credential, provider, push, merge, formatter, or codemod was used. The pre-existing untracked
`docs/superpowers/plans/2026-08-16-five-harness-conformance.md` remains untouched.

## Test results

### RED — emitting build followed by the focused 12-test suite

Commands:

```text
npx tsc -p tsconfig.test.json
node --test dist-test/test/coverage-envelope-conformance.test.js
```

Exit codes: `0`, `1`

Verbatim tail:

```text
ℹ tests 12
ℹ suites 0
ℹ pass 10
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 463.9098

✖ failing tests:

test at dist-test\test\coverage-envelope-conformance.test.js:237:1
✖ report validation rejects a recomputed route status upgrade without the original adapter input (1.1216ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

  true !== false

test at dist-test\test\coverage-envelope-conformance.test.js:258:1
✖ report validation rejects a recomputed claim upgrade without the original input commitment (0.6142ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

  true !== false
```

The emitting build completed before the focused test process. Only the two new regressions failed;
the prior ten tests passed.

### GREEN — final emitting build followed by the focused 12-test suite

Commands:

```text
npx tsc -p tsconfig.test.json
node --test dist-test/test/coverage-envelope-conformance.test.js
```

Exit codes: `0`, `0`

Verbatim focused-suite output:

```text
✔ Codex and Claude discovery rows map to an observed envelope without gaining enforcement (24.779ms)
✔ catalog-only, stale, and unwrapped route evidence are explicit non-success (1.6613ms)
✔ discovery-only completeness claims cannot override bypasses or unknown routing (0.5785ms)
✔ unknown, uncovered, unchecked, absent, and pending evidence never passes (1.4223ms)
✔ the discovery-only contract rejects an enforced request and labels asserted provenance honestly (1.4106ms)
✔ the input contract binds built-in adapter identity and adapter-produced route evidence (1.0675ms)
✔ source freshness is bounded and future-dated route or source observations are rejected (0.9181ms)
✔ report validation recomputes reasons, route mappings, evidence, claims, and status invariants (1.7182ms)
✔ report validation rejects a recomputed route status upgrade without the original adapter input (0.6097ms)
✔ report validation rejects a recomputed claim upgrade without the original input commitment (0.5994ms)
✔ bypass reasons override conflicting wrapped evidence (0.4868ms)
✔ CLI refusal remains a closed schema-valid non-success envelope (145.084ms)
ℹ tests 12
ℹ suites 0
ℹ pass 12
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 464.3571
```

### Source and test typechecks

Commands:

```text
npx tsc --noEmit
npx tsc --noEmit -p tsconfig.test.json
```

Exit codes: `0`, `0`

Verbatim output: empty.

### Diff check

Command:

```text
git diff --check
```

Exit code: `0`

Verbatim output:

```text
warning: in the working copy of '.superpowers/sdd/task-3-coverage-envelope-report.md', LF will be replaced by CRLF the next time Git touches it
```

## Open risks

- Adapter and source provenance remains asserted, not verified. Requiring the original input
  prevents standalone report re-hashing from upgrading semantics, but the original input itself is
  not delivered over a trusted live adapter provenance channel.
- The commitments are unkeyed SHA-256 integrity commitments, not signatures. A party controlling
  both report and alleged original input can replace both; v0 therefore remains discovery-only and
  non-authorizing.
- `validateCoverageEnvelopeReport` now intentionally needs the original input for ordinary reports.
  Callers retaining only a report receive `false`; refusal reports remain independently valid.
- A future enforced contract needs authenticated adapter/source proof material and an independently
  trusted channel before adding any passing or enforced schema branch.
