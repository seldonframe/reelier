# Files changed

- `.gitignore`
- `conformance/continuity-adapter/v1/eve-fixture/agent/agent.ts`
- `conformance/continuity-adapter/v1/eve-fixture/agent/channels/eve.ts`
- `conformance/continuity-adapter/v1/eve-fixture/agent/instructions/continuity.ts`
- `conformance/continuity-adapter/v1/eve-fixture/agent/lib/binding.ts`
- `conformance/continuity-adapter/v1/eve-fixture/agent/lib/faults.ts`
- `conformance/continuity-adapter/v1/eve-fixture/agent/lib/runtime.ts`
- `conformance/continuity-adapter/v1/eve-fixture/agent/tools/continuity_checkpoint.ts`
- `conformance/continuity-adapter/v1/eve-fixture/agent/tools/reelier_outcome_request.ts`
- `conformance/continuity-adapter/v1/eve-fixture/agent/tools/reelier_outcome_status.ts`
- `conformance/continuity-adapter/v1/eve-fixture/evals/continuity.eval.ts`
- `conformance/continuity-adapter/v1/eve-fixture/evals/evals.config.ts`
- `conformance/continuity-adapter/v1/eve-fixture/package-lock.json`
- `conformance/continuity-adapter/v1/eve-fixture/package.json`
- `conformance/continuity-adapter/v1/eve-fixture/tsconfig.json`
- `src/continuity/normalize.ts`
- `test/continuity/eve-binding-static.test.ts`
- `test/continuity/normalize.test.ts`
- `.superpowers/sdd/2026-08-14-continuity-adapter-conformance/task-4-report.md`

# What changed per file

- `.gitignore`: ignores only fixture-local Eve state, build output, distribution output, and installed dependencies (`.eve/`, `.output/`, `dist/`, `node_modules/`).
- `agent/agent.ts`: configures the deterministic Eve `mockModel`, explicit context-window metadata, the three exact prompt-to-tool mappings, and a deterministic resume-context observation.
- `agent/channels/eve.ts`: installs one custom bearer `AuthFn<Request>`; SHA-256 of the bearer selects a registry entry containing only principal/task/workload identity.
- `agent/instructions/continuity.ts`: resolves a turn-scoped system instruction by identifying the actor, opening that task's ledger projection, and rendering resume Markdown. It makes no authority request/status call.
- `agent/lib/binding.ts`: defines durable `reelier.continuity.binding/v1` state, pins the initiating task/principal/workload tuple, refuses missing or changed current auth, and derives the exact Eve actor including `runtimeSessionId = ctx.session.id` and `harnessId = eve@0.37.1`.
- `agent/lib/faults.ts`: contains closed configuration and binding error types shared by the fixture.
- `agent/lib/runtime.ts`: constructs `FsContinuityLedger` and `createContinuityRuntimeAdapter`, validates the injected protocol/environment, restricts the authority port to unauthenticated `http://127.0.0.1`, and sends only the internal bearer to request/status routes.
- `agent/tools/continuity_checkpoint.ts`: exposes only `events`, `evidenceRefs`, `expectedCursor`, and `agentMemo`; enumerates public event variants without `consequence.observed` or `verified`; injects actor and authority fields from host context; projects the ledger result to a closed JSON object.
- `agent/tools/reelier_outcome_request.ts`: exposes exactly `choices`, `requestId`, and `sourceRefs` and delegates only to `adapter.requestOutcome`.
- `agent/tools/reelier_outcome_status.ts`: exposes exactly `requestId` and delegates only to `adapter.statusOutcome`.
- `evals/continuity.eval.ts`: proves stable session ID, checkpoint/resume behavior, exact tool order/count, and no failed actions across four deterministic turns.
- `evals/evals.config.ts`: deterministic local configuration with no judge and no reporters.
- `package.json`: isolated exact Eve 0.37.1 / Zod 4 / Node 24 / TypeScript 7 package using the root through `file:../../../..` only.
- `package-lock.json`: npm lockfile generated inside the fixture with exact direct dependency versions.
- `tsconfig.json`: strict NodeNext fixture-only typecheck configuration.
- `src/continuity/normalize.ts`: adds a harness-only bounded identifier validator that permits `@`; all other identity fields keep the prior alphabet.
- `test/continuity/eve-binding-static.test.ts`: specifies dependency isolation and the exact exported model-input key lists.
- `test/continuity/normalize.test.ts`: proves `eve@0.37.1` is accepted only as a harness ID and malformed, empty, overlong, or non-harness at-sign identifiers remain refused.
- `task-4-report.md`: this implementation and verification record.

# TDD evidence

## RED 1 — fixture boundary before implementation

Command:

