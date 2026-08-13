# Native HTTPS GitHub Label Outcome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship one measurable native HTTPS GitHub issue-label Outcome whose exact prepared request is authorized before dispatch, whose provider result is classified conservatively, and whose declared label projection is proven by authoritative pre/post reads and portable offline evidence.

**Architecture:** Harden the existing JSON HTTPS driver into a closed, canonical route registry shared by authority and execution. After the gate durably reserves the expected route and materialized-request digest, the coordinator rereads that join, revalidates current authority/source state, and asks the connector for an opaque one-use `PreparedDispatch` that freezes the same normalized route and exact materialized request. An authority/delegation compare-and-set then returns a separate opaque one-use `DispatchCommitLease`; consuming both capabilities durably marks `send-started` while still serialized against revocation/expiry, then releases the lock and invokes the private send closure exactly once. The first public composition enters through the existing MCP/HTTP Outcome ingress, server, and runtime, reuses the reviewed GitHub label pack and reconciliation logic, and binds route, account identity, request, observation, cleanup, and measured phase evidence through certification extensions without changing frozen Adapter Contract v1.

**Tech Stack:** TypeScript, Node.js `https`/`tls`/`dns`/`fs` primitives, existing Path C authority gate and filesystem ledger, existing GitHub labels pack/reconciler, JSON Schema, Node test runner, exact npm tarball certification on Ubuntu and Windows offline verification.

## Global Constraints

- Do not begin until `docs/superpowers/plans/2026-08-12-windows-client-linux-authority-cell.md` Tasks 4A, 5, and 6 are complete, independently reviewed, and green against the exact packed artifact; the hosted Windows ledger falsifier must be fixed or proven absent on that same merge candidate without retries, sleeps, or wider timeouts.
- Tasks 1-5 may proceed in parallel with `docs/superpowers/plans/2026-08-12-agent-neutral-governed-outcome-tour.md`; the completed exact packed tour is a release gate for Tasks 6-8, not a start blocker for transport hardening.
- FOUNDATION and `BUILDING-COMPASS.md` govern: wide intelligence, narrow consequential exits; the model may propose a non-authorizing label choice only where the closed pack permits it, while provider/account/resource/route/method/credential-slot/reconciliation/evidence fields come only from signed authority and operator-owned configuration.
- Native HTTPS is the only new execution adapter in this plan. Do not implement browser/GUI interception, arbitrary direct-HTTP observation, plugin interception, x402/payment processing, completeness attestation, semantic-correctness judgment, or external-delivery certification.
- Preserve frozen Adapter Contract v1 and `contract/authority/v1/` byte-for-byte. Add certification extensions and host-internal wire types; change Adapter Contract v1 only if an independent review proves the extension path impossible and a separately approved plan amendment names the incompatibility.
- Secret values and secret references never enter agent/model fields, Outcome wire fields, logs, metrics, receipts, graphs, or error messages. Receipts may bind only a non-secret credential-slot identifier.
- A route or authenticated-account mismatch refuses before reservation/budget consumption and before the one-use prepared send capability can be consumed. Credential resolution used only to prepare authenticated identity and request material remains inside the Cell, is total-deadline-bounded, and can never itself authorize dispatch.
- One monotonic absolute dispatch deadline starts at Outcome ingress before credential lease acquisition, authenticated identity probing, source reads, or request preparation and never resets across preparation, authority revalidation, budget/ledger commitment, DNS, proxy CONNECT, TLS, upload, response headers, or bounded response-body collection. Expiry never authorizes a resend and does not prevent post-dispatch reconciliation from using its separately bounded read deadline. No automatic redirect and no automatic retry after any consequential send attempt.
- `2xx` means provider acknowledgement only. Every post-send non-`2xx`, redirect, disconnect, or deadline is ambiguous until independently rejoined authoritative read-back proves the declared post-state; pre-state equality alone never proves not-applied and never releases consumed budget. A definitive not-applied verdict requires provider-native operation identity/status evidence reviewed for that exact route.
- `exact + matched` is available only for the complete declared GitHub labels projection with comparable authoritative pre/post reads. `partial`, `pending`, `absent`, `unchecked`, ambiguous, and manual states never pass.
- Cleanup is a separately authorized Outcome that restores the signed pre-state projection with its own reservation, budget, dispatch, reconciliation, receipts, and ambiguity handling. It is never an implicit compensating request.
- Critical-path latency contains no model, reviewer, package, graph-export, or Cloud call. Cache only immutable verified artifacts; re-check mutable grant/revocation/budget/source/session/route/provider state for every dispatch.
- Task 8 establishes a measured baseline only. No numeric latency SLO or regression budget is added in this plan; a later independently reviewed amendment may propose one from the recorded distribution.
- Named Grok, Eve, Hermes, Claude Code, and Codex compatibility remains `unchecked`. The public E2E proves only the documented generic MCP/HTTP Outcome ingress and CLI/runbook path until separate executable host-conformance tests promote a named host.
- Every behavior change follows RED -> GREEN TDD in separate commits, creates its named task report, and receives an independent spec and code-quality review before the next task.

---

### Task 1: Freeze canonical native HTTPS route configuration

**Files:**
- Create: `src/authority/host/json-https-route.ts`
- Modify: `src/authority/host/config.ts`
- Modify: `src/authority/drivers/json-https.ts`
- Test: `test/authority/config.test.ts`
- Create: `test/authority/json-https-route.test.ts`
- Create: `.superpowers/sdd/2026-08-12-native-https-github-label-outcome/task-1-report.md`

**Interfaces:**
- Produces `JsonHttpsRouteV1`, `CanonicalJsonHttpsRouteV1`, `JsonHttpsRouteRegistry`, `parseJsonHttpsRouteV1(value)`, `canonicalizeJsonHttpsRoute(route)`, `jsonHttpsRouteDigest(route): string`, `createJsonHttpsRouteRegistry(routes)`, `lookupJsonHttpsRoute(registry, endpointId)`, and `jsonHttpsConnectorConfigurationDigest(registry, connectorId, accountId)`.
- `CanonicalJsonHttpsRouteV1` binds `providerId`, `connectorId`, `accountId`, `providerAccountIdentity`, `endpointId`, canonical HTTPS `origin`, sorted unique `allowedMethods`, normalized sorted `allowedPathPrefixes`, `credentialSlotId`, `responseSemanticsProfileId`, `reconciliationRecipeId`, `readEndpointId`, and `egressPolicyDigest`.
- `JsonHttpsEndpoint` becomes the runtime view derived from the canonical route; it no longer carries an unconstrained secret reference as route identity.

- [ ] **Step 1: Write closed-parser and canonical-digest tests**

```ts
const route = parseJsonHttpsRouteV1({
  v: "reelier.json-https-route/v1",
  providerId: "github",
  connectorId: "github",
  accountId: "github_fixlyai_reelier",
  providerAccountIdentity: "github:fixlyai/reelier",
  endpointId: "github.issue.labels.replace",
  origin: "https://api.github.com",
  allowedMethods: ["PUT"],
  allowedPathPrefixes: ["/repos/fixlyai/reelier/issues/1/labels"],
  credentialSlotId: "github.primary",
  responseSemanticsProfileId: "github.issue-labels.v1",
  reconciliationRecipeId: "github.issue-labels.readback.v1",
  readEndpointId: "github.issue.labels.readback",
  egressPolicyDigest: sha("egress"),
});
assert.equal(jsonHttpsRouteDigest(route), jsonHttpsRouteDigest(structuredClone(route)));
assert.throws(() => parseJsonHttpsRouteV1({ ...route, secretRef: "env:TOKEN" }), /closed|unknown/i);
assert.throws(() => parseJsonHttpsRouteV1({ ...route, origin: "http://api.github.com" }), /HTTPS origin/i);
```

Also reject credentials in URLs, paths with dot segments/backslashes/query/fragments, duplicate or unsorted-equivalent entries, wildcard origins, zero digests, unknown response profiles, accessors, prototypes other than `Object.prototype`, and extra nested keys without invoking getters.

- [ ] **Step 2: Run RED tests**

Run: `npx tsc -p tsconfig.test.json && node --test --test-concurrency=1 dist-test/test/authority/config.test.js dist-test/test/authority/json-https-route.test.js`

Expected: FAIL because `json-https-route.ts` and the closed `routes` config surface do not exist.

- [ ] **Step 3: Commit the RED tests**

```bash
git add test/authority/config.test.ts test/authority/json-https-route.test.ts
git commit -m "test(authority): specify canonical HTTPS routes"
```

- [ ] **Step 4: Implement the minimal canonical route module and config loader**

