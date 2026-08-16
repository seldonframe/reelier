Files changed

- `contract/certification/v1/task-current-state.schema.json`
- `contract/certification/v1/task-receipt-graph.schema.json`
- `src/authority/certification/cell.ts`
- `src/authority/certification/github-issue-labels-runner.ts`
- `src/authority/certification/portable-evidence.ts`
- `src/authority/certification/task-receipt-graph.ts`
- `test/authority/certification-portable-evidence.test.ts`
- `test/authority/certification-github-issue-labels-runner.test.ts`
- `.superpowers/sdd/2026-08-12-windows-client-linux-authority-cell/task-4-report.md`
- `.superpowers/sdd/2026-08-12-windows-client-linux-authority-cell/task-4-1-report.md`

What changed per file

- `task-current-state.schema.json`: adds the closed certification-local schema for signed dispatch/export task-status observations, with later freshness fixed at `unchecked`.
- `task-receipt-graph.schema.json`: adds closed task-authority, post-state, policy, task-status, and duplicate-decision collections plus their exact counts and collection digests.
- `cell.ts`: retains the exact dispatch-snapshot preimage behind the genuine branded Cell permit and exposes it only through the existing Cell-internal state bridge. The journal digest is recomputed from those exact bytes.
- `github-issue-labels-runner.ts`: persists signed task authority, pre-dispatch projection commitments, authoritative post-state reads, dispatch status, and zero-effect duplicate decisions; exports signed Outcome Contract/local-gate policy evidence and export-time status; incorporates every declared collection into the graph. Duplicate attempts perform no provider write, spend no additional budget, and mint no AuthorityReceipt.
- `portable-evidence.ts`: defines closed purpose-bound records and offline verification. It recomputes task/job/activation/permit/intent/trigger links, comparable signed SourceBundle projections, reviewed projection schema, exact JCS policy bytes and digest, task/budget history, status-at-time semantics, and duplicate state/deltas under the activated `authority-evidence` key.
- `task-receipt-graph.ts`: incorporates the five portable collections into terminal counts/digests and verifies them against the externally anchored activated evidence root, journals, receipts, source bundles, policy commitment, and budget history.
- `certification-portable-evidence.test.ts`: establishes RED then covers signed task status, explicitly unchecked later freshness, expiry, and revocation refusal.
- `certification-github-issue-labels-runner.test.ts`: covers end-to-end task-to-permit linkage, exact declared labels projection evidence, distinct policy statuses, dispatch/export status, durable duplicate evidence, contract/schema closure, and substitution/omission/false-upgrade/nonzero-effect falsifiers. It also replaces unqualified complete-graph wording with the declared-fixture boundary.
- `task-4-report.md`: adds the required `Boundaries and non-claims` section and records the new certification-local evidence artifacts/tests.
- `task-4-1-report.md`: records Task 4A scope, verification, deviations, and risks.

Deviations from the plan and why

- No file outside the Task 4A closed scope was modified.
- `src/authority/certification/lifecycle-receipts.ts` did not require a change: its existing purpose-signed `sourceBundle` already supplies the exact pre-read artifact and digest used by the new post-state verifier. Widening the receipt or frozen Adapter Contract would have been both unnecessary and contrary to the plan.
- The first baseline runner execution exposed two pre-existing Windows/concurrency failures. Per orchestrator direction, no retry, timeout, production behavior, or failing path was changed. Two fresh exact full-suite executions after Task 4A both passed those cases.

Test results (verbatim tail)

Initial baseline, before Task 4A production changes:

```text
ℹ tests 38
ℹ suites 0
ℹ pass 35
ℹ fail 2
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 38269.5125

✖ failing tests:

test at dist-test\test\authority\certification-github-issue-labels-runner.test.js:244:1
✖ a previously valid signed journal cannot roll acknowledged ledger truth backward (716.2622ms)
  Error: EPERM: operation not permitted, rename 'C:\Users\maxim\AppData\Local\Temp\reelier-github-cell-sb4V6f\certification\authority\github-label-runner\request_rollback.journal.json.0c5d80b0-393d-4f1f-a2b4-0308ae99d65c.tmp' -> 'C:\Users\maxim\AppData\Local\Temp\reelier-github-cell-sb4V6f\certification\authority\github-label-runner\request_rollback.journal.json'

test at dist-test\test\authority\certification-github-issue-labels-runner.test.js:275:1
✖ concurrent recovery cannot release a live dispatched request before its one write (656.3961ms)
  AssertionError [ERR_ASSERTION]: Missing expected rejection.
```

