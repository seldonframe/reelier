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