```ts
export interface JsonHttpsRouteV1 {
  readonly v: "reelier.json-https-route/v1";
  readonly providerId: string;
  readonly connectorId: string;
  readonly accountId: string;
  readonly providerAccountIdentity: string;
  readonly endpointId: string;
  readonly origin: string;
  readonly allowedMethods: readonly ("GET" | "POST" | "PUT" | "PATCH" | "DELETE")[];
  readonly allowedPathPrefixes: readonly string[];
  readonly credentialSlotId: string;
  readonly responseSemanticsProfileId: string;
  readonly reconciliationRecipeId: string;
  readonly readEndpointId: string;
  readonly egressPolicyDigest: string;
}

export function jsonHttpsRouteDigest(value: JsonHttpsRouteV1): string {
  return authorityDigest(canonicalizeJsonHttpsRoute(parseJsonHttpsRouteV1(value)));
}

export interface JsonHttpsRouteRegistry {
  route(endpointId: string): CanonicalJsonHttpsRouteV1 | undefined;
  connectorConfigurationDigest(connectorId: string, accountId: string): string;
}
```

Add a closed optional `nativeHttps` section to `AuthorityHostConfig` containing canonical `routes`, response profiles, `secretRoot`, and credential-slot declarations. Keep `endpoints` only as the explicitly legacy, non-certified JSON HTTPS surface; it cannot populate `routeAuthority`, cannot produce the native certified claim, and is never silently upgraded by filling missing authority fields.

- [ ] **Step 5: Run GREEN and regression tests**

Run: `npx tsc -p tsconfig.test.json && node --test --test-concurrency=1 dist-test/test/authority/config.test.js dist-test/test/authority/json-https-route.test.js dist-test/test/authority/json-https-driver.test.js dist-test/test/authority/json-https-connector.test.js`

Expected: PASS; equivalent route input has one digest and any authority-relevant difference changes it.

- [ ] **Step 6: Commit GREEN implementation and report**

```bash
git add src/authority/host/json-https-route.ts src/authority/host/config.ts src/authority/drivers/json-https.ts test/authority/config.test.ts test/authority/json-https-route.test.ts .superpowers/sdd/2026-08-12-native-https-github-label-outcome/task-1-report.md
git commit -m "feat(authority): canonicalize native HTTPS routes"
```

---

### Task 2: Share public-address enforcement and enforce one total deadline

**Files:**
- Modify: `src/authority/client/ip.ts`
- Create: `src/authority/net/deadline.ts`
- Modify: `src/authority/client/http.ts`
- Modify: `src/authority/drivers/json-https.ts`
- Modify: `src/authority/host/egress-gateway.ts`
- Create: `test/authority/authority-client.test.ts`
- Test: `test/authority/json-https-driver.test.ts`
- Test: `test/authority/egress-gateway.test.ts`
- Create: `.superpowers/sdd/2026-08-12-native-https-github-label-outcome/task-2-report.md`

**Interfaces:**
- Extends the existing `src/authority/client/ip.ts` as the one authoritative classifier, producing `classifyPublicAddress(address): { ok: true; family: 4 | 6 } | { ok: false; reason: PublicAddressRefusal }` and `assertAllPublicAddresses(addresses)` while retaining `normalizeIpLiteral`, `isPublicIpAddress`, and `isLoopbackIpAddress` as wrappers over the same classification.
- Produces `createTotalDeadline({ timeoutMs, monotonicNow }): TotalDeadline`, where `absoluteDeadlineMs` is drawn once before the first credential lease/identity probe and `remainingMs(stage)` always derives from that same absolute deadline; no phase creates a new timer or widens the deadline.
- Both direct HTTPS and the CONNECT egress gateway consume the same address classifier.

- [ ] **Step 1: Write address and deadline falsifiers**

```ts
for (const address of ["127.0.0.1", "169.254.169.254", "10.0.0.1", "172.16.0.1", "192.168.1.1", "0.0.0.0", "224.0.0.1", "::", "::1", "fc00::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1"]) {
  assert.equal(classifyPublicAddress(address).ok, false, address);
}
assert.equal(classifyPublicAddress("93.184.216.34").ok, true);
assert.equal(classifyPublicAddress("2606:2800:220:1:248:1893:25c8:1946").ok, true);
```

Add client/driver/gateway tests where one DNS answer is private among public answers, a mapped IPv4 private address is returned, and injected monotonic time expires during credential acquisition, identity probe, source read, request preparation, authority revalidation, budget commitment, ledger transition, DNS, CONNECT, TLS, upload, headers, and body collection. Assert every phase reads the same `absoluteDeadlineMs`, no later phase begins after expiry, and no phase creates a new timer.

- [ ] **Step 2: Run RED tests**

Run: `npx tsc -p tsconfig.test.json && node --test --test-concurrency=1 dist-test/test/authority/authority-client.test.js dist-test/test/authority/json-https-driver.test.js dist-test/test/authority/egress-gateway.test.js`

Expected: FAIL because the shared classifier and total deadline do not exist.

- [ ] **Step 3: Commit the RED tests**

```bash
git add test/authority/authority-client.test.ts test/authority/json-https-driver.test.ts test/authority/egress-gateway.test.ts
git commit -m "test(authority): specify HTTPS address and deadline bounds"
```

- [ ] **Step 4: Implement shared enforcement**

```ts
export interface TotalDeadline {
  readonly startedAtMs: number;
  readonly expiresAtMs: number;
  readonly absoluteDeadlineMs: number;
  remainingMs(stage: "credential" | "identity" | "source" | "prepare" | "authority" | "budget" | "ledger" | "dns" | "connect" | "tls" | "upload" | "headers" | "body"): number;
}

export function createTotalDeadline(input: Readonly<{ timeoutMs: number; monotonicNow: () => number }>): TotalDeadline {
  const startedAtMs = input.monotonicNow();
  const expiresAtMs = startedAtMs + input.timeoutMs;
  return Object.freeze({ startedAtMs, expiresAtMs, absoluteDeadlineMs: expiresAtMs, remainingMs(stage) {
    const remaining = expiresAtMs - input.monotonicNow();
    if (remaining <= 0) throw new TotalDeadlineExceeded(stage);
    return remaining;
  }});
}
```

Migrate the authority client direct path, JSON HTTPS driver, and egress gateway to the same classifier and injected `TotalDeadline`. Resolve all DNS answers, reject the whole set if any answer is non-public or malformed, pin one validated address, never follow `Location`, bound upload/body sizes, and destroy the request/socket when the original deadline expires. Constructors accept the existing deadline object; none accepts a fresh per-phase timeout on the certified path.

- [ ] **Step 5: Run GREEN and regression tests**

Run: `npx tsc -p tsconfig.test.json && node --test --test-concurrency=1 dist-test/test/authority/authority-client.test.js dist-test/test/authority/json-https-driver.test.js dist-test/test/authority/egress-gateway.test.js`

Expected: PASS with deterministic injected monotonic clocks and zero real network calls.

- [ ] **Step 6: Commit GREEN implementation and report**

```bash
git add src/authority/client/ip.ts src/authority/client/http.ts src/authority/net/deadline.ts src/authority/drivers/json-https.ts src/authority/host/egress-gateway.ts test/authority/authority-client.test.ts test/authority/json-https-driver.test.ts test/authority/egress-gateway.test.ts .superpowers/sdd/2026-08-12-native-https-github-label-outcome/task-2-report.md
git commit -m "feat(authority): bound native HTTPS network execution"
```

---

### Task 3: Confine credential references to operator-owned slots

**Files:**
- Modify: `src/authority/host/secret-resolver.ts`
- Modify: `src/authority/host/config.ts`
- Modify: `src/authority/cli.ts`
- Modify: `src/authority/drivers/json-https.ts`
- Modify: `src/authority/host/json-https-connector.ts`
- Modify: `src/authority/host/founder-source-adapter.ts`
- Modify: `src/authority/host/fly-network-policy-client.ts`
- Modify: `src/authority/host/fly-remote-probe.ts`
- Modify: `src/authority/host/local.ts`
- Modify: `src/authority/host/founder-dispatch-adapter.ts`
- Test: `test/authority/secret-resolver.test.ts`
- Test: `test/authority/config.test.ts`
- Test: `test/authority/authority-serve.test.ts`
- Test: `test/authority/json-https-driver.test.ts`
- Test: `test/authority/json-https-connector.test.ts`
- Test: `test/authority/founder-source-adapter.test.ts`
- Test: `test/authority/fly-network-policy-client.test.ts`
- Test: `test/authority/fly-remote-probe.test.ts`
- Test: `test/authority/local-runtime.test.ts`
- Test: `test/authority/founder-dispatch-adapter.test.ts`
- Create: `.superpowers/sdd/2026-08-12-native-https-github-label-outcome/task-3-report.md`

