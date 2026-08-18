Files changed

- `docs/runbooks/live-certification.md`
- `src/authority/cli.ts`
- `src/authority/types.ts`
- `src/authority/ingress/mcp.ts`
- `src/authority/host/config.ts`
- `src/authority/host/gate-signer.ts`
- `src/authority/host/local.ts`
- `src/authority/host/server.ts`
- `src/authority/host/stdio-context.ts`
- `test/authority/authority-serve-stdio-context.test.ts`
- `test/authority/gate-signer.test.ts`
- `test/authority/local-multi-definition-jobs.test.ts`
- `.superpowers/sdd/2026-08-18-eve-governed-production-release/task-3-report.md`

## What changed per file

### `docs/runbooks/live-certification.md`

- Documents the closed stdio principal reference, startup refusal rules, gate-key rotation invalidation/re-discovery requirement, and atomic hard-link publication filesystem contract.

### `src/authority/cli.ts`

- Preserves the local runtime's compatibility-safe direct-alias allowlist when the CLI composes the production server runtime.
- Production `authority serve` now composes stdio through the referenced principal credential resolver and session-bound runtime before creating or starting the MCP server.
- Extracts a package-internal, injectable server-composition boundary used by `authorityServe`; regression coverage binds stdio composition, bound-runtime creation, and host-server construction without opening a real stdio loop.

### `src/authority/types.ts`

- Adds the dedicated closed `job-reference` signature purpose. This prevents opaque reference derivation from reusing the unrelated `principal` domain.

### `src/authority/ingress/mcp.ts`

- Enforces the same direct-alias allowlist used to advertise tools; an unadvertised `reelier_outcome_<alias>` call can no longer reach the handler by prefix alone.

### `src/authority/host/gate-signer.ts`

- Replaces timestamp/PID temporary names with random unique candidates.
- Fsyncs each complete private-key candidate, publishes with atomic same-filesystem hard-link/no-replace semantics, syncs the parent directory on POSIX, and returns only a stable durable readback.
- Concurrent first starts now converge on the one persisted identity rather than replacing it or returning divergent keys.
- Its public API comment records same-filesystem hard-link/no-replace support and key-rotation invalidation as fail-closed contract behavior.

### `src/authority/host/config.ts`

- Adds closed `ingress.stdioPrincipalCredentialRef`, accepting only `env:<NAME>` or absolute `file:<path>` and only alongside `principalRegistryFile`; raw values and relative file references refuse.

### `src/authority/host/local.ts`

- Removed only the production local host's artificial exactly-one-definition startup restriction.
- Preserved the existing signed Job Card `definitionAliases` array and installed-pack/config equality checks.
- Added a closed multi-definition catalog path that requires the host-authenticated execution context and resolves the durable active task/principal/grant/allocation through the existing delegation authority.
- Derived one deterministic `jobref_<64 hex>` reference per definition from the tenant, task, principal, grant ID/digest, allocation, runtime session, authority cell, signed Job Card digest, and definition alias.
- Keyed the final opaque commitment with the persistent host-owned local-gate signer, so identical public bindings on another host do not produce the same reference.
- Binds the exact signed Job Card envelope (semantic body, signer ID, and signature) and uses the dedicated `job-reference` signing domain.
- Multi-definition search returns only `{ jobRef }`; no job ID or alias is exposed. The query is deliberately ignored on this path so it cannot become an alias-existence oracle.
- Multi-definition load and invoke accept only a reference issued for the exact current binding. Raw alias/job ID fallback is refused.
- Preserved the existing unsigned and signed single-definition compatibility path.
- Left the separate governed-profile one-definition code path unchanged.
- Refuses raw `outcome(alias, ...)` dispatch for a signed multi-definition deployment and exposes no direct aliases for that runtime.
- Coalesces concurrent exact same-request invokes while immediately refusing an in-flight same-ID/different-semantics request before provider dispatch.
- Adds a package-internal stdio-bound constructor that captures the exact resolved execution context, validates its Job ID/principal/Cell against the signed deployment/config, and rejects all session/Cell drift before catalog access.

### `src/authority/host/server.ts`

- Accepts an optional host-owned authenticated stdio execution context and captures it when the MCP server is built; the MCP request shape remains unchanged.
- Uses the runtime's direct-alias allowlist, while retaining configured-alias compatibility for existing runtimes that do not declare one.
- Carries the runtime's explicit authenticated-context requirement so production composition can refuse missing stdio credentials before server construction.

### `src/authority/host/stdio-context.ts`

- Adds the production `authority serve` composition helper and short-lived credential resolver.
- Environment/file secrets remain local variables; file resolution rejects indirection, non-files, oversized/changed files, surrounding whitespace, NUL/embedded-newline content, multiple terminal newlines, and unstable identity while accepting exact bytes optionally followed by one LF or CRLF.
- Resolves through the principal registry and validates configured tenant, requester, and Authority Cell before returning the closed execution context.
- On Linux, validates the real handle, post-read handle, and current path are all owned by `process.geteuid()` with no group/world bits; owner/mode changes are part of the TOCTOU comparison. Production exposes no platform/UID/stat override.

### `test/authority/authority-serve-stdio-context.test.ts`

- Covers config closure, environment and stable-file references, missing/expired/revoked credentials, tenant/requester/Cell drift, non-exposure, production composition, and missing-context refusal.
- Deterministically covers wrong-owner and every group/world permission class with synthetic metadata, and verifies the production CLI composition order without starting stdio.

