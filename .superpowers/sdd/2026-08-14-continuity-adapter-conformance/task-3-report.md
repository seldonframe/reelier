# Files changed

- `test/authority/fixtures/github-issue-labels.ts`
- `test/authority/certification-github-issue-labels-runner.test.ts`
- `test/continuity/support/path-c-port.ts`
- `test/continuity/path-c-port.test.ts`
- `.superpowers/sdd/2026-08-14-continuity-adapter-conformance/task-3-report.md`

# What changed per file

- `test/authority/fixtures/github-issue-labels.ts`: extracted the complete hermetic GitHub issue-label fixture, exported the required mode/authority/fixture types, preserved the full inferred return shape, and added idempotent fixture cleanup with restoration of the test platform seam.
- `test/authority/certification-github-issue-labels-runner.test.ts`: replaced every local fixture construction with `createGitHubIssueLabelsFixture`, replaced fixture-root removal with `f.close()`, retained the special live-run settling order, and removed imports moved with the fixture.
- `test/continuity/support/path-c-port.ts`: added an ephemeral `127.0.0.1` HTTP port with a minted bearer token; the closed POST/GET/counter routes; canonical request-byte binding; real runner idempotency; real provider-write and consumed-budget counters; public-only runner outcome mapping; verified graph export; the after-provider-apply response latch; and deterministic server/latch cleanup.
- `test/continuity/path-c-port.test.ts`: added public-boundary coverage for authentication, exact retry deduplication, status-read isolation, changed-byte conflict refusal, confidential credential exclusion, verified graph export, response fault latching, and close-before-fault cleanup.
- `.superpowers/sdd/2026-08-14-continuity-adapter-conformance/task-3-report.md`: recorded RED/GREEN evidence, extraction equivalence, review, and risks.

# Deviations from the plan

- No implementation-scope deviation. The requested final commit was split into three immutable, reviewable commits because the dispatch instructions require committing the first coherent unit early and forbid amending prior commits.
- The port test count is six rather than the four minimum cases: changed canonical bytes and close-before-fault are explicit binding/cleanup requirements and each received a focused regression test.

# RED / GREEN evidence

## RED — missing loopback port

Command:

```powershell
npx tsc -p tsconfig.test.json
```

Output:

```text
test/continuity/path-c-port.test.ts(5,43): error TS2307: Cannot find module './support/path-c-port.js' or its corresponding type declarations.
```

## GREEN — fixture extraction equivalence

Command:

```powershell
npx tsc -p tsconfig.test.json
node --test --test-concurrency=1 dist-test/test/authority/certification-github-issue-labels-runner.test.js
```

Verbatim tail:

```text
ℹ tests 48
ℹ suites 0
ℹ pass 47
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 43047.882
```

The pre-extraction baseline had the same 48 tests, 47 passes, zero failures, and one existing Windows symlink-privilege skip. All fixture modes and all four authority modes remained exercised by the unchanged assertions.

## RED — close-before-fault cleanup

Command:

```powershell
npx tsc -p tsconfig.test.json
node --test --test-concurrency=1 dist-test/test/continuity/path-c-port.test.js
```

Verbatim tail:

```text
✖ closing the port releases an unreached fault latch (95.9854ms)
ℹ tests 6
ℹ suites 0
ℹ pass 5
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 4330.6365
```

## GREEN — focused port suite

Command:

```powershell
npx tsc -p tsconfig.test.json
node --test --test-concurrency=1 dist-test/test/continuity/path-c-port.test.js
```

Verbatim tail:

```text
ℹ tests 6
ℹ suites 0
ℹ pass 6
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3579.3126
```

## Final combined gate

Command:

```powershell
npx tsc -p tsconfig.test.json
node --test --test-concurrency=1 dist-test/test/continuity/path-c-port.test.js dist-test/test/authority/certification-github-issue-labels-runner.test.js
```

Verbatim tail:

```text
ℹ tests 54
ℹ suites 0
ℹ pass 53
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 46523.8549
```

`git diff --check` exited 0 before each implementation commit and before report creation.

# Extraction-equivalence evidence

- Before extraction: 48 tests, 47 pass, 0 fail, 1 existing Windows symlink skip.
- After extraction: 48 tests, 47 pass, 0 fail, 1 existing Windows symlink skip.
- The operator config literal, principals, grant construction, two-effect budget, trust material, lifecycle schedule modes, hermetic provider composition, and returned fixture members were moved without narrowing the inferred return type.
- Existing live-dispatch cleanup still releases and settles the running promise before invoking the extracted fixture's `close()`.

# Self-review