Final exact runner suite:

```text
✔ portable evidence links the approved task, exact post-state, policy statuses, task status, and zero-effect duplicates (911.8239ms)
ℹ tests 39
ℹ suites 0
ℹ pass 38
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 36921.4513
```

Focused portable status:

```text
✔ portable task status binds the signed observation time without claiming later freshness (4.5512ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 179.3081
```

Contract/build gates:

```text
> reelier@0.32.1 check:authority-contract
> node scripts/build-authority-contract.mjs --check
```

```text
> reelier@0.32.1 build
> node scripts/build-authority-contract.mjs --check && tsc -p tsconfig.json && node scripts/build-authority-contract.mjs --copy-schemas && node scripts/build-packs.mjs

built cloudflare_api_token, cloudflare_dns, github_issue_labels, gmail, gmail_labels, hubspot_slack_information_flow, neon_database, slack_channel_topic, stripe, vercel_deployment
```

`npx tsc --noEmit --pretty false` and `git diff --check` exited 0 without output.

Frozen contract check:

```text
frozen contract files unchanged
Adapter Contract digest sha256:7f46242b26d9c921f4e1ec9de6418ac5fc8c03d70c4415c25e799ae0e73a1512
```

Open risks

- The initial exact baseline run exposed nondeterministic Windows filesystem/concurrency failures in two pre-existing tests. The same exact suite passed twice after Task 4A without changes to those paths, retries, or timeouts; the flake remains recorded rather than claimed fixed.
- The one final skip is the existing Windows symlink-privilege case. Native Linux CI remains required for the actual Authority Cell host boundary.
- Status evidence proves state only at its signed observation time. Later freshness remains `unchecked` unless a separately supplied externally anchored later proof is verified.
- `exact` post-state confidence applies only to the complete declared labels projection read authoritatively before and after. It does not prove the whole provider account, semantic correctness, safety, delivery, or universal completeness.
- The local gate policy remains `unchecked`; no rule load, match, firing, or coverage claim is made. The Outcome Contract policy is verified only from its exact reviewed JCS commitment.
- Existing unrelated dirt was preserved exactly: `.gitignore`, `src/authority/certification/manifests.ts`, `src/authority/certification/runner-registry.ts`, `test/authority/certification-input-fixture.ts`, `.tmp-pack/`, `native/`, and `rust-toolchain.toml`.

Round 1/5 reviewer fixes

- RED `833f89f`: added freshly re-signed inconsistent portable records and regenerated terminal commitments; the focused test failed with `Missing expected exception`.
- GREEN `cfe0621`: passing graphs now require one unique exact/partial post-state per dispatched fixture request; expected labels derive from the verified Outcome Contract policy and declared intent; the signed Job Card is verified against readiness/current trust and exact permit links; task status binds graph task/grant/allocation plus durable task-and-budget history; local gate policy binds the signed authority-state preimage used by receipt decisions; journal-signed duplicate attempts pair one-to-one with evidence-signed zero-effect decisions across semantic, exact request, conflict, and cleanup replay paths.
- Schema timestamps now use the same canonical millisecond-UTC shape as runtime validation, and post-state arrays reject exact duplicate nodes.

Round 1/5 verification (verbatim tail)

```text
✔ offline portable verification rejects re-signed false claims with a fresh terminal commitment (1003.8603ms)
✔ portable task status binds the signed observation time without claiming later freshness (3.1877ms)
ℹ tests 41
ℹ suites 0
ℹ pass 40
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 39625.3786
```

`npx tsc --noEmit --pretty false` and `git diff --check` exited 0 without output.

```text
> reelier@0.32.1 check:authority-contract
> node scripts/build-authority-contract.mjs --check
```

