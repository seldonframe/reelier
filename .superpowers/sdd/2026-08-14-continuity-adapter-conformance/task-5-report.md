# Files changed

- `conformance/continuity-adapter/v1/eve-fixture/agent/channels/eve.ts`
- `conformance/continuity-adapter/v1/eve-fixture/conformance-report.schema.json`
- `conformance/continuity-adapter/v1/eve-fixture/package.json`
- `conformance/continuity-adapter/v1/eve-fixture/scripts/eve-process.mjs`
- `conformance/continuity-adapter/v1/eve-fixture/scripts/no-crash.mjs`
- `conformance/continuity-adapter/v1/eve-fixture/scripts/run-conformance.mjs`
- `conformance/continuity-adapter/v1/eve-fixture/scripts/stream.mjs`
- `conformance/continuity-adapter/v1/README.md`
- `package.json`
- `test/continuity/eve-kill-resume.test.ts`
- `.superpowers/sdd/2026-08-14-continuity-adapter-conformance/task-5-report.md`

# What changed per file

- `agent/channels/eve.ts`: resolves the authenticated inbound caller with `defaultEveAuth(ctx)` and rejects a caller whose host-authenticated task-owner principal differs before `step.started`; runtime binding remains defense in depth.
- `conformance-report.schema.json`: defines the closed Eve v1 report, exact Eve version, exact Node 24 `process.version`, checks, artifacts, reproduced maturity, and six explicit nonclaims.
- Fixture `package.json`: adds the conformance command without weakening exact pins.
- `eve-process.mjs`: centralizes shared loopback process control; targets only the exact spawned Eve PID tree; proves the old listener is dead before restart; executes checkpoint, Path C, stream, control, identity, and model scenarios. Crash scenarios preserve the same app/Workflow/ledger roots, reconnect the original session from an absolute cursor, and send no recovery POST before it settles. The hermetic local Workflow ownership lease is one second so the bounded test observes its supported ownership-recovery path instead of waiting the 860-second default.
- `no-crash.mjs`: reuses shared Eve orchestration while retaining redirect/output protections.
- `run-conformance.mjs`: builds and compiles, runs generic/focused/process checks, validates Node 24 and the closed schema, computes the canonical report digest with `reportDigest` omitted, and emits one JSON line.
- `stream.mjs`: performs absolute-cursor NDJSON reads and deduplicates instrumentation only by `meta.id`; missing IDs remain distinct and produce `legacy-event-id-absent`.
- Conformance `README.md`: documents prerequisites, clean-checkout command, duration, artifact meanings, maturity, and nonclaims.
- Root `package.json`: adds `check:continuity-eve`.
- `eve-kill-resume.test.ts`: adds one serialized external-process test with the seven prescribed named subtests and ledger/projection/counter/HTTP/event assertions.
- This report: records commits, exact RED/GREEN evidence, digest, deviations, self-review, and risks.

# Commits

Base: `50cf8834b85b85d06eeafde1ef13a798ac9eba6d`

- `a17be9d` — `test(continuity): specify eve kill resume matrix`
- `5ed0f7c` — `test(continuity): prove eve process resume`
- `a167e97` — `test(continuity): emit closed eve evidence`
- `89226ef` — `fix(continuity): bind eve task owner`
- `06b73c1` — `test(continuity): require original Eve run recovery`
- `7529cac` — `fix(continuity): reclaim interrupted Eve steps`

Implementation evidence commit: `7529cac5404743aedde6ba928c918603d28ebcbc`.

# TDD evidence

## Initial RED

```powershell
npx tsc -p tsconfig.test.json
node --test --test-concurrency=1 dist-test/test/continuity/eve-kill-resume.test.js
```

```text
Error: Cannot find module '...\eve-fixture\scripts\eve-process.mjs'
Node.js v24.9.0
1 !== 0
```

## Original-session recovery RED

The first implementation created a replacement session and therefore did not satisfy process resume. Commit `06b73c1` restored the exact acceptance: same app root, original session/cursor, no recovery POST, and a real checkpoint cut after commit but before tool return.

```text
✖ real Eve 0.37.1 preserves Reelier continuity across process and session boundaries (57854.9357ms)
ℹ tests 1
ℹ pass 0
ℹ fail 1
Error: Eve session did not settle
    at waitForAnyBoundary (.../eve-process.mjs:322:9)
    at async checkpointScenario (.../eve-process.mjs:112:7)
```

The persisted step retained an old `ownerMessageId`; source tracing showed delayed recovery uses the inline ownership lease, whose default is 860 seconds. A diagnostic `WORKFLOW_LOCAL_QUEUE_MAX_VISIBILITY=1` did not help because queue visibility cannot reclaim inline step ownership. That setting was removed.

## Retry-event assertion RED

After enabling the hermetic one-second inline ownership lease, recovery succeeded. The first exact event assertion expected `action.started`, while real Eve re-emitted `step.started`:

```text
actual:   { sameCoordinates: true, distinctMetaIds: true, type: 'step.started' }
expected: { sameCoordinates: true, distinctMetaIds: true, type: 'action.started' }
ℹ tests 8
ℹ pass 6
ℹ fail 2
```

## Focused GREEN

```powershell
npx tsc -p tsconfig.test.json
node --test --test-concurrency=1 dist-test/test/continuity/eve-kill-resume.test.js
```

```text
▶ real Eve 0.37.1 preserves Reelier continuity across process and session boundaries
  ✔ checkpoint commit survives process death before tool return
  ✔ Path C apply survives process death without resend
  ✔ overlapping stream cursor deduplicates by event id
  ✔ compact and clear preserve Reelier continuity
  ✔ reset session can be replaced for the same task
  ✔ cross-principal follow-up refuses before model work
  ✔ changed mock model leaves projection bytes unchanged
✔ real Eve 0.37.1 preserves Reelier continuity across process and session boundaries
ℹ tests 8
ℹ pass 8
ℹ fail 0
```

