Files changed

- `conformance/candidate-capture/v0/check.mjs`
- `conformance/candidate-capture/v0/capture.schema.json`
- `conformance/candidate-capture/v0/report.schema.json`
- `conformance/candidate-capture/v0/README.md`
- `test/candidate-capture-conformance.test.ts`
- `docs/superpowers/plans/2026-08-16-five-harness-conformance.md`
- `.superpowers/sdd/task-5-candidate-capture-report.md`

What changed per file

- `conformance/candidate-capture/v0/check.mjs` implements the detached five-harness capture
  boundary. Every supplied v0 capture remains failed/non-passing. Malformed, stale,
  identity-invalid, digest-invalid, malformed-JSON, and sensitive inputs emit failed
  `invalid-candidate`; only actual absence emits `not-tested`/`candidate-missing`. Recursive
  rejection covers sensitive object keys and identifier strings in JSON values and arrays,
  including pair arrays and field descriptors. Fix round 3 rejects every value matching
  `^[A-Za-z][A-Za-z0-9+.-]*:` and every protocol-relative `//` URI while preserving common
  secret/token pattern rejection. The required semantic identity key `descriptor.agentHost`
  remains the sole host-key exception. Invalid reports retain at most a checker-computed raw digest
  and never raw JSON.
- `conformance/candidate-capture/v0/capture.schema.json` defines the closed supplied-or-missing
  input envelope. Freshness evaluation time is runtime-owned and cannot be supplied by callers.
- `conformance/candidate-capture/v0/report.schema.json` defines failed-only supplied reports and
  closes identity, classification, freshness, artifact, binding, reason, and non-claim cross-fields.
- `conformance/candidate-capture/v0/README.md` documents recursive identifier rejection in keys and
  values, the complete URI-prefix rule, the semantic identity exception, digest-only output, and
  failed/non-passing semantics.
- `test/candidate-capture-conformance.test.ts` covers all five harnesses, missing/malformed input,
  identity/digest/freshness failures, sensitive identifiers in values, pair arrays, and field
  descriptors, `mailto:`, `data:`, `postgres:`, custom schemes and `//` URIs, existing common
  secret/token forms, and a safe semantic-report control that remains failed/non-passing.
- `docs/superpowers/plans/2026-08-16-five-harness-conformance.md` records the approved closed Task 5
  allowlist and objective. It was changed in the original Task 5 work and not in fix round 3.
- `.superpowers/sdd/task-5-candidate-capture-report.md` records cumulative scope, deviations,
  commits, verbatim verification tails, and risks, including fix-round-3 RED/GREEN evidence.

Deviations from the plan and why

- No file-scope deviation. Earlier review fixes made supplied captures failed-only, removed
  caller-owned evaluation time, and added the narrow `descriptor.agentHost` key exception required
  by the candidate contract.
- Fix round 3 applies identifier classification to every JSON string. This can reject benign
  semantic uses of words such as `host` or `authorization`, but it is required to prevent alternate
  JSON encodings from bypassing the credential-free boundary.
- No external provider, network, credential, GitHub, email, push, merge, formatter, codemod, or
  package-surface change was used. No file outside the Task 5 allowlist was modified.

TDD evidence

Fix round 3 first ran the emitting test build, then the focused Task 5 test. RED exited 1 because
`[["host","db.internal"]]` and `mailto:operator@example.invalid` returned
`live-candidate-observed` instead of `invalid-candidate`. The existing safe semantic-report and
common secret/token controls passed during RED. Verbatim RED tail:

```text
ℹ tests 16
ℹ suites 0
ℹ pass 14
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 851.024
```

After the implementation, the focused Task 5 suite passed 16/16 before the GREEN commit.

Commits

Initial Task 5 and first review fix:

- `cb60a9b` — `test: define black-box candidate capture boundary`
- `0286c11` — `feat: add black-box candidate capture boundary`
- `cf49f91` — `fix: accept bound raw adapter reports`
- `e5ea5bf` — `docs: record Task 5 capture evidence`
- `57c425e` — `docs: add Task 5 implementation report`
- `d260c3b` — `test: close candidate capture trust boundary`
- `095e25d` — `test: close capture report cross fields`
- `c3dd63c` — `fix: fail closed candidate capture reports`
- `d18d79c` — `docs: align candidate capture failure semantics`
- `7b19eb9` — `docs: record Task 5 capture fix evidence`

Fix round 2:

- `fa1507f` — `test: close candidate capture transport boundary`
- `0052b13` — `fix: reject generic capture transport data`
- `9508d24` — `docs: define generic capture rejection`
- `aaec50a` — `docs: record Task 5 round 2 evidence`

Fix round 3:

- `e04f700` — `test: close recursive capture redaction gaps`
- `b6844d6` — `fix: redact sensitive capture values recursively`
- `a5175f2` — `docs: define recursive capture value rejection`

The fix-round-3 code/test/documentation evidence HEAD before this report update is
`a5175f285203d88f203365f4569047c00df25521`. The report-only commit follows this evidence snapshot.

Final verification

Commands ran in this order:

```text
npm run build
npx tsc -p tsconfig.test.json --pretty false
node --test --test-concurrency=1 dist-test/test/candidate-capture-conformance.test.js dist-test/test/coverage-envelope-conformance.test.js dist-test/test/semantic-matrix-conformance.test.js dist-test/test/aggregate-conformance.test.js dist-test/test/agent-adapter-conformance.test.js dist-test/test/continuity/conformance-runner.test.js
npx tsc --noEmit --pretty false
npx tsc -p tsconfig.test.json --noEmit --pretty false
git diff --check
git diff --check HEAD~3..HEAD
```

The package build exited 0 with this verbatim tail:

```text
> reelier@0.32.1 build
> node scripts/build-authority-contract.mjs --check && node scripts/build-bootstrap-contract.mjs --check && tsc -p tsconfig.json && node scripts/build-authority-contract.mjs --copy-schemas && node scripts/build-packs.mjs

built cloudflare_api_token, cloudflare_dns, github_issue_labels, gmail, gmail_labels, hubspot_slack_information_flow, neon_database, slack_channel_topic, stripe, vercel_deployment
```

The emitting test build, both no-emit typechecks, and both diff checks exited 0 with no output.
Verbatim relevant-test tail:

```text
✔ invalid source reports cannot publish semantic checks (0.2353ms)
✔ listed missing evidence must be explicit and CLI failures remain schema-valid (381.3677ms)
✔ a passed matrix cannot contain unsupported top-level harness rows (0.5622ms)
✔ explicit missing evidence cannot coexist with a candidate or report (0.2511ms)
ℹ tests 68
ℹ suites 0
ℹ pass 68
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 5134.2491
```

The fix-round-3 allowlist audit from `aaec50a` through evidence HEAD `a5175f2` was:

```text
conformance/candidate-capture/v0/README.md
conformance/candidate-capture/v0/check.mjs
test/candidate-capture-conformance.test.ts
```

Every path is in the closed Task 5 allowlist. This report is the fourth and final fix-round-3 path
and is also allowlisted.

Open risks

- No actual live harness candidate was supplied. Codex, Claude Code, Eve, Grok Build, and Grok Bot
  live execution therefore remain unproved by Task 5.
- Harness and adapter instance digests are unkeyed assertions. They bind relabeling and mutation
  within the supplied envelope but do not authenticate who supplied it; v0 reports remain failed.
- The recursive detector closes sensitive identifiers in keys and string values, every anchored URI
  scheme and `//` prefix, and named credential signatures, but cannot prove that an arbitrary opaque
  string is not a secret. Producers must still remove secrets before capture. Raw payloads are
  processed locally but never emitted in reports.
- The conservative boundary can reject benign payload fields, standalone identifier words, or
  strings matching URI grammar. This fail-closed false-positive risk is intentional for a
  credential-free detached boundary.
