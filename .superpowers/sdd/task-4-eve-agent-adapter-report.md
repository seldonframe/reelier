Files changed

- `conformance/agent-adapter/v0/fixtures/eve-observed.json`
- `conformance/semantic-matrix/v0/check.mjs`
- `conformance/semantic-matrix/v0/report.schema.json`
- `test/agent-adapter-conformance.test.ts`
- `test/semantic-matrix-conformance.test.ts`
- `docs/superpowers/plans/2026-08-16-five-harness-conformance.md`
- `.superpowers/sdd/task-4-eve-agent-adapter-report.md`

What changed per file

- `conformance/agent-adapter/v0/fixtures/eve-observed.json` adds a hermetic Eve candidate for the
  existing `reelier.agent-adapter-candidate/v0` contract. Its descriptor identifies Eve and HTTPS,
  declares `fixture-only`, exposes observed and enforced coverage modes with observed as the
  default, keeps enforced unavailable, and records a pre-freeze refusal with dispatch and provider
  evidence absent. It contains no external endpoint, credential, provider call, or write.
- `conformance/semantic-matrix/v0/check.mjs` lets an Eve `agent-adapter/v0` candidate carry a
  separately typed `continuity-adapter/v1/eve-fixture` evidence source. The candidate still runs
  only through the existing v0 semantic checker/report contract and its same seven-check universal
  vector. Candidate inputs now bind both `descriptor.adapterId` and `descriptor.agentHost` to the
  selected harness, and every candidate input is closed to the `agent-adapter/v0` path. Continuity
  evidence is independently classified by the existing aggregate continuity contract and never
  substitutes for the primary agent-adapter row.
- `conformance/semantic-matrix/v0/report.schema.json` closes the new `continuityEvidence` output to
  at most one Eve continuity-fixture aggregate row. The primary Eve row and supplemental continuity
  row therefore retain distinct adapter paths and evidence maturities.
- `test/agent-adapter-conformance.test.ts` proves the Eve fixture emits the unchanged v0 report
  identity and passes exactly the same seven semantic checks as the existing vector.
- `test/semantic-matrix-conformance.test.ts` loads the committed `eve-observed.json` fixture rather
  than synthesizing Eve by cloning Grok. It proves an Eve continuity report cannot be relabeled as
  agent-adapter evidence; Eve can select the candidate while retaining separate continuity-proven
  evidence; fixture-only evidence remains a failed matrix with execution and outcome not tested;
  all existing non-claims remain explicit; adapter ID, host identity, or authority-contract
  relabels publish no Eve semantic evidence; and the real candidate is rejected on the continuity
  adapter path.
- `docs/superpowers/plans/2026-08-16-five-harness-conformance.md` adds an explicit per-task Files
  touched allowlist for Tasks 1–4, including every Task 4 implementation, test, plan, fixture, and
  report file. Tasks 5–7 remain unauthorized until their allowlists are defined and reviewed.
- `.superpowers/sdd/task-4-eve-agent-adapter-report.md` records Task 4 scope, TDD evidence,
  verification, review-fix commits, deviations, and gaps.

Commits

- `3ab8c86 test: define Eve agent adapter candidate contract`
- `3e22b73 feat: add Eve agent adapter candidate`
- `0fe14cb test: bind Eve matrix fixture identity`
- `fb1cb73 fix: reject mismatched semantic candidate paths`

Deviations from the plan and why

- None. The selected candidate is the plan-permitted fixture adapter, not a live Eve delegation
  implementation. Existing Eve continuity files and claims were not modified. Continuity remains
  continuity-proven and explicitly does not establish agent-adapter execution; the candidate
  remains fixture-only and non-passing.
- The pre-existing untracked plan was preserved, extended only with the requested per-task Files
  touched allowlist, and committed on this branch so review scope is durable.
- No external call, credential, provider, dependency install, push, merge, formatter, codemod, or
  file outside Task 4 scope was used.

Test results

RED — initial emitting build followed by the two focused suites

Commands:

```text
npx tsc -p tsconfig.test.json
node --test dist-test/test/agent-adapter-conformance.test.js dist-test/test/semantic-matrix-conformance.test.js
```

Exit codes: `0`, `1`

Verbatim tail:

