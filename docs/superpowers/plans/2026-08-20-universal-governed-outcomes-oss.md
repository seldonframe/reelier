# Universal Governed Outcomes — OSS Implementation Plan

**Spec:** `docs/superpowers/specs/2026-08-20-universal-governed-outcomes-design.md`

## Global constraints

- Use strict TDD: commit failing behavioral tests before implementation.
- All wire parsers are closed, inert, bounded, detached, canonical, and total on hostile input.
- The kernel contains no provider or harness names and never receives credentials.
- Provider writes occur only after a durable atomic reservation and coordinator commit.
- Same request ID plus same semantics converges; changed semantics refuses pre-dispatch.
- Ambiguous writes become readback-only; they are never resent.
- Evidence states are exactly `verified`, `partial`, `pending`, `absent`, and `failed`; only verified exact readback may produce `verified`.
- No raw prompt or reasoning is persisted; only a prompt digest may enter durable records.
- Existing public authority/package ABI stays explicit and closed.
- No external provider writes, pushes, merges, tags, releases, or publication.

### Task 1: Define the universal governed-effect contracts

**Files:**

- Create `src/authority/tool-effect-contract.ts`.
- Create `contract/authority/v1/tool-effect-contract.schema.json`.
- Modify `src/authority/types.ts` and `src/authority/wire.ts` additively.
- Modify `src/authority/pack.ts` and `src/authority/compile.ts` additively.
- Modify `src/authority/agent-mandate.ts` only to add a neutral mandate version/union; do not silently redefine V1.
- Modify `src/authority/index.ts`.
- Modify `scripts/build-authority-contract.mjs`, generated contract artifacts, and golden vectors if the public adapter contract changes.
- Create `test/authority/effect-contract.test.ts`.
- Modify `test/authority/wire.test.ts`, `test/authority/compile.test.ts`, and `test/authority/contract.test.ts` as required by the additive contract arm.
- Modify `test/authority/agent-mandate.test.ts`.
- Modify `test/authority/package.test.ts`.
- Create `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-1-report.md`.

**Requirements:**

Define and export closed V1 contracts for `ToolEffectContractV1`, `ProviderOutcomePackV1` metadata, `MissionClaimV1`, `EffectReservationV1`, `AttemptV1`, `ObservationV1`, `GovernedOutcomeV1`, and `GovernedReceiptV1`. Add `ToolEffectContractV1` as a new closed effect arm while preserving the existing public `TransportEffect` and receipt ABI. Contract fields bind exact operation/schema/policy digests, effect class, bounded model fields, host-owned bindings, semantic identity, optional idempotency, readback projection, result semantics, and maximum evidence grade. Add parse/digest functions and a transition verifier that refuses impossible chronology, identity drift, verified-without-authoritative-observation, and partial/pending/absent masquerading as verified.

Introduce an additive neutral mandate version rather than mutating `AgentMandateV1`; existing V1 documents and digests remain byte-compatible. The new version uses closed provider/account/destination references without provider enums and preserves subset checks. Tests must include proxies, accessors, functions, sparse/huge arrays, duplicate keys/identities, invalid timestamps, unknown fields, mutation after parsing, existing V1 golden compatibility, and arbitrary provider names proving the new contract is data-neutral.

### Task 2: Implement the universal durable Outcome kernel

**Files:**

- Create `src/authority/host/outcome-kernel.ts`.
- Modify `src/authority/host/dispatch.ts` only to expose the minimum coordinator hook required by the generic kernel.
- Modify `src/authority/host/prepared-dispatch.ts` additively so non-HTTP effects have a truthful prepared projection.
- Modify `src/authority/host/receipt-authority.ts` and `src/authority/evidence.ts` additively for a neutral receipt arm.
- Modify `src/authority/host/index.ts`.
- Create `test/authority/outcome-kernel.test.ts`.
- Modify `test/authority/dispatch-coordinator.test.ts`.
- Create `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-2-report.md`.

**Requirements:**

Compose the existing `AuthorityLedger`, gate, prepared dispatch coordinator, and durable publication boundary into a provider-neutral lifecycle: mission claim, reservation, attempt, observation, Outcome, receipt. Do not create a second competing reservation state machine. Add only the neutral lifecycle projection/storage seams whose atomic claim returns either the exact prior semantics or a conflict. Refuse missing durable storage except in an explicit hermetic mode that cannot treat ambiguity as success. Revoke/expire before dispatch; permit only readback after an ambiguous provider boundary. A crash after claim or after provider response must resume without a second write. A multi-effect Outcome is verified only when every required effect is verified and its receipt publication is durable; otherwise preserve the most honest partial/pending/failed state. Tests must use a barrier for concurrent conflict, crash injection at every state boundary, restart from durable fixtures, revocation, expiry, receipt-head loss, and exact no-resend counters.