```text
frozen contract files unchanged
sha256:7f46242b26d9c921f4e1ec9de6418ac5fc8c03d70c4415c25e799ae0e73a1512
```

Round 2/5 reviewer fixes

- RED `3e6fda8`: exposed missing durable duplicate-history commitment, caller request-ID rewriting, and acceptance of partial evidence without a reviewed authoritative observation.
- RED `17cdbfd`: added a real dispatch -> revoke -> export case plus freshly re-signed historical/current status falsifiers; the passing export initially failed because dispatch history was compared with current revocation state.
- GREEN `86de703`: added a journal-authority-signed duplicate-attempt head with exact count/history digest, stable attempt IDs separate from unmodified caller request IDs, and one-to-one attempt/decision linkage. Exact replay, conflict replay, and cleanup replay remain zero-write, zero-budget, and receipt-free even after capacity exhaustion. Partial evidence now requires a real observed projection and the named reviewed authoritative read method. Status verification distinguishes signed dispatch history from the current export observation.
- The duplicate omission falsifier now creates a genuine duplicate before deleting both attempt/decision collections and rebuilding the evidence-signed terminal commitment; the independently journal-signed head makes the omission refuse.

Round 2/5 verification (verbatim tail)

Focused portable + runner tests:

```text
✔ portable export preserves dispatch history while reporting a current task revocation (989.5977ms)
✔ offline portable verification rejects re-signed false claims with a fresh terminal commitment (1097.6292ms)
✔ portable task status binds the signed observation time without claiming later freshness (3.1673ms)
✔ partial post-state requires a reviewed observation with a real observed projection (0.2332ms)
ℹ tests 43
ℹ suites 0
ℹ pass 42
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 42744.717
```

Exact runner suite:

```text
✔ portable export preserves dispatch history while reporting a current task revocation (961.7524ms)
✔ offline portable verification rejects re-signed false claims with a fresh terminal commitment (1132.0059ms)
ℹ tests 41
ℹ suites 0
ℹ pass 40
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 40099.4236
```

`npm run check:authority-contract`, `npx tsc --noEmit --pretty false`, `node scripts/build-authority-contract.mjs --check`, and `git diff --check` exited 0. `git diff c30c92ca45bd337143a42e18f414fb83a53622bb -- contract/authority/v1` remained empty. Adapter Contract v1 remains `sha256:7f46242b26d9c921f4e1ec9de6418ac5fc8c03d70c4415c25e799ae0e73a1512`.

Round 2 open risks

- The existing Windows symlink-privilege test remains skipped; native Linux CI is still required for that host boundary.
- The journal-signed duplicate head proves the exported collection's exact count/history. It does not claim universal interception or completeness outside the declared durable fixture boundary.

Round 3/5 reviewer fixes

- RED `fc627ed`: demonstrated exhausted replays failing before terminal inspection, concurrent duplicate loss, lexical old-head selection, literal request-ID mutation, and self-consistent false lifecycle acceptance.
- GREEN `67363ca`: replaced lexical evidence fragments with one confined canonical duplicate ledger, serialized under a task-wide exclusive lock. Each append allocates its monotonic sequence while locked, commits attempt and zero-effect decision together, and advances a journal-signed predecessor-linked head committing both histories. Run/conflict/cleanup are separate signed operation kinds while caller request IDs remain literal. Terminal replay inspection authenticates through the non-effect observation path before any effect-capacity permit. Dispatch/export lifecycle history now commits independently derived task, grant, allocation, journal, and budget inputs and the verifier derives lifecycle rather than trusting a self-authored digest.

Round 3 verification

```text
✔ portable evidence links the approved task, exact post-state, policy statuses, task status, and zero-effect duplicates
✔ duplicate ledger serializes concurrent exhausted attempts and ignores lexical old-head injection
✔ exhausted exact conflict replay records literal request id and operation kind without effect
✔ portable export preserves dispatch history while reporting a current task revocation
✔ offline portable verification rejects re-signed false claims with a fresh terminal commitment
ℹ tests 5
ℹ pass 5
ℹ fail 0
```