**Interfaces:**
- Replaces every unconstrained production `createSecretResolver()` with `createSecretResolver({ fileRoot, slots, env? })` or an injected `SecretResolver`; no deliberately legacy resolver remains certifiable.
- A route carries only `credentialSlotId`; the resolver owns the map from slot ID to `env:NAME` or a path relative to `fileRoot`.
- Resolution rejects symlinks/reparse indirection, root escapes, non-regular files, files over 64 KiB, empty values, embedded NUL, and changed file identity between validation and read.
- `LocalAuthorityRuntimeOptions.secretResolver` supports an opaque platform/Cell secret broker. Self-hosted config may map slots to confined env/file sources, but common setup and doctor accept/check only slot IDs and never ask an agent/model to paste a provider secret. Doctor reports only `configured | missing`; `configured` is explicitly not authenticated, verified, authorized, or account-bound.

- [ ] **Step 1: Write confinement and non-disclosure tests**

```ts
const resolver = createSecretResolver({
  fileRoot: secretsRoot,
  slots: { "github.primary": { kind: "file", path: "github/token" } },
  env: Object.freeze({}),
});
const lease = await resolver.acquireSlot("github.primary");
assert.deepEqual(describeSecretLease(lease), { slotId: "github.primary", instanceId: expectedInstance, version: expectedVersion, expiresAt });
await assert.rejects(() => resolver.acquireSlot("missing"), /slot.*unavailable/i);
```

Add Windows junction/symlink and Unix symlink cases, `..`/absolute path rejection, oversize and replacement-race falsifiers, invalid environment names, and assertions that thrown errors, route digests, serialized config, receipts, and metrics contain neither the secret value nor its environment/file reference.

- [ ] **Step 2: Run RED tests**

Run: `npx tsc -p tsconfig.test.json && node --test --test-concurrency=1 dist-test/test/authority/secret-resolver.test.js dist-test/test/authority/config.test.js dist-test/test/authority/authority-serve.test.js dist-test/test/authority/json-https-driver.test.js dist-test/test/authority/json-https-connector.test.js dist-test/test/authority/founder-source-adapter.test.js dist-test/test/authority/fly-network-policy-client.test.js dist-test/test/authority/fly-remote-probe.test.js dist-test/test/authority/local-runtime.test.js dist-test/test/authority/founder-dispatch-adapter.test.js`

Expected: FAIL because resolver construction is unconstrained and founder dispatch creates a default resolver.

- [ ] **Step 3: Commit the RED tests**

```bash
git add test/authority/secret-resolver.test.ts test/authority/config.test.ts test/authority/authority-serve.test.ts test/authority/json-https-driver.test.ts test/authority/json-https-connector.test.ts test/authority/founder-source-adapter.test.ts test/authority/fly-network-policy-client.test.ts test/authority/fly-remote-probe.test.ts test/authority/local-runtime.test.ts test/authority/founder-dispatch-adapter.test.ts
git commit -m "test(authority): specify confined credential slots"
```

- [ ] **Step 4: Implement slot-only resolution**

```ts
export type SecretSlot =
  | Readonly<{ kind: "env"; name: string }>
  | Readonly<{ kind: "file"; path: string }>;

declare const secretLeaseBrand: unique symbol;
export interface SecretLease { readonly [secretLeaseBrand]: true }
export interface SecretLeaseDescriptor { readonly slotId: string; readonly instanceId: string; readonly version: string; readonly expiresAt: string }
export interface SecretResolver {
  status(slotId: string): Promise<"configured" | "missing">;
  acquireSlot(slotId: string): Promise<SecretLease>;
  describeLease(lease: SecretLease): SecretLeaseDescriptor;
  useLeaseOnce<T>(lease: SecretLease, consumer: (secret: Uint8Array) => Promise<T>): Promise<T>;
}

export function createSecretResolver(input: Readonly<{
  fileRoot: string;
  slots: Readonly<Record<string, SecretSlot>>;
  env?: Readonly<Record<string, string | undefined>>;
}>): SecretResolver;
```

Make `secretRoot` and a closed `credentialSlots` map operator-owned host config for self-hosted Cells. `createLocalAuthorityRuntime` uses `options.secretResolver` when a platform supplies an opaque broker, otherwise constructs the confined resolver once from normalized config. Migrate CLI egress startup, JSON driver/connector, founder source/dispatch, Fly network-policy/probe, and local runtime to opaque lease acquisition/one-use consumption; each constructor requires either an injected resolver or explicit confined resolver inputs and never invents a default. The resolver zeroes temporary bytes after the callback and rejects expired/reused leases. Identity probe, each authoritative GET, and the consequential write acquire distinct one-use leases, and every lease descriptor must carry the same committed slot instance ID/version (with unexpired lease-specific expiry) or the Outcome refuses. Add `reelier authority setup native-https --route <file>` to register only non-secret route metadata and a credential slot ID, and `reelier authority doctor native-https --route <file>` to report `routeConfig: valid|invalid` and `credentialSlot: configured|missing` through `status`, without acquiring/resolving or printing the secret. The runbook states `valid` is parser/digest evidence only and `configured` proves only that the opaque slot name is present; neither means authenticated, verified, authorized, or account-bound.

- [ ] **Step 5: Run GREEN and repository reference checks**

Run: `npx tsc -p tsconfig.test.json && node --test --test-concurrency=1 dist-test/test/authority/secret-resolver.test.js dist-test/test/authority/config.test.js dist-test/test/authority/authority-serve.test.js dist-test/test/authority/json-https-driver.test.js dist-test/test/authority/json-https-connector.test.js dist-test/test/authority/founder-source-adapter.test.js dist-test/test/authority/fly-network-policy-client.test.js dist-test/test/authority/fly-remote-probe.test.js dist-test/test/authority/local-runtime.test.js dist-test/test/authority/founder-dispatch-adapter.test.js`

Run: `rg -n "createSecretResolver\(\)|\.resolve\((?:resource\.)?.*credentialRef|secretRef:" src/authority`

Expected: tests PASS and the search returns no production call site.

- [ ] **Step 6: Commit GREEN implementation and report**

```bash
git add src/authority/host/secret-resolver.ts src/authority/host/config.ts src/authority/cli.ts src/authority/drivers/json-https.ts src/authority/host/json-https-connector.ts src/authority/host/founder-source-adapter.ts src/authority/host/fly-network-policy-client.ts src/authority/host/fly-remote-probe.ts src/authority/host/local.ts src/authority/host/founder-dispatch-adapter.ts test/authority/secret-resolver.test.ts test/authority/config.test.ts test/authority/authority-serve.test.ts test/authority/json-https-driver.test.ts test/authority/json-https-connector.test.ts test/authority/founder-source-adapter.test.ts test/authority/fly-network-policy-client.test.ts test/authority/fly-remote-probe.test.ts test/authority/local-runtime.test.ts test/authority/founder-dispatch-adapter.test.ts .superpowers/sdd/2026-08-12-native-https-github-label-outcome/task-3-report.md
git commit -m "feat(authority): confine provider credential slots"
```

---

### Task 4: Bind the materialized request and conservative response semantics

**Files:**
- Create: `src/authority/host/prepared-dispatch.ts`
- Create: `src/authority/host/http-response-semantics.ts`
- Modify: `src/authority/drivers/json-https.ts`
- Modify: `src/authority/host/json-https-connector.ts`
- Create: `test/authority/prepared-dispatch.test.ts`
- Test: `test/authority/http-response-semantics.test.ts`
- Test: `test/authority/json-https-driver.test.ts`
- Test: `test/authority/json-https-connector.test.ts`
- Create: `.superpowers/sdd/2026-08-12-native-https-github-label-outcome/task-4-report.md`

**Interfaces:**
- Produces `MaterializedHttpRequestProjectionV1` and `materializedHttpRequestDigest(projection)`.
- `src/authority/host/prepared-dispatch.ts` owns transport-neutral opaque branded `PreparedDispatch` and `DispatchCommitLease`, their descriptions, and one joint `consumePreparedDispatch(prepared, commitLease)` operation. Transport adapters keep exact private send state behind `PreparedDispatch`; the authority/delegation commit boundary owns `DispatchCommitLease`; the generic coordinator never sees HTTPS request objects or credentials.
- `PreparedDispatchDescriptionV1` binds route digest, materialized-request digest, non-secret projection, `authorityGeneration`, semantic `authorityExpiresAt`, and the one monotonic `absoluteDeadlineMs`. `DispatchCommitLease` binds the same generation/deadlines, reservation, allocation, prepared digest, and durable dispatch-commit generation. Neither capability can be cloned, serialized, reused, or consumed alone.
- `prepareJsonHttpsDispatch(state, route, secretLease, deadline)` freezes the exact prepared semantic request (method, canonical origin/path/query, reviewed non-secret headers, and exact body bytes) and its private HTTPS send closure. It does not claim to freeze Node's eventual TLS framing, TCP segmentation, or full wire serialization.
- Produces `HttpResponseSemanticsProfileV1`, `parseHttpResponseSemanticsProfileV1`, and `classifyHttpResponse(profile, observation): "acknowledged" | "ambiguous"` for the GitHub labels route.
- Driver returns the non-secret projection/digest separately from reviewed response projections; it never returns request credentials or unreviewed response bytes to receipt code. No second materialization occurs between prepare and send.

