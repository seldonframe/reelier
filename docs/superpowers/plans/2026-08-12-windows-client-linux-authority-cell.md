# Windows Client and Linux Authority Cell Implementation Plan

> **Founder-locked 2026-08-12.** Implement with `superpowers:subagent-driven-development`, one fresh worker and one independent reviewer per task. Use TDD and separate RED/GREEN commits. Do not revive the Node FIFO or native-helper alternatives.

**Goal:** In this increment, keep Windows fully supported for Reelier preparation, Authority Cell connection/identity validation, host refusal, and offline verification while reservation, dispatch coordination, credentials, reconciliation, and receipt minting run inside a Linux Authority Cell whose filesystem and process invariants are enforceable. A live consequential Windows-to-Linux dispatch client remains a later, separately certified increment.

**Architecture:** Public contracts, client configuration, preparation, agent adapters, and offline verification remain substrate-neutral. Authority-bearing commands fail before mutation on non-Linux hosts and direct the operator to configure and validate a Linux Cell; this increment does not claim a live remote consequential dispatch route. Adapter Contract v1 freezes the exact substrate-neutral wire boundary. A Linux-hosted hermetic GitHub-label lifecycle exercises genuine Cell authority/budget/ledger/reconciliation/cleanup without provider credentials or external network calls, exports a complete signed graph, and verifies it offline on Ubuntu and Windows.

**Non-goals:** Native Windows Authority Cell hosting; Node FIFO admission; Rust/Win32 helpers; weaker pathname validation; live-provider credentials; provider SDK calls; vendor-specific transport or an Outcome before the contract freeze.

**Evidence-guided amendment (founder-approved 2026-08-12):** A published large open-source maintenance factory reports operating a task-specialized, isolated workflow with risk-scaled human review and documented evidence, together with throughput and backlog results. We infer only as a thesis signal that this workflow shape may improve reviewer leverage; it is not evidence of Reelier demand, Reelier-style reconciliation, causal uplift, cryptographic completeness, or Outcomes per reviewer. Other supplied onboarding examples are thesis signals for an optional default agent, terminal-native discovery, and an interactive path to first value. Named provenance and strategic interpretation remain in the private evidence lane. These signals do not authorize a write, prove demand, privilege a vendor, or change the Foundation boundary. This plan therefore adds a factory-shaped packed journey without broadening Task 4, while a separate dependent plan owns the agent-neutral guided tour.

## Global constraints

- Work only in `C:\Users\maxim\CascadeProjects\reelier\.worktrees\outcomes-delegation-infra`.
- Preserve and do not stage the interrupted native scaffold (`.gitignore`, `native/`, `rust-toolchain.toml`), unrelated certification stat-only paths, and `.tmp-pack/`.
- Do not rewrite or squash the historical FIFO/native commits. This plan supersedes them prospectively.
- Linux behavior must not be weakened to make Windows pass. Windows hosting refuses; Windows client and offline verification pass.
- Every refusal is deterministic, typed, redacted, and occurs before filesystem, key, principal, budget, ledger, receipt, provider, or network mutation.
- No credential value is accepted by a connection file. Only closed `env:` or confined `file:` references are stored. Connection metadata is public and non-authorizing: on Windows its pathname is not evidence of same-user filesystem confinement, and it can never supply task, principal, grant, allocation, or session authority.
- Ordinary certification readiness remains non-dispatchable until a host-internal implemented runner and executed evidence exist.
- A provider acknowledgement is not authoritative reconciliation. Ambiguous writes retain consumption and are never resent automatically.
- `verified` means the named evidence verified; it never means safe, correct, wise, complete, or successful.
- Each task ends with focused tests, TypeScript compile, authority-contract drift, build, an independent read-only review, and a task report before the next task begins.

## Files and ownership map

