Files changed

- `conformance/failure-injection/v0/check.mjs`
- `conformance/failure-injection/v0/report.schema.json`
- `test/failure-injection-conformance.test.ts`
- `.superpowers/sdd/task-6-failure-injection-report.md`

## What changed per file

- `conformance/failure-injection/v0/check.mjs` adds the deterministic 15-case table and a semantic checker that accepts only the exact closed matrix. Every row has a harness-neutral identity, an existing adapter path, expected lifecycle, explicit observed disposition and receipt-style claim states, `passEligibility: false`, reason codes, and non-claims. Its CLI is local-only, consumes no inputs or credentials, emits the report, and exits 1 because the report is intentionally non-passing.
- `conformance/failure-injection/v0/report.schema.json` closes the report, row, observed-result, claim, lifecycle, reason, and non-claim shapes. It fixes the report status to `failed`, every row's pass eligibility to false, and permits only refusal, ambiguity, reconciliation-required, unsupported, or not-tested dispositions.
- `test/failure-injection-conformance.test.ts` independently locks the planned case list and principal reason for each case, receipt/coverage evidence states, closed-schema behavior, semantic anti-upgrade behavior, and CLI non-success behavior.
- `.superpowers/sdd/task-6-failure-injection-report.md` records Task 6 scope, RED/GREEN evidence, verification, deviations, and remaining gaps.

## Matrix coverage

The table covers: wrong principal; reused parent principal; identity injection through task choices; undiscovered job; unauthorized repository/branch target; budget overflow; duplicate retry; crash after reservation; crash after dispatch; stale outcome; provider acknowledgement without matching post-state; hidden/unwrapped route; incomplete route inventory; malformed coverage; and unavailable coverage.

Authority and delegation mutations refuse before dispatch. Duplicate and crash states remain ambiguous or require reconciliation. A provider acknowledgement with conflicting post-state records acknowledgement as `verified` and reconciliation as `failed`, never success. Coverage failures remain `unsupported` or `not-tested` with failed, unchecked, or absent topology/completeness evidence. No row is eligible to pass.

## Deviations from plan

None. Only the four Task 6 allowlisted paths were created or modified. No provider, credential, network, GitHub, Gmail, Stripe, route, authority, delegation, receipt, continuity, or coverage implementation was changed. No second execution or delegation protocol was introduced.

## Test results

RED was committed as `2352ea6` after TypeScript compilation succeeded and the focused test failed for the intended missing implementation:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'C:\Users\maxim\CascadeProjects\reelier\.worktrees\five-harness-conformance\conformance\failure-injection\v0\check.mjs'
...
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
```

GREEN build before focused tests (`npm run build`, exit 0), verbatim tail:

```text
> reelier@0.32.1 build
> node scripts/build-authority-contract.mjs --check && node scripts/build-bootstrap-contract.mjs --check && tsc -p tsconfig.json && node scripts/build-authority-contract.mjs --copy-schemas && node scripts/build-packs.mjs

built cloudflare_api_token, cloudflare_dns, github_issue_labels, gmail, gmail_labels, hubspot_slack_information_flow, neon_database, slack_channel_topic, stripe, vercel_deployment
```

Focused GREEN (`npx tsc -p tsconfig.test.json --pretty false` then `node --test --test-concurrency=1 dist-test/test/failure-injection-conformance.test.js`, exit 0), verbatim tail:

```text
✔ the closed table covers every planned failure injection without a passing result (3.1263ms)
✔ authority, crash, receipt, and coverage cases preserve explicit evidence states (0.2368ms)
✔ the semantic checker rejects closed-schema and eligibility upgrades (0.6078ms)
✔ the CLI emits the complete non-passing report without external inputs (122.2897ms)
ℹ tests 4
ℹ suites 0
ℹ pass 4
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 292.8205
```

Relevant Task 1–6 conformance suites (exit 0), verbatim tail:

```text
✔ explicit missing evidence cannot coexist with a candidate or report (0.2789ms)
ℹ tests 62
ℹ suites 0
ℹ pass 62
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 4603.3037
```

Package checks:

```text
> reelier@0.32.1 check:authority-contract
> node scripts/build-authority-contract.mjs --check
```

`npx tsc -p tsconfig.test.json --pretty false` and `git diff --check` both exited 0 with no output.

GREEN implementation was committed as `8072611`.

The later full `npm test` verification was stopped on operator request and exited 1 after three pre-existing authority adapter tests had already failed. It is not a passing completion gate. Exact failing lines observed before termination:

```text
✖ authority runtime authenticates host identity, dispatches once, and returns durable status (0.7683ms)
✖ authority runtime does not trust identity fields from the request body (0.1247ms)
✖ shadow runtime returns a report-only lifecycle and never an accepted receipt (0.1054ms)
```

No Task 6 focused or relevant-conformance failure appeared before termination; the bounded 62-test conformance command above remains the complete passing Task 6 evidence.

## Open risks and gaps

- This is a hermetic conformance matrix and checker, not evidence that any live Codex, Claude Code, Eve, Grok Build, or Grok Bot process was fault-injected. `harnessId: "harness-neutral"` and the explicit live-execution non-claim preserve that boundary.
- Crash rows describe the required durable lifecycle/evidence classification; they do not launch or kill a process in Task 6's closed scope.
- Unsupported and not-tested coverage rows do not prove route enforcement or traffic completeness.
- Provider acknowledgement and post-state rows are deterministic evidence-state fixtures only. No external provider was contacted, and outcome correctness and production safety remain not proved.
- The repository-wide `npm test` completion gate is not green: it was terminated on request after the three authority adapter failures listed above. Those files are outside the Task 6 allowlist and were not changed or diagnosed in this task.