- [ ] **Step 1: Write request-projection and response-matrix tests**

```ts
const projection: MaterializedHttpRequestProjectionV1 = {
  v: "reelier.materialized-http-request/v1",
  method: "PUT",
  origin: "https://api.github.com",
  normalizedPath: "/repos/fixlyai/reelier/issues/1/labels",
  normalizedQuery: "",
  reviewedHeaders: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
  bodyDigest: sha("body"),
};
assert.match(materializedHttpRequestDigest(projection), /^sha256:[0-9a-f]{64}$/);
```

Test every status class: reviewed `2xx` acknowledgement; every `3xx`, `4xx`, `5xx`, disconnect, malformed response, response overflow, and deadline after the send boundary is ambiguous. Assert `Location` is never followed, a consequential request is sent at most once, the exact prepared semantic request and body bytes cannot change between prepare and send, a prepared capability is single-use and non-serializable, stale `authorityGeneration`, semantic authority expiry, or monotonic deadline refuses before the send closure, and `Authorization`, cookies, proxy bearer, query secrets, and unreviewed headers/bodies never appear in the projection or result digest preimage.

- [ ] **Step 2: Run RED tests**

Run: `npx tsc -p tsconfig.test.json && node --test --test-concurrency=1 dist-test/test/authority/prepared-dispatch.test.js dist-test/test/authority/http-response-semantics.test.js dist-test/test/authority/json-https-driver.test.js dist-test/test/authority/json-https-connector.test.js`

Expected: FAIL because current connector treats all non-2xx responses as definitive failures and binds only request body bytes.

- [ ] **Step 3: Commit the RED tests**

```bash
git add test/authority/prepared-dispatch.test.ts test/authority/http-response-semantics.test.ts test/authority/json-https-driver.test.ts test/authority/json-https-connector.test.ts
git commit -m "test(authority): specify HTTP request and response evidence"
```

- [ ] **Step 4: Implement projection and semantics**

```ts
export interface MaterializedHttpRequestProjectionV1 {
  readonly v: "reelier.materialized-http-request/v1";
  readonly method: "POST" | "PUT" | "PATCH" | "DELETE";
  readonly origin: string;
  readonly normalizedPath: string;
  readonly normalizedQuery: string;
  readonly reviewedHeaders: Readonly<Record<string, string>>;
  readonly bodyDigest: string;
}

export interface HttpResponseSemanticsProfileV1 {
  readonly v: "reelier.http-response-semantics/v1";
  readonly profileId: string;
  readonly acknowledgedStatuses: readonly number[];
}

declare const preparedDispatchBrand: unique symbol;
declare const dispatchCommitLeaseBrand: unique symbol;
export interface PreparedDispatch { readonly [preparedDispatchBrand]: true }
export interface DispatchCommitLease { readonly [dispatchCommitLeaseBrand]: true }
export interface PreparedDispatchDescriptionV1 {
  readonly v: "reelier.prepared-dispatch-description/v1";
  readonly routeDigest: string;
  readonly materializedRequestDigest: string;
  readonly projection: MaterializedHttpRequestProjectionV1;
  readonly authorityGeneration: string;
  readonly authorityExpiresAt: string;
}
```

Normalize header names and query ordering before hashing; include only the route's reviewed non-secret headers. Preparation consumes the write-specific opaque lease inside the Cell, builds the final semantic request/body bytes once, stores them only in transport-private capability state, and returns the digest/projection/generation/expiries through the transport-neutral read-only description. Joint consumption first validates both opaque capabilities and their exact binding, then durably marks `send-started` under the same authority/delegation serialization used to mint the commit lease; only after that durable boundary releases does it delete both private capability states and invoke the send closure. If the driver cannot prove whether bytes crossed the consequential boundary, return ambiguous and rely on reconciliation; never resend automatically. A future definitive-not-applied result requires a separate provider-native operation-status design and is not inferred from HTTP status here.

- [ ] **Step 5: Run GREEN and no-resend tests**

Run: `npx tsc -p tsconfig.test.json && node --test --test-concurrency=1 dist-test/test/authority/prepared-dispatch.test.js dist-test/test/authority/http-response-semantics.test.js dist-test/test/authority/json-https-driver.test.js dist-test/test/authority/json-https-connector.test.js dist-test/test/authority/dispatch-coordinator.test.js`

Expected: PASS; every test fixture records at most one consequential send.

- [ ] **Step 6: Commit GREEN implementation and report**

```bash
git add src/authority/host/prepared-dispatch.ts src/authority/host/http-response-semantics.ts src/authority/drivers/json-https.ts src/authority/host/json-https-connector.ts test/authority/prepared-dispatch.test.ts test/authority/http-response-semantics.test.ts test/authority/json-https-driver.test.ts test/authority/json-https-connector.test.ts .superpowers/sdd/2026-08-12-native-https-github-label-outcome/task-4-report.md
git commit -m "feat(authority): bind native HTTP request semantics"
```

---

### Task 5: Join authority, authenticated account identity, route, and prepared send crash-safely

**Files:**
- Modify: `src/authority/ledger.ts`
- Modify: `src/authority/gate.ts`
- Modify: `src/authority/host/fs-ledger.ts`
- Modify: `src/authority/host/dispatch.ts`
- Modify: `src/authority/host/delegation-budget.ts`
- Modify: `src/authority/host/delegation-service.ts`
- Modify: `src/authority/host/json-https-connector.ts`
- Modify: `src/authority/host/composio-connector.ts`
- Modify: `src/authority/host/mcp-connector.ts`
- Modify: `src/authority/host/secret-adapters.ts`
- Create: `src/authority/host/github-account-identity.ts`
- Modify: `src/authority/host/local.ts`
- Modify: `src/authority/host/deploy.ts`
- Modify: `src/authority/host/certification-runner.ts`
- Test: `test/authority/gate.test.ts`
- Test: `test/authority/ledger.test.ts`
- Create: `test/authority/fs-ledger.test.ts`
- Test: `test/authority/dispatch-coordinator.test.ts`
- Test: `test/authority/delegation-budget.test.ts`
- Test: `test/authority/delegation-service.test.ts`
- Test: `test/authority/json-https-connector.test.ts`
- Test: `test/authority/composio-connector.test.ts`
- Test: `test/authority/mcp-connector.test.ts`
- Create: `test/authority/secret-adapters.test.ts`
- Create: `test/authority/github-account-identity.test.ts`
- Test: `test/authority/deploy.test.ts`
- Test: `test/authority/certification-runner.test.ts`
- Test: `test/authority/native-https-route-join.test.ts`
- Create: `.superpowers/sdd/2026-08-12-native-https-github-label-outcome/task-5-report.md`

**Interfaces:**
- Adds internal `routeAuthority?: RouteAuthoritySnapshotV1` to `ReservationIntent`/`StoredReservationIntent` and `DispatchRequestState.reservation.intent`. `FsAuthorityLedger` persists, reparses, and byte-compares it under the same atomic reservation publication; it is mandatory for the certified native HTTPS composition and absent on unchanged non-certified paths.
- Produces `AuthenticatedProviderIdentityV1` and `probeGitHubAccountIdentity({ route, secretLease, transport, signer })`. The reviewed GitHub `/user` probe binds provider, credential slot ID, opaque slot instance ID/version/expiry, authenticated login/account ID, observed time, route digest, and a purpose-separated Cell signature. Mismatch, expiry, substitution, or absence refuses before reservation.
- Replaces `DispatchAdapter.preflight + dispatch(state)` with `DispatchAdapter.prepare(state): Promise<PreparedDispatch>` and `DispatchAdapter.dispatch(prepared): Promise<DispatchOutcome>`. All existing adapters receive a minimal opaque preparation implementation; native HTTPS preparation freezes the exact route and request from Task 4.
- `createAuthorityGate` copies route authority only from the selected connector registration, authenticated provider identity, and canonical route registry owned by dependencies; it never reads route/account fields from `OutcomeRequest`.
- Produces `DispatchAuthorityRevalidator.revalidate(state): Promise<CurrentDispatchAuthorityV1>` with `authorityGeneration`, authority/grant/session/source/route digests, and semantic expiry. The coordinator validates once before preparation and a second time immediately after preparation; both results and the capability description must match.
- Produces `commitPreparedDispatch({ reservationId, expectedAuthorityGeneration, allocationId, preparedDescription, absoluteDeadlineMs }): Promise<DispatchCommitLease>`, implemented under the authority/delegation lock or an equivalent durable compare-and-set. It atomically compares current generation/expiry, consumes budget idempotently, commits `reserved -> dispatched`, and mints the opaque one-use lease bound to that exact prepared digest; a generation change cannot interleave between comparison and commitment.
- Produces `consumePreparedDispatch(prepared, commitLease)`. While still serialized against authority/delegation mutation, it validates both capability bindings and current generation/expiry/deadline, durably appends `send-started`, and consumes the commit lease. Only after the serialized boundary releases may the prepared transport closure run.