- Contract freeze: `contract/authority/v1/adapter-contract-v1.json`, `scripts/build-authority-contract.mjs`, `test/authority/contract.test.ts`, `src/authority/adapter-contract.ts`, `src/authority/index.ts`.
- Platform boundary: `src/authority/host/platform.ts`, `src/authority/cli.ts`, `src/authority/host/local.ts`, certification host entry points, focused platform tests.
- Windows client: `src/authority/client/config.ts`, `src/authority/client/http.ts`, `src/authority/cli.ts`, a minimal authenticated identity route in `src/authority/ingress/http.ts` and host/server composition, closed non-authorizing client schema under `contract/client/v1/`, client tests and runbook. Client configuration is deliberately outside the frozen Adapter Contract v1 wire set.
- Retired code: delete tracked `src/authority/host/windows-k1-fifo.ts` and `test/authority/windows-k1-fifo.test.ts` only after source-graph tests prove there is no production import.
- Hermetic lifecycle: `src/authority/certification/github-issue-labels-runner.ts`, receipt/graph modules under `src/authority/certification/`, the minimal genuine-Cell authority binding in `src/authority/certification/cell.ts`, and a non-package-exported verification-first signed-child registration seam in `src/authority/host/delegation-service.ts`; corresponding tests and certification-local schemas.
- CI/release evidence: `.github/workflows/ci.yml`, packed-artifact tests, task reports, freeze notice containing the exact digest.

---

### Task 1: Freeze Adapter Contract v1 and golden vectors

**Files touched (closed historical scope):** `.gitattributes`, `contract/authority/v1/adapter-contract-v1.json`, `package.json`, `scripts/build-authority-contract.mjs`, `src/authority/adapter-contract-template.ts`, `src/authority/adapter-contract.ts`, `src/authority/index.ts`, `test/authority/contract.test.ts`, and `.superpowers/sdd/2026-08-12-windows-client-linux-authority-cell/task-1-report.md`.

**Outcome:** One canonical, nonzero digest identifies the complete public adapter/wire contract independently of its host OS.

- [ ] Add RED tests proving the contract set has a closed manifest, sorted unique members, an exact version, per-file SHA-256 digests, a golden-vector digest, and a nonzero aggregate digest. Mutation, omission, duplicate paths, reordered members, path traversal, self-inclusion, and stale generated output must refuse.
- [ ] Generate `contract/authority/v1/adapter-contract-v1.json` deterministically. Its aggregate digest is over a domain-separated canonical payload that excludes the aggregate digest field itself, avoiding a digest cycle.
- [ ] Include every public v1 authority schema and `golden-vectors.json`; exclude certification-local/internal files only if the exclusion is explicit and tested. Do not infer membership from filesystem enumeration at verification time.
- [ ] Add a narrow substrate-neutral reader/verifier and export only the frozen descriptor/digest needed by clients and receipts. Export no runner, credential, filesystem, or provider behavior.
- [ ] Run regeneration twice and prove byte stability. Run tamper tests against a copied contract directory.
- [ ] Independently review the exact public surface, manifest membership, canonicalization, domain separation, golden vectors, and nonzero digest. Record the approved digest; do not prepare downstream-consumer evidence yet.

Verification:

```powershell
npx tsc -p tsconfig.test.json --pretty false
node --test --test-concurrency=1 dist-test/test/authority/contract.test.js
npm run check:authority-contract
npm run build
```

---

### Task 2: Enforce the Linux Authority Cell boundary and retire Windows FIFO

**Files touched (closed historical scope):** `src/authority/certification/cell.ts`, `src/authority/certification/github-issue-labels-runner.ts`, `src/authority/cli.ts`, `src/authority/host/delegation-service.ts`, `src/authority/host/dispatch.ts`, `src/authority/host/egress-gateway.ts`, `src/authority/host/local.ts`, `src/authority/host/platform.ts`, `src/authority/host/receipts.ts`, `src/authority/host/runtime.ts`, `src/authority/host/server.ts`, deletion of `src/authority/host/windows-k1-fifo.ts`, `test/authority/authority-serve.test.ts`, `test/authority/init.test.ts`, `test/authority/linux-authority-cell.test.ts`, `test/authority/local-e2e.test.ts`, deletion of `test/authority/windows-k1-fifo.test.ts`, and `.superpowers/sdd/2026-08-12-windows-client-linux-authority-cell/task-2-report.md`.