### `test/authority/gate-signer.test.ts`

- Reproduces 32 simultaneous first starts and asserts every returned identity equals the stable persisted readback.

### `test/authority/local-multi-definition-jobs.test.ts`

- Added a real signed two-definition deployment fixture with reviewed first-party packs, durable delegation state, a real Gmail authority contract/source read, and an in-memory provider adapter.
- Covers deterministic restart recovery, one reference per signed definition, no ID/alias exposure, and a distinct keyed namespace for another host authority.
- Covers cross-task, cross-tenant, cross-principal, cross-allocation, wrong grant digest, another Job Card, unknown/raw alias/job ID, conflicting references, revoked grants, and expired grants after restart.
- Covers successful opaque invoke, exact retry convergence, same request ID with changed source semantics, and same request ID with a different job reference; provider dispatch remains exactly one.
- Covers real production-server MCP search/load/invoke, raw-tool non-advertisement and direct-call refusal, stdio cross-task isolation, and authenticated HTTP raw-route refusal.
- Independently varies grant ID, runtime session, Authority Cell, and same-body/different-signer Job Cards; both definition references are invoked, and the another-card tests share the same host key.
- Gives both Gmail and Slack complete signed contracts, connector/adoption authority, source evidence, and policies; their refs dispatch the distinct reviewed Gmail and `slack.conversations.setTopic` write effects.
- No external provider or network calls occur.

### `.superpowers/sdd/2026-08-18-eve-governed-production-release/task-3-report.md`

- Records scope, RED/GREEN evidence, verification output, self-review, and remaining risks.

## TDD evidence

### RED 1 — multi-definition restriction and raw reference design

Focused command:

```text
npx tsc -p tsconfig.test.json; node --test --test-concurrency=1 dist-test/test/authority/local-multi-definition-jobs.test.js
```

Expected failure observed before production changes:

```text
✖ multi-definition signed Job Card returns deterministic opaque references instead of job IDs or aliases
TypeError: loaded signed Job Card must bind exactly one invokable definition
```

Committed as `18111a30 test(authority): expose multi-definition job catalog gap`.

### GREEN 1 — closed context-bound catalog

After the minimum local-host implementation:

```text
✔ multi-definition signed Job Card returns deterministic opaque references instead of job IDs or aliases
✔ signed multi-definition references refuse every binding mismatch and stale authority
ℹ pass 2
ℹ fail 0
```

Committed as `eb854068 feat(authority): bind opaque refs to signed job contexts`.

### RED 2 — unkeyed opacity

The cross-host assertion failed with identical references before keyed commitment was added:

```text
✖ multi-definition signed Job Card returns deterministic opaque references instead of job IDs or aliases
AssertionError: opaque references must be keyed to host-owned authority
actual:   [ 'jobref_afaf...', 'jobref_2092...' ]
expected: [ 'jobref_afaf...', 'jobref_2092...' ]
```

### GREEN 2 — host-keyed opacity

After keying with the persistent local-gate signer:

```text
✔ multi-definition signed Job Card returns deterministic opaque references instead of job IDs or aliases
✔ signed multi-definition references refuse every binding mismatch and stale authority
✔ opaque invoke converges exact retries and refuses request-id semantic conflicts before provider dispatch
✔ persisted references refuse after the bound grant expires across authority restart
ℹ pass 4
ℹ fail 0
```

Committed as `401d94e9 fix(authority): key opaque job references to host authority`.

## Restart and isolation evidence

- Same host key + same signed Job Card + same authenticated task/principal/allocation/session yields byte-identical references after runtime restart.
- A different host gate key yields different references for otherwise identical bindings.
- A different signed Job Card yields a different reference and is refused by the first runtime.
- Reopened persistent delegation state at a time after grant expiry refuses both load and invoke.
- Revocation refuses a previously issued reference.
- Cross-task, tenant, principal, allocation, job ID, and grant digest attempts all return refusal.
- Same request ID + exact semantics returns the existing accepted result with one dispatch.
- Same request ID + changed source semantics or a different definition reference refuses with dispatch count still one.

## Deviations from plan

- None. No release super-agent was introduced, no public MCP/request schema was widened, no governed-cell profile behavior was changed, and no provider/credential/config ownership moved to agents.
- The new focused test file was selected because adding this matrix to `local-e2e.test.ts` would make the existing single-definition lifecycle test unreadable.
- Narrow additional files required by fix-round findings: `gate-signer.ts` and its existing test own key creation; `server.ts` captures trusted stdio context and selects advertised aliases; `ingress/mcp.ts` enforces that advertised allowlist; `types.ts` owns signature purposes; `cli.ts` preserves the runtime allowlist through the production composition adapter. No broader refactor was made.
- Fix round 2 adds only `stdio-context.ts` plus its focused test for production startup authentication, extends the existing host config parser, and updates the existing live-certification runbook as explicitly required. These are narrow ownership boundaries, not a new agent or alternate execution path.

## Verification results

Final command:

```text
npx tsc --noEmit
npm run check:authority-contract
npm run check:agent-adapter -- conformance/agent-adapter/v0/fixtures/grok-build-observed.json
npx tsc -p tsconfig.test.json
node --test --test-concurrency=1 dist-test/test/authority/local-multi-definition-jobs.test.js dist-test/test/authority/local-e2e.test.js dist-test/test/authority/local-runtime.test.js dist-test/test/authority/local-latency-wiring.test.js dist-test/test/authority/ingress.test.js dist-test/test/authority/http.test.js dist-test/test/authority/http-response-semantics.test.js dist-test/test/authority/contract.test.js dist-test/test/agent-adapter-conformance.test.js
```

