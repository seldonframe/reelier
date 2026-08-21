# Files changed

- `src/authority/host/dispatch.ts`
- `test/authority/dispatch-coordinator.test.ts`
- `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-4b-report.md`

# What changed

- `src/authority/host/dispatch.ts`: `bindCoordinatorDispatchCallDelegateV1` now refuses a delegate already owned by any live coordinator call before mutating either WeakMap. `revokeCoordinatorDispatchCall` deletes the delegate entry only when that entry still belongs to the exact call binding being revoked. The internal capability and optional adapter ABI remain unchanged; prepared dispatch and reconciliation were not modified.
- `test/authority/dispatch-coordinator.test.ts`: adds a deterministic two-live-call shared-delegate collision barrier. The RED result reproduced `firstBound=true`, `secondBound=true`, then two failed exact-first consumption attempts. The GREEN result requires first bind true, second bind false, exact first consumption true once. Coverage also pins success/throw cleanup; fake, structural-copy, serialized, and proxy call/delegate refusal; crossed reservation/effect/state refusal; optional one-argument adapter compatibility; and the existing prepared/reconcile paths.
- `task-4b-report.md`: records scope, TDD evidence, verification output, deviations, and residual risks.

# Deviations from plan

- None in implementation scope. Only the three Task 4B files were changed.
- An initial source-mode probe using `node --import tsx` could not load because this repository does not depend on `tsx`. All authoritative tests used the repository-native `tsconfig.test.json` build followed by Node's test runner.
- No subagent review was used because the Task 4B brief explicitly prohibited subagents. The final review was a direct inspection of `4660630b..HEAD`, the scoped file list, and `git diff --check`.

# Test results

RED, after correcting the Windows host seam in the test fixture:

```text
tests 18
suites 0
pass 17
fail 1
cancelled 0
skipped 0
todo 0
duration_ms 392.3013

actual:   { firstBound: true, secondBound: true, firstConsumed: false, firstConsumedAgain: false }
expected: { firstBound: true, secondBound: false, firstConsumed: true, firstConsumedAgain: false }
```

Focused dispatch coordinator after GREEN:

```text
tests 20
suites 0
pass 20
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 386.7903
```

Focused dispatch, transport, kernel, Task 4 pack, and package gate:

```text
tests 83
suites 0
pass 83
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 3432.6769
```

Selected real Task 4 GitHub runner cases:

```text
tests 4
suites 0
pass 4
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 2106.2001
```

Production and test TypeScript graphs:

```text
npx tsc -p tsconfig.json --noEmit --pretty false
npx tsc -p tsconfig.test.json --pretty false
exit 0
```

Build and contract checks:

```text
> reelier@0.32.1 build
> node scripts/build-authority-contract.mjs --check && node scripts/build-bootstrap-contract.mjs --check && tsc -p tsconfig.json && node scripts/build-authority-contract.mjs --copy-schemas && node scripts/build-packs.mjs

built cloudflare_api_token, cloudflare_dns, github_issue_labels, github_release, gmail, gmail_labels, hubspot_slack_information_flow, neon_database, slack_channel_topic, stripe, vercel_deployment

> reelier@0.32.1 check:authority-contract
> node scripts/build-authority-contract.mjs --check

> reelier@0.32.1 check:outcome-profile-contract
> node scripts/build-outcome-profile-contract.mjs --check

> reelier@0.32.1 check:bootstrap-contract
> node scripts/build-bootstrap-contract.mjs --check
```

Fresh complete release-runner file, unchanged inherited baseline:

```text
tests 65
suites 0
pass 44
fail 21
cancelled 0
skipped 0
todo 0
duration_ms 24293.8023
```

Full repository suite, run to completion:

```text
tests 3721
suites 0
pass 3671
fail 29
cancelled 0
skipped 21
todo 0
duration_ms 496321.6204
```

The 29 failures are outside Task 4B: the 21 inherited legacy GitHub release-runner expectations; five Authority Cell Linux-host expectations exercised on Windows; one pre-existing certification lifecycle digest mismatch; the absent `native/bootstrap-helper/manifest.json`; and the absent Eve 0.39.0 fixture dependency. The Task 4B coordinator block passed 20/20 inside this full run.

Final scoped diff checks before the report commit:

```text
git diff --check
exit 0

git diff --name-only 4660630b..HEAD
src/authority/host/dispatch.ts
test/authority/dispatch-coordinator.test.ts
```

# Open risks

- The complete repository remains non-green for the documented inherited and environment-dependent failures above. None originates in the Task 4B diff.
- The collision proof is hermetic and deterministic; no live provider or external write was exercised.
- WeakMap ownership remains process-local by design. The change closes concurrent live-call aliasing within the host process without introducing durable state or widening the private API.