```powershell
npx tsc -p tsconfig.test.json
node --test --test-concurrency=1 dist-test/test/continuity/eve-binding-static.test.js
```

Verbatim tail:

```text
✖ Eve fixture is isolated and its model-facing schemas exclude authority (1.5899ms)
Error: ENOENT: no such file or directory, open 'C:\Users\maxim\CascadeProjects\reelier\.worktrees\continuity-path-c-integration\conformance\continuity-adapter\v1\eve-fixture\package.json'
```

## RED 2 — exact Eve harness identifier

Command:

```powershell
npx tsc -p tsconfig.test.json
node --test --test-concurrency=1 dist-test/test/continuity/normalize.test.js
```

Verbatim tail:

```text
✖ authenticated workload normalization accepts the versioned Eve harness identifier (0.1048ms)
Error [ContinuityValidationError]: authenticated actor.harnessId must be a bounded identifier
ℹ tests 8
ℹ pass 7
ℹ fail 1
```

The same RED run proved the four non-harness identity fields already rejected `@`, and malformed harness IDs already refused.

## RED 3 — real Eve runtime integration

The first local Eve HTTP evaluation reached `continuity_checkpoint` and failed with:

```text
error=authenticated actor.harnessId must be a bounded identifier
EVAL_EXIT 1
PATH_C_COUNTERS {"outcomeRequests":0,"statusReads":0,"providerDispatches":0,"reservations":0}
```

After the authorized normalization fix, the next runtime RED found Eve's JSON boundary:

```text
error=Tool "continuity_checkpoint" call "mock-tool-call-1-0-1" returned a non-JSON-serializable result.
EVAL_EXIT 1
PATH_C_COUNTERS {"outcomeRequests":0,"statusReads":0,"providerDispatches":0,"reservations":0}
```

After projecting the checkpoint result, the next runtime RED demonstrated that Eve 0.37.1 includes prior-turn results in `toolResults`:

```text
✗ calledTool(reelier_outcome_request): expected exactly 1 matching call(s), found 0
✗ calledTool(reelier_outcome_status): expected exactly 1 matching call(s), found 0
PATH_C_COUNTERS {"outcomeRequests":0,"statusReads":0,"providerDispatches":0,"reservations":0}
```

The minimal correction applies the specified tool-result echo only when the current prompt ends in a tool message.

# GREEN and final verification

## Root continuity suite and mandated static test

Command:

```powershell
npx tsc -p tsconfig.test.json
node --test --test-concurrency=1 dist-test/test/continuity/*.test.js
node --test --test-concurrency=1 dist-test/test/continuity/eve-binding-static.test.js
```

Verbatim tails:

```text
ℹ tests 54
ℹ suites 0
ℹ pass 54
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 10804.0166
```

```text
✔ Eve fixture is isolated and its model-facing schemas exclude authority (3.5752ms)
ℹ tests 1
ℹ pass 1
ℹ fail 0
ℹ duration_ms 71.3076
```

## Exact dependency isolation

Command:

```powershell
npm --prefix conformance/continuity-adapter/v1/eve-fixture ls --depth=0
```

Verbatim output:

```text
reelier-eve-continuity-conformance@0.0.0 C:\Users\maxim\CascadeProjects\reelier\.worktrees\continuity-path-c-integration\conformance\continuity-adapter\v1\eve-fixture
+-- @types/node@24.13.3
+-- eve@0.37.1
+-- reelier@0.32.1 -> .\..\..\..\..
+-- typescript@7.0.2
`-- zod@4.4.3
```

The root `package.json` has no `eve` dependency or devDependency; the static test enforces this. Node used for evaluation was `v24.9.0`. No provider/model credentials were configured.

## Fixture typecheck and build

Commands:

```powershell
npm --prefix conformance/continuity-adapter/v1/eve-fixture run typecheck
npm --prefix conformance/continuity-adapter/v1/eve-fixture run build
```

Verbatim tails:

```text
> reelier-eve-continuity-conformance@0.0.0 typecheck
> tsc --noEmit
```

```text
Σ Total size: 8.18 MB (1.9 MB gzip)
[nitro] √ You can preview this build using npx nitro preview
[BUILD] built output at C:\Users\maxim\CascadeProjects\reelier\.worktrees\continuity-path-c-integration\conformance\continuity-adapter\v1\eve-fixture\.output
```

The generated Eve agent summary reports generator `0.37.1`, model `eve-mock/model`, exactly the three authored tools, no skills, no connections, no subagents, and no sandbox.

## Deterministic local no-crash evaluation

The evaluation started the existing hermetic GitHub fixture and loopback Path C port, generated route/port bearers in process, started Eve on `127.0.0.1`, and ran `eve eval --url ... --skip-report --verbose`. No live model, judge, reporter, provider credential, deployment, ACP, or remote service was used.

Verbatim tail:

```text
✓  continuity  gates 14/14