- Boundary: the server explicitly listens on `127.0.0.1` with port `0` and rejects a non-loopback bound address.
- Authentication: every exposed route requires the random client token; provider credentials are used only inside server callbacks and never returned.
- Closed input: POST accepts exactly `requestId`, `sourceRefs`, and `choices`; validates scalar value domains; injects `v` internally; and hashes canonical protocol bytes before any runner or budget action.
- Idempotency: exact retries call the real Path C runner; changed canonical bytes return `request-id-conflict` before runner, provider, or budget access.
- Counters: provider dispatches come from `GitHubHermeticRunnerResult.providerWrites`; reservations come from the real allocation's consumed budget; status reads do not dispatch or reserve.
- Confidentiality: HTTP outcomes contain only public ingress fields plus provider-write count. Private graphs remain local to verification; `exportVerifiedGraph()` returns only the verifier-produced branded result.
- Fault timing: the latch is reached only after `runner.run` and counter refresh complete, and before response serialization. `close()` releases both reached and unreached latches before closing the server.
- Scope: no production runner, gate, provider, model, deployment, workflow, or external service was changed or invoked.

# Open risks

- None identified within the scoped hermetic test boundary. The single skipped authority assertion remains the pre-existing Windows symlink-privilege skip and is unrelated to this task.

# Fix round 1

## Review findings addressed

- Thrown controlled cuts now refresh counter truth from the real allocation and, when readable, the authoritative runner status before the HTTP 500 is written. The refresh does not increment the public `statusReads` counter and does not dispatch or reserve.
- Fixture construction is exception-safe. Any failure before the fixture is returned recursively removes only the exact minted root, restores the exact prior platform seam, and rethrows the original construction error even if best-effort cleanup itself fails.

## RED — controlled-cut counter truth and rejecting fixture cleanup

Command:

```powershell
npx tsc -p tsconfig.test.json
node --test --test-concurrency=1 --test-name-pattern="failure counters expose real effects" dist-test/test/continuity/path-c-port.test.js
node --test --test-concurrency=1 --test-name-pattern="rejecting fixture construction removes" dist-test/test/authority/certification-github-issue-labels-runner.test.js
```

Verbatim failure summaries:

```text
✖ cut-after-budget failure counters expose real effects without duplicate action (796.2598ms)
✖ cut-after-apply failure counters expose real effects without duplicate action (658.4173ms)
ℹ tests 2
ℹ suites 0
ℹ pass 0
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1678.1266

cut-after-budget actual: { outcomeRequests: 1, statusReads: 0, providerDispatches: 0, reservations: 0 }
cut-after-budget expected: { outcomeRequests: 1, statusReads: 0, providerDispatches: 0, reservations: 1 }
cut-after-apply actual: { outcomeRequests: 1, statusReads: 0, providerDispatches: 0, reservations: 0 }
cut-after-apply expected: { outcomeRequests: 1, statusReads: 0, providerDispatches: 1, reservations: 1 }

✖ rejecting fixture construction removes its exact root and restores the platform seam (72.894ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 260.0237

AssertionError [ERR_ASSERTION]: Missing expected exception.
```

## GREEN — controlled-cut counter truth

Command:

```powershell
npx tsc -p tsconfig.test.json
node --test --test-concurrency=1 --test-name-pattern="failure counters expose real effects" dist-test/test/continuity/path-c-port.test.js
```

Output:

```text
✔ cut-after-budget failure counters expose real effects without duplicate action (756.5408ms)
✔ cut-after-apply failure counters expose real effects without duplicate action (726.3775ms)
ℹ tests 2
ℹ suites 0
ℹ pass 2
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1674.0842
```

## GREEN — rejecting fixture cleanup and seam restoration

Command:

```powershell
npx tsc -p tsconfig.test.json
node --test --test-concurrency=1 --test-name-pattern="rejecting fixture construction removes" dist-test/test/authority/certification-github-issue-labels-runner.test.js
```

Output:

```text
✔ rejecting fixture construction removes its exact root and restores the platform seam (223.6998ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 486.4523
```

## Final fix-round gate

Command:

```powershell
npx tsc -p tsconfig.test.json
node --test --test-concurrency=1 dist-test/test/continuity/path-c-port.test.js dist-test/test/authority/certification-github-issue-labels-runner.test.js
```

Verbatim tail:

```text
✔ cut-after-budget failure counters expose real effects without duplicate action (565.2001ms)
✔ cut-after-apply failure counters expose real effects without duplicate action (695.4753ms)
✔ after-provider-apply latch withholds the first response until release (697.0391ms)
✔ closing the port releases an unreached fault latch (89.6954ms)
ℹ tests 57
ℹ suites 0
ℹ pass 56
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 46080.9762
```

## Fix-round self-review

- Failure counter refresh calls only `runner.status` and `delegation.budget.get`; neither path dispatches, reserves, or derives truth from HTTP request counts.
- The exact retry after each controlled cut returns through the real runner while provider writes and consumed reservations remain unchanged, proving no duplicate action.
- Constructor cleanup tracks only the root returned by that invocation's `mkdtemp`; no parent, glob, shared temp directory, or unresolved variable is removed.
- Cleanup exceptions cannot replace the expected authority-construction error. The platform restoration runs after cleanup on every rejecting path.
- No production runner semantics, gates, providers, external services, workflows, or deployment state changed.

## Fix-round concerns

- None. The one skipped test remains the existing Windows symlink-privilege case.