**Outcome:** A native Windows process cannot begin authority-bearing setup or execution, while all client/preparation/offline commands remain usable.

- [ ] Add RED tests for `authority init`, bootstrap, serve, root activation, dispatch host construction, and receipt-minting host construction on `win32`. Each must return the same typed `AUTHORITY_CELL_LINUX_REQUIRED` refusal before any write or secret/key/budget/ledger/provider access. Test the no-write boundary with counters and an empty temporary directory.
- [ ] Implement one closed `assertLinuxAuthorityCellHost()` boundary. Production reads `process.platform`; test substitution is private and cannot be body/config supplied. Invoke it at every authority-host entry point and again at the local runtime composition root.
- [ ] Keep `reelier init`, discovery, agent adapters, public contract verification, certification preflight, status/export, and offline receipt/graph verification cross-platform. Add explicit Windows tests for those allowed paths.
- [ ] Refusal text must state that Windows is supported as a client and give actionable WSL/container/remote Linux Cell guidance without embedding a secret or claiming automatic setup.
- [ ] Prove `src/authority/host/windows-k1-fifo.ts` has no production import. Delete that tracked module and its dedicated test. Do not stage or delete the interrupted untracked Rust/native scaffold in this task.
- [ ] Preserve the Linux ledger and mutex behavior byte-for-byte except for any import cleanup. Run Linux-focused ledger regression tests and public-export closure tests.

Verification includes a Windows-platform simulation on every OS and a native Linux happy path; hosted Windows CI remains required later.

---

### Task 3: Add the closed Windows-to-Linux Cell connection path

**Files touched (closed historical scope):** `contract/client/v1/authority-cell-connection.schema.json`, `docs/runbooks/authority-cell-client.md`, `docs/superpowers/plans/2026-08-12-windows-client-linux-authority-cell.md`, `src/authority/cli.ts`, `src/authority/client/config.ts`, `src/authority/client/http.ts`, `src/authority/client/ip.ts`, `src/authority/host/config.ts`, `src/authority/host/server.ts`, `src/authority/ingress/http.ts`, `test/authority/authority-cell-connection.test.ts`, `test/authority/http.test.ts`, and `.superpowers/sdd/2026-08-12-windows-client-linux-authority-cell/task-3-report.md`.

**Outcome:** A Windows user can configure and verify a Linux Authority Cell without copying provider credentials into the workspace or model context.

**Public data contract:**

```ts
interface AuthorityCellConnectionV1 {
  readonly v: "reelier.authority-cell-connection/v1";
  readonly endpoint: string;          // HTTPS, or loopback HTTP for local WSL/container development
  readonly transport: "http";
  readonly bearerTokenRef: `env:${string}` | `file:${string}`;
  readonly expectedCellId: string;
  readonly adapterContractDigest: `sha256:${string}`;
}
```

- [ ] Add a closed JSON Schema under `contract/client/v1/` and runtime parser with exact keys, canonical endpoint normalization, no query/userinfo/fragment, no non-loopback HTTP, safe reference syntax, nonzero digest, and accessor/callback zero-invocation tests. This local, non-authorizing configuration schema is not a member of the frozen Adapter Contract wire set and must not change its digest.
- [ ] Add `reelier authority connect --endpoint ... --token-ref ... --cell-id ...`. It writes only public, non-authorizing connection metadata atomically and never resolves the token during parsing or writes a ledger/receipt/key. Native Windows restricts persistence to the canonical user client-config location and reports same-user pathname confinement as `unchecked`; it must not recreate the rejected native filesystem helper.
- [ ] Add `reelier authority doctor --live` (or the existing doctor integration if present) to resolve the opaque reference inside the client process, authenticate to the Cell, compare Cell ID and Adapter Contract digest, and report four-state results. Redact token values and resolver errors.
- [ ] Add one authenticated, read-only `GET /v1/identity` Cell route returning only the closed Cell ID and Adapter Contract digest. It performs no writes and reveals nothing to unauthenticated callers.
- [ ] Any future consequential client request must bind to the authenticated server-derived principal/session context. No task, principal, grant, allocation, or Cell identity may be supplied in the Outcome body.
- [ ] Add an exact compatibility refusal for contract-digest mismatch. The client may still perform status/export/offline verification, but it may not request consequential dispatch.
- [ ] Document three starts: local WSL, local Linux container, and remote/Fly Linux Cell. Keep the default path one command after the Cell endpoint and token reference exist.