- [ ] **Step 1: Write ordering, restart, and substitution tests**

```ts
const events: string[] = [];
const adapter: DispatchAdapter = {
  async prepare(state) { events.push("prepare"); return createTestPreparedDispatch(state, sha("request")); },
  async dispatch(prepared) { events.push("send"); return consumeTestPreparedDispatch(prepared); },
};
await coordinator.dispatch(handle);
assert.deepEqual(events, ["route-reread", "authority-validation-before-prepare", "prepare", "authority-validation-after-prepare", "dispatch-commit-cas", "authority-send-boundary", "send-started", "send"]);
```

Instrument route publication/reread, authority generation, current authority/source validation, budget, ledger transition, secret lease, monotonic deadline, DNS, and send seams. For provider/connector/account/authenticated login/slot instance/version/expiry/origin/method/path-prefix/response-profile/reconciliation/read-endpoint/egress-policy substitutions, assert refusal before reservation or before prepared-capability consumption as appropriate. Reject absent, zero, legacy, extra-key, accessor, and malformed route snapshots without invoking getters.

Add controlled cuts and concurrent authority mutations: revocation/expiry during preparation; immediately after preparation before second revalidation; during atomic budget/dispatch commitment; after commit-lease minting before joint consumption; inside the serialized joint-consumption boundary before `send-started`; immediately after durable `send-started` before lock release; after lock release before the send closure; after provider apply; after response receipt; and after terminal publication. Revocation/expiry before durable `send-started` consumes neither send closure nor request bytes and yields zero sends. Once `send-started` is durable, revocation/expiry cannot cancel the already committed attempt; it becomes current-status/ambiguity evidence and recovery never resends. Before `dispatched`, deadline expiry cancels and returns budget exactly once; after `dispatched` but before `send-started`, deadline expiry records ambiguous with zero send and consumed budget; after `send-started`, deadline expiry records ambiguity and reconciliation remains allowed under its separate read deadline. No recovery path mints a new prepared capability or commit lease for a `dispatched` or `send-started` reservation.

- [ ] **Step 2: Run RED tests**

Run: `npx tsc -p tsconfig.test.json && node --test --test-concurrency=1 dist-test/test/authority/gate.test.js dist-test/test/authority/ledger.test.js dist-test/test/authority/fs-ledger.test.js dist-test/test/authority/dispatch-coordinator.test.js dist-test/test/authority/delegation-budget.test.js dist-test/test/authority/delegation-service.test.js dist-test/test/authority/json-https-connector.test.js dist-test/test/authority/composio-connector.test.js dist-test/test/authority/mcp-connector.test.js dist-test/test/authority/secret-adapters.test.js dist-test/test/authority/github-account-identity.test.js dist-test/test/authority/deploy.test.js dist-test/test/authority/certification-runner.test.js dist-test/test/authority/native-https-route-join.test.js`

Expected: FAIL because route authority is not persisted by the filesystem ledger, authenticated account identity is absent, and dispatch has no opaque prepared capability or explicit cut recovery.

- [ ] **Step 3: Commit the RED tests**

```bash
git add test/authority/gate.test.ts test/authority/ledger.test.ts test/authority/fs-ledger.test.ts test/authority/dispatch-coordinator.test.ts test/authority/delegation-budget.test.ts test/authority/delegation-service.test.ts test/authority/json-https-connector.test.ts test/authority/composio-connector.test.ts test/authority/mcp-connector.test.ts test/authority/secret-adapters.test.ts test/authority/github-account-identity.test.ts test/authority/deploy.test.ts test/authority/certification-runner.test.ts test/authority/native-https-route-join.test.ts
git commit -m "test(authority): specify authority runtime route join"
```

- [ ] **Step 4: Implement the route snapshot, identity join, prepared capability, and crash order**

```ts
export interface RouteAuthoritySnapshotV1 {
  readonly v: "reelier.route-authority-snapshot/v1";
  readonly connectorRegistrationDigest: string;
  readonly operatorConfigurationDigest: string;
  readonly routeDigest: string;
  readonly providerId: string;
  readonly connectorId: string;
  readonly accountId: string;
  readonly providerAccountIdentity: string;
  readonly endpointId: string;
  readonly authenticatedProviderIdentityDigest: string;
  readonly sourceReadRouteDigest: string;
  readonly projectionSchemaDigest: string;
  readonly expectedMaterializedRequestDigest: string;
  readonly authorityGeneration: string;
  readonly authorityExpiresAt: string;
}

export interface AuthenticatedProviderIdentityV1 {
  readonly v: "reelier.authenticated-provider-identity/v1";
  readonly providerId: "github";
  readonly credentialSlotId: string;
  readonly slotInstanceId: string;
  readonly slotVersion: string;
  readonly slotExpiresAt: string;
  readonly providerAccountId: string;
  readonly providerLogin: string;
  readonly routeDigest: string;
  readonly observedAt: string;
}

export interface CurrentDispatchAuthorityV1 {
  readonly authorityGeneration: string;
  readonly authorityExpiresAt: string;
  readonly authorityStateDigest: string;
  readonly sourceBundleDigest: string;
  readonly grantDigest: string;
  readonly runtimeSessionId: string;
  readonly routeAuthorityDigest: string;
}

export interface DispatchAdapter {
  prepare(state: DispatchRequestState): Promise<PreparedDispatch>;
  dispatch(prepared: PreparedDispatch): Promise<DispatchOutcome>;
  reconcile?(state: DispatchRequestState, outcome: DispatchOutcome): Promise<DispatchOutcome>;
}
```

At Outcome ingress create the one `TotalDeadline` before acquiring any credential lease. Before every gate reservation, acquire a dedicated identity-probe lease and call the reviewed authenticated GitHub identity probe; accept only the signed account identity committed by the Job Card/connector. Each source read and the later write preparation acquire their own one-use lease, all matching the same slot instance/version. Cache only immutable slot instance/version descriptors until their expiry; rerun the account probe for every Outcome and never cache provider identity results, revocation, grant/session, budget, SourceBundle, or provider post-state.

Construct one normalized route registry in `createLocalAuthorityRuntime` and inject it into connector registration, identity probe, source reads, gate, and dispatch. Require `connector.operatorConfigurationDigest === registry.connectorConfigurationDigest(...)`; independently recompute and bind the exact GET read route, provider account, complete projection pointers, and projection schema digest rather than inheriting them from the write route.

The coordinator order is normative: (1) read back the durable reservation and byte-compare `routeAuthority`; (2) perform `authority-validation-before-prepare` over current grant, child/session, revocation/expiry, route, authenticated identity, fresh SourceBundle, and authority generation; (3) `adapter.prepare(state)` creates one transport-neutral opaque capability without network send, binding the same generation, semantic expiry, and original ingress-created absolute deadline; (4) perform `authority-validation-after-prepare` and require byte-identical current authority/generation plus a prepared description equal to the durable route/request digests; (5) `dispatch-commit-cas` calls `commitPreparedDispatch` under the authority/delegation lock or equivalent CAS, atomically compares generation/expiry/deadline, consumes budget, commits `reserved -> dispatched`, and returns one opaque `DispatchCommitLease`; (6) `authority-send-boundary` jointly consumes prepared and commit capabilities while still serialized against revocation/expiry, durably marks `send-started`, then releases serialization and invokes the private send closure; (7) publish result/ambiguity and terminal transition. Revocation/expiry before `send-started` yields zero send; after `send-started` it cannot cancel the committed attempt and yields ambiguity/current-status evidence with no resend. The monotonic dispatch deadline is process-local capability state and is never reconstructed after restart; post-dispatch reconciliation uses a separately bounded read deadline and follows durable reservation/send state.

- [ ] **Step 5: Run GREEN and ordering tests**

