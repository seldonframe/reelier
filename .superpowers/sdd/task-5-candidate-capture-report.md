Files changed

- `conformance/candidate-capture/v0/check.mjs`
- `conformance/candidate-capture/v0/capture.schema.json`
- `conformance/candidate-capture/v0/report.schema.json`
- `conformance/candidate-capture/v0/README.md`
- `test/candidate-capture-conformance.test.ts`
- `docs/superpowers/plans/2026-08-16-five-harness-conformance.md`
- `.superpowers/sdd/task-5-candidate-capture-report.md`

What changed per file

- `conformance/candidate-capture/v0/check.mjs` adds a local-only black-box capture checker shared by
  Codex, Claude Code, Eve, Grok Build, and Grok Bot. It validates canonical harness/adapter mapping,
  commits harness and adapter instance identities with timestamps and the exact raw artifact digest,
  rejects stale/future/overlong captures, parses raw candidate/report JSON only for identity and
  secret rejection, emits no raw payload, preserves observed versus enforced classification, and
  produces integrity-committed reports. Fixture and observed captures fail; explicit absence is
  `not-tested`; only a fresh `live-candidate` can pass this capture boundary.
- `conformance/candidate-capture/v0/capture.schema.json` defines the closed input envelope and
  mutually exclusive supplied/missing states, exact five-harness vocabulary, canonical adapter
  identities, capture modes, freshness fields, artifact kind, raw digest, and binding digest.
- `conformance/candidate-capture/v0/report.schema.json` defines the closed output, including
  non-passing fixture/observed constraints, missing-candidate absence constraints, freshness,
  classification, non-claims, raw artifact digest, binding digest, and report digest.
- `conformance/candidate-capture/v0/README.md` documents the detached transport-neutral format,
  report/candidate identity rules, 24-hour maximum freshness, no-credential rule, exact meaning of a
  passing capture, explicit non-claims, local CLI behavior, and the absence of a package script.
- `test/candidate-capture-conformance.test.ts` covers all five harnesses, candidate and genuine
  agent-adapter report shapes, fixture/observed non-success, explicit missing candidates, closed
  schema refusal, harness/adapter/instance relabeling, raw/report commitment tampering, stale and
  malformed timestamps, credential/token rejection, output forgery, and CLI absence.
- `docs/superpowers/plans/2026-08-16-five-harness-conformance.md` contains the user-authorized
  explicit Files touched allowlists for Tasks 5-7, including every Task 5 file above.
- `.superpowers/sdd/task-5-candidate-capture-report.md` records scope, TDD evidence, verification,
  commits, deviations, and open risks.

Deviations from the plan and why

- None. Task 5 stayed within its explicit allowlist. No source package file, package script,
  dependency, provider, credential, URL fetch, external call, push, merge, formatter, or codemod was
  added or used.
- The requested independent code-review subagent was unavailable in this session. A local
  requirement/diff audit found and fixed raw report compatibility and common token-field rejection;
  this is a review-process gap, not a product-scope change.

TDD evidence

Initial RED command (emitting build before the focused test):

```text
npx tsc -p tsconfig.test.json
node --test --test-concurrency=1 dist-test/test/candidate-capture-conformance.test.js
```

Exit codes: `0`, `1`.

Verbatim RED tail:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'C:\Users\maxim\CascadeProjects\reelier\.worktrees\five-harness-conformance\conformance\candidate-capture\v0\check.mjs'
✖ dist-test\test\candidate-capture-conformance.test.js (48.8399ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 54.4942
```

Initial GREEN command used the same emitting build and focused test. Exit codes: `0`, `0`.

Verbatim GREEN tail:

```text
✔ report validation detects status, digest, identity, reason, and freshness forgeries (0.7003ms)
✔ CLI absence emits a closed not-tested report without a synthetic candidate (139.7194ms)
ℹ tests 10
ℹ suites 0
ℹ pass 10
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 317.5545
```

Review-fix RED used the same build/focused-test ordering. The genuine raw report shape and expanded
token-field mutations were the only failures:

```text
✖ raw report identity is bound and its exact bytes are committed (0.2057ms)
✖ credential-like fields and token-shaped values are rejected rather than redacted (1.3244ms)
ℹ tests 10
ℹ suites 0
ℹ pass 8
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 326.0739
```

Review-fix GREEN exit codes: `0`, `0`. Verbatim tail:

```text
✔ report validation detects status, digest, identity, reason, and freshness forgeries (0.7826ms)
✔ CLI absence emits a closed not-tested report without a synthetic candidate (139.3646ms)
ℹ tests 10
ℹ suites 0
ℹ pass 10
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 316.3205
```

Commits

- `cb60a9b` — `test: define black-box candidate capture boundary`
- `0286c11` — `feat: add black-box candidate capture boundary`
- `cf49f91` — `fix: accept bound raw adapter reports`
- Report/allowlist commit: pending this report commit.

Final verification

Commands (fail-fast, no package script):

```text
npx tsc --noEmit --pretty false
npx tsc -p tsconfig.test.json --pretty false
node --test --test-concurrency=1 dist-test/test/candidate-capture-conformance.test.js dist-test/test/coverage-envelope-conformance.test.js dist-test/test/semantic-matrix-conformance.test.js dist-test/test/aggregate-conformance.test.js dist-test/test/agent-adapter-conformance.test.js dist-test/test/continuity/conformance-runner.test.js
node scripts/build-authority-contract.mjs --check
node scripts/build-bootstrap-contract.mjs --check
```

All exit codes: `0`. Both typechecks and both contract checks emitted no output.

Verbatim final test tail:

```text
✔ invalid source reports cannot publish semantic checks (0.2306ms)
✔ listed missing evidence must be explicit and CLI failures remain schema-valid (389.3479ms)
✔ a passed matrix cannot contain unsupported top-level harness rows (0.5414ms)
✔ explicit missing evidence cannot coexist with a candidate or report (0.2472ms)
ℹ tests 62
ℹ suites 0
ℹ pass 62
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 4653.5768
```

Open risks

- No actual live harness candidate was supplied during Task 5. All tests are hermetic local fixtures,
  so Codex, Claude Code, Eve, Grok Build, and Grok Bot live execution remain untested here.
- Identity and report commitments are unkeyed SHA-256 digests. They detect mutation relative to the
  supplied original input but do not authenticate who supplied the envelope; harness/adapter
  instance digests remain asserted at this boundary.
- A passing `live-candidate` proves only that a fresh, identity-bound candidate was supplied. It
  does not prove semantic conformance, harness execution, route enforcement, traffic completeness,
  outcome correctness, or production safety; the output states these non-claims explicitly.
- Secret rejection uses credential-like field names and common token signatures. It is intentionally
  fail-closed for recognized forms but cannot prove arbitrary opaque strings are non-secret; harnesses
  must remove credentials before capture. Raw payloads are never emitted in the report.
