Files changed

- `conformance/failure-injection/v0/check.mjs`
- `test/failure-injection-conformance.test.ts`
- `.superpowers/sdd/task-6-failure-injection-report.md`

## What changed per file

- `conformance/failure-injection/v0/check.mjs` replaces the static expected-result rows with an executable hermetic simulation. It defines one valid, closed baseline state for principal/delegation, discovery, target authority, allocation, continuity, outcome freshness/post-state, and coverage. Each of the 15 named mutations is applied to a structured clone of that baseline. A single evaluator derives refusal, ambiguity, reconciliation-required, unsupported, not-tested, or baseline-only passed results from the resulting state. Report generation rejects any named mutation that evaluates as passed or lacks one reason-specific code. Evaluation validation recomputes the result from its input, so stale results cannot be reused after an input mutation.
- `test/failure-injection-conformance.test.ts` adds RED/GREEN tests proving every named mutation changes the valid baseline result, no mutation can be marked passed, a result is invalidated when its input changes, and mutation operates on a clone. Existing independent literal expectations still pin each mutation's disposition and reason, so evaluator or baseline semantic drift can fail the suite.
- `.superpowers/sdd/task-6-failure-injection-report.md` records this hardening round, its executable-simulation boundary, RED/GREEN commits, exact verification evidence, deviations, and open risks.

The existing `conformance/failure-injection/v0/report.schema.json` was reviewed but not modified. It remains closed, fixes report status to `failed`, fixes `passEligibility` to `false`, and permits no passing observed disposition.

## Deviations from plan

None. Only Task 6 allowlisted paths were modified. The report schema required no widening. No provider, credential, network, process-launch, crash-injection, authority, continuity, delegation, route, receipt, or coverage implementation was changed.

## Test results

RED was committed as `1aa635d`. `npx tsc -p tsconfig.test.json --pretty false` exited 0, then the focused test exited 1 for the intended missing executable API. Verbatim tail:

```text
✖ every named mutation changes the baseline evaluation and cannot be marked passed (0.5699ms)
✖ an evaluation is invalidated when its hermetic input is mutated (0.105ms)
✔ the executable matrix covers every planned failure injection without a passing result (2.4602ms)
✔ authority, crash, receipt, and coverage cases preserve explicit evidence states (0.1955ms)
✔ the semantic checker rejects closed-schema and eligibility upgrades (0.59ms)
✔ the CLI emits the complete non-passing report without external inputs (124.4333ms)
ℹ tests 6
ℹ suites 0
ℹ pass 4
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 284.9247

✖ failing tests:

test at dist-test\test\failure-injection-conformance.test.js:29:1
✖ every named mutation changes the baseline evaluation and cannot be marked passed (0.5699ms)
  TypeError: checker.createFailureInjectionBaseline is not a function

test at dist-test\test\failure-injection-conformance.test.js:44:1
✖ an evaluation is invalidated when its hermetic input is mutated (0.105ms)
  TypeError: checker.createFailureInjectionBaseline is not a function
```

GREEN implementation was committed as `51d6f19`.

`npm run build` exited 0. Verbatim tail:

```text
> reelier@0.32.1 build
> node scripts/build-authority-contract.mjs --check && node scripts/build-bootstrap-contract.mjs --check && tsc -p tsconfig.json && node scripts/build-authority-contract.mjs --copy-schemas && node scripts/build-packs.mjs

built cloudflare_api_token, cloudflare_dns, github_issue_labels, gmail, gmail_labels, hubspot_slack_information_flow, neon_database, slack_channel_topic, stripe, vercel_deployment
```

`npx tsc -p tsconfig.json --noEmit --pretty false` and `npx tsc -p tsconfig.test.json --pretty false` both exited 0 with no output.

Focused command `node --test --test-concurrency=1 dist-test/test/failure-injection-conformance.test.js` exited 0. Verbatim tail:

```text
✔ every named mutation changes the baseline evaluation and cannot be marked passed (2.3048ms)
✔ an evaluation is invalidated when its hermetic input is mutated (0.3858ms)
✔ the executable matrix covers every planned failure injection without a passing result (3.5499ms)
✔ authority, crash, receipt, and coverage cases preserve explicit evidence states (0.6424ms)
✔ the semantic checker rejects closed-schema and eligibility upgrades (1.44ms)
✔ the CLI emits the complete non-passing report without external inputs (125.163ms)
ℹ tests 6
ℹ suites 0
ℹ pass 6
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 293.7279
```

The relevant Task 1–6 conformance command over aggregate, agent-adapter, candidate-capture, coverage-envelope, failure-injection, and semantic-matrix suites exited 0. Verbatim tail:

```text
✔ explicit missing evidence cannot coexist with a candidate or report (0.2577ms)
ℹ tests 64
ℹ suites 0
ℹ pass 64
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 4627.3023
```

`git diff --check` exited 0 with no output after the report update.

## Open risks

- This is executable hermetic simulation, not live process or provider fault injection. It does not launch or kill Codex, Claude Code, Eve, Grok Build, or Grok Bot, and it does not call GitHub, Gmail, Stripe, or another provider.
- The evaluator proves that the modeled state/contract maps each named mutation to a non-passing reason-specific result. It does not prove a live adapter emits the modeled state under a real crash or provider mismatch.
- `harnessId: "harness-neutral"` and the explicit non-claims continue to state that live harness execution, route enforcement, traffic completeness, outcome correctness, content correctness, and production safety are not proved.
- Unsupported and not-tested coverage outcomes remain non-passing; no discovery evidence is upgraded to enforcement or completeness.