Run: `npx tsc -p tsconfig.test.json && node --test --test-concurrency=1 dist-test/test/authority/gate.test.js dist-test/test/authority/ledger.test.js dist-test/test/authority/fs-ledger.test.js dist-test/test/authority/dispatch-coordinator.test.js dist-test/test/authority/delegation-budget.test.js dist-test/test/authority/delegation-service.test.js dist-test/test/authority/json-https-connector.test.js dist-test/test/authority/composio-connector.test.js dist-test/test/authority/mcp-connector.test.js dist-test/test/authority/secret-adapters.test.js dist-test/test/authority/github-account-identity.test.js dist-test/test/authority/deploy.test.js dist-test/test/authority/certification-runner.test.js dist-test/test/authority/native-https-route-join.test.js`

Expected: PASS; `FsAuthorityLedger` round-trips the route snapshot exactly, identity mismatches reserve nothing, every cut converges under the stated recovery rule, and no dispatched reservation sends twice.

- [ ] **Step 6: Commit GREEN implementation and report**

```bash
git add src/authority/ledger.ts src/authority/gate.ts src/authority/host/fs-ledger.ts src/authority/host/dispatch.ts src/authority/host/delegation-budget.ts src/authority/host/delegation-service.ts src/authority/host/json-https-connector.ts src/authority/host/composio-connector.ts src/authority/host/mcp-connector.ts src/authority/host/secret-adapters.ts src/authority/host/github-account-identity.ts src/authority/host/local.ts src/authority/host/deploy.ts src/authority/host/certification-runner.ts test/authority/gate.test.ts test/authority/ledger.test.ts test/authority/fs-ledger.test.ts test/authority/dispatch-coordinator.test.ts test/authority/delegation-budget.test.ts test/authority/delegation-service.test.ts test/authority/json-https-connector.test.ts test/authority/composio-connector.test.ts test/authority/mcp-connector.test.ts test/authority/secret-adapters.test.ts test/authority/github-account-identity.test.ts test/authority/deploy.test.ts test/authority/certification-runner.test.ts test/authority/native-https-route-join.test.ts .superpowers/sdd/2026-08-12-native-https-github-label-outcome/task-5-report.md
git commit -m "feat(authority): join authorized and runtime HTTPS routes"
```

---

### Task 6: Execute one native GitHub labels Outcome with authoritative read-back and separate cleanup

**Files:**
- Modify: `src/authority/cli.ts`
- Modify: `src/authority/host/server.ts`
- Modify: `src/authority/host/runtime.ts`
- Modify: `src/authority/host/local.ts`
- Modify: `src/authority/host/founder-dispatch-adapter.ts`
- Modify: `src/authority/host/founder-source-adapter.ts`
- Modify: `src/authority/host/source-read-adapter.ts`
- Modify: `src/authority/certification/github-issue-labels-runner.ts`
- Test: `test/authority/authority-serve.test.ts`
- Test: `test/authority/host-server.test.ts`
- Test: `test/authority/local-runtime.test.ts`
- Test: `test/authority/founder-dispatch-adapter.test.ts`
- Test: `test/authority/source-read-adapter.test.ts`
- Test: `test/authority/certification-github-issue-labels-runner.test.ts`
- Create: `test/authority/native-github-labels.test.ts`
- Create: `test/authority/native-github-labels-public-entry.test.ts`
- Create: `docs/authority/native-https-github-labels.md`
- Create: `.superpowers/sdd/2026-08-12-native-https-github-label-outcome/task-6-report.md`

**Interfaces:**
- Reuses `github_issue_labels_set_v1`, its compiled `PUT /repos/{owner}/{repo}/issues/{number}/labels`, and `reconcileGitHubIssueLabels`.
- Produces internal `createNativeGitHubLabelsComposition(...)` with injected route registry, confined secret resolver, transport, monotonic clock, and portable publication; it is not exported from public barrels.
- The public entry is the existing `reelier authority serve` MCP/HTTP Outcome ingress -> `createAuthorityServer` -> `createAuthorityHostRuntime` -> local Cell composition. No bespoke agent SDK or hidden certification constructor is required.
- Pre-read and post-read independently rejoin the signed account identity, exact GET route digest, read endpoint, complete declared projection `{ owner, repo, issueNumber, issueState, labels }`, and projection schema digest through the reviewed GitHub pack.

- [ ] **Step 1: Write the native lifecycle integration tests**

```ts
const applied = await composition.run({ requestId: "native_apply_1", choices: { labels: ["triaged"] } });
assert.equal(applied.kind, "acknowledged");
assert.equal(applied.reconciliationStatus, "matched");
assert.deepEqual(await provider.labels(), ["triaged"]);
const cleaned = await composition.cleanup({ requestId: "native_apply_1.cleanup", parentRequestId: "native_apply_1" });
assert.equal(cleaned.reconciliationStatus, "matched");
assert.deepEqual(await provider.labels(), beforeLabels);
```

The test server must bind loopback only through an injected test transport, never by weakening production public-address checks. Cover exact pre-read, identity/read-route/account/schema/projection drift before reservation, one PUT, `2xx` without matching read-back, every post-send non-`2xx`, disconnect after apply, restart then reconciliation without resend, read-back equal to pre-state remaining ambiguous with budget consumed, conflicting read-back, revocation between pre-read and dispatch, duplicate request/effect, and cleanup ambiguity. Assert apply and cleanup each have their own reservation/allocation event/receipt chain and no case exceeds one PUT per reservation.

Add black-box public-entry tests that launch the real Authority server with an injected deterministic native provider. In isolated fixtures, invoke `github_issue_labels_set_v1` once through the existing MCP Outcome ingress and once through the existing HTTP Outcome ingress, read status/receipt through the public runtime, and perform separately authorized cleanup. Assert setup and doctor require only the non-secret route file plus opaque slot ID, a missing slot yields one actionable refusal before reservation, and report named-host compatibility for Grok/Eve/Hermes/Claude Code/Codex as `unchecked`.

- [ ] **Step 2: Run RED tests**

Run: `npx tsc -p tsconfig.test.json && node --test --test-concurrency=1 dist-test/test/authority/native-github-labels.test.js dist-test/test/authority/native-github-labels-public-entry.test.js dist-test/test/authority/authority-serve.test.js dist-test/test/authority/host-server.test.js dist-test/test/authority/local-runtime.test.js dist-test/test/authority/founder-dispatch-adapter.test.js dist-test/test/authority/source-read-adapter.test.js dist-test/test/authority/certification-github-issue-labels-runner.test.js`

Expected: FAIL because the certification lifecycle is hermetic-only and native dispatch is not route-joined.

- [ ] **Step 3: Commit the RED tests**

```bash
git add test/authority/native-github-labels.test.ts test/authority/native-github-labels-public-entry.test.ts test/authority/authority-serve.test.ts test/authority/host-server.test.ts test/authority/local-runtime.test.ts test/authority/founder-dispatch-adapter.test.ts test/authority/source-read-adapter.test.ts test/authority/certification-github-issue-labels-runner.test.ts
git commit -m "test(authority): specify native GitHub label lifecycle"
```

- [ ] **Step 4: Implement the native composition**

```ts
interface NativeGitHubLabelsComposition {
  run(input: Readonly<{ requestId: string; choices: Readonly<{ labels: readonly string[] }> }>): Promise<DispatchOutcome>;
  reconcile(reservationId: string): Promise<DispatchOutcome>;
  cleanup(input: Readonly<{ requestId: string; parentRequestId: string }>): Promise<DispatchOutcome>;
  exportGraph(): Promise<CertificationTaskReceiptGraphV1>;
}
```

Perform authenticated identity probing and authoritative GET before gate compilation, the gate's second source read under current authority, one sealed PUT, and an independently route/account/schema-rejoined authoritative GET reconciliation. On any ambiguous provider result, persist ambiguity and call reconciliation without resending. If the observed state equals the pre-state rather than the expected post-state, retain ambiguity/conflict and consumed budget; do not infer not-applied. Cleanup derives labels only from the signed committed pre-state evidence, creates a new Outcome request and reservation, consumes its own budget, sends once, and reconciles independently.

Wire the composition through the existing server/runtime factory and document the exact generic user flow in `docs/authority/native-https-github-labels.md`: configure a non-secret route and opaque slot; run doctor; create/approve the scoped Job Card and child allocation using the existing ceremony; start the Linux Cell; invoke the existing MCP or HTTP Outcome; inspect status/portable receipt; run separately authorized cleanup. The runbook says `liveProviderStatus: absent` for the hermetic packed path and never tells a user to paste a token into a prompt, agent memory, or command argument.

