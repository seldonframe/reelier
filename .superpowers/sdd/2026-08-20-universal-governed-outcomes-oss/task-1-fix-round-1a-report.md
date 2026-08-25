Files changed

- `src/authority/agent-mandate.ts`
- `src/authority/tool-effect-contract.ts`
- `test/authority/agent-mandate.test.ts`
- `test/authority/effect-contract.test.ts`
- `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-1-fix-round-1a-report.md`

What changed per file

- `src/authority/agent-mandate.ts`: snapshots the complete V2 mission request from inert own data descriptors before parsing, authorization, or emission. All emitted and checked values come from detached parsed locals, so accessors are rejected without execution and caller-owned values cannot drift across the authorization boundary.
- `src/authority/tool-effect-contract.ts`: adds a closed governed-outcome verification context carrying the exact parsed `ToolEffectContractV1` and canonical inert `now` value. Transition verification recomputes the contract and projection digests, binds semantic identity and record IDs, rejects future or non-monotonic lifecycle evidence, enforces the contract evidence ceiling, requires a provider-crossing attempt and authoritative exact matched projection for `verified`, rejects verified proof under nonverified states, and refuses any later provider crossing after an ambiguous crossing.
- `test/authority/agent-mandate.test.ts`: adds a regression test proving a top-level V2 mission-request accessor is never invoked.
- `test/authority/effect-contract.test.ts`: adds regression coverage for closed/context-inert verification, exact contract and projection binding, maximum evidence grade, all future lifecycle timestamps, nonverified impersonation, and ambiguous-crossing retry refusal.
- `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-1-fix-round-1a-report.md`: records this narrowed fix unit, its exact file inventory, verification evidence, and remaining sequential work.

Commits

- `fd7de798 test(authority): reject accessor mission requests`
- `002761d1 fix(authority): snapshot V2 mission requests inertly`
- `345c97d4 test(authority): bind outcome verification context`
- `726b3f2f fix(authority): verify governed outcomes against context`

Deviations from the plan and why

- None within fix round 1A. Work was deliberately restricted to blockers 2 through 4 and the five files assigned by the dispatcher. Schema, package, export-allowlist, and prior report corrections remain owned by the later sequential 1B unit.

Test results (verbatim tail)

```text
> reelier@0.32.1 build
> node scripts/build-authority-contract.mjs --check && node scripts/build-bootstrap-contract.mjs --check && tsc -p tsconfig.json && node scripts/build-authority-contract.mjs --copy-schemas && node scripts/build-packs.mjs

built cloudflare_api_token, cloudflare_dns, github_issue_labels, github_release, gmail, gmail_labels, hubspot_slack_information_flow, neon_database, slack_channel_topic, stripe, vercel_deployment
✔ governed outcome transition refuses unverifiable chronology and verified masquerades (8.1931ms)
ℹ tests 16
ℹ suites 0
ℹ pass 16
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 142.8445
```

Commands completed with exit code 0:

```text
npm run build
npx tsc -p tsconfig.test.json
node --test dist-test/test/authority/effect-contract.test.js dist-test/test/authority/agent-mandate.test.js
```

Open risks

- Task 1 is not globally review-ready until the planned sequential 1B unit aligns the JSON Schema/runtime language, restores the independently pinned declaration allowlist, and repairs the original Task 1 report inventory and Markdown fences.
- This unit intentionally does not alter public export files. The new verification-context interface is therefore module-local until 1B performs its assigned ABI/export work.
