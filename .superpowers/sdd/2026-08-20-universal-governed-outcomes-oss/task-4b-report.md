# Files changed

- `src/authority/host/dispatch.ts`
- `test/authority/dispatch-coordinator.test.ts`
- `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-4b-report.md`

# What changed

- `src/authority/host/dispatch.ts`: `bindCoordinatorDispatchCallDelegateV1` refuses a delegate already owned by any live coordinator call before mutating either WeakMap. Consumption compares the expected reservation/effect identity before revocation and revokes only an exact successful consume. `revokeCoordinatorDispatchCall` deletes the delegate entry only when that entry still belongs to the exact call binding being revoked. The internal capability and optional adapter ABI remain unchanged; prepared dispatch and reconciliation were not modified.
- `test/authority/dispatch-coordinator.test.ts`: adds deterministic second-before-first consumption checks. A rejected same-identity competing delegate cannot disturb the first exact binding; a rejected shared-delegate consume using the second call's crossed reservation/effect/state cannot steal the first call's binding. The first exact call remains consumable once. Coverage also pins success/throw cleanup; distinct-delegate isolation; fake, structural-copy, serialized, and proxy call/delegate refusal; optional one-argument adapter compatibility; and the existing prepared/reconcile paths and Task 4 race.
- `task-4b-report.md`: records scope, TDD evidence, verification output, deviations, and residual risks.

# Deviations from plan

- None in implementation scope. Only the three Task 4B files were changed.
- An initial source-mode probe using `node --import tsx` could not load because this repository does not depend on `tsx`. All authoritative tests used the repository-native `tsconfig.test.json` build followed by Node's test runner.
- No subagent review was used because the Task 4B brief explicitly prohibited subagents. The final review was a direct inspection of `4660630b..HEAD`, the scoped file list, and `git diff --check`.

# Test results

Fix-round RED command:

```text
npx tsc -p tsconfig.test.json --pretty false
node --test --test-concurrency=1 dist-test/test/authority/dispatch-coordinator.test.js

tests 20
suites 0
pass 19
fail 1
cancelled 0
skipped 0
todo 0
duration_ms 391.6577

actual:   { firstBound: true, secondBound: false, rejectedSecondConsumed: false, firstConsumed: false, firstConsumedAgain: false }
expected: { firstBound: true, secondBound: false, rejectedSecondConsumed: false, firstConsumed: true, firstConsumedAgain: false }
```

This reproduces the review blocker: the rejected second consume revoked the first live binding before comparing identity.

Fix-round GREEN command:

```text
npx tsc -p tsconfig.test.json --pretty false
node --test --test-concurrency=1 dist-test/test/authority/dispatch-coordinator.test.js

tests 20
suites 0
pass 20
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 408.3061
```

The same-identity competing delegate is also attempted before the first exact delegate: rejected consume false, then first consume true once and false thereafter.

Final focused verification repeated after the report update:

```text
npx tsc -p tsconfig.test.json --pretty false
node --test --test-concurrency=1 dist-test/test/authority/dispatch-coordinator.test.js

tests 20
pass 20
fail 0
duration_ms 346.6202
```

Initial Task 4B collision RED, retained for provenance:

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

Focused dispatch, transport, kernel, Task 4 pack, and package gate:

```text
npx tsc -p tsconfig.test.json --pretty false
node --test --test-concurrency=1 dist-test/test/authority/dispatch-coordinator.test.js dist-test/test/authority/effect-transports.test.js dist-test/test/authority/outcome-kernel.test.js dist-test/test/authority/github-linear-outcomes.test.js dist-test/test/authority/package.test.js

tests 83
suites 0
pass 83
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 3441.1013
```

Selected real Task 4 GitHub runner cases:

```text
node --test --test-concurrency=1 --test-name-pattern="generic reviewed pack|generic reviewed executor|signed reviewed PR|ambiguous merge reconciles" dist-test/test/authority/github-release-runner.test.js

tests 4
suites 0
pass 4
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 1969.4462
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
node --test --test-concurrency=1 dist-test/test/authority/github-release-runner.test.js

tests 65
suites 0
pass 44
fail 21
cancelled 0
skipped 0
todo 0
duration_ms 23543.5574
```

Full repository suite command, run to completion:

```text
npm test
exit 1
```

The fresh terminal capture retained the individual failure diagnostics but truncated its aggregate summary because of output volume. It reproduced the same inherited failure families: the 21 legacy GitHub release-runner expectations, Windows/Linux-host expectations, certification lifecycle expectation, absent `native/bootstrap-helper/manifest.json`, and absent Eve fixture dependency. The changed coordinator and Task 4 race tests passed in that full run. No aggregate total is inferred from truncated output.

The exact immediately preceding clean-HEAD baseline, retained for comparison, was:

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

Those 29 baseline failures are outside Task 4B: the 21 inherited legacy GitHub release-runner expectations; five Authority Cell Linux-host expectations exercised on Windows; one pre-existing certification lifecycle digest mismatch; the absent `native/bootstrap-helper/manifest.json`; and the absent Eve 0.39.0 fixture dependency.

Final scoped diff checks:

```text
git diff --check
exit 0

git diff --name-only 330e100c..HEAD
.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-4b-report.md
src/authority/host/dispatch.ts
test/authority/dispatch-coordinator.test.ts
```

# Open risks

- The complete repository remains non-green for the documented inherited and environment-dependent failures above. None originates in the Task 4B diff.
- The collision proof is hermetic and deterministic; no live provider or external write was exercised.
- WeakMap ownership remains process-local by design. The change closes concurrent live-call aliasing within the host process without introducing durable state or widening the private API.