```text
ℹ tests 23
ℹ suites 0
ℹ pass 20
ℹ fail 3
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2221.1054

✖ failing tests:

test at dist-test\test\agent-adapter-conformance.test.js:77:1
✖ the Eve fixture candidate satisfies the same universal pre-freeze semantic vector (0.7164ms)
  AssertionError [ERR_ASSERTION]: the Eve agent-adapter fixture candidate must exist

test at dist-test\test\semantic-matrix-conformance.test.js:73:1
✖ Eve can select its agent candidate without hiding separate continuity evidence (0.2051ms)
  TypeError: semantic matrix input is invalid: data/candidates/0 must NOT have additional properties

test at dist-test\test\semantic-matrix-conformance.test.js:155:1
✖ a passed matrix cannot contain unsupported top-level harness rows (0.9372ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

  false !== true
```

RED — host identity mutation after the first GREEN

Commands:

```text
npx tsc -p tsconfig.test.json
node --test dist-test/test/semantic-matrix-conformance.test.js
```

Exit codes: `0`, `1`

Verbatim tail:

```text
ℹ tests 10
ℹ suites 0
ℹ pass 9
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 622.8301

✖ failing tests:

test at dist-test\test\semantic-matrix-conformance.test.js:105:1
✖ Eve agent candidate identity or contract mismatch refuses semantic evidence (1.266ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected

  + 'fixture-only'
  - 'unsupported'
```

Final fail-fast emitting build and relevant conformance suites

Commands:

```text
npx tsc -p tsconfig.test.json
node --test dist-test/test/agent-adapter-conformance.test.js dist-test/test/semantic-matrix-conformance.test.js dist-test/test/aggregate-conformance.test.js dist-test/test/continuity/conformance-runner.test.js
```

Exit codes: `0`, `0`

Verbatim tail:

```text
✔ Eve continuity evidence cannot be relabeled as agent-adapter evidence (0.4804ms)
✔ Eve can select its agent candidate without hiding separate continuity evidence (1.487ms)
✔ Eve agent candidate identity or contract mismatch refuses semantic evidence (1.5498ms)
✔ semantic matrix refuses unknown harnesses and does not synthesize missing candidates (0.5471ms)
✔ matrix report has exactly the five unique harness identities and binds status to aggregate (0.4444ms)
✔ invalid source reports cannot publish semantic checks (0.2429ms)
✔ listed missing evidence must be explicit and CLI failures remain schema-valid (424.7278ms)
✔ a passed matrix cannot contain unsupported top-level harness rows (0.8875ms)
✔ explicit missing evidence cannot coexist with a candidate or report (0.3775ms)
ℹ tests 39
ℹ suites 0
ℹ pass 39
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2343.2424
```

Eve candidate CLI check

Command:

```text
npm run check:agent-adapter -- conformance/agent-adapter/v0/fixtures/eve-observed.json
```

Exit code: `0`

Verbatim tail:

```text
> reelier@0.32.1 check:agent-adapter
> node conformance/agent-adapter/v0/check.mjs conformance/agent-adapter/v0/fixtures/eve-observed.json

{"v":"reelier.agent-adapter-conformance-report/v0","status":"passed","adapterId":"eve","checks":[{"id":"universal-operations","status":"passed","detail":"adapter exposes only the universal semantic operation set"},{"id":"dynamic-job-discovery","status":"passed","detail":"loaded and invoked job references originate in catalog discovery"},{"id":"host-bound-outcome-input","status":"passed","detail":"Outcome input contains no authenticated identity or provider authority"},{"id":"attenuated-child-principal","status":"passed","detail":"child principal and effect allocation are distinct and narrower"},{"id":"pre-freeze-no-dispatch","status":"passed","detail":"pending Adapter Contract refuses without dispatch or a passing receipt"},{"id":"observed-coverage-honesty","status":"passed","detail":"observed mode remains available with unchecked topology and completeness"},{"id":"enforced-mode-unavailable","status":"passed","detail":"enforced mode remains unavailable without verified topology"}]}
```

Typechecks

Commands:

```text
npx tsc --noEmit --pretty false
npx tsc --noEmit -p tsconfig.test.json --pretty false
```

Exit codes: `0`, `0`. Verbatim output: empty.

Project build

Command:

```text
npm run build
```

Exit code: `0`

Verbatim tail:

```text
> reelier@0.32.1 build
> node scripts/build-authority-contract.mjs --check && node scripts/build-bootstrap-contract.mjs --check && tsc -p tsconfig.json && node scripts/build-authority-contract.mjs --copy-schemas && node scripts/build-packs.mjs

built cloudflare_api_token, cloudflare_dns, github_issue_labels, gmail, gmail_labels, hubspot_slack_information_flow, neon_database, slack_channel_topic, stripe, vercel_deployment
```

Review fix round RED — committed Eve fixture and candidate-path binding

Commands:

```text
npx tsc -p tsconfig.test.json
node --test dist-test/test/semantic-matrix-conformance.test.js
```

Exit codes: `0`, `1`

Verbatim tail:

```text
ℹ tests 11
ℹ suites 0
ℹ pass 10
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 619.6753

✖ failing tests:

test at dist-test\test\semantic-matrix-conformance.test.js:124:1
✖ Eve agent candidate cannot publish semantic evidence through the continuity path (0.824ms)
  AssertionError [ERR_ASSERTION]: Missing expected exception.
```

Review fix round final emitting build and focused conformance suites

Commands:

```text
npx tsc -p tsconfig.test.json
node --test dist-test/test/agent-adapter-conformance.test.js dist-test/test/semantic-matrix-conformance.test.js dist-test/test/aggregate-conformance.test.js dist-test/test/continuity/conformance-runner.test.js
```

Exit codes: `0`, `0`

Verbatim tail:

```text
✔ Eve continuity evidence cannot be relabeled as agent-adapter evidence (0.4557ms)
✔ Eve can select its agent candidate without hiding separate continuity evidence (1.1731ms)
✔ Eve agent candidate identity relabels refuse semantic evidence (1.3698ms)
✔ Eve agent candidate cannot publish semantic evidence through the continuity path (0.5951ms)
✔ semantic matrix refuses unknown harnesses and does not synthesize missing candidates (0.2051ms)
✔ matrix report has exactly the five unique harness identities and binds status to aggregate (1.2003ms)
✔ invalid source reports cannot publish semantic checks (0.2775ms)
✔ listed missing evidence must be explicit and CLI failures remain schema-valid (422.2895ms)
✔ a passed matrix cannot contain unsupported top-level harness rows (0.5812ms)
✔ explicit missing evidence cannot coexist with a candidate or report (0.2595ms)
ℹ tests 40
ℹ suites 0
ℹ pass 40
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2308.5648
```

Review fix round project build

Command:

```text
npm run build
```

Exit code: `0`

Verbatim tail:

```text
> reelier@0.32.1 build
> node scripts/build-authority-contract.mjs --check && node scripts/build-bootstrap-contract.mjs --check && tsc -p tsconfig.json && node scripts/build-authority-contract.mjs --copy-schemas && node scripts/build-packs.mjs

built cloudflare_api_token, cloudflare_dns, github_issue_labels, gmail, gmail_labels, hubspot_slack_information_flow, neon_database, slack_channel_topic, stripe, vercel_deployment
```

Review fix round typechecks

Commands:

```text
npx tsc --noEmit --pretty false
npx tsc --noEmit -p tsconfig.test.json --pretty false
```

Exit codes: `0`, `0`. Verbatim output: empty.

Review fix round diff check

Commands:

```text
git status --short
git diff --check
git diff --cached --check
git diff --name-only db1bf45..HEAD
```

Exit codes: `0`, `0`, `0`, `0`.

Verbatim output before this report update:

```text
conformance/semantic-matrix/v0/check.mjs
docs/superpowers/plans/2026-08-16-five-harness-conformance.md
test/semantic-matrix-conformance.test.ts
```

Open risks

- The Eve agent candidate is fixture-only. It proves that a candidate with Eve identity satisfies
  the universal pre-freeze semantic checker; it does not prove Eve performed delegation, governed
  execution, dispatch, provider acknowledgment, topology enforcement, or complete traffic capture.
- The existing Eve process fixture remains the only continuity evidence. It is surfaced separately
  as continuity-proven with execution and outcome not tested; it is not converted into or cited as
  agent delegation evidence.
- The matrix v0 report contract now requires a `continuityEvidence` array (empty when absent).
  Consumers constructing reports manually must add that closed field; generated reports already do.
- A future supported/live candidate needs independently captured Eve agent-adapter execution and
  coverage provenance. This task intentionally supplies neither and therefore cannot produce a
  passing matrix.