Verbatim tail:

```text
✔ multi-definition signed Job Card returns deterministic opaque references instead of job IDs or aliases (82.4779ms)
✔ signed multi-definition references refuse every binding mismatch and stale authority (67.2176ms)
✔ opaque invoke converges exact retries and refuses request-id semantic conflicts before provider dispatch (940.863ms)
✔ persisted references refuse after the bound grant expires across authority restart (37.3541ms)
✔ local authority serve uses the real gate and refuses an unsigned empty deployment (225.771ms)
✔ public local runtime options do not accept governed signing authority (1.2054ms)
✔ package-internal admitted runtime rejects a forged profile handle before creating host directories (1.774ms)
✔ local authority catalog lists only configured definitions and loads an opaque job reference (6.1329ms)
✔ local authority runtime refuses a malformed signed deployment instead of silently using an empty authority state (6.2952ms)
✔ managed local authority refuses a non-exclusive topology (0.8361ms)
✔ managed local authority refuses isolated declarations without host topology evidence (0.7642ms)
✔ managed local authority accepts only complete verified topology evidence (6.4211ms)
✔ managed local authority rejects declaration-only topology evidence (0.81ms)
✔ local runtime creates a root task only for the authenticated sponsor (34.4045ms)
ℹ tests 42
ℹ suites 0
ℹ pass 41
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 6230.9475
```

The adapter checker separately returned `"status":"passed"` for all seven universal checks. `npx tsc --noEmit`, the test compilation, and the authority contract check exited 0 without diagnostic output.

### Full repository suite

`npm test` was also run. Verbatim summary:

```text
ℹ tests 3368
ℹ suites 0
ℹ pass 3343
ℹ fail 7
ℹ cancelled 0
ℹ skipped 18
ℹ todo 0
ℹ duration_ms 467978.5313
```

All seven failures are outside the touched files and identify missing host prerequisites rather than behavioral assertions:

```text
authority-runtime.test.js (3): AuthorityCellLinuxRequiredError
authority/host-server.test.js (2): AuthorityCellLinuxRequiredError
authority/receipts.test.js (1): AuthorityCellLinuxRequiredError
bootstrap-build-identity.test.js (1): ENOENT native/bootstrap-helper/manifest.json
```

The focused authority tests install the repository's explicit Linux platform test seam and passed on this Windows host. No out-of-scope test/platform or native-artifact files were changed.

## Self-review

- Confirmed multi-definition refs contain neither raw job ID nor alias and cannot be recomputed without host-owned key material.
- Confirmed every search/load/invoke revalidates current durable delegation state; references are not bearer capabilities on their own.
- Confirmed the ref binding contains all authenticated execution identity fields plus signed Job Card digest and definition alias.
- Confirmed raw alias/job ID fallback exists only on the preserved non-multi compatibility path.
- Confirmed invoke strips `jobRef` before the closed Outcome request parser and does not accept repo, credential, destination, version, limit, or policy authority from the agent.
- Confirmed no Stripe/payment call sites, secret values, external calls, or money paths were added.
- Reviewed `git diff --check`: clean.
- The requesting-code-review skill normally dispatches a reviewer, but the task explicitly prohibited subagents; this report therefore records the required self-review instead.

## Open risks

- `local-e2e.test.ts` is intentionally Linux-only and was skipped on this Windows host. Its surrounding local-runtime, latency, ingress, HTTP, contract, adapter, and the new cross-platform focused deployment tests all passed. Linux CI should execute that one existing E2E.
- The full repository suite is not green in this checkout: six untouched tests invoke Linux-only Authority Cell hosting directly on Windows, and one untouched bootstrap identity test requires an absent generated native manifest. The exact 3,343/7/18 summary and failures are recorded above. The task-specific regression gate is green.
- To preserve the frozen MCP shape, `reelier_job_load` still names its request property `jobId`; on the multi-definition signed path that property carries only the opaque `jobRef`. This naming mismatch is intentional compatibility debt, not a raw-ID fallback.

## Fix round 1 — Phase 1 root-cause evidence (recorded before modifications)

### Production path traces

1. **Raw alias ingress bypasses the opaque catalog.** `createLocalAuthorityRuntimeCore` wraps `jobsSearch`, `jobLoad`, and `invoke` with `resolveBoundJobs`, but its public `outcome(alias, ...)` wrapper only checks that the alias occurs in the signed Job Card and that the requester is an audience. `createAuthorityHostServer` passes that wrapper directly into both ingresses. `buildAuthorityMcpServer` advertises one `reelier_outcome_<alias>` tool per configured definition and its call dispatcher accepts any name with that prefix. `handleAuthorityHttp` accepts `POST /v1/outcomes/<alias>`, authenticates the principal, and then calls `handler.outcome(alias, ...)`. Thus an authenticated signed multi-definition principal can dispatch a raw alias without ever presenting or resolving a bound opaque reference. The working signed-multi pattern is `jobsSearch -> jobLoad -> invoke`, where every step calls `resolveBoundJobs`; the working compatibility pattern is the existing unsigned/signed-single direct tool/route.