The first combined focused run passed 43/45 with the existing symlink skip and the previously recorded concurrent-recovery baseline flake. The subsequent exact runner run passed every new Round 3 case except a nondeterministic `ingress-ledger-unavailable` in the re-signed falsifier after 30 seconds, alongside the same pre-existing concurrent-recovery flake: 40 pass, 2 fail, 1 skip. The identical re-signed falsifier passed in the immediately preceding focused run. No timeout, retry, or unrelated path was changed.

`npm run check:authority-contract`, `npx tsc --noEmit --pretty false`, `git diff --check`, and the frozen `contract/authority/v1` diff exited 0. Adapter Contract v1 remains `sha256:7f46242b26d9c921f4e1ec9de6418ac5fc8c03d70c4415c25e799ae0e73a1512`.

Round 4/5 duplicate checkpoint fix

Files changed

- `contract/certification/v1/task-receipt-graph.schema.json`
- `src/authority/certification/github-issue-labels-runner.ts`
- `src/authority/certification/portable-evidence.ts`
- `src/authority/certification/task-receipt-graph.ts`
- `test/authority/certification-github-issue-labels-runner.test.ts`
- `.superpowers/sdd/2026-08-12-windows-client-linux-authority-cell/task-4-1-report.md`

What changed per file

- The runner now checkpoints each signed duplicate head in the independently authority-journal-signed append-only request generation chain while holding the duplicate ledger lock.
- Portable verification requires the presented duplicate collection head at the terminal signed journal checkpoint, rejecting canonical ledger rollback paired with current journal history.
- Graph verification reports `duplicateHistoryFreshness: "unchecked"`: it proves completeness only at the included signed checkpoint, never universal or later currentness.
- The certification schema includes the nullable journal checkpoint digest.
- The test captures a genuine count-one state, restarts, appends two concurrent attempts, restores the old canonical ledger, regenerates the evidence terminal, and proves rejection. The honest count-three graph passes; the captured old graph remains historical with freshness unchecked.

Deviations from the plan and why

- No files outside Task 4A closed scope changed. No external freshness authority was added. Per orchestrator ruling, the existing authority-journal generation chain is the independent checkpoint; historical artifacts remain valid only for their signed checkpoint.

Test results (verbatim tail)

```text
✔ duplicate ledger serializes concurrent exhausted attempts and ignores lexical old-head injection (2960.5066ms)
✔ externally anchored duplicate head rejects canonical rollback after restart and concurrent attempts (3724.1226ms)
ℹ tests 2
ℹ suites 0
ℹ pass 2
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 6939.9882
```

The combined runner/portable suite passed 43, failed 2, and skipped 1. One failure was the previously recorded Windows concurrent-recovery flake (`Missing expected rejection` plus post-test ENOENT activity). The new rollback case hit the previously recorded nondeterministic `ingress-ledger-unavailable` after 30 seconds; the identical case passed in both focused executions. No retry, sleep, timeout, or unrelated path was changed.

`npm run check:authority-contract`, `npx tsc --noEmit --pretty false`, `node scripts/build-authority-contract.mjs --check`, and `git diff --check` exited 0. `git diff 7cbb8af -- contract/authority/v1` is empty. Adapter Contract v1 remains `sha256:7f46242b26d9c921f4e1ec9de6418ac5fc8c03d70c4415c25e799ae0e73a1512`.

Open risks

- Duplicate completeness is only as of the included signed journal checkpoint. Freshness after that checkpoint is explicitly unchecked.
- A captured old graph plus its captured old journal is valid historical evidence and cannot satisfy a later-currentness claim.
- Existing Windows filesystem/concurrency flakes remain recorded and unmasked; Linux CI is still required for the real host boundary.

Round 5/5 zero-head checkpoint fix

Files changed

- `src/authority/certification/portable-evidence.ts`
- `test/authority/certification-github-issue-labels-runner.test.ts`
- `.superpowers/sdd/2026-08-12-windows-client-linux-authority-cell/task-4-1-report.md`

What changed per file