### Task 3: Add provider-neutral MCP, HTTP/OpenAPI, and CLI transport adapters

**Files:**

- Create `src/authority/host/effect-transports.ts`.
- Modify `src/authority/host/outcome-kernel.ts` only to make stored `pending` Outcomes in recoverable ledger states continue through authoritative reconciliation; terminal Outcome adoption remains unchanged.
- Modify `src/authority/host/index.ts`.
- Create `test/authority/effect-transports.test.ts`.
- Create `test/authority/fixtures/tool-effect-contracts.ts`.
- Create `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-3-report.md`.

**Requirements:**

Implement closed transport ports for MCP tool calls, reviewed HTTP/OpenAPI calls, and fixed CLI argv/env execution. Compilation accepts only fields named in the signed effect contract; host-owned fields and credentials are injected after model input validation and are excluded from evidence. CLI forbids shell strings and uses executable plus argv; HTTP binds method, origin, path template, request schema digest, and response projection; MCP binds server/tool/schema digests. Trusted port implementations serialize provider responses before delivering them through a host-owned result sink; the host never awaits or inspects a caller-controlled port return root. Create three deliberately unrelated hermetic contracts—a Slack-like message, a Calendar-like event, and a Slides-like document update—and prove all run through the same generic Task 2 kernel, including its minimal generic correction that lets stored pending Outcomes in recoverable states reach authoritative reconciliation. Include ambiguity/readback, conflict, no-readback=`absent`, delayed=`partial`, and credential-leak tests.

**Amended trust boundary after terminal falsification:** provider executor code is a host-minted trusted capability because it receives provider credentials and could otherwise exfiltrate them directly. V1 executors are callback-only and must synchronously return `undefined`; they own all internal asynchronous work and rejection hygiene, and only bounded serialized success or a fixed failure signal crosses into the authority host. Arbitrary returned Promises are unsupported. Untrusted provider data, model input, and durable state remain inertly parsed. If arbitrary Promise-returning executors are required later, isolate them in a child process with framed byte IPC as a separately reviewed task.

### Task 3B: Mint and enforce the trusted callback-only executor capability

**Files:**

- Modify `src/authority/host/effect-transports.ts`.
- Modify `src/authority/host/index.ts` only if the capability factory is public.
- Modify `test/authority/effect-transports.test.ts`.
- Create `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-3b-report.md`.

**Requirements:**

Replace raw executable port objects with an opaque host-minted trusted executor capability whose callbacks have a `void`/synchronous-`undefined` return contract. Reject raw or unminted port objects before resolving credentials or dispatch. Remove the in-process native-Promise reaction bridge and every claim that the host can safely absorb arbitrary Promise returns. Preserve fixed secret-free errors, first-settle sink semantics, authenticated projection provenance, restart/no-resend behavior, exact HTTP/MCP/CLI bindings, and wire/receipt ABI. Tests must prove raw ports refuse before credential resolution, trusted callback executors work, synchronous throws sanitize, double/late sink settlement converges, and hostile serialized provider data remains inert. Document that async work must be caught inside the trusted executor. Do not begin Task 4 until Task 3B independently ships.

### Task 4: Certify GitHub merge and Linear operations as contract instances

**Files:**

- Create `src/authority/packs/github-linear-outcomes.ts`.
- Modify `src/authority/pack/index.ts`.
- Modify `src/authority/pack.ts` only for the explicit reviewed-pack allowlist.
- Modify `src/authority/host/github-release-runner.ts` only to adapt existing exact-SHA operations to the generic pack port.
- Create `src/authority/host/linear-outcome-runner.ts` as a trusted callback executor over a host provider port; it owns no journal, retry state, credentials, or SDK.
- Modify `src/authority/host/outcome-kernel.ts` only to add a generic host-minted predecessor-policy capability that requires an exact earlier verified Outcome and durable receipt head before successor dispatch.
- Modify `src/authority/host/effect-transports.ts` only to pass a compiler-owned frozen authority envelope (`contractDigest`, `bindingDigest`, `reservationId`) to trusted executors; model input and host resolver values cannot substitute for it.
- Modify `src/authority/host/dispatch.ts` only to mint a one-call opaque coordinator dispatch capability bound to the exact reservation/effect/state around `adapter.dispatch`, revoked in `finally`; no prepared-dispatch or durable state changes.
- Create `test/authority/github-linear-outcomes.test.ts`.
- Modify `test/authority/github-release-runner.test.ts`.
- Modify `test/authority/outcome-kernel.test.ts` for direct fail-closed and restart predecessor proofs.
- Modify `test/authority/effect-transports.test.ts` for compiler-owned authority-envelope binding and substitution refusal.
- Modify `test/authority/dispatch-coordinator.test.ts` for single-use, exact-call binding, direct-call refusal, and revocation-after-finally proofs.
- Modify `test/authority/package.test.ts` if public pack exports change.
- Create `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-4-report.md`.

