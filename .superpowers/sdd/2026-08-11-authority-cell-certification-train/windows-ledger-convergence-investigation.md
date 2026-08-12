# Windows ledger convergence investigation

Status: **release blocker remains open**.

## Hosted falsifiers

Exact merge commit `13ed819` produced two failing Windows executions in GitHub Actions run
`31596294603`:

- Job `94112526160`: the 100-process reservation convergence test returned 99 `busy` results and
  one `corruption` result, with no committed winner.
- Rerun job `94117665864`: the same test again produced no winner (only one captured `busy`
  result), and `dead-owner liveness loss before final revalidation remains busy and consumes once`
  emitted no prep-housekeeping observer events instead of the expected four.

Ubuntu and the canonical badge gate were green. PR #117 is badge-only and is not part of this
investigation.

## Partial hardening in this range

- `29ed08e` first pinned the raw `ENOENT` stack observed during active preparation validation.
- `cf21e39` corrected that initial test's unsafe expectation: unexplained deletion is corruption,
  not a retryable success.
- `5a54237` maps an `ENOENT` from any syscall in exact admission-preparation revalidation to the
  existing typed `LedgerCorruption` result. Raw filesystem exceptions no longer escape this path.
- `3bf9830` enriches the pre-existing liveness-routing assertion message with result, exception,
  event, probe, and timing evidence.

This does **not** establish why the Windows operation fence sometimes refuses before any
prep-housekeeping event, and it does **not** prove that 100 contenders always elect a winner.
No timeout was increased and no corruption result was downgraded to `busy`.

## Local evidence

On the exact working tree after `5a54237`/`3bf9830`:

- TypeScript test compilation passed.
- The unexplained preparation-deletion test passed and returned typed corruption.
- The complete `prep-only housekeeper revalidates one-use authority before mutation` parent passed
  22/22.
- Four consecutive 100-process convergence waves passed locally; each produced one reservation and
  one dispatch-eligible winner.

These local passes do not supersede the two unchanged-tree hosted Windows failures.

## Required closure evidence

Before Task 4B resumes or the release gate closes:

1. Identify the pre-filesystem Windows fence/mutex refusal path responsible for empty observer
   events or prove a different exact cause.
2. Add a deterministic regression for that cause without weakening serialization or liveness
   checks.
3. Pass repeated 100-process convergence and dead-owner handoff tests on hosted Windows.
4. Independently review the final kernel change.