- `portable-evidence.ts`: requires the supplied signed duplicate head to match an included terminal journal checkpoint whenever either the head is nonzero or any checkpoint exists. A genuine initial zero head with no later checkpoint remains valid historical/current-as-of evidence with freshness unchecked.
- `certification-github-issue-labels-runner.test.ts`: captures and verifies an honest initial zero graph, creates a genuine count-one checkpoint, restores the zero ledger and regenerates the terminal graph to prove rejection, then verifies the honest current graph and captured historical graphs.
- `task-4-1-report.md`: records the Round 5 red/green commits, exact verification, deviations, and remaining risks.

Deviations from the plan and why

- None. No retry, sleep, timeout, contract, runner, journal, or unrelated behavior changed.

Test results (verbatim tail)

RED, commit `d704d03`:

```text
âœ– externally anchored duplicate head rejects canonical rollback after restart and concurrent attempts (2707.1178ms)
â„¹ tests 1
â„¹ suites 0
â„¹ pass 0
â„¹ fail 1
â„¹ cancelled 0
â„¹ skipped 0
â„¹ todo 0
â„¹ duration_ms 2929.8739

âœ– failing tests:

AssertionError [ERR_ASSERTION]: Missing expected exception.
```

GREEN, commit `182af78`:

```text
âœ” externally anchored duplicate head rejects canonical rollback after restart and concurrent attempts (2697.5202ms)
â„¹ tests 1
â„¹ suites 0
â„¹ pass 1
â„¹ fail 0
â„¹ cancelled 0
â„¹ skipped 0
â„¹ todo 0
â„¹ duration_ms 2889.2567
```

Focused runner and portable suite:

```text
âœ” externally anchored duplicate head rejects canonical rollback after restart and concurrent attempts (3928.1888ms)
âœ” exhausted exact conflict replay records literal request id and operation kind without effect (1743.9967ms)
âœ” portable export preserves dispatch history while reporting a current task revocation (1605.5912ms)
âœ” offline portable verification rejects re-signed false claims with a fresh terminal commitment (1697.0668ms)
â„¹ Error: Test "concurrent recovery cannot release a live dispatched request before its one write" at dist-test\test\authority\certification-github-issue-labels-runner.test.js:279:1 generated asynchronous activity after the test ended. This activity created the error "Error: ENOENT: no such file or directory, open 'C:\Users\maxim\AppData\Local\Temp\reelier-github-cell-myUuLp\certification\authority\github-label-runner\provider-state.json.2fa17e3d-b07c-411f-b2eb-69dec69aa8c9.tmp'" and would have caused the test to fail, but instead triggered an unhandledRejection event.
âœ” portable task status binds the signed observation time without claiming later freshness (3.7858ms)
âœ” partial post-state requires a reviewed observation with a real observed projection (0.249ms)
â„¹ tests 46
â„¹ suites 0
â„¹ pass 44
â„¹ fail 1
â„¹ cancelled 0
â„¹ skipped 1
â„¹ todo 0
â„¹ duration_ms 69658.2983

âœ– failing tests:

âœ– concurrent recovery cannot release a live dispatched request before its one write (702.4603ms)
  AssertionError [ERR_ASSERTION]: Missing expected rejection.
```

Contract/build gates:

```text
> reelier@0.32.1 check:authority-contract
> node scripts/build-authority-contract.mjs --check
```

`npx tsc --noEmit --pretty false`, `git diff --check`, and `git diff --exit-code 18b5351 -- contract/authority/v1` exited 0. The frozen Adapter Contract digest printed:

```text
sha256:7f46242b26d9c921f4e1ec9de6418ac5fc8c03d70c4415c25e799ae0e73a1512
```

Open risks

- Duplicate completeness and the zero-head exception remain current only as of the included signed journal history; later freshness is explicitly unchecked.
- A captured zero or nonzero graph paired with its captured journal remains valid historical evidence. Pairing an old head with a later included checkpoint now refuses.
- The previously recorded Windows concurrent-recovery test flaked again in the combined focused suite. The new Round 5 targeted scenario passed in both its dedicated GREEN run and the combined run; no retry, sleep, timeout, or failing path was changed.