**Requirements:**

Define reviewed contracts for candidate publication, PR ensure, exact-head squash merge, Linear evidence comment, and Linear status transition. The GitHub adapter must preserve unchanged base, exact head SHA, signed workflow path/digest, successful required checks, allowed candidate digest, and post-merge commit/tree readback. The Linear contracts bind exact workspace/team/project/issue, pre-status, target status, and an immutable comment marker; comment and status are separate one-effect allocations and comment receipt is the status predecessor. No Linear SDK or credential enters the OSS contract. Tests prove GitHub+Linear composite ordering, Linear-only execution with zero git fields/calls, wrong workflow/status/project refusal, duplicate/conflicting comment, ambiguous merge/comment/status no-resend, and partial Outcome after merge plus pending Linear.

### Task 4B: Make coordinator-call delegation collision-free

**Files:**

- Modify `src/authority/host/dispatch.ts` only to reject a delegate already bound to any live coordinator call and preserve exact-call cleanup.
- Modify `test/authority/dispatch-coordinator.test.ts`.
- Create `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-4b-report.md`.

**Requirements:**

Task 4 stopped after three fix loops because the same delegate could be bound to two concurrent live coordinator calls. Reject the second bind without changing the first mapping. Prove deterministic concurrent shared-delegate isolation, exact first-call consumption, second-call refusal, revocation after success and throw, and refusal of fake, copied, serialized, or cross-reservation call/delegate identities. Keep the capability private, optional adapter compatibility intact, and prepared/readback paths unchanged. Do not begin Task 5 until Task 4B independently ships.

### Task 5: Expose the harness-neutral four-tool surface and Eve 0.39 rehearsal fixture

**Files:**

- Create `src/authority/host/agent-tools.ts`.
- Create `src/authority/ingress/agent-tool-contracts.ts` and generate MCP/HTTP/OpenAPI projections from it.
- Modify `src/authority/ingress/mcp.ts`, `src/authority/ingress/http.ts`, and create `src/authority/ingress/openapi.ts`.
- Modify `src/authority/host/local.ts`.
- Modify `src/authority/host/index.ts`.
- Create `test/authority/agent-tools.test.ts`.
- Modify `test/authority/local-multi-definition-jobs.test.ts`.
- Modify files under `conformance/continuity-adapter/v1/eve-fixture/agent/` and `conformance/continuity-adapter/v1/eve-fixture/tests/` only as needed for the four-tool adapter.
- Create `test/continuity/eve-governed-outcomes.test.ts`.
- Create `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-5-report.md`.

**Requirements:**

Define agent status, Outcome proposal, Outcome request, and Outcome status once and project the same schema to MCP, HTTP/OpenAPI, and Eve. Keep legacy job tools compatible until a deliberate public removal; the new adapter exposes only the new quartet. Opaque references remain task/session/Cell-bound, and raw aliases never become callable. Keep tenant, account, destination, provider status IDs, merge policy, credentials, and signing keys host-owned. Add an adapter capability descriptor so Eve, Codex, Claude Code, Cursor, Grok, and Hermes can be certified against the same request/response ABI without altering provider packs. Update the Eve 0.39.0 deterministic mock fixture to execute one composite GitHub+Linear mission and one Linear-only mission with fresh mission/grant/allocation/session IDs, process restarts, and ambiguity injection. Tests must prove one activation, zero routine approvals, two reconciled Outcomes, no credentials/model prompt persistence, and two Outcomes per one review. If the Eve dependency or native helper is absent, the real-process test may skip only with an explicit prerequisite reason; hermetic behavior tests must still pass.

## Final gates

- Focused tests for every task.
- `npx tsc -p tsconfig.json --pretty false` and the repository's test TypeScript build.
- Authority, adapter, bootstrap, package/export, and full `npm test` gates.
- Existing missing native/Eve certification prerequisites are reported separately and never described as passing.
- Final independent whole-branch review before any Cloud composition or live provider rehearsal.
