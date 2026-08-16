Files changed

- `conformance/failure-injection/v0/check.mjs`
- `conformance/failure-injection/v0/report.schema.json`
- `test/failure-injection-conformance.test.ts`
- `.superpowers/sdd/task-6-failure-injection-report.md`

## What changed per file

- `conformance/failure-injection/v0/check.mjs` provides the existing executable hermetic simulation for the 15 named failure mutations. It derives each non-passing result from a cloned valid baseline and validates reports by standalone schema first, then canonical equality with the generated report. No checker change was needed in this schema-hardening round.
- `conformance/failure-injection/v0/report.schema.json` closes `reasonCodes` to the exact 15-case reason vocabulary. The 15-item `cases` array now has `uniqueItems: true` and one strict `contains`/`minContains`/`maxContains` constraint per allowed case ID, requiring every expected ID exactly once during standalone validation.
- `test/failure-injection-conformance.test.ts` adds RED/GREEN standalone Ajv regressions proving an invented reason and a duplicated case ID fail schema validation without relying on the semantic checker. Existing executable-mutation, semantic-checker, evidence-state, and CLI coverage remains intact.
- `.superpowers/sdd/task-6-failure-injection-report.md` records the complete Task 6 file scope, schema-hardening RED/GREEN commits, exact verification evidence, deviations, and open risks.

## Deviations from plan

None. Only Task 6 allowlisted paths were modified. The checker required no change because its canonical report equality already enforces the exact case-to-reason mapping after standalone schema validation. No provider, credential, network, process-launch, crash-injection, authority, continuity, delegation, route, receipt, or coverage implementation was changed.

## Test results

Schema-hardening RED was committed as `3102cf5`. `npx tsc -p tsconfig.test.json --pretty false` exited 0, then `node --test --test-concurrency=1 dist-test/test/failure-injection-conformance.test.js` exited 1 because standalone Ajv validation incorrectly accepted both mutations. Verbatim tail:

```text
ℹ tests 8
ℹ suites 0
ℹ pass 6
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 295.5102

✖ failing tests:

test at dist-test\test\failure-injection-conformance.test.js:101:1
✖ the standalone schema rejects an invented failure reason (1.5861ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

  true !== false

test at dist-test\test\failure-injection-conformance.test.js:107:1
✖ the standalone schema rejects duplicated case IDs (0.7652ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

  true !== false
```

Schema hardening was committed as `25c16bf`.

`npm run build` exited 0. Verbatim tail:

```text
> reelier@0.32.1 build
> node scripts/build-authority-contract.mjs --check && node scripts/build-bootstrap-contract.mjs --check && tsc -p tsconfig.json && node scripts/build-authority-contract.mjs --copy-schemas && node scripts/build-packs.mjs

built cloudflare_api_token, cloudflare_dns, github_issue_labels, gmail, gmail_labels, hubspot_slack_information_flow, neon_database, slack_channel_topic, stripe, vercel_deployment
```

`npx tsc -p tsconfig.json --noEmit --pretty false` and `npx tsc -p tsconfig.test.json --pretty false` both exited 0 with no output.

Focused command `node --test --test-concurrency=1 dist-test/test/failure-injection-conformance.test.js` exited 0. Verbatim tail:

```text
✔ every named mutation changes the baseline evaluation and cannot be marked passed (2.4524ms)
✔ an evaluation is invalidated when its hermetic input is mutated (0.4079ms)
✔ the executable matrix covers every planned failure injection without a passing result (5.6684ms)
✔ authority, crash, receipt, and coverage cases preserve explicit evidence states (0.6671ms)
✔ the semantic checker rejects closed-schema and eligibility upgrades (1.8853ms)
✔ the standalone schema rejects an invented failure reason (0.8733ms)
✔ the standalone schema rejects duplicated case IDs (0.743ms)
✔ the CLI emits the complete non-passing report without external inputs (122.8105ms)
ℹ tests 8
ℹ suites 0
ℹ pass 8
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 305.8983
```

The relevant Task 1–6 conformance command over aggregate, agent-adapter, candidate-capture, coverage-envelope, failure-injection, and semantic-matrix suites exited 0. Verbatim tail:

```text
✔ explicit missing evidence cannot coexist with a candidate or report (0.2733ms)
ℹ tests 66
ℹ suites 0
ℹ pass 66
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 4560.1731
```

`git diff --check` exited 0 with no output after the report update.

## Open risks

- This is executable hermetic simulation, not live process or provider fault injection. It does not launch or kill Codex, Claude Code, Eve, Grok Build, or Grok Bot, and it does not call GitHub, Gmail, Stripe, or another provider.
- The schema closes the allowed ID and reason vocabularies and the exact case-ID set; the semantic checker remains responsible for binding each case ID to its exact expected reason, disposition, lifecycle, claims, and non-claims.
- The evaluator proves that the modeled state/contract maps each named mutation to a non-passing reason-specific result. It does not prove a live adapter emits the modeled state under a real crash or provider mismatch.
- `harnessId: "harness-neutral"` and the explicit non-claims continue to state that live harness execution, route enforcement, traffic completeness, outcome correctness, content correctness, and production safety are not proved.
- Unsupported and not-tested coverage outcomes remain non-passing; no discovery evidence is upgraded to enforcement or completeness.
