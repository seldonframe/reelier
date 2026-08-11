# Files changed

- `src/authority/host/fs-ledger.ts`
- `test/authority/ledger.test.ts`
- `.superpowers/sdd/task-1-windows-marker-recovery-report.md`

## What changed per file

### `src/authority/host/fs-ledger.ts`

- Extended the existing operation-scoped cleanup continuation record with a closed `prep-retired | slot-retired` purpose.
- When a permitted slot-retired cleanup creates its zero-length stage, binds that exact file identity to the active K1 operation capability.
- Carries the same identity and purpose through the stage-to-ack rename.
- Allows over-budget continuation only when the current closed snapshot contains that exact file identity, the capability is still the initiating operation, the purpose matches, and the existing dead-owner route remains authorized.
- Clears the continuation when the exact orphan slot ack or aborted-terminal chain ack is removed. The existing operation-finalizer also clears it on every exit.

### `test/authority/ledger.test.ts`

- Added a deterministic marker-only crash-window regression that advances the injected monotonic clock beyond the original deadline immediately after `slot-only-cleanup-stage-zero`.
- The regression requires exact convergence to `{ok:true,status:"advanced"}` and removal of the marker, stage, ack, and bound terminal. Before the production change it failed with the CI symptom `{ok:false,reason:"busy"}`.

### `.superpowers/sdd/task-1-windows-marker-recovery-report.md`

- Records scope, root cause, verification evidence, deviations, and open risk for the remaining Task 1 Windows failure.

## Root cause

The marker-only fixture begins before any slot-retired cleanup stage exists, so it performs more durable transitions than marker-plus-stage, marker-plus-ack, and orphan-ack. On loaded Windows CI, the original acquisition budget could expire after the operation had exclusively created and authenticated the zero-length slot cleanup stage. The analogous prep-retired path already carried an exact file-identity capability through the rest of its initiating operation, but the slot-retired path did not. On the next closed-snapshot classification, `budgetLive` was false and the otherwise exact withdrawn-chain transition was refused as `busy`.

The fix does not extend the deadline or accept `busy`. It preserves corruption/refusal honesty by requiring the same operation capability, closed purpose, deterministic lifecycle name, exact filesystem identity, and pre-existing dead-owner route authority.

## Deviations from the plan and why

None. Only the Task 1 production ledger file, focused ledger test, and this Task 1 report were changed. Task 2 was not started. The pre-existing untracked `.tmp-pack/` directory was not touched.

## Test results

### TDD red — deterministic regression before production change

Command:

```text
npx tsc -p tsconfig.test.json; node --test --test-concurrency=1 --test-name-pattern="atomic admission slot retirement and purpose-bound ack crash windows converge" dist-test/test/authority/ledger.test.js
```

Verbatim tail:

```text
✖ failing tests:

test at dist-test\test\authority\ledger.test.js:3392:13
✖ marker-only initiated stage crosses the original deadline (71.8812ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected
  
    {
  +   ok: false,
  +   reason: 'busy'
  -   observedAt: '2026-08-02T12:00:00.000Z',
  -   ok: true,
  -   status: 'advanced'
    }
```

### Focused fresh-process Windows stress

Command: 20 fresh invocations of the focused crash-window test.

Verbatim tail:

```text
iterations=20 pass=20 fail=0
▶ atomic admission slot retirement and purpose-bound ack crash windows converge
  ✔ marker-only (177.8216ms)
  ✔ marker-plus-stage (109.027ms)
  ✔ marker-plus-ack (91.57ms)
  ✔ orphan-ack (84.7407ms)
  ✔ marker-only initiated stage crosses the original deadline (147.2141ms)
✔ atomic admission slot retirement and purpose-bound ack crash windows converge (611.4741ms)
ℹ tests 6
ℹ suites 0
ℹ pass 6
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 754.3622
```

### Related continuation and cleanup tests

Verbatim tail:

```text
▶ atomic admission prep-retired ack windows converge only with creator or dead-owner authority
  ✔ marker-only (73.2733ms)
  ✔ marker-plus-ack (48.449ms)
  ✔ orphan-ack (35.0541ms)
✔ atomic admission prep-retired ack windows converge only with creator or dead-owner authority (157.3402ms)
ℹ tests 17
ℹ suites 0
ℹ pass 17
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1456.4252
```

### Complete ledger spec on Windows

Command:

```text
node --test --test-concurrency=1 dist-test/test/authority/ledger.test.js
```

Verbatim tail:

```text
ℹ tests 717
ℹ suites 0
ℹ pass 717
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 93771.1417
```

### Test compilation

Command:

```text
npx tsc -p tsconfig.test.json
```

Verbatim result:

```text
Exit code: 0
```

### Production build

Command:

```text
npm run build
```

Verbatim tail:

```text
> reelier@0.32.1 build
> tsc -p tsconfig.json && node scripts/build-authority-contract.mjs --copy-schemas && node scripts/build-packs.mjs

built cloudflare_api_token, cloudflare_dns, github_issue_labels, gmail, gmail_labels, hubspot_slack_information_flow, neon_database, slack_channel_topic, stripe, vercel_deployment
```

### Complete project suite on Windows

Command:

```text
npm test
```

Verbatim tail:

```text
ℹ tests 2715
ℹ suites 0
ℹ pass 2714
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 239482.9164
```

## Open risks

- The original CI failure occurred under the complete Windows suite's machine load. The deterministic boundary test, 20 fresh-process focused runs, and the complete 717-test Windows ledger spec are green locally, but the full cross-platform CI workflow still needs to confirm the exact hosted-runner environment.
- The continuation intentionally covers only the exact initiated slot cleanup file and the aborted-terminal removal of that same slot ack. It does not grant a new cleanup lifecycle, widen a deadline, or transfer authority to a later operation.