Security tests cover config substitution, symlinked token files, DNS/URL confusion, redirect refusal, bearer leakage in errors/logs, stale Cell identity, stale contract digest, unauthenticated ingress, and body-supplied identity rejection.

---

### Task 4: Complete the hermetic GitHub-label lifecycle through the Linux Cell

**Files touched (closed scope):** `src/authority/certification/cell.ts`, `src/authority/certification/filesystem.ts`, `src/authority/certification/github-issue-labels-runner.ts`, `src/authority/certification/lifecycle-authority.ts`, `src/authority/certification/lifecycle-receipts.ts`, `src/authority/certification/task-receipt-graph.ts`, `src/authority/host/delegation-service.ts`, `test/authority/certification-cell.test.ts`, `test/authority/certification-github-issue-labels-runner.test.ts`, `test/authority/certification-lifecycle-authority.test.ts`, `test/authority/delegation-service.test.ts`, `test/authority/linux-authority-cell.test.ts`, and `.superpowers/sdd/2026-08-12-windows-client-linux-authority-cell/task-4-report.md`. Expanding this list requires a plan amendment and review before code.

**Outcome:** The first complete certification scenario exercises genuine authority and recovery with zero provider credentials, zero provider SDK calls, and zero external network access; purpose-separated authority signing keys remain opaque and confined inside the Cell.

- [ ] Extend the existing branded Cell-internal GitHub runner; do not expose an executable callback, provider port, ledger, budget, signer, or fault injector through a public constructor or per-call input.
- [ ] Bind the frozen Adapter Contract digest, exact operator config, signed Job Card, root/child grant, principal session, allocation, endpoint manifest, scenario plan, desired labels, and hermetic runner identity before permit issuance.
- [ ] Model the hermetic provider as durable in-Cell state with authoritative reads. Support exact apply, a controlled cut after apply, reconciliation without resend, duplicate semantic Outcome, conflicting bytes, and exact cleanup restoration.
- [ ] Journal every transition under the existing signed, rollback-resistant, link-safe Cell boundary. Consume budget before the simulated write; retain consumption for acknowledged/ambiguous/matched/conflicting/unavailable results; return only proven predispatch or authoritative not-applied cases.
- [ ] Mint real authority receipts for reservation, dispatch, ambiguity/reconciliation, and cleanup. Preserve prior-receipt links and the exact contract digest.
- [ ] Bind every portable receipt/evidence signer through genuine Cell activation and purpose-aware trust. No public constructor, per-run input, serialized config, or runtime self-anchor may supply a private signer.
- [ ] Use a pre-readiness opaque authority ceremony: generate purpose-separated keys, expose only public descriptors for human signing, and consume a process-local one-use branded handle after readiness/trust verification. The handle is nonserializable and contains no enumerable key material; raw private keys never enter Cell constructor data.
- [ ] Preserve frozen `AuthorityKeyDescriptorV1`. Artifact purposes absent from its closed enum use a certification-local exact key-binding artifact, human-committed before activation and signed by the activated `authority-evidence` root. Offline verification validates that chain before deriving purpose-aware roots for the existing portable bundle verifier.
- [ ] Implement a closed `TaskReceiptGraphV1` exporter/verifier containing root task, complete grant lineage, principals, allocations, budget events, Outcomes, exceptions, topology status, leases if present, and prior-receipt links. Unsupported topology/lease evidence is `unchecked` or `absent`, never fabricated as verified.
- [ ] Verify the exported graph offline with network/provider/credential access disabled. Tampering, omission, duplicate nodes, broken lineage, budget imbalance, receipt-chain forks, contract mismatch, and confidential-field leakage must fail.

Acceptance: apply succeeds once; duplicate dispatches zero additional writes; conflict consumes zero additional budget; cut-after-apply reconciles without resend; cleanup restores the exact before state; offline graph verification passes; secret canary scan is empty.