Results: 1 passed (1 total)
Gates: 14 passed

Completed in 3.4s

EVAL_EXIT 0
PATH_C_COUNTERS {"outcomeRequests":1,"statusReads":1,"providerDispatches":1,"reservations":1}
VERIFIED_GRAPH_STATUS verified
```

# Deviations and rulings

- The real eval exposed that the existing generic identifier validator rejected the spec-mandated `eve@0.37.1`. The orchestrator explicitly expanded ownership to `src/continuity/normalize.ts` and its focused test. The implementation permits `@` only for `harnessId`.
- Eve build emits `.output/` in addition to `.eve/`; this fixture-local generated path was added to `.gitignore` so build output cannot enter the commit.
- Eve 0.37.1 retains prior-turn results in the mock responder's `toolResults`. The brief's unconditional echo guard would prevent every later required prompt, so the echo is restricted to a current tool-result step (`messages.at(-1)?.role === "tool"`).
- A deterministic `inspect resume` turn was added so the eval proves the post-checkpoint resume projection is actually visible as turn-scoped system content.

# Self-review

- Reviewed `6bc1d8e2..HEAD` file-by-file and ran `git diff --check`.
- Confirmed the bearer registry is indexed only by SHA-256 of the Authorization bearer and never reads request bodies or prompt text.
- Confirmed session binding pins initiator task/principal/workload and checks all three against current auth before actor derivation.
- Confirmed request/status bodies contain only their public model inputs; port and route bearer values are never returned or logged.
- Confirmed the checkpoint model schema cannot express `consequence.observed` or `status: "verified"`, and host-owned identity/authority fields are absent from every exported model-input key list.
- Confirmed `open` performs ledger read/projection only and that all authority network calls are loopback-only.
- Confirmed no Stripe call sites, charge paths, secret values, workflows, deployment configuration, provider models, judges, or reporters were added.

# Open risks

- Task 5 still owns process-kill orchestration and restart/ambiguity scenarios; this task proves only deterministic no-crash operation.
- The no-crash eval orchestration is intentionally external to the fixture source and uses a generated local port/token harness; CI wiring is not part of Task 4.
- Eve 0.37.1 is a preview API. Exact dependency and lockfile pins contain that risk, but upgrading Eve requires re-running the bundled-doc/API conformance work.

## Fix round 1/5

### Files changed

- `conformance/continuity-adapter/v1/eve-fixture/agent/lib/runtime.ts`
- `conformance/continuity-adapter/v1/eve-fixture/package.json`
- `conformance/continuity-adapter/v1/eve-fixture/scripts/no-crash.mjs`
- `conformance/continuity-adapter/v1/eve-fixture/tests/runtime.test.ts`
- `conformance/continuity-adapter/v1/eve-fixture/tests/tsconfig.json`
- `test/continuity/path-c-port.test.ts`
- `test/continuity/support/path-c-port.ts`
- `.superpowers/sdd/2026-08-14-continuity-adapter-conformance/task-4-report.md`

### What changed per file

- `agent/lib/runtime.ts`: both authority fetches now set `redirect: "error"`; the response boundary requires an inert plain object with exactly `requestId`, `verdict`, `reasonCode`, `lifecycleState`, and optional `receiptRef`, validates the verdict enumeration and primitive types, and returns a newly frozen projection.
- `package.json`: adds reproducible fixture-local `test:runtime` and `test:no-crash` commands without changing any dependency or version pin.
- `scripts/no-crash.mjs`: starts the existing hermetic GitHub fixture and Path C loopback port, launches local Eve dev/eval with a credential-scrubbed environment and mock model, and asserts exact counters plus verified graph status.
- `tests/runtime.test.ts`: proves 307/308 refusal prevents an alternate loopback host request, proves private graph extras cannot cross either request/status boundary, and proves extras/accessors/non-records/invalid primitives are refused.
- `tests/tsconfig.json`: emits only the fixture runtime and its focused tests to the already-ignored fixture `dist/` directory.
- `test/continuity/support/path-c-port.ts`: removes the harness-private `providerWrites` counter from public authority responses so the loopback fixture implements the exact closed outcome contract.
- `test/continuity/path-c-port.test.ts`: asserts the public lifecycle projection and the existing private counter API instead of reading `providerWrites` from tool-visible HTTP output.
- `task-4-report.md`: records this repair round and its verification evidence.

### TDD evidence

#### RED 1 — redirect and response boundary API absent

Command:

```powershell
npm --prefix conformance/continuity-adapter/v1/eve-fixture run test:runtime
```

Verbatim tail:

```text
tests/runtime.test.ts(6,3): error TS2305: Module '"../agent/lib/runtime.js"' has no exported member 'readAuthorityIngressOutcome'.
tests/runtime.test.ts(7,3): error TS2305: Module '"../agent/lib/runtime.js"' has no exported member 'requestOutcomeFromPort'.
tests/runtime.test.ts(8,3): error TS2305: Module '"../agent/lib/runtime.js"' has no exported member 'statusOutcomeFromPort'.
```

#### GREEN 1 — redirect refusal and closed inert projection

Command:

```powershell
npm --prefix conformance/continuity-adapter/v1/eve-fixture run test:runtime
```

Verbatim tail:

```text
✔ Outcome request and status refuse redirect hops before an alternate host is contacted (34.9584ms)
✔ Authority response projection exposes only the five public outcome fields (0.2943ms)
✔ Outcome request and status tool boundaries refuse private response graph material (11.1574ms)
✔ Authority response projection refuses extras, accessors, and non-records (0.4624ms)
ℹ tests 4
ℹ suites 0
ℹ pass 4
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 239.8092
```

#### RED 2 — real Eve eval exposes private Path C counter field

Command:

```powershell
npm --prefix conformance/continuity-adapter/v1/eve-fixture run test:no-crash
```

Verbatim tail:

```text
✗  continuity  gates 9/14
  ✗ calledTool(reelier_outcome_request) (0% < 100%): expected exactly 1 matching call(s), found 0
  ✗ noFailedActions (0% < 100%): 1 failed action(s): tool-result:reelier_outcome_request callId=mock-tool-call-3-1-1 status=failed isError=true error=Path C outcome response must be closed output=Path C outcome response must be closed
  ✗ calledTool(reelier_outcome_status) (0% < 100%): expected exactly 1 matching call(s), found 0
  ✗ noFailedActions (0% < 100%): 1 failed action(s): tool-result:reelier_outcome_status callId=mock-tool-call-4-2-1 status=failed isError=true error=Path C outcome response must be closed output=Path C outcome response must be closed
