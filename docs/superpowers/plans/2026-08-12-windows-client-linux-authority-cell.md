# Windows Client and Linux Authority Cell Implementation Plan

> **Founder-locked 2026-08-12.** Implement with `superpowers:subagent-driven-development`, one fresh worker and one independent reviewer per task. Use TDD and separate RED/GREEN commits. Do not revive the Node FIFO or native-helper alternatives.

**Goal:** Keep Reelier fully usable from Windows while running reservation, dispatch coordination, credentials, reconciliation, and receipt minting inside a Linux Authority Cell whose filesystem and process invariants are enforceable.

**Architecture:** Public contracts, client configuration, preparation, agent adapters, and offline verification remain substrate-neutral. Authority-bearing commands fail before mutation on non-Linux hosts and direct the operator to a configured Linux Cell over authenticated HTTP/MCP. Adapter Contract v1 freezes the exact substrate-neutral wire boundary. A hermetic GitHub-label certification lifecycle crosses that boundary without credentials or network calls, exercises genuine Cell authority/budget/ledger/reconciliation/cleanup, exports a complete signed graph, and verifies it offline on Ubuntu and Windows.

**Non-goals:** Native Windows Authority Cell hosting; Node FIFO admission; Rust/Win32 helpers; weaker pathname validation; live-provider credentials; provider SDK calls; Grok-specific transport or an Outcome before the contract freeze.

## Global constraints

- Work only in `C:\Users\maxim\CascadeProjects\reelier\.worktrees\outcomes-delegation-infra`.
- Preserve and do not stage the interrupted native scaffold (`.gitignore`, `native/`, `rust-toolchain.toml`), unrelated certification stat-only paths, and `.tmp-pack/`.
- Do not rewrite or squash the historical FIFO/native commits. This plan supersedes them prospectively.
- Linux behavior must not be weakened to make Windows pass. Windows hosting refuses; Windows client and offline verification pass.
- Every refusal is deterministic, typed, redacted, and occurs before filesystem, key, principal, budget, ledger, receipt, provider, or network mutation.
- No credential value is accepted by a connection file. Only closed `env:` or confined `file:` references are stored.
- Ordinary certification readiness remains non-dispatchable until a host-internal implemented runner and executed evidence exist.
- A provider acknowledgement is not authoritative reconciliation. Ambiguous writes retain consumption and are never resent automatically.
- `verified` means the named evidence verified; it never means safe, correct, wise, complete, or successful.
- Each task ends with focused tests, TypeScript compile, authority-contract drift, build, an independent read-only review, and a task report before the next task begins.

## Files and ownership map

- Contract freeze: `contract/authority/v1/adapter-contract-v1.json`, `scripts/build-authority-contract.mjs`, `test/authority/contract.test.ts`, `src/authority/adapter-contract.ts`, `src/authority/index.ts`.
- Platform boundary: `src/authority/host/platform.ts`, `src/authority/cli.ts`, `src/authority/host/local.ts`, certification host entry points, focused platform tests.
- Windows client: `src/authority/client/config.ts`, `src/authority/client/http.ts`, `src/authority/cli.ts`, a minimal authenticated identity route in `src/authority/ingress/http.ts` and host/server composition, closed non-authorizing client schema under `contract/client/v1/`, client tests and runbook. Client configuration is deliberately outside the frozen Adapter Contract v1 wire set.
- Retired code: delete tracked `src/authority/host/windows-k1-fifo.ts` and `test/authority/windows-k1-fifo.test.ts` only after source-graph tests prove there is no production import.
- Hermetic lifecycle: `src/authority/certification/github-issue-labels-runner.ts`, receipt/graph modules under `src/authority/certification/`, corresponding tests and schemas.
- CI/release evidence: `.github/workflows/ci.yml`, packed-artifact tests, task reports, freeze notice containing the exact digest.

---

### Task 1: Freeze Adapter Contract v1 and golden vectors

**Outcome:** One canonical, nonzero digest identifies the complete public adapter/wire contract independently of its host OS.

- [ ] Add RED tests proving the contract set has a closed manifest, sorted unique members, an exact version, per-file SHA-256 digests, a golden-vector digest, and a nonzero aggregate digest. Mutation, omission, duplicate paths, reordered members, path traversal, self-inclusion, and stale generated output must refuse.
- [ ] Generate `contract/authority/v1/adapter-contract-v1.json` deterministically. Its aggregate digest is over a domain-separated canonical payload that excludes the aggregate digest field itself, avoiding a digest cycle.
- [ ] Include every public v1 authority schema and `golden-vectors.json`; exclude certification-local/internal files only if the exclusion is explicit and tested. Do not infer membership from filesystem enumeration at verification time.
- [ ] Add a narrow substrate-neutral reader/verifier and export only the frozen descriptor/digest needed by clients and receipts. Export no runner, credential, filesystem, or provider behavior.
- [ ] Run regeneration twice and prove byte stability. Run tamper tests against a copied contract directory.
- [ ] Independently review the exact public surface, manifest membership, canonicalization, domain separation, golden vectors, and nonzero digest. Record the approved digest; do not notify Grok yet.

Verification:

```powershell
npx tsc -p tsconfig.test.json --pretty false
node --test --test-concurrency=1 dist-test/test/authority/contract.test.js
npm run check:authority-contract
npm run build
```

---