# Crash evidence

- Checkpoint: the temp fixture writes its cut marker only after `await continuityRuntime(ctx).checkpoint(checkpoint)` resolves, then blocks before returning. The harness captures the original cursor, force-terminates the exact Eve PID tree, proves its listener is dead, restarts the same root, and waits for the original session without a POST. Only after settlement does a later stale-cursor follow-up run. Final evidence is cursor `2`, exactly two segments/no third, one visible agent-authored `unchecked` claim, and zero Outcome/status/provider/reservation counters.
- Outcome: the first request reaches `after-provider-apply-before-response`; the exact Eve tree is killed while the response is withheld; the latch is released; restart reclaims the original interrupted step without a session/message POST. The recovered attempt emits a distinct `step.started.meta.id` with the same `turnId`, `stepIndex`, and `sequence`. Counters conserve `outcomeRequests>=2`, `providerWrites=1`, `providerDispatches=1`, and `reservations=1`.
- Status/read-back: the native graph passes the existing verifier, `appendVerifiedAuthority` accepts only that verifier-produced object with external replay anchors, and the direct ledger projection contains a verified consequence. Ambiguity remains reconcile-before-retry.
- Identity: the second valid principal is rejected by the channel boundary before `step.started`; ledger and effect counters remain byte-for-byte/counter unchanged.
- Stream/control/model: cursor overlap deduplicates only by `meta.id`; reconnect/open have zero authority/provider effects; compact, clear, reset/replacement, and changed mock model assertions compare projection bytes/counters/events, not assistant prose.

# Closed report evidence

One clean-checkout command:

```powershell
npm run check:continuity-eve
```

Exit `0`; verbatim report line:

```json
{"artifacts":{"ledgerHeadDigest":"sha256:df0dcafc0c6f659953e1c45c91923cdc9ba76f8292a92611cd535978dd2adab9","receiptGraphDigest":"sha256:32522cad0274be00d91482f49fd46604283f9aeabd64d6bb8f1efbf9c7ebec74","reportDigest":"sha256:933b09eeaebb60ccd8c455986a8f432406c9a7d43f067c110dc412f95d68d234"},"authorityAdapterContractDigest":"sha256:7f46242b26d9c921f4e1ec9de6418ac5fc8c03d70c4415c25e799ae0e73a1512","checks":[{"detail":"public continuity adapter candidate checks passed","id":"generic-candidate","status":"passed"},{"detail":"real Eve kill, resume, stream, control, identity, and model matrix passed","id":"eve-process-matrix","status":"passed"},{"detail":"focused Path C and Continuity suites passed","id":"focused-continuity","status":"passed"}],"eveVersion":"0.37.1","maturity":"reproduced","nodeVersion":"v24.9.0","nonClaims":{"contentCorrectness":"not-proved","grokBot":"not-tested","productionReadiness":"not-proved","safety":"not-proved","topology":"not-proved","trafficCompleteness":"not-proved"},"reelierCommit":"7529cac5404743aedde6ba928c918603d28ebcbc","status":"passed","v":"reelier.continuity-eve-conformance-report/v1"}
```

# Complete verification

- Fixture typecheck: exit `0`.
- Fixture build: exit `0`; `[BUILD] built output at ...\eve-fixture\.output`.
- No-crash proof: exit `0`:

```text
EVE_EVAL_EXIT 0
PATH_C_COUNTERS {"outcomeRequests":1,"statusReads":1,"providerDispatches":1,"reservations":1}
VERIFIED_GRAPH_STATUS verified
```

- Root Continuity/Path C suite:

```text
ℹ tests 62
ℹ pass 62
ℹ fail 0
ℹ duration_ms 79303.8577
```

- Generic candidate and focused suites passed inside the clean command.
- `git diff --check`: exit `0`, no output.
- Docker/Linux unavailable:

```text
error during connect: Get "http://%2F%2F.%2Fpipe%2FdockerDesktopLinuxEngine/v1.51/version": open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified.
```

# Deviations and risks

- Binding ruling: the deliberate checkpoint claim remains exactly one visible `unchecked` claim; it is not suppressed or upgraded.
- Windows crash cuts use `taskkill /PID <exact-spawned-eve-pid> /T /F`. Successful tree termination and failed health reconnect prove the old server is gone. Normal cleanup remains graceful. No process enumeration or broad Node kill occurs.
- Eve 0.37.1 requires a numeric CLI port and exposes no listener handoff; bind/close retains a bounded race with five fresh-port retries only on `EADDRINUSE`.
- The test sets `WORKFLOW_INLINE_OWNERSHIP_LEASE_SECONDS=1` in the scrubbed hermetic Eve child environment. It changes only how long the supported recovery path waits before reclaiming a step; the default 860-second lease is unsuitable for bounded CI.
- Docker/Linux verification was unavailable.
- Artifact digests vary between reproductions because the hermetic authority fixture generates fresh native evidence IDs; canonicalization is deterministic for each report object.

# Self-review

- Reviewed the immutable range file by file and corrected the replacement-session proof before final verification.
- Confirmed neither crash scenario creates/sends/resumes anything before the original session settles.
- Confirmed every fetch is loopback-only with `redirect: "error"`; no live provider/model/deployment/workflow dispatch, credentials, ACP, or Grok Bot is reachable.
- Confirmed exact-PID tree termination only; absolute cursors; `meta.id`-only deduplication; native verifier-only authority import; and ledger/projection/counter/event assertions rather than assistant prose.
- No Stripe call site, charge/credit path, secret, merge, push, deployment, or external service was added or used.