2. **Stdio drops the host-authenticated execution identity.** The local signed-multi resolver requires task, principal, grant, allocation, runtime session, Job Card, and Authority Cell fields from `context.executionContext`. HTTP obtains those fields from the host-owned `PrincipalRegistry.resolve` result. In contrast, `createAuthorityHostServer` constructs its stdio context with only `{ tenant: config.tenant, requester: config.requester }`, and `authorityServe` passes no other stdio identity. Therefore a real MCP `reelier_jobs_search` reaches `resolveBoundJobs` with no execution context and is refused, although direct runtime tests work because they inject `executionContext` themselves. The working server pattern is HTTP's conversion of trusted session state into `AuthorityExecutionContextV1`; the MCP request body must remain unchanged.

3. **First gate-key publication is replace-capable.** `loadOrCreateLocalGateSigner` performs a missing-file read, independently generates a candidate, writes a private temporary file with `wx`, then calls `rename(temporary, resolved)`. On POSIX, rename replaces an existing destination, so two starts that both observed `ENOENT` may both report successful publication with different in-memory keys; the later rename also replaces the durable key. The `EEXIST` recovery branch does not protect POSIX because replacement succeeds. The working persistence patterns elsewhere use exclusive creation or link/no-replace publication followed by directory synchronization; the existing `loadExistingLocalGateSigner` provides stable-handle parsing for durable readback.

4. **The current reference preimage omits exact envelope identity and uses the wrong purpose.** `resolveBoundJobs` binds `signedJobCardDigest(card)`, which deliberately hashes only the unsigned semantic body, so a same-body card signed by a different signer/signature produces the same reference under the same host key. It then calls `signAuthorityDigest(..., "principal", ...)`, reusing a purpose unrelated to opaque catalog references. The existing authority signing API supports a closed purpose domain, while `authorityDigest(card)` includes signer and signature and therefore represents the exact signed envelope.

5. **Coverage gaps can conceal binding bugs.** Existing focused tests varied task, tenant, principal, allocation, job ID, grant digest, and a differently titled card, but did not independently vary grant ID, runtime session, Authority Cell, or same-body/different-signer card; did not invoke both definitions; did not race exact retries; and exercised no real MCP/HTTP raw alias path. The different-card case also used a newly created host key, confounding card binding with host-key binding.

### Single root-cause hypotheses

- **H1 raw alias:** direct ingress has no signed-multi capability-profile signal and the local raw `outcome` wrapper does not forbid the signed-multi route; making the runtime expose only its compatibility-safe direct aliases and enforcing that allowlist at MCP dispatch, while refusing signed-multi direct outcomes locally, will close both public paths without changing requests.
- **H2 stdio identity:** the stdio server captures an incomplete host context; supplying an already-authenticated, host-owned execution context when constructing the server will make MCP search/load/invoke follow the same resolver as HTTP without adding agent fields.
- **H3 key race:** replace-capable rename is the publication root cause; atomic same-filesystem no-replace publication plus directory sync and stable readback will make concurrent creators converge on the one persisted key.
- **H4 card/domain:** semantic-body digest and the generic `principal` signing purpose are the root causes; bind `authorityDigest(card)` and introduce a dedicated job-reference purpose in the existing closed authority signature domain.
- **H5 test gaps:** direct-runtime happy paths masked ingress and concurrency failures; production-server MCP/HTTP tests and independently varied bindings will reproduce them and guard the minimal fixes.

No architecture blocker was found: the existing runtime/server interfaces already have a host-owned context seam and the existing signature-purpose union can be narrowly extended.

### Fix round 1 RED

Command:

```text
npx tsc -p tsconfig.test.json
node --test --test-concurrency=1 dist-test/test/authority/gate-signer.test.js dist-test/test/authority/local-multi-definition-jobs.test.js
```

Verbatim summary and failure evidence:

```text
ℹ tests 10
ℹ pass 6
ℹ fail 4

simultaneous first starts converge...:
TypeError: local gate key could not be created: ENOENT ... rename ...tmp -> ...local-gate.pem

signed multi-definition references refuse...:
AssertionError: the exact signed Job Card envelope must bind the reference
actual: jobref_f3d73... expected: jobref_f3d73...

opaque invoke converges exact retries...:
actual: [ 'accepted', 'refused' ] expected: [ 'accepted', 'accepted' ]

production MCP and HTTP keep...:
AssertionError: true !== false
```

The key race reproduced on Windows as well: the timestamp/PID temporary name also collides among same-process starters, and replace-capable publication remains the POSIX root cause. The public-ingress test first fails because the MCP tool list exposes raw aliases; later assertions additionally cover direct call dispatch, stdio identity propagation, and HTTP refusal.

### Fix round 1 GREEN and final verification

Implementation commit: `a509e3d9 fix(authority): close signed multi-job public ingress`.

Final command:

```text
npx tsc --noEmit
npm run check:authority-contract
npm run check:agent-adapter -- conformance/agent-adapter/v0/fixtures/grok-build-observed.json
npx tsc -p tsconfig.test.json
node --test --test-concurrency=1 dist-test/test/authority/gate-signer.test.js dist-test/test/authority/local-multi-definition-jobs.test.js dist-test/test/authority/local-e2e.test.js dist-test/test/authority/local-runtime.test.js dist-test/test/authority/local-latency-wiring.test.js dist-test/test/authority/ingress.test.js dist-test/test/authority/http.test.js dist-test/test/authority/http-response-semantics.test.js dist-test/test/authority/authority-serve.test.js dist-test/test/authority/contract.test.js dist-test/test/authority/package.test.js dist-test/test/agent-adapter-conformance.test.js
```

