Files changed

- `src/authority/host/fs-ledger.ts`
- `test/authority/ledger.test.ts`
- `.superpowers/sdd/2026-08-11-authority-cell-certification-train/windows-ledger-convergence-investigation.md`

# Windows owned-preparation loss fix

## What changed per file

- `src/authority/host/fs-ledger.ts`: maps ENOENT after exclusive preparation creation to
  `LedgerCorruption` during owner creation, exact validation, and promotion. It adds one private
  post-final-revalidation fault seam so rename-time disappearance is reachable. Other transient
  errors, deadlines, authenticated housekeeping transitions, and convergence behavior are unchanged.
- `test/authority/ledger.test.ts`: table-drives deletion of the creator's exact preparation at all
  seven construction/promotion seams and requires `{ok:false,reason:"corruption"}` without a raw
  filesystem exception. Existing liveness-routing diagnostics remain.
- This report records RED/GREEN and verification evidence.

## Root cause and commits

The creator had no uniform owned-preparation disappearance rule. Deletion immediately after
`after-admission-prep-create` leaked raw ENOENT from `open(owner.json)`. Deletion after final exact
validation could make promotion `rename` return ENOENT, which the generic transient branch converted
to `busy`. Both contradict the invariant that unexplained loss of an exact owned identity is
corruption; only authenticated monotonic retirement/cleanup lineage may be treated as progress.

- RED: `00f2ae2 test(ledger): pin owned prep disappearance seams`
- GREEN: `f2522a2 fix(ledger): fail closed on owned prep loss`

Earlier partial hardening remains in `cf21e39` and `5a54237`; `29ed08e`'s unsafe initial success
expectation was superseded by `cf21e39`.

## Deviations

None from the bounded reviewer fix. This change does not claim to resolve the separate hosted
all-busy/no-winner convergence failure from run `31596294603`; no convergence algorithm changed.

## Test results (verbatim tails)

RED:

```text
✖ after-admission-prep-create (30.538ms)
Error: ENOENT: no such file or directory, open '...admission-prep...tmp\\owner.json'
ℹ pass 5
ℹ fail 2
```

Focused deletion plus complete prep-housekeeper parent:

```text
✔ prep-only housekeeper revalidates one-use authority before mutation (1757.434ms)
ℹ tests 30
ℹ pass 30
ℹ fail 0
ℹ duration_ms 2031.8355
```

Three N100 repetitions:

```text
N100 ATTEMPT 3
✔ 100 real processes converge on one committed reservation and one dispatch eligibility (32347.0622ms)
ℹ tests 1
ℹ pass 1
ℹ fail 0
ℹ duration_ms 32783.1362
```

Build and contract:

```text
> reelier@0.32.1 build
> tsc -p tsconfig.json && node scripts/build-authority-contract.mjs --copy-schemas && node scripts/build-packs.mjs
built cloudflare_api_token, cloudflare_dns, github_issue_labels, gmail, gmail_labels, hubspot_slack_information_flow, neon_database, slack_channel_topic, stripe, vercel_deployment
> reelier@0.32.1 check:authority-contract
> node scripts/build-authority-contract.mjs --check
```

## Open risks

- Hosted Windows convergence remains independently unresolved: exact merge `13ed819` twice produced
  no winner, and one run emitted no prep-housekeeping events. Local N100 passed three fresh repeats;
  that does not falsify the hosted result.
- CI has not run the new owned-preparation deletion matrix.
