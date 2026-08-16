Files changed

- `.superpowers/sdd/github-live-proxy-conformance-report.md`
- `scripts/disposable-github-live-proxy.test.mjs`
- `scripts/disposable-github-mcp-server.mjs`
- `scripts/disposable-github-live-proxy.mjs`
- `docs/evidence/github-live-proxy-conformance-2026-08-16/README.md`
- `docs/evidence/github-live-proxy-conformance-2026-08-16/coverage.json`
- `docs/evidence/github-live-proxy-conformance-2026-08-16/delegation.json`
- `docs/evidence/github-live-proxy-conformance-2026-08-16/descriptor.json`
- `docs/evidence/github-live-proxy-conformance-2026-08-16/dispatch.json`
- `docs/evidence/github-live-proxy-conformance-2026-08-16/final-report.json`
- `docs/evidence/github-live-proxy-conformance-2026-08-16/provider-state.json`
- `docs/evidence/github-live-proxy-conformance-2026-08-16/receipt.json`
- `docs/evidence/github-live-proxy-conformance-2026-08-16/trace/github-live-proxy-conformance-2026-08-16-1.jsonl`

## What changed per file

- `.superpowers/sdd/github-live-proxy-conformance-report.md`: records the complete review scope, implementation summary, deviations, verbatim verification tails, and open risks.
- `scripts/disposable-github-live-proxy.test.mjs`: tests the exact target fence, auth refusal, one-write same-key retry behavior, idempotency collisions, honest Path A classification, and evidence mutation rejection.
- `scripts/disposable-github-mcp-server.mjs`: adds the bounded stdio MCP server. It accepts only `fixlyai/soloproof`, `reelier/conformance-20260816`, and `reelier-conformance-proof.txt`; invokes process-local `gh` without a shell; reads exact ref/commit/tree/blob state; and performs at most one Contents API update per process-local request key.
- `scripts/disposable-github-live-proxy.mjs`: drives an MCP SDK client through `dist/cli.js mcp --wrap`, executes initial read/write/retry/final read, machine-checks the bindings, and emits the evidence bundle.
- `docs/evidence/github-live-proxy-conformance-2026-08-16/README.md`: explains the live result, exact Git objects, Path A classification, and explicit non-claims.
- `docs/evidence/github-live-proxy-conformance-2026-08-16/coverage.json`: records observed MCP topology and explicitly leaves completeness unproved.
- `docs/evidence/github-live-proxy-conformance-2026-08-16/delegation.json`: records the exact allowed target and one-write budget plus prohibited main/branch/PR operations.
- `docs/evidence/github-live-proxy-conformance-2026-08-16/descriptor.json`: identifies the live Path A proof and fixed target/request key.
- `docs/evidence/github-live-proxy-conformance-2026-08-16/dispatch.json`: records first-dispatch effect 1, duplicate retry effect 0, and one total provider write.
- `docs/evidence/github-live-proxy-conformance-2026-08-16/final-report.json`: binds artifact digests and explicit proved/not-proved/not-attempted claims.
- `docs/evidence/github-live-proxy-conformance-2026-08-16/provider-state.json`: records exact before, post-write, post-retry, and final commit/tree/blob/content state.
- `docs/evidence/github-live-proxy-conformance-2026-08-16/receipt.json`: embeds and digests the Path A trace and its four downstream calls.
- `docs/evidence/github-live-proxy-conformance-2026-08-16/trace/github-live-proxy-conformance-2026-08-16-1.jsonl`: raw append-only trace written by the existing live proxy.

## Deviations from the plan

- No implementation scope was expanded into `src` or authority contracts.
- The raw JSONL trace is retained under the approved evidence directory in addition to the seven requested JSON artifacts so `receipt.json` remains independently inspectable.
- This report is outside the user-owned globs only because the dispatch instructions require `.superpowers/sdd/<task>-report.md` before completion.
- Two attempted ad hoc persisted-check commands failed before checker execution due PowerShell/native-argument quote stripping. The corrected escaped invocation passed; no artifact changed during those attempts.
- The first independent remote content-hash command used a .NET API unavailable in this PowerShell runtime. The compatible `SHA256.Create().ComputeHash` rerun passed; both commands were read-only.

## Test results

### Live execution

Command:

`node scripts/disposable-github-live-proxy.mjs --out docs/evidence/github-live-proxy-conformance-2026-08-16`

Verbatim output:

```text
{"status":"passed","classification":"path-a-live-proxy","repository":"fixlyai/soloproof","branch":"reelier/conformance-20260816","output":"C:\\Users\\maxim\\CascadeProjects\\reelier\\.worktrees\\five-harness-conformance\\docs\\evidence\\github-live-proxy-conformance-2026-08-16"}
```

### Focused behavior suite

Command:

`node --test scripts/disposable-github-live-proxy.test.mjs`

Verbatim tail:

```text
ℹ tests 6
ℹ suites 0
ℹ pass 6
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 251.1574
```

### Persisted artifact check

Command: Node ESM invocation loading the seven committed JSON artifacts and calling `checkEvidenceArtifacts`.

Verbatim output:

```text
{"v":"reelier.github-live-proxy-check/v1","status":"passed","checks":20}
```

### Independent remote readback

Command: read-only `gh api` ref → commit → recursive tree → blob comparison against `provider-state.json`.

Verbatim output:

```text
{"status":"passed","head":"7b87fce12741f422cf6e8156bec92ed8563ce93f","tree":"6fad1e9c183c04c3e054f36f2230552aeba70040","blob":"b52105bca1c44f7be4cd2836bdbf0a52dc549fb0","contentSha256":"sha256:36ad30608b8d3ea95c4d50e9f8ea87204975be4a758eb5b3e6cf4b78b9965dc0"}
```

### Full repository suite

Command:

`npm test`

Verbatim summary tail:

```text
ℹ tests 3441
ℹ suites 0
ℹ pass 3414
ℹ fail 8
ℹ cancelled 0
ℹ skipped 19
ℹ todo 0
ℹ duration_ms 478951.9725
```

Verbatim failure headings:

```text
✖ authority runtime authenticates host identity, dispatches once, and returns durable status
✖ authority runtime does not trust identity fields from the request body
✖ shadow runtime returns a report-only lifecycle and never an accepted receipt
✖ common host serves the same closed outcome over HTTP
✖ HTTP never substitutes the configured requester when no scoped principal registry is present
✖ file receipt publication is immutable and idempotent across a restart
✖ real Eve 0.37.1 preserves Reelier continuity across process and session boundaries
✖ real Eve process executes the shared Adapter Contract vector and emits closed evidence
```

The first six fail with `AUTHORITY_CELL_LINUX_REQUIRED` on this Windows host. The two Eve failures report `Cannot find native binding` for an optional dependency. None names or imports a changed file from this task.

## Open risks

- Idempotency is process-local, exactly as claimed. A process restart loses the completed-request map; this proof does not claim cross-process deduplication.
- Path A records the traffic it sees but does not prove completeness or block bypass traffic.
- The full repository suite is not green on this Windows checkout for the eight environmental/platform failures listed above. Fixing them would require out-of-scope files or dependency state and was not attempted.
- The fixed proof content now already exists at the branch head. Re-running the live harness will honestly return `unchanged` on its first dispatch and will not reproduce a fresh provider write unless the approved disposable branch file is deliberately reset.