Verbatim tail:

```text
✔ simultaneous first starts converge on the one durably persisted gate identity (62.7189ms)
✔ multi-definition signed Job Card returns deterministic opaque references instead of job IDs or aliases (81.2055ms)
✔ signed multi-definition references refuse every binding mismatch and stale authority (104.037ms)
✔ opaque invoke converges exact retries and refuses request-id semantic conflicts before provider dispatch (1051.981ms)
✔ production MCP and HTTP keep signed multi-definition aliases behind authenticated opaque refs (525.3277ms)
✔ persisted references refuse after the bound grant expires across authority restart (36.1854ms)
✔ public production export parses DecisionContext and its portable evidence against packaged schemas (170.9502ms)
ℹ tests 66
ℹ suites 0
ℹ pass 64
ℹ fail 0
ℹ cancelled 0
ℹ skipped 2
ℹ todo 0
ℹ duration_ms 9065.5241
```

`npx tsc --noEmit`, test compilation, and the authority contract check exited 0 without diagnostics. The adapter checker returned `"status":"passed"` for all seven checks. The two skips are the existing Linux-only local E2E and bootstrap-liveness cases on this Windows host.

### Fix round 1 self-review and concerns

- Signed multi-definition raw aliases are absent from MCP discovery, rejected when called directly despite not being advertised, and refused by authenticated HTTP before provider dispatch. Signed/unsigned single-definition compatibility remains.
- Stdio receives task/principal/grant/allocation/session/Job Card/Cell identity only through the host construction option; no MCP input field was added.
- Hard-link publication is same-filesystem and no-replace; candidate bytes are fsynced before publication and the published identity is always reread through the stable-handle loader.
- Exact signed envelope binding is proven under the same gate key; different host-key behavior remains independently tested.
- Gate-key rotation intentionally invalidates all previously issued job references because the keyed commitment namespace changes. Clients must search/load again after an operator rotates the host gate identity; no alias or prior-key fallback exists.
- The public stdio server option is a trusted composition seam. Legacy `authority serve` does not invent a task context; a managed/self-hosted caller must pass its already-authenticated session context. Without it, signed multi-definition MCP fails closed.

## Fix round 2 — Phase 1 root-cause evidence (recorded before modifications)

1. **Production stdio composition stops before authentication.** `authorityServe` loads `ingress.principalRegistryFile`, constructs the file registry and delegation authority, builds the local runtime, then calls `createAuthorityHostServer` with only `{ principalRegistry }`. The server supports `stdioExecutionContext`, but no production caller supplies it. `activateCodexPrincipalSessions` already issues the short-lived credential, persists only its digest in the append-only registry, and writes the raw token into a private `<profile>.token` file. The missing link is a host-owned reference from config to that credential plus a startup resolver that calls `PrincipalRegistry.resolve` and validates the returned tenant/requester/cell/job before constructing the stdio server.

2. **Config has no closed stdio credential reference.** `AuthorityHostConfig.ingress` accepts `bearerRef`, `allowedRequester`, and `principalRegistryFile`; it rejects unknown fields, and the bearer mode is mutually exclusive with the registry. Existing client/certification conventions accept only `env:<NAME>` or `file:<path>` references and never embed raw tokens. There is currently no field that is valid only alongside `principalRegistryFile`, so production stdio cannot select an issued principal without putting identity into an MCP request.

3. **Session and Cell drift lack a trusted comparison value in the local resolver.** `resolveBoundJobs` validates task/principal/grant/allocation against durable `DelegationAuthority.resolveSessionBinding`, but that delegation record contains neither runtime session ID nor Authority Cell ID. Those values are authoritative in the resolved principal credential. Because the runtime does not capture the resolved startup context, a direct caller can substitute session/cell, obtain a new catalog, and the prior test explicitly skipped search refusal for those two mutations. A stdio-bound runtime must compare the entire supplied context with the exact startup context before delegation lookup.

4. **The second-definition test fixture cannot dispatch by construction.** The signed card lists Gmail and Slack, but the deployment manifest injects an empty Slack state, has only a Gmail connector/adoption/source, and the adapter test merely asserts Slack does not return `job-not-found`. The working Gmail pattern includes a signed active contract, trusted grant, registered connector/account, source file, and matching first-party pack. Slack needs the same complete state with its own connector, source, contract policy, risk, endpoint, and effect assertion.

5. **Rotation semantics exist only in ignored evidence.** Job references are keyed by the persisted local gate key, so rotation changes the namespace and intentionally invalidates outstanding refs. The durable API/runbook does not state that clients must search/load again. The gate-key contract also does not state that first creation requires same-filesystem hard-link/no-replace support and fails closed if that atomic publication is unavailable.

### Fix round 2 hypotheses

- **H1 startup:** a closed `ingress.stdioPrincipalCredentialRef` parsed as `env:`/absolute `file:`, valid only with `principalRegistryFile`, plus a narrow startup resolver used by `authorityServe`, will supply the exact context without widening MCP bodies or serializing the secret/context.
- **H2 trust:** resolving the token before runtime/server construction, validating tenant/requester/configured Cell/signed Job ID, and constructing a stdio-bound local runtime with that exact context will make session and Cell substitutions refuse at search/load/invoke.
- **H3 Slack:** mirroring the complete Gmail deployment pattern for Slack will make its distinct ref select `slack.conversations.setTopic`, proving alias-to-effect mapping rather than only reference existence.
- **H4 docs:** adding the rotation and atomic-publication contract to the existing live Authority Cell runbook and gate-signer API comment will make the operational behavior durable and reviewable.

