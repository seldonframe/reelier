# Files changed

- `src/authority/host/dispatch.ts`
- `test/authority/dispatch-coordinator.test.ts`
- `src/authority/host/effect-transports.ts`
- `test/authority/effect-transports.test.ts`
- `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-4b-report.md`

# What changed

- `src/authority/host/dispatch.ts`: `bindCoordinatorDispatchCallDelegateV1` refuses a delegate already owned by any live coordinator call before mutating either WeakMap. Consumption compares the expected reservation/effect identity before revocation and revokes only an exact successful consume. `revokeCoordinatorDispatchCall` deletes the delegate entry only when that entry still belongs to the exact call binding being revoked. The internal capability and optional adapter ABI remain unchanged; prepared dispatch and reconciliation were not modified.
- `test/authority/dispatch-coordinator.test.ts`: adds deterministic second-before-first consumption checks. A rejected same-identity competing delegate cannot disturb the first exact binding; a rejected shared-delegate consume using the second call's crossed reservation/effect/state cannot steal the first call's binding. The first exact call remains consumable once. Coverage also pins success/throw cleanup; distinct-delegate isolation; fake, structural-copy, serialized, and proxy call/delegate refusal; optional one-argument adapter compatibility; and the existing prepared/reconcile paths and Task 4 race.
- `src/authority/host/effect-transports.ts`: the compiled dispatch adapter now treats a refused coordinator delegate bind as a deterministic definitive failure before host binding resolution, executor access, or provider dispatch. Direct predecessor calls without a coordinator call and authoritative readback are unchanged.
- `test/authority/effect-transports.test.ts`: adds a real re-entrant compiled-adapter collision through a genuine live coordinator call. The second invocation is refused with zero additional host resolutions/provider calls, while the first bound authority remains consumable exactly once.
- `task-4b-report.md`: records scope, TDD evidence, verification output, deviations, and residual risks.

# Deviations from plan

- None in implementation scope. The round-two plan amendment authorized the two effect-transport files; Task 4B changes remain confined to the five files listed above.
- An initial source-mode probe using `node --import tsx` could not load because this repository does not depend on `tsx`. All authoritative tests used the repository-native `tsconfig.test.json` build followed by Node's test runner.
- No subagent review was used because the Task 4B brief explicitly prohibited subagents. The final review was a direct inspection of `4660630b..HEAD`, the scoped file list, and `git diff --check`.

# Test results

Round-two adapter-boundary RED command:

```text
npx tsc -p tsconfig.test.json --pretty false
node --test --test-concurrency=1 dist-test/test/authority/effect-transports.test.js

tests 24
suites 0
pass 23
fail 1
cancelled 0
skipped 0
todo 0
duration_ms 183.4926

actual:   { first: "acknowledged", second: "acknowledged", hostResolutions: 2, providerCalls: 2 }
expected: { first: "acknowledged", second: "definitive-failure", hostResolutions: 1, providerCalls: 1 }
```

Round-two GREEN, including all prior coordinator collision checks:

```text
npx tsc -p tsconfig.test.json --pretty false
node --test --test-concurrency=1 dist-test/test/authority/effect-transports.test.js dist-test/test/authority/dispatch-coordinator.test.js

tests 44
suites 0
pass 44
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 583.3431
```

The first provider authority consumed `true` once and `false` thereafter. The re-entrant second invocation returned `definitive-failure` while both `hostResolutions` and `providerCalls` remained exactly `1`.

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

tests 84
suites 0
pass 84
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 3263.5695
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
duration_ms 1933.5017
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

Full repository suite command, run to completion with an aggregate-only terminal filter:

```text
npm test 2>&1 | Select-String -Pattern '^ℹ (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)'
exit 1

tests 3722
suites 0
pass 3672
fail 29
cancelled 0
skipped 21
todo 0
duration_ms 541972.1678
```

The unchanged 29 failures are outside Task 4B: the 21 inherited legacy GitHub release-runner expectations; five Authority Cell Linux-host expectations exercised on Windows; one pre-existing certification lifecycle digest mismatch; the absent `native/bootstrap-helper/manifest.json`; and the absent Eve 0.39.0 fixture dependency. The added regression accounts for the increase from the preceding 3,721/3,671 baseline to 3,722/3,672.

Final scoped diff checks:

```text
git diff --check
exit 0

git diff --name-only 0ee994de..HEAD
.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-4b-report.md
src/authority/host/effect-transports.ts
test/authority/effect-transports.test.ts
```

# Open risks

- The complete repository remains non-green for the documented inherited and environment-dependent failures above. None originates in the Task 4B diff.
- The collision proof is hermetic and deterministic; no live provider or external write was exercised.
- WeakMap ownership remains process-local by design. The change closes concurrent live-call aliasing within the host process without introducing durable state or widening the private API.
- Compiled dispatch creates a fresh frozen executor-authority object per invocation, so literal shared-object collision is not constructible through that adapter ABI. The test exercises the real bind-refusal path by re-entering with the same genuine live coordinator call; the helper-level two-live-call test separately pins shared-delegate ownership.
