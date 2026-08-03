Files changed

- `test/authority/ledger.test.ts`
- `docs/specs/compiled-authority-v1.md`
- `.superpowers/sdd/universal-compiled-authority/task-3b2-fairness-red-report.md`

## What changed per file

- `test/authority/ledger.test.ts`: corrected all publication-peer owner serialization so the runtime-only `ticket` property is non-enumerable and every `owner.json` remains the exact canonical `{host,nonce,pid,v}` bytes. Replaced the false-green same-ticket liveness-probe assertion with an actual caller-promotion election whose numeric PID order, decimal PID-text order, and nonce order disagree. Strengthened the lower-PID non-preemption test to retain exact caller owner bytes through waiting and observe zero publication renames/callbacks. Added deterministic RED coverage for reversed two-wave ticket/PID ordering; raw below/equal/above visible-max outputs; live MAX no-sample refusal; dead MAX cleanup and root sync before allocation; malformed/unverifiable pre-allocation refusal; collision ticket immutability and one admission-clock sample; creator replacement under another valid ticket; and identical owner bytes under arbitrary tickets in separate generations. Preserved the deep-module fallback unique-symbol compilation strategy, root-export exclusion, string-key isolation, default `hrtime.bigint()` test, duplicate host+PID corruption, and all migrated crash/election fixtures.
- `docs/specs/compiled-authority-v1.md`: replaced the stale PID-first grammar and removed the nonce-election contradiction. The spec now distinguishes syntactic filename fields (ticket, decimal PID text, nonce) from valid election (ticket, then decimal PID text for distinct PIDs); duplicate same-host+PID stages are corruption before election, so nonce is never a valid election tie-break.
- `.superpowers/sdd/universal-compiled-authority/task-3b2-fairness-red-report.md`: records the corrected RED history, exact verification commands/results, stress-block proof, deviations, and remaining risks.

## Correction history

The initial fairness RED commit `c326928` had three review-blocking gaps: helper-returned `ticket` values leaked into canonical owner serialization in migrated election fixtures; the same-ticket test observed only liveness-probe order rather than election; and the required deterministic allocation/lifecycle matrix was incomplete. Commit `0b473ee` corrects those gaps without modifying production.

The corrected tests fail against the unchanged pre-GREEN production for behavioral reasons: production still emits the old host/PID/nonce filename, rejects valid ticketed stages, does not expose the unique-symbol admission-clock seam, and does not implement ticket allocation/election/lifecycle rules. There are no missing-symbol imports or TypeScript fixture errors. The creator-ticket replacement case exposes the old production's uncaught `ENOENT` after the creator path is renamed; corrected production must classify that integrity replacement as corruption while preserving it.

## Deviations from plan

None. Production `src/**` remained frozen. The real 100-process stress test was neither edited nor run.

## Test results

TypeScript compilation:

```text
npx tsc --noEmit; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; npx tsc -p tsconfig.test.json
```

Verbatim result:

```text
Exit code: 0
```

Focused deterministic ticket/allocation/lifecycle RED:

```text
node --test --test-concurrency=1 --test-name-pattern "publication admission tickets|publication ticket validation|admission-clock seam|same-ticket distinct publishers|exact visible maximum|exact visible MAX|admission clock compares|visible MAX and invalid|dead MAX|malformed and unverifiable|rename collision retains the exact ticket|creator ticket replacement|identical canonical owner bytes" dist-test/test/authority/ledger.test.js
```

Verbatim tail:

```text
ℹ tests 34
ℹ suites 0
ℹ pass 7
ℹ fail 27
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 569.1016
```

Representative behavioral failures:

```text
publication admission tickets allocate after the visible maximum without changing owner authority
actual:   { ok: false, reason: 'corruption' }
expected: { ok: false, reason: 'busy' }

raw zero becomes ticket one
actual:   .authority-ledger-lock-publication-<host64>-<pid>-<nonce64>.tmp
expected: .authority-ledger-lock-publication-<host64>-0000000000000001-<pid>-<nonce64>.tmp

live visible MAX
actual:   { ok: false, reason: 'corruption' }
expected: { ok: false, reason: 'busy' }

unverifiable
actual liveness probes: 0
expected liveness probes: 1

rename collision retains the exact ticket and samples admission once
actual admission samples: 0
expected admission samples: 1
```

Focused migrated crash/election compatibility RED:

```text
node --test --test-concurrency=1 --test-name-pattern "owner publication hard-exit boundaries|publication-stage multiplicity|a lower live predecessor|a non-head contender|completed membership re-election|an elected head|safely closed live generation" dist-test/test/authority/ledger.test.js
```

Verbatim tail:

```text
ℹ tests 17
ℹ suites 0
ℹ pass 3
ℹ fail 14
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1977.4099
```

These migrated fixtures fail at the exact old/new grammar boundary (old production creates no ticketed match or rejects seeded ticketed stages). The post-rename/root-sync crash cases and duplicate-host+PID corruption control remain green where their result is grammar-independent.

Whitespace verification:

```text
git diff --check HEAD^ HEAD
```

Verbatim result: no output, exit code 0.

Independent stress-block comparison used the exact byte range from the stress-test declaration through the next test declaration in each Git blob:

```text
bc9e730 bytes=905 sha256=c8cace4740ab944ae206f34e69e68632a469d8435c58e73c64b555e962aa5f33
HEAD bytes=905 sha256=c8cace4740ab944ae206f34e69e68632a469d8435c58e73c64b555e962aa5f33
```

The blocks are byte-identical. The 100-process test was not executed.

## Open risks

- RED is intentionally not production-ready: GREEN must add the deep-module unique-symbol seam and ticket protocol without exporting the symbol through `authority/index.ts` or accepting a string-keyed clock.
- GREEN review should run the corrected focused set first, then the wider non-stress suite, and only run the unchanged 100-process stress test in its authorized GREEN/stress phase.
- The fixture helper makes `ticket` non-enumerable so stage construction can read it while canonical serialization cannot emit it; GREEN review should retain assertions that every peer `owner.json` equals `authorityCanonicalBytes({host,nonce,pid,v})`.