No architectural blocker: all trusted data already exists in the principal registry, signed deployment, and host config; this round only closes their production composition.

### Fix round 2 RED 1 — missing production composition

```text
npx tsc -p tsconfig.test.json
```

```text
test/authority/authority-serve-stdio-context.test.ts: Cannot find module '../../src/authority/host/stdio-context.js'
Property 'stdioPrincipalCredentialRef' does not exist on type ingress
local.ts has no exported member named 'createStdioBoundLocalAuthorityRuntime'
```

These compile failures are the exact missing production seams: no closed config reference, no startup resolver, and no runtime that captures the resolved stdio authority. The same test change tightens session/Cell search to refusal and requires the Slack ref to dispatch a Slack effect; their behavioral RED is run after these missing seams compile.

### Fix round 2 RED 2 — second definition lacks authority state

After adding only the startup/context seams:

```text
node --test --test-concurrency=1 dist-test/test/authority/authority-serve-stdio-context.test.js dist-test/test/authority/config.test.js dist-test/test/authority/local-multi-definition-jobs.test.js
```

```text
ℹ tests 12
ℹ pass 11
ℹ fail 1
opaque invoke converges...:
{"requestId":"second_definition","verdict":"refused","reasonCode":"contract-not-found","lifecycleState":"refused"}
```

This confirms reference resolution reaches the Slack alias, but the fixture's deliberately empty Slack snapshot blocks before effect compilation/dispatch. The minimal remaining change is complete signed Slack authority state and source/connector evidence in the test deployment.

### Fix round 2 GREEN and final verification

Implementation commit: `e65f8933 fix(authority): bind production stdio to principal sessions`.

```text
npx tsc --noEmit
npm run check:authority-contract
npx tsc -p tsconfig.test.json
node --test --test-concurrency=1 dist-test/test/authority/authority-serve-stdio-context.test.js dist-test/test/authority/authority-serve.test.js dist-test/test/authority/config.test.js dist-test/test/authority/principal-registry.test.js dist-test/test/authority/gate-signer.test.js dist-test/test/authority/local-multi-definition-jobs.test.js dist-test/test/authority/local-e2e.test.js dist-test/test/authority/local-runtime.test.js dist-test/test/authority/local-latency-wiring.test.js dist-test/test/authority/ingress.test.js dist-test/test/authority/http.test.js dist-test/test/authority/http-response-semantics.test.js dist-test/test/authority/contract.test.js dist-test/test/agent-adapter-conformance.test.js
```

Verbatim tail:

```text
✔ authority serve config accepts only a referenced stdio principal credential paired with its registry (1.1254ms)
✔ authority serve resolves a short-lived stdio principal before server construction and refuses identity drift (8.1836ms)
✔ authority serve production composition passes only the resolved context into runtime construction (1.0619ms)
✔ simultaneous first starts converge on the one durably persisted gate identity (75.8116ms)
✔ multi-definition signed Job Card returns deterministic opaque references instead of job IDs or aliases (81.2712ms)
✔ signed multi-definition references refuse every binding mismatch and stale authority (110.5106ms)
✔ opaque invoke converges exact retries and refuses request-id semantic conflicts before provider dispatch (1525.1798ms)
✔ production MCP and HTTP keep signed multi-definition aliases behind authenticated opaque refs (537.0295ms)
✔ file principal registry serializes concurrent issuance for one runtime session (20.1918ms)
ℹ tests 71
ℹ suites 0
ℹ pass 69
ℹ fail 0
ℹ cancelled 0
ℹ skipped 2
ℹ todo 0
ℹ duration_ms 8646.4273
```

`npx tsc --noEmit`, test compilation, and the authority contract check exited 0 without diagnostics. The two skips are the existing Linux-only local deployment E2E and bootstrap-liveness cases on this Windows host.

### Fix round 2 self-review and concerns

- The stdio credential is never accepted in MCP arguments, returned by the resolver, added to receipts, or logged. Config stores only its `env:`/`file:` reference; the principal registry stores only its digest.
- Missing, expired, revoked, tenant/requester/Cell-mismatched credentials refuse before runtime/server construction. Signed Job mismatch refuses during bound runtime construction, still before server construction.
- The exact captured runtime session and Authority Cell are compared before durable delegation lookup, so search, load, and invoke all refuse drift.
- Both refs now reach complete independent signed authority states and dispatch distinct provider effects; the second ref is no longer proved merely by avoiding `job-not-found`.
- Legacy single-definition stdio remains compatible without a principal credential reference. Signed multi-definition stdio explicitly refuses one.
- File credential references are absolute and reject symlink/canonical indirection and unstable files. Operators should retain the private activation credential directory permissions documented by the runbook.

## Fix round 3 — Phase 1 root-cause evidence (recorded before modifications)