- [ ] **Step 5: Run GREEN plus existing hermetic lifecycle tests**

Run: `npx tsc -p tsconfig.test.json && node --test --test-concurrency=1 dist-test/test/authority/native-github-labels.test.js dist-test/test/authority/native-github-labels-public-entry.test.js dist-test/test/authority/authority-serve.test.js dist-test/test/authority/host-server.test.js dist-test/test/authority/local-runtime.test.js dist-test/test/authority/founder-dispatch-adapter.test.js dist-test/test/authority/source-read-adapter.test.js dist-test/test/authority/certification-github-issue-labels-runner.test.js`

Expected: PASS; the old hermetic runner remains green and the native fixture never resends after ambiguity.

- [ ] **Step 6: Commit GREEN implementation and report**

```bash
git add src/authority/cli.ts src/authority/host/server.ts src/authority/host/runtime.ts src/authority/host/local.ts src/authority/host/founder-dispatch-adapter.ts src/authority/host/founder-source-adapter.ts src/authority/host/source-read-adapter.ts src/authority/certification/github-issue-labels-runner.ts test/authority/authority-serve.test.ts test/authority/host-server.test.ts test/authority/local-runtime.test.ts test/authority/founder-dispatch-adapter.test.ts test/authority/source-read-adapter.test.ts test/authority/certification-github-issue-labels-runner.test.ts test/authority/native-github-labels.test.ts test/authority/native-github-labels-public-entry.test.ts docs/authority/native-https-github-labels.md .superpowers/sdd/2026-08-12-native-https-github-label-outcome/task-6-report.md
git commit -m "feat(authority): execute native GitHub label outcomes"
```

---

### Task 7: Extend portable receipts with route, request, post-state, and cleanup evidence

**Files:**
- Create: `src/authority/host/portable-receipts.ts`
- Modify: `src/authority/certification/lifecycle-receipts.ts`
- Modify: `src/authority/certification/task-receipt-graph.ts`
- Modify: `src/authority/host/local.ts`
- Modify: `src/authority/verify.ts`
- Modify: `contract/certification/v1/task-receipt-graph.schema.json`
- Test: `test/authority/portable-receipts.test.ts`
- Test: `test/authority/certification-github-issue-labels-runner.test.ts`
- Test: `test/authority/native-github-labels.test.ts`
- Test: `test/authority/artifacts.test.ts`
- Test: `test/authority/contract.test.ts`
- Create: `.superpowers/sdd/2026-08-12-native-https-github-label-outcome/task-7-report.md`

**Interfaces:**
- Produces a generic internal `createPortableAuthorityReceiptPublication(...)`; `createCertificationLifecycleReceiptPublication(...)` becomes a certification wrapper over it.
- Adds certification extension records for `routeAuthority`, `authenticatedProviderIdentity`, `materializedRequest`, `preState`, `postState`, `responseSemantics`, `cleanupParent`, and the separate evidence-source/attestation-signer roles; Adapter Contract v1 remains untouched.
- Offline verification recomputes every digest and rejects missing, substituted, forked, reordered, false-`exact`, or self-anchored evidence.

- [ ] **Step 1: Write portable-evidence and tamper tests**

```ts
const verified = verifyCertificationTaskReceiptGraph(graph, { trustPin });
assert.equal(verified.status, "verified");
assert.throws(() => verifyCertificationTaskReceiptGraph(mutate(graph, "/routeAuthority/routeDigest"), { trustPin }), /route|digest/i);
assert.throws(() => verifyCertificationTaskReceiptGraph(mutate(graph, "/postState/confidence", "exact"), { trustPin }), /comparable|exact/i);
```

Model provenance without inventing independent signers: GitHub is the authoritative post-state source; the Authority Cell's purpose-separated `authority-evidence` key signs the observation/receipt assertion; the same Cell may sign both execution and reconciliation attestations. `exact` depends on a reviewed authoritative GitHub state endpoint, independent read-route/account/schema join, comparable complete pre/post projections, and valid Cell attestation—not on falsely claiming GitHub signed Reelier's receipt or that two Cell keys are independent parties. Bind the signed Job Card/task/trigger/intent, root-to-child grant/session, allocation/budget, permit snapshot, authenticated identity, connector/write-route/read-route digests, materialized non-secret request, reviewed provider acknowledgement projection, exact pre/post schema/projection, policy status, cleanup parent/pre-state, receipt chain, status at the signed revocation observation time, and Adapter Contract extension. Later current revocation remains `unchecked` without a separately trusted newer status proof. Add secret canaries and assert no raw URL query, credential slot mapping, secret reference/value, authorization/cookie header, or response body escapes.

- [ ] **Step 2: Run RED tests**

Run: `npx tsc -p tsconfig.test.json && node --test --test-concurrency=1 dist-test/test/authority/portable-receipts.test.js dist-test/test/authority/certification-github-issue-labels-runner.test.js dist-test/test/authority/native-github-labels.test.js dist-test/test/authority/artifacts.test.js dist-test/test/authority/contract.test.js`

Expected: FAIL because route/materialized-request/native post-state extensions are absent.

- [ ] **Step 3: Commit the RED tests**

```bash
git add test/authority/portable-receipts.test.ts test/authority/certification-github-issue-labels-runner.test.ts test/authority/native-github-labels.test.ts test/authority/artifacts.test.ts test/authority/contract.test.ts
git commit -m "test(authority): specify portable native HTTPS evidence"
```

- [ ] **Step 4: Implement generic publication and verification extensions**

```ts
export interface PortableOutcomeEvidenceV1 {
  readonly v: "reelier.portable-outcome-evidence/v1";
  readonly routeAuthorityDigest: string;
  readonly materializedRequestDigest: string;
  readonly responseSemanticsProfileDigest: string;
  readonly preStateEvidenceDigest: string;
  readonly postStateEvidenceDigest: string;
  readonly confidence: "exact" | "partial" | "pending" | "absent";
  readonly authoritativeStateSource: "hermetic-github-fixture" | "github-api";
  readonly executionAttestationSignerId: string;
  readonly reconciliationAttestationSignerId: string;
  readonly attestationSignerRelationship: "same-authority-cell";
  readonly cleanupParentReceiptDigest: string | null;
}
```

Require opaque, purpose-bound authority-evidence/receipt signers rooted in the activated trust pin. `createLocalAuthorityRuntime` accepts an injected portable publication but does not manufacture self-anchored trust. Verify all collection counts and terminal digests and preserve Task 4A current-state, policy, duplicate, and post-state semantics.

- [ ] **Step 5: Run GREEN, frozen-contract, and package checks**

Run: `npm run check:authority-contract`

Run: `npx tsc -p tsconfig.test.json && node --test --test-concurrency=1 dist-test/test/authority/portable-receipts.test.js dist-test/test/authority/certification-github-issue-labels-runner.test.js dist-test/test/authority/native-github-labels.test.js dist-test/test/authority/artifacts.test.js dist-test/test/authority/contract.test.js`

Expected: PASS; Adapter Contract digest remains `sha256:7f46242b26d9c921f4e1ec9de6418ac5fc8c03d70c4415c25e799ae0e73a1512` and no `contract/authority/v1/` bytes change.

- [ ] **Step 6: Commit GREEN implementation and report**

```bash
git add src/authority/host/portable-receipts.ts src/authority/certification/lifecycle-receipts.ts src/authority/certification/task-receipt-graph.ts src/authority/host/local.ts src/authority/verify.ts contract/certification/v1/task-receipt-graph.schema.json test/authority/portable-receipts.test.ts test/authority/certification-github-issue-labels-runner.test.ts test/authority/native-github-labels.test.ts test/authority/artifacts.test.ts test/authority/contract.test.ts .superpowers/sdd/2026-08-12-native-https-github-label-outcome/task-7-report.md
git commit -m "feat(authority): verify portable native HTTPS evidence"
```

---

### Task 8: Measure a critical-path baseline and certify the exact tarball

**Files:**
- Create: `src/authority/host/latency.ts`
- Create: `src/authority/certification/evaluation.ts`
- Modify: `src/authority/gate.ts`
- Modify: `src/authority/host/dispatch.ts`
- Modify: `src/authority/drivers/json-https.ts`
- Modify: `src/authority/certification/factory-release-evidence.ts`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Create: `test/authority/latency.test.ts`
- Modify: `test/authority/native-github-labels.test.ts`
- Modify: `test/authority/factory-release-evidence.test.ts`
- Create: `test/packed/native-github-labels.mjs`
- Create: `docs/release/native-https-github-label-baseline.md`
- Create: `.superpowers/sdd/2026-08-12-native-https-github-label-outcome/task-8-report.md`