### Task 2: Enforce the Linux Authority Cell boundary and retire Windows FIFO

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
- [ ] Add `reelier authority connect --endpoint ... --token-ref ... --cell-id ...`. It writes only a client-owned connection file atomically; it never resolves the token during parsing or writes a ledger/receipt/key.
- [ ] Add `reelier authority doctor --live` (or the existing doctor integration if present) to resolve the opaque reference inside the client process, authenticate to the Cell, compare Cell ID and Adapter Contract digest, and report four-state results. Redact token values and resolver errors.
- [ ] Add one authenticated, read-only `GET /v1/identity` Cell route returning only the closed Cell ID and Adapter Contract digest. It performs no writes and reveals nothing to unauthenticated callers.
- [ ] Bind every consequential client request to the authenticated server-derived principal/session context. No task, principal, grant, allocation, or Cell identity may be supplied in the Outcome body.
- [ ] Add an exact compatibility refusal for contract-digest mismatch. The client may still perform status/export/offline verification, but it may not request consequential dispatch.
- [ ] Document three starts: local WSL, local Linux container, and remote/Fly Linux Cell. Keep the default path one command after the Cell endpoint and token reference exist.

Security tests cover config substitution, symlinked token files, DNS/URL confusion, redirect refusal, bearer leakage in errors/logs, stale Cell identity, stale contract digest, unauthenticated ingress, and body-supplied identity rejection.

---

### Task 4: Complete the hermetic GitHub-label lifecycle through the Linux Cell

**Outcome:** The first complete certification scenario exercises genuine authority and recovery with zero credentials, zero provider SDK calls, and zero network access.

- [ ] Extend the existing branded Cell-internal GitHub runner; do not expose an executable callback, provider port, ledger, budget, signer, or fault injector through a public constructor or per-call input.
- [ ] Bind the frozen Adapter Contract digest, exact operator config, signed Job Card, root/child grant, principal session, allocation, endpoint manifest, scenario plan, desired labels, and hermetic runner identity before permit issuance.
- [ ] Model the hermetic provider as durable in-Cell state with authoritative reads. Support exact apply, a controlled cut after apply, reconciliation without resend, duplicate semantic Outcome, conflicting bytes, and exact cleanup restoration.
- [ ] Journal every transition under the existing signed, rollback-resistant, link-safe Cell boundary. Consume budget before the simulated write; retain consumption for acknowledged/ambiguous/matched/conflicting/unavailable results; return only proven predispatch or authoritative not-applied cases.
- [ ] Mint real authority receipts for reservation, dispatch, ambiguity/reconciliation, and cleanup. Preserve prior-receipt links and the exact contract digest.
- [ ] Implement a closed `TaskReceiptGraphV1` exporter/verifier containing root task, complete grant lineage, principals, allocations, budget events, Outcomes, exceptions, topology status, leases if present, and prior-receipt links. Unsupported topology/lease evidence is `unchecked` or `absent`, never fabricated as verified.
- [ ] Verify the exported graph offline with network/provider/credential access disabled. Tampering, omission, duplicate nodes, broken lineage, budget imbalance, receipt-chain forks, contract mismatch, and confidential-field leakage must fail.

Acceptance: apply succeeds once; duplicate dispatches zero additional writes; conflict consumes zero additional budget; cut-after-apply reconciles without resend; cleanup restores the exact before state; offline graph verification passes; secret canary scan is empty.

---

### Task 5: Cross-platform packed-artifact certification

**Outcome:** Ubuntu hosts the authority lifecycle; Windows proves client compatibility and offline verification against the exact packed artifact.

- [ ] Add explicit CI jobs/steps rather than relying on incidental full-suite coverage:
  - Ubuntu: construct and run the Linux Authority Cell hermetic lifecycle, export graph, verify offline.
  - Windows: assert host refusal/no writes, configure/validate a Linux Cell connection fixture, verify the Ubuntu-produced contract vectors and graph offline.
- [ ] Pack the npm artifact once, install that exact tarball into clean Ubuntu and Windows fixtures, and run contract/client/offline gates against it. Assert the obsolete FIFO/native helper is absent from package contents and public exports.
- [ ] Run build, test compile, focused authority suites, authority-contract drift, full `npm test`, package-content checks, and `git diff --check`. Never raise timeouts or add sleeps to hide a race.
- [ ] Independently review release evidence and exact packed contents. Merge only after required `test (ubuntu-latest)` and `test (windows-latest)` checks are green on the merge candidate.

---

### Task 6: Freeze notice and Grok-channel handoff

**Outcome:** The approved nonzero Adapter Contract digest is communicated exactly once after the freeze and green CI.

- [ ] Create a signed release-evidence record containing commit, package tarball digest, Adapter Contract digest, golden-vector digest, Ubuntu/Windows run IDs, hermetic graph digest, reviewer verdicts, and explicit live-provider status `absent`.
- [ ] Recompute and compare the contract digest from the packed artifact before notification. All-zero, stale, locally dirty, or differently computed digests block the handoff.
- [ ] Send the Grok-channel task a non-executable message containing the exact digest, manifest path, commit, and CI evidence. Do not send credentials, create a Grok transport adapter, or execute a Grok Outcome.
- [ ] If no authenticated Grok task/channel is available, stop with a prepared exact message and name that external coordination as the only blocker; do not guess a destination.

## Completion criteria

- Windows remains a supported Reelier client and offline verifier.
- Every native Windows Authority Cell hosting entry point refuses before mutation with one actionable error.
- Consequential Path C execution runs only inside a Linux Authority Cell.
- Adapter Contract v1 and golden vectors have one independently reviewed, reproducible, nonzero digest.
- The hermetic GitHub-label lifecycle proves dispatch, ambiguity, no-resend reconciliation, cleanup, receipts, and offline graph verification without credentials or provider/network calls.
- Ubuntu and Windows pass against the exact packed artifact.
- No native Windows helper or Node FIFO implementation ships.
- Grok receives only the frozen digest/evidence handoff after all gates pass.