Results: 1 failed (1 total)
Gates: 9 passed, 5 failed
1 !== 0
```

#### GREEN 2 — committed hermetic no-crash proof

Command:

```powershell
npm --prefix conformance/continuity-adapter/v1/eve-fixture run test:no-crash
```

Verbatim tail:

```text
EVE_EVAL_EXIT 0
PATH_C_COUNTERS {"outcomeRequests":1,"statusReads":1,"providerDispatches":1,"reservations":1}
VERIFIED_GRAPH_STATUS verified
```

### Final verification

Root focused suite:

```powershell
npx tsc -p tsconfig.test.json
node --test --test-concurrency=1 dist-test/test/continuity/*.test.js
node --test --test-concurrency=1 dist-test/test/continuity/eve-binding-static.test.js
```

Verbatim tails:

```text
ℹ tests 54
ℹ suites 0
ℹ pass 54
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 9771.1535
```

```text
✔ Eve fixture is isolated and its model-facing schemas exclude authority (4.1657ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 67.1634
```

Fixture typecheck/build:

```powershell
npm --prefix conformance/continuity-adapter/v1/eve-fixture run typecheck
npm --prefix conformance/continuity-adapter/v1/eve-fixture run build
```

Verbatim tails:

```text
> reelier-eve-continuity-conformance@0.0.0 typecheck
> tsc --noEmit
```

```text
Σ Total size: 8.18 MB (1.9 MB gzip)
[nitro] √ You can preview this build using npx nitro preview
[BUILD] built output at C:\Users\maxim\CascadeProjects\reelier\.worktrees\continuity-path-c-integration\conformance\continuity-adapter\v1\eve-fixture\.output
```

Diff check:

```powershell
git diff --check
```

Verbatim output: no output; exit code 0.

### Deviations from the repair brief

- The first no-crash prototype used `node:test`, but Node 24.9.0 on Windows asserted in `InternalCallbackScope::Close` while the test launched child processes. The committed proof is therefore a standalone assertion harness invoked by the fixture's `test:no-crash` package command. It exercises the same real Eve dev/eval processes and is easier for Task 5 to extend without nesting process orchestration inside the root test runner.
- The loopback Path C fixture previously returned `providerWrites`, which the new exact boundary correctly refused. That harness-private counter was removed from HTTP output and remains available through `port.counters()` for exact proof.

### Open risks

- The standalone harness reserves a free loopback port by bind/close before Eve binds it; another local process could theoretically win that port race. A future reusable process helper can parse Eve's chosen port or own the listener handoff.
- The command is hermetic with respect to models/providers and requires no credentials, deployment, ACP, or non-loopback service. It does create and delete local temporary ledger/fixture state and lets Eve write only its ignored local build/eval state.
