Files changed

- `src/authority/decision.ts`
- `src/authority/host/fs-ledger.ts`
- `test/authority/decision.test.ts`
- `test/authority/fence-port.test.ts`
- `test/authority/ledger.test.ts`
- `.superpowers/sdd/2026-08-11-authority-cell-certification-train/task-1-report.md`

Commits

- `672e3c0 fix(ledger): close fence identity probes cleanly`
- `ed546bb fix(authority): classify durable decision contention`
- `5d41d4b fix(ledger): finish acknowledged prep cleanup`
- `d5b3a02 test(authority): expect durable contention outcome`
- `75a4994 fix(authority): close continuation contention races`

What changed

- `src/authority/decision.ts`: when acquiring the decision lock fails after a peer has durably recorded the same event, primary ingress, or reservation, the contender reads the immutable store and returns the corresponding terminal result instead of collapsing it to `unavailable`.
- `test/authority/decision.test.ts`: adds a deterministic held-lock regression and raises child-process race coverage from 20 to 80 contenders per conflict class.
- `src/authority/host/fs-ledger.ts`: the K1 fence identity responder now half-closes after writing its identity, rather than sending a TCP reset immediately after a successful response. It exposes a host-private test seam only.
- `test/authority/fence-port.test.ts`: verifies a probing client receives the full identity and a clean EOF with no `ECONNRESET`.
- `src/authority/host/fs-ledger.ts`: once a dead owner's prep-retired cleanup lifecycle has a durable stage or acknowledgement, its completion is permitted past the acquisition boundary; creation of the first stage remains bound to the original budget.

Deviations from plan

- None. The exact Ubuntu CI failure later supplied was fixed without altering timeout values, sleeps, or assertions.

Test results

`npx tsc -p tsconfig.test.json; node --test --test-concurrency=1 --test-name-pattern="fence identity response" dist-test/test/authority/fence-port.test.js`

```text
✔ a fence identity response completes without resetting its probing client (17.6861ms)
ℹ tests 1
ℹ pass 1
ℹ fail 0
```

`npx tsc -p tsconfig.test.json; node --test --test-concurrency=1 --test-name-pattern="concurrent held decision lock|concurrent appends" dist-test/test/authority/decision.test.js`

```text
✔ a concurrent held decision lock returns the durable terminal classification (77.2196ms)
✔ concurrent appends and every crash boundary expose a complete transaction or no transaction (14989.5379ms)
ℹ tests 2
ℹ pass 2
ℹ fail 0
```

`npm test -- --test-name-pattern="concurrent appends"` was attempted before edits but timed out after 124 seconds because the package script compiles and then invokes the repository-wide serialized test glob; it did not produce a test result.

Open risks

- `.tmp-pack/` is pre-existing/unrelated and intentionally unmodified.

Update — exact Ubuntu marker-only evidence

- Ubuntu PR #115 run `31433842051`, job `93603357565`, failed `atomic admission prep-retired ack windows converge only with creator or dead-owner authority` / `marker-only`: expected the advanced clock result and received `{ok:false,reason:"busy"}`. `marker-plus-ack` and `orphan-ack` passed.
- `5d41d4b fix(ledger): finish acknowledged prep cleanup` permits a dead, already-started `prep-retired` cleanup lifecycle to complete after the acquisition budget boundary. It does not widen initial cleanup authority: a marker-only lifecycle still requires a live budget to create its first stage; only an existing stage or acknowledgement can finish.
- Focused retest after the change:

```text
✔ marker-only (137.5762ms)
✔ marker-plus-ack (57.8033ms)
✔ orphan-ack (46.1806ms)
ℹ tests 4
ℹ pass 4
ℹ fail 0
```

Final focused decision run:

```text
ℹ tests 21
ℹ pass 21
ℹ fail 0
ℹ duration_ms 16245.9747
```

`d5b3a02 test(authority): expect durable contention outcome` updates the former stranded-lock expectation: when the prior decision is durable, a new conflicting decision deterministically returns `primary-ingress-conflict` instead of `unavailable`.

## Fix round 2 — identity-bound continuation and terminal contention

What changed

- The preparation-retired over-budget continuation is no longer a deterministic-name set. It is a single capability bound to the active K1 operation, the exact file identity it created, and that operation's lifetime. The same identity is carried across the stage-to-ack rename and cleared on final cleanup or operation exit. A same-name peer replacement is preserved and the contender refuses `busy` once its original budget is exhausted.
- Decision contention retains the immutable unlocked fast-path when the winning record is already durable. If that first post-timeout read is absent, only a real decision-lock contention may retry; the contender reacquires the lock and classifies or appends under that lock. Other publication/persistence failures retain their prior `unavailable`/`corruption` behavior.
- The fence regression now covers an `allowHalfOpen` client that receives the complete identity and EOF while deliberately keeping its write side open. It observes the server-side socket close and zero retained connections.
- The bounded-exception commentary now states the initiation, exact-identity, stage-to-ack, and operation-lifetime bound.

Deterministic regressions

- A winner writes the durable decision only after the contender's first timeout and unlocked store-read boundary. The test reads the reacquired lock's real `owner.json` before accepting the terminal `idempotent` classification.
- Exact same-operation preparation cleanup continues after budget expiry, while a later operation cannot inherit that authority.
- Same-name replacements at both the stage and acknowledgement handoff boundaries remain byte/identity-preserved and are not mutated over budget.
- A half-open fence client cannot keep a server connection resident after response EOF.

Final focused verification

`npx tsc -p tsconfig.test.json`

```text
exit 0
```

`node --test --test-concurrency=1 dist-test/test/authority/decision.test.js`

```text
ℹ tests 22
ℹ pass 22
ℹ fail 0
ℹ duration_ms 25085.3383
```

`node --test --test-concurrency=1 dist-test/test/authority/fence-port.test.js`

```text
ℹ tests 8
ℹ pass 8
ℹ fail 0
ℹ duration_ms 357.437
```

`node --test --test-concurrency=1 --test-name-pattern="prep-only cleanup writer|prep-only progress respects|over-budget continuation|atomic admission prep-retired ack windows" dist-test/test/authority/ledger.test.js`

```text
ℹ tests 11
ℹ pass 11
ℹ fail 0
ℹ duration_ms 938.6522
```

Review and remaining gates

- Independent read-only review found no runtime correctness or authority-widening defect. Its test-observability concern was addressed by verifying the actual reacquired decision-lock owner file.
- The task brief does not contain a formal files-touched list; this round stayed within the parent-assigned ownership (`decision.ts`, `fs-ledger.ts`, their focused tests, and this report) and did not alter the brief.
- Complete Ubuntu and Windows stress-suite evidence remains a CI gate. This round ran the requested focused suites on Windows; it does not claim Ubuntu verification.
- `.tmp-pack/` remains pre-existing/unrelated and intentionally unmodified.