1. `readStableCredential` opens with `O_NOFOLLOW`, verifies canonical path identity, regular-file/size limits, and compares handle/path device/inode/size/mtime across the read. It never inspects `uid` or permission mode. Consequently, a Linux credential owned by another UID or readable by group/world passes every existing check.
2. Production already runs only on Linux and Node `Stats` exposes `uid` and `mode`; `process.geteuid()` supplies the non-agent-controlled effective host identity. A pure package-internal metadata validator can be unit-tested with synthetic UID/mode on Windows while production always supplies real handle/path metadata and real effective UID. The resolver API will expose no dependency override for either.
3. The stable check should validate owner/mode before reading, revalidate them after reading, and include them in the current-path equality comparison, so chmod/chown replacement races remain fail closed.
4. The report currently says file credentials reject “NUL/newline content,” but the implementation intentionally trims and accepts one conventional trailing newline while rejecting embedded newlines. The durable wording should say “embedded newlines.”
5. The existing composition unit test verifies `composeAuthorityServeStdioRuntime` in isolation, while CLI wiring is unbound: deleting the calls to `composeAuthorityServeStdioRuntime`, `createStdioBoundLocalAuthorityRuntime`, or `createAuthorityHostServer` from `authorityServe` could leave it green. A small injectable production composition function that creates the server from the composed runtime/context can bind all three calls without starting stdio.

Hypotheses: enforcing `uid === geteuid` and `(mode & 0o077) === 0` at all stable-file snapshots closes the credential exposure; extracting the already-existing CLI composition block into an exported package-internal function with injected runtime/server factories gives a behavioral wiring test without source matching or a live stdio loop.

### Fix round 3 RED

```text
npx tsc -p tsconfig.test.json
```

```text
stdio-context.ts has no exported member 'validatePrivateStdioCredentialFileMetadata'
cli.ts has no exported member 'composeAuthorityServeHost'
```

The missing symbols directly represent the two review gaps: no enforceable/testable private-owner/mode contract and no behavioral production composition boundary tying stdio resolution, bound runtime creation, and host-server construction together.

### Fix round 3 GREEN and final verification

Implementation commit: `b17de6e8 fix(authority): require private stdio credential files`.

```text
npx tsc --noEmit
npm run check:authority-contract
npx tsc -p tsconfig.test.json
node --test --test-concurrency=1 dist-test/test/authority/authority-serve-stdio-context.test.js dist-test/test/authority/authority-serve.test.js dist-test/test/authority/config.test.js dist-test/test/authority/principal-registry.test.js dist-test/test/authority/secret-resolver.test.js dist-test/test/authority/gate-signer.test.js dist-test/test/authority/local-multi-definition-jobs.test.js dist-test/test/authority/local-runtime.test.js dist-test/test/authority/ingress.test.js dist-test/test/authority/http.test.js dist-test/test/authority/contract.test.js
```

Verbatim tail:

```text
✔ authority serve resolves a short-lived stdio principal before server construction and refuses identity drift (10.6536ms)
✔ stdio credential file metadata requires the effective host owner and private mode (0.2827ms)
✔ authority serve host composition binds stdio resolver, bound runtime, and host server without starting stdio (0.3681ms)
✔ simultaneous first starts converge on the one durably persisted gate identity (51.7316ms)
✔ signed multi-definition references refuse every binding mismatch and stale authority (112.6715ms)
✔ production MCP and HTTP keep signed multi-definition aliases behind authenticated opaque refs (536.163ms)
✔ credential env slots reject empty and NUL values (0.7353ms)
ℹ tests 62
ℹ suites 0
ℹ pass 61
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 5916.8264
```

`npx tsc --noEmit`, test compilation, and the authority contract check exited 0 without diagnostics. The one skip is the existing bootstrap-liveness platform case.

### Fix round 3 self-review and concerns

- The production path obtains UID only from `process.geteuid()` on Linux and metadata only from the open handle/current path. Neither agents, config, nor public resolver dependencies can override them.
- Permission enforcement rejects any of `0077`; owner read/write/execute bits remain an operator choice, while the regular-file check remains mandatory.
- UID and mode are checked before and after reading and compared across the handle/path snapshots alongside device, inode, size, and mtime.
- A single conventional terminal LF or CRLF is accepted explicitly; token bytes are otherwise preserved exactly. Leading/trailing whitespace, multiple terminal newlines, NUL, and embedded newlines refuse.
- `authorityServe` delegates all runtime/server creation to the tested composition boundary; the test asserts the exact compose → bound runtime → host server path and does not start stdio.

## Fix round 4 — Phase 1 root-cause evidence (recorded before modifications)

1. The round-3 wiring test called `composeAuthorityServeHost` directly. It did not enter `runAuthorityCommand` or `authorityServe`, so replacing the production `authorityServe` call with the prior unbound runtime/server construction left the test green.
2. `readStableCredential` called `trim()`. That accepted leading/trailing spaces and any number of terminal LF/CRLF sequences instead of preserving token bytes with only one conventional line-ending exception.
3. The existing private-file metadata test used synthetic metadata on Windows. An actual wrong-mode resolver test was still absent; it can be honest only as a Linux-gated test because production mode enforcement is Linux-only.

The narrow fix is an internal, non-package-exported runtime seam around the real `authorityServe` composition and transport start. `runAuthorityCommand` still supplies no dependencies, production defaults are frozen, and the test can execute parsing, config/credential resolution, `composeAuthorityServeHost`, resolved-context propagation, and host construction without opening stdio or a socket.

### Fix round 4 RED

Test commit: `f21f8880 test(authority): expose serve dispatch and credential byte gaps`.

Initial test compilation:

```text
test/authority/authority-serve-stdio-context.test.ts(9,10): error TS2305: Module '"../../src/authority/cli.js"' has no exported member '__testSetAuthorityServeRuntime'.
```