**Interfaces:**
- Produces `AuthorityLatencyTraceV1`, `AuthorityLatencyPhase`, `createAuthorityLatencyRecorder({ monotonicNow })`, and `evaluateLatencyEvidence(samples)`.
- Required phases are `authority-load`, `identity-probe`, `source-pre-read`, `compile`, `reserve`, `route-reread`, `authority-validation-before-prepare`, `prepare`, `credential`, `authority-validation-after-prepare`, `dispatch-commit-cas`, `authority-send-boundary`, `dns`, `connect`, `tls`, `upload`, `response-headers`, `response-body`, `reconcile-read`, `receipt-publish`, and `terminal-transition`.
- Setup/ceremony duration is emitted by the setup/tour surface as separate evidence and is never inferred from dispatch timestamps.

- [ ] **Step 1: Write deterministic phase and critical-path tests**

```ts
const trace = recorder.finish();
assert.deepEqual(trace.phases.map(item => item.name), expectedPhaseOrder);
assert.equal(trace.phases.every(item => item.durationMs >= 0), true);
assert.equal(trace.modelCalls, 0);
assert.equal(trace.reviewerCalls, 0);
assert.equal(trace.graphExportsOnCriticalPath, 0);
```

Inject a monotonic clock and phase hooks. Assert route mismatch stops before budget/credential/DNS, acknowledgement without reconciliation cannot pass, graph export/report construction occurs after the terminal transition, immutable route/profile/pack verification can be cached while revocation/budget/source/provider state is re-read, and metrics contain no origin path/query, headers, bodies, account names, credential slots/references/values, provider response content, or identifiers that could reconstruct them.

- [ ] **Step 2: Run RED tests**

Run: `npx tsc -p tsconfig.test.json && node --test --test-concurrency=1 dist-test/test/authority/latency.test.js dist-test/test/authority/native-github-labels.test.js dist-test/test/authority/factory-release-evidence.test.js`

Expected: FAIL because phase evidence and evaluation do not exist.

- [ ] **Step 3: Commit the RED tests**

```bash
git add test/authority/latency.test.ts test/authority/native-github-labels.test.ts test/authority/factory-release-evidence.test.ts test/packed/native-github-labels.mjs
git commit -m "test(authority): specify native Outcome latency evidence"
```

- [ ] **Step 4: Implement phase recording without adding critical-path work**

```ts
export type AuthorityLatencyPhase =
  | "authority-load" | "identity-probe" | "source-pre-read" | "compile" | "reserve"
  | "route-reread" | "authority-validation-before-prepare" | "prepare" | "credential"
  | "authority-validation-after-prepare" | "dispatch-commit-cas" | "authority-send-boundary"
  | "dns" | "connect" | "tls" | "upload"
  | "response-headers" | "response-body" | "reconcile-read" | "receipt-publish" | "terminal-transition";

export interface AuthorityLatencyTraceV1 {
  readonly v: "reelier.authority-latency-trace/v1";
  readonly phases: readonly Readonly<{ name: AuthorityLatencyPhase; durationMs: number }>[];
  readonly totalMs: number;
  readonly modelCalls: 0;
  readonly reviewerCalls: 0;
  readonly graphExportsOnCriticalPath: 0;
}
```

Record monotonic durations in memory and publish only sanitized aggregate phase data after the terminal ledger transition. `evaluateLatencyEvidence` reports sample count and p50/p95/p99 when the configured minimum sample count is met; before that it returns `baselineStatus: "insufficient-samples"` and no SLO verdict.

- [ ] **Step 5: Establish and publish the baseline without an SLO**

Run the hermetic/injected-transport benchmark from the exact packed tarball on Ubuntu and the Windows offline/client path. Record hardware/runner class, Node version, commit, tarball SHA-256, sample count, phase percentiles, operation counts, and variance in `docs/release/native-https-github-label-baseline.md`. Do not include provider network time in the deterministic regression gate.

The baseline artifact explicitly contains `sloStatus: "absent"` and `regressionBudgetStatus: "absent"`. CI gates only phase ordering, maximum operation counts, absence of forbidden work, and honesty of the measurement artifact. A numeric SLO or regression budget requires a later independently reviewed plan amendment after this baseline exists.

- [ ] **Step 6: Run GREEN, packed, and full release gates**

Run: `npm run check:authority-contract`

Run: `npm run build`

Run: `npx tsc -p tsconfig.test.json && node --test --test-concurrency=1 dist-test/test/authority/latency.test.js dist-test/test/authority/native-github-labels.test.js dist-test/test/authority/factory-release-evidence.test.js`

Run: `npm pack --json`

Run the tarball path with: `node test/packed/native-github-labels.mjs <absolute-tarball-path>` on Ubuntu through the real generic MCP/HTTP Outcome ingress; pass only its public evidence bundle to the Windows job for offline verification and native-host refusal. The hermetic run records `liveProviderStatus: "absent"` and named-host conformance `unchecked`.

Run: `npm test`

Run: `git diff --check`

Expected: all gates PASS on the exact tarball; Ubuntu performs the Linux Cell lifecycle, Windows performs client/offline verification only, and the hosted Windows ledger check is green without retry masking.

- [ ] **Step 7: Independent review and GREEN commit**

Obtain independent reviews for: spec compliance; route/budget/network ordering; credential non-disclosure; ambiguity/no-resend behavior; authoritative pre/post comparability; cleanup independence; portable trust roots; latency methodology; package contents; and claims/non-claims. Record reviewer verdicts and exact commit/tarball/CI identifiers in the task report and signed factory release evidence.

```bash
git add src/authority/host/latency.ts src/authority/certification/evaluation.ts src/authority/gate.ts src/authority/host/dispatch.ts src/authority/drivers/json-https.ts src/authority/certification/factory-release-evidence.ts package.json .github/workflows/ci.yml test/authority/latency.test.ts test/authority/native-github-labels.test.ts test/authority/factory-release-evidence.test.ts test/packed/native-github-labels.mjs docs/release/native-https-github-label-baseline.md .superpowers/sdd/2026-08-12-native-https-github-label-outcome/task-8-report.md
git commit -m "feat(authority): certify native HTTPS outcome baseline"
```

## Completion criteria

- The exact packed artifact passes the existing Windows/Linux prerequisites, agent-neutral tour, native GitHub labels lifecycle, portable graph verification, and frozen Adapter Contract check.
- The route authorized by the gate is byte-equivalent under canonicalization to the route used by dispatch; any mismatch refuses before ledger dispatch transition, budget, credentials, DNS, or network.
- One native GitHub label replacement has exact comparable pre/post evidence for the complete declared labels projection, including ambiguity reconciliation without resend.
- Cleanup is a separately authorized, budgeted, dispatched, reconciled, and receipted restoration of the signed pre-state.
- Portable offline evidence binds accountable task and child/session lineage, authority state, route, materialized non-secret request, response semantics, provider observation, cleanup, policy status, and revocation observation without exposing credentials.
- Phase evidence proves no model, reviewer, package, graph-export, or Cloud work lies on the dispatch critical path. This plan records a baseline and makes no numeric SLO or regression-budget claim.
- Ubuntu hosts consequential execution. Windows remains a supported client and offline verifier and refuses native Authority Cell hosting before mutation.

## Permitted claims

- Reelier authorized and dispatched one sealed, non-secret GitHub label request projection through one committed native HTTPS route.
- If and only if a separately authorized disposable live-provider run records a reviewed `2xx` response and completes separately authorized cleanup, Reelier may say GitHub acknowledged that one request according to the reviewed endpoint response profile. Hermetic packed CI keeps this claim `absent`.
- The complete declared GitHub issue-label projection matched the authorized expectation when separately authoritative read-back verified it.
- The covered task, grant/session, budget, dispatch, observation, cleanup, and receipt links verify offline for this declared Outcome graph.
- The measured critical path has the phase and operation-count properties recorded for the exact tested tarball and runner class.

## Required non-claims

- Do not claim the label choice was safe, correct, wise, complete, or free of hidden provider side effects.
- Do not claim `2xx` proves durable post-state, delivery, exactly-once external behavior, or application correctness.
- Do not claim receipts cover bypass HTTP, arbitrary GUI/browser work, plugins, other agents, the whole GitHub account, or every write.
- Do not claim authentication/session possession, a credential slot, payment, sandboxing, repeatable skills, reviewer approval, or a successful short-term track record grants scoped authority.
- Do not claim the Linux Cell proves external-effect isolation beyond the named governed exit.
- Do not claim platform-wide Grok, Eve, Hermes, Claude Code, Codex, or other host compatibility from this native transport plan; those claims require their separate executable conformance evidence.
- Do not claim a numeric latency SLO until the reviewed baseline and regression-budget amendment are committed.