---

### Task 5: Cross-platform packed-artifact certification

**Outcome:** Ubuntu hosts the authority lifecycle; Windows proves client compatibility and offline verification against the exact packed artifact.

**Files/interfaces:** Create `src/authority/certification/factory-journey.ts`, `contract/certification/v1/factory-journey-summary.schema.json`, `test/authority/certification-factory-journey.test.ts`, and `test/packed/authority-factory-journey.mjs`; modify `src/authority/cli.ts`, `src/authority/index.ts`, `test/authority/package.test.ts`, `package.json`, and `.github/workflows/ci.yml`. The non-authorizing certification-local summary binds the existing verified graph digest and reports derived workflow evidence; it does not modify graph semantics. The CLI may invoke the journey internally; `src/authority/index.ts` may expose offline verification but must not export the factory executor, provider, signer, ledger, budget, or callback.

- [ ] Gate this task on the hosted Windows `FsAuthorityLedger` concurrency failure being fixed or explicitly proven absent on the exact merge candidate. Do not mask it with retries, sleeps, or increased timeouts.
- [ ] Shape the packed certification as a small software-factory journey without building a factory orchestrator: classification/context, preparation, consequential execution, and independent review are non-authorizing workflow stages around the already-reviewed Task 4 root→child execution lineage. Do not invent additional principals, grants, allocations, graph nodes, or terminal semantics in this task.
- [ ] Exercise and report only terminal/reason states the reviewed Task 4 lifecycle actually emits. Unsupported factory categories remain `absent`; ambiguity/manual/blocked states are never passing and operational reason codes never replace or collapse `verified`, `failed`, `unchecked`, and `absent`.
- [ ] Present a deterministic reviewer packet derived only from signed artifacts: declared operation, compiled effect, existing principal/grant/allocation lineage, provider observation, reconciliation result, cleanup result, exceptions, receipt chain, graph digest, and explicit non-claims. The packet may summarize evidence but may not add authority, invent nodes/states, score safety, or claim semantic correctness.
- [ ] Add explicit CI jobs/steps rather than relying on incidental full-suite coverage:
  - Pack: build once on Ubuntu, run Adapter Contract drift checks, create one tarball, record its SHA-256 and commit, inspect its contents, and upload only that tarball.
  - Ubuntu: construct and run the Linux Authority Cell hermetic lifecycle, export graph, verify offline.
  - Windows: assert host refusal/no writes, configure/validate a Linux Cell connection fixture, verify the Ubuntu-produced contract vectors and graph offline.
- [ ] Every job consuming the tarball or cross-job evidence must recompute and match tarball SHA-256, commit, Adapter Contract digest, graph digest, and secret-canary result. Windows receives public verification material only.
- [ ] Pack the npm artifact once, install that exact tarball into clean Ubuntu and Windows fixtures, and run contract/client/offline gates against it. Assert the obsolete FIFO/native helper is absent from package contents and public exports.
- [ ] Emit non-secret, reproducible acceptance measurements from the packed journey: at most four logical operator steps after installation; `authorityBoundaryCeremonies: 1`; `fixtureOperatorConfirmations: 1`; `liveHumanReview: absent`; `providerCredentialValueHandling: 0`; `clientBearerResolution: 0`; `providerSdkCalls: 0`; `externalSockets: 0`; elapsed milliseconds reported but not correctness-gated; and Ubuntu-produced evidence verified offline on Windows. Purpose-separated authority signing keys are generated and confined inside the Cell and are explicitly excluded from the provider-credential metric. Measurements are release evidence, not market evidence.
- [ ] Reject unknown categories, multiple terminal claims for one Outcome, extra writes/budget, or passing ambiguous/manual/blocked evidence. Record unsupported categories as `absent` rather than fabricating required counts.
- [ ] Run build, test compile, focused authority suites, authority-contract drift, full `npm test`, package-content checks, and `git diff --check`. Never raise timeouts or add sleeps to hide a race.
- [ ] Independently review release evidence and exact packed contents. Merge only after required `test (ubuntu-latest)` and `test (windows-latest)` checks are green on the merge candidate.