Mutation check against the old `trim()` parser:

```text
✖ stdio credential files accept exact token bytes with at most one terminal LF or CRLF
AssertionError [ERR_ASSERTION]: Missing expected rejection: " rat_exact"
ℹ tests 1
ℹ pass 0
ℹ fail 1
```

Mutation check bypassing the injected production composition dependencies in `authorityServe`:

```text
✖ authority serve command dispatch uses production host composition with the resolved stdio context
TypeError: stdio principal context does not match the signed deployment or host identity
ℹ tests 1
ℹ pass 0
ℹ fail 1
```

The first mutation proves spaces no longer disappear through normalization. The second proves the regression enters the real `runAuthorityCommand` → `authorityServe` path and fails if that path stops using the production composition boundary.

### Fix round 4 GREEN

Implementation commit: `cc44bc80 fix(authority): bind serve dispatch and exact credential bytes`.

- `src/authority/cli.ts`: production `authorityServe` now selects frozen default host-composition/start behavior through an internal test-only override patterned after the existing Linux host-platform seam. The command still accepts no dependency injection. The regression uses the real stdio resolver and real `composeAuthorityServeHost`, supplies only bound-runtime/host construction doubles, and replaces transport start with a no-op assertion.
- `src/authority/host/stdio-context.ts`: removes `trim()`, strips at most one terminal LF or CRLF, and rejects empty values, surrounding whitespace, NUL, embedded newlines, and additional terminal newlines while preserving owner/mode/stability checks.
- `test/authority/authority-serve-stdio-context.test.ts`: adds actual command-dispatch coverage, exact/LF/CRLF acceptance, malformed-byte refusals, and a Linux-only real `0640` file resolver refusal.
- Deviations from the approved brief: none. The real wrong-mode test is skipped on Windows and is not claimed as executed there.

### Fix round 4 final verification

```text
npx tsc --noEmit
npm run check:authority-contract
npm run check:agent-adapter -- conformance/agent-adapter/v0/fixtures/grok-build-observed.json
npx tsc -p tsconfig.test.json
node --test --test-concurrency=1 dist-test/test/authority/authority-serve-stdio-context.test.js dist-test/test/authority/authority-serve.test.js dist-test/test/authority/config.test.js dist-test/test/authority/principal-registry.test.js dist-test/test/authority/secret-resolver.test.js dist-test/test/authority/gate-signer.test.js dist-test/test/authority/local-multi-definition-jobs.test.js dist-test/test/authority/local-runtime.test.js dist-test/test/authority/ingress.test.js dist-test/test/authority/http.test.js dist-test/test/authority/http-response-semantics.test.js dist-test/test/authority/contract.test.js dist-test/test/agent-adapter-conformance.test.js
```

The typecheck, test compilation, and authority contract check exited 0 without diagnostics. The adapter checker returned `"status":"passed"` for all seven checks.

Verbatim tail:

```text
✔ credential slots issue one-use non-secret leases (7.4117ms)
✔ credential slot inspection is status-only and confinement rejects unsafe files (3.975ms)
✔ credential slot values reject NUL and oversized files (2.8392ms)
✔ credential leases expire and remain one-use (3.3812ms)
✔ credential slot maps and definitions reject accessors and non-plain prototypes (0.3731ms)
✔ credential slots reject linked and non-directory roots (1.7394ms)
✔ credential slot rejects a file replaced between open/read and post-stat (3.3247ms)
✔ credential slot refuses a symlinked file root (2.053ms)
✔ credential env slots reject empty and NUL values (0.677ms)
ℹ tests 82
ℹ suites 0
ℹ pass 80
ℹ fail 0
ℹ cancelled 0
ℹ skipped 2
ℹ todo 0
ℹ duration_ms 8217.9791
```

The two skips are the existing Windows bootstrap-liveness skip and the new Linux-only actual wrong-mode credential file test. The synthetic owner/mode contract test executes on Windows; no claim is made that the real Linux filesystem mode path ran on this host.

### Fix round 4 open risks

- The internal runtime override is module-scoped and therefore used only by serialized tests. It is absent from every public package export, and neither CLI arguments nor `runAuthorityCommand` parameters expose dependency injection to agent callers.
- Actual wrong-owner and wrong-mode filesystem behavior still needs execution on Linux CI. This Windows run covered the pure UID/mode validator and skipped the honestly platform-gated `0640` resolver test.
- Owner, mode, symlink, canonical-path, inode/device, size, and mtime stability guarantees remain unchanged; this round changes only credential content parsing and the testability of existing production wiring.

### Fix round 4 repository-wide finishing check

`npm test` was also run after the scoped gate. It is not green on this Windows checkout:

```text
ℹ tests 3378
ℹ suites 0
ℹ pass 3352
ℹ fail 7
ℹ cancelled 0
ℹ skipped 19
ℹ todo 0
ℹ duration_ms 472248.9198
```

Six failures are Windows executions of tests that call Linux-only Authority Cell host constructors without installing the existing platform test seam: three in `test/authority-runtime.test.ts`, two in `test/authority/host-server.test.ts`, and one in `test/authority/receipts.test.ts`. The seventh is `test/bootstrap-build-identity.test.ts`, which cannot find `native/bootstrap-helper/manifest.json` in this checkout. None of those files or prerequisites is in Task 3's approved file list, so no out-of-scope fix was attempted. The scoped 82-test authority/security gate above remains the applicable Task 3 verification result.