Acceptance: one factory-shaped hermetic journey reaches one reconciled consequential Outcome and exact cleanup using the reviewed Task 4 root→child lineage; existing failure/ambiguity/conflict/revocation falsifiers remain deterministic; the reviewer packet verifies from the same signed graph on Ubuntu and Windows; provider credential handling, bearer resolution, provider SDK calls, and external sockets remain zero; Cell signing keys remain confined; unsupported categories are honestly absent; no result claims general software-factory capability.

---

### Task 6: Freeze evidence and downstream-consumer handoff

**Outcome:** Prepare one deterministic, verified downstream-consumer handoff artifact after the freeze and green CI; delivery remains `absent` unless a separately authorized external action occurs.

**Files/interfaces:** Create `src/authority/certification/factory-release-evidence.ts`, `contract/certification/v1/factory-release-evidence.schema.json`, `test/authority/factory-release-evidence.test.ts`, and `docs/release/authority-cell-factory-freeze.md`; modify `src/authority/certification/lifecycle-authority.ts`, `src/authority/certification/cell.ts`, `test/authority/certification-lifecycle-authority.test.ts`, and `test/authority/certification-cell.test.ts`. Add an object-identity-branded, purpose-bound Cell-internal `signFactoryReleaseEvidence(digest)` method returning only signature and public binding; never return lifecycle material or private keys. Do not overload a Cloud-oriented release manifest or add transport code.

- [ ] Create a signed release-evidence record containing commit, package tarball digest, Adapter Contract digest, golden-vector digest, Ubuntu/Windows run IDs, hermetic graph digest, reviewer verdicts, and explicit live-provider status `absent`.
- [ ] Use a closed Authority Cell factory-release evidence artifact rather than overloading Cloud-oriented release fields. Bind the metrics digest and exact Ubuntu/Windows job identifiers alongside artifact/graph/reviewer digests. Sign through a purpose-bound opaque one-use ceremony whose public key is committed and rooted in the activated evidence authority; parse and verify it offline without a raw-key API.
- [ ] Include the Task 5 acceptance measurements and terminal-category counts, including explicit zero/`absent` entries for unsupported categories, in the signed release evidence. Report them as engineering evidence from the hermetic fixture, never adoption, safety, or production-provider evidence.
- [ ] Recompute and compare the contract digest from the packed artifact before notification. All-zero, stale, locally dirty, or differently computed digests block the handoff.
- [ ] Produce a non-executable downstream-consumer message containing the exact digest, manifest path, commit, and CI evidence. Do not send credentials, create a vendor transport adapter, or execute an Outcome.
- [ ] Report delivery as `absent` in OSS evidence. Any authenticated external transmission, acknowledgement, retry, or exactly-once claim requires a separate privately authorized plan with destination authority and idempotency semantics.

## Completion criteria

- Windows remains a supported Reelier client and offline verifier.
- Every native Windows Authority Cell hosting entry point refuses before mutation with one actionable error.
- Consequential Path C execution runs only inside a Linux Authority Cell.
- Adapter Contract v1 and golden vectors have one independently reviewed, reproducible, nonzero digest.
- The hermetic GitHub-label lifecycle proves dispatch, ambiguity, no-resend reconciliation, cleanup, receipts, and offline graph verification without provider credential values, client bearer/reference resolution, or provider/external-network calls; Cell signing keys remain opaque and confined.
- The packed artifact proves a factory-shaped journey around the reviewed root→child execution lineage, with one explicit fixture authority ceremony and a deterministic reviewer packet; `liveHumanReview` remains `absent`, and no result claims a factory orchestrator.
- Release evidence reports time/steps to first governed Outcome, authority-ceremony count, zero provider credential handling/bearer resolution/external sockets, confined Cell signing keys, and honest terminal categories without weakening four-state proof semantics.
- Ubuntu and Windows pass against the exact packed artifact.
- No native Windows helper or Node FIFO implementation ships.
- One deterministic downstream-consumer handoff artifact is prepared after all gates pass; OSS makes no delivery claim.
