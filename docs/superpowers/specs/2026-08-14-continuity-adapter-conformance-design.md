# Continuity Adapter Conformance and Eve Tracer-Bullet Design

**Status:** Founder-approved direction; implementation not started

**Pinned implementation:** `fb31b587488ad25b932d5cb8aef2f5aadff15c1b`

**Pinned Eve package:** `eve@0.37.1`

**Maturity target:** reproduced, hermetic integration evidence; not production certification

## Decision

Reelier will freeze an executable Continuity Adapter v1 conformance kit around the existing `ContinuityRuntimeAdapterV1`, then prove it through one real Eve application running Eve's local durable world. The kit defines behavioral obligations shared by Codex, Claude Code, Cursor/Grok Build, Eve, and future harnesses. It does not put any model or harness in Reelier's trust path.

The first tracer bullet is Eve over its canonical HTTP session API, not ACP. Eve HTTP exposes durable session IDs and reconnectable streams across process restarts; Eve 0.37.1 explicitly does not support durable ACP IDs or ACP session resumption across process restarts. Grok Bot testing is a later design because onboarding creates a persistent paid cloud bot and is not required to validate the portable contract.

The painful supervision removed is reconstructing a task after context loss, checking whether an agent already performed a consequential action, and manually warning a replacement agent not to repeat it. A host may replace the model or harness while Reelier supplies the same evidence-bound answer to seven questions: outcome owed, binding decisions, work state, consequential state, remaining envelope, evidence and uncertainty, and next safe action.

## First principles

Agent memory needs only four durable primitives for reliable task continuity:

1. **Identity:** which authenticated task, principal, workload, and runtime session is acting.
2. **Ordered facts:** immutable semantic events with an expected cursor and digest chain.
3. **Verified consequence imports:** verifier-produced Path C evidence, never model-authored claims of success.
4. **Projection:** a bounded, current answer to what remains and what action is safe next.

Eve and Reelier own different layers:

- Eve durably replays computation at completed workflow-step boundaries, preserves session history and state, and reconnects event streams.
- Reelier durably records task commitments and verified or honestly uncertain world changes across sessions, processes, harnesses, and models.

Eve durability cannot prove that an external write occurred once. Reelier continuity does not replay an interrupted model step. Combining them is useful precisely because neither pretends to own the other's claim.

## Architecture

### 1. Trusted continuity core

The existing `reelier/continuity` subpath remains the only source of task truth. `FsContinuityLedger`, `ContinuityRuntimeAdapterV1`, the verified Path C bridge, and `ResumeProjectionV1` remain model- and harness-neutral.

The runtime adapter gains one read/reconciliation operation alongside the current four methods:

```ts
interface ContinuityRuntimeAdapterV1 {
  identify(): Promise<AuthenticatedWorkloadV1>;
  open(taskId: string): Promise<ResumeProjectionV1>;
  checkpoint(input: ContinuityCheckpointV1): Promise<ContinuityAppendResultV1>;
  requestOutcome(input: OutcomeRequest): Promise<AuthorityIngressOutcome>;
  statusOutcome(input: Readonly<{ requestId: string }>): Promise<AuthorityIngressOutcome>;
}
```

`statusOutcome` uses the same host-authenticated actor as `requestOutcome`. It exists because `reconcile-before-retry` is not actionable unless every harness can read the existing semantic operation before requesting another one. It may reconcile through the Authority Cell's public status ingress; it may not dispatch a new Outcome.

No other core method is added. Catalog discovery, delegation, task provisioning, and provider-specific operations remain Authority Cell capabilities, not continuity primitives.

### 2. Harness binding

Each harness owns a thin binding with four responsibilities:

- derive `AuthenticatedWorkloadV1` from host-authenticated runtime context;
- call `open()` before model work and inject the returned projection as system-scoped context;
- expose narrow checkpoint, Outcome request, and Outcome status tools;
- preserve the task binding when the harness process or model is replaced.

The model-facing checkpoint schema excludes `taskId`, `actorPrincipalId`, `workloadId`, `jobCardDigest`, and `authoritySnapshotDigest`. Those fields come from the authenticated task binding and current Authority Cell snapshot. The model may propose only public continuity events, evidence references, and an optional memo that remains `unchecked`.

The model-facing Outcome request schema remains exactly `requestId`, opaque `sourceRefs`, and bounded `choices`. The status schema contains only `requestId`. Neither schema accepts tenant, principal, workload, provider account, credential, endpoint, recipient, amount, raw provider arguments, or evidence status.

### 3. Open conformance kit

`conformance/continuity-adapter/v1/` will contain an open executable runner, closed candidate/report schemas, golden scenarios, and a README that states the claim boundary. A candidate driver supplies fresh and replacement adapter instances plus observable counters for Outcome requests, status reads, and hermetic provider dispatches. The runner calls only public adapter methods; it cannot import Authority Cell runner, signer, credential, or private ledger internals.

The report binds:

- conformance version;
- adapter and harness IDs;
- exact Reelier commit and Authority Adapter Contract v1 digest;
- harness package/version;
- scenario results;
- maturity `reproduced` or `failed`;
- explicit non-claims for topology, traffic completeness, semantic correctness, and production readiness.

Passing means the observed adapter behavior satisfied the hermetic scenarios. It never means the adapter is safe, that all writes were covered, or that a production provider Outcome occurred.

### 4. Eve tracer bullet

The Eve fixture is an isolated package below the conformance directory with its own lockfile. The root Reelier runtime takes no Eve dependency.

The fixture uses:

- Eve's local Workflow world persisted under the fixture's `.eve/.workflow-data`;
- a deterministic `mockModel`, so no model provider or credential is called;
- a custom fixture-only route `AuthFn` that verifies a test token and supplies principal, task, and workload attributes;
- `ctx.session.id` as `runtimeSessionId` and `eve@0.37.1` as `harnessId`;
- session-scoped durable state to pin the initiator principal and task on first use;
- a turn-scoped dynamic system instruction that renders the current Reelier resume projection without appending duplicate user-history messages;
- narrow authored tools for checkpoint, Outcome request, and Outcome status;
- Eve's canonical HTTP client/stream, absolute stream cursor, and stable `meta.id` deduplication.

A follow-up whose current authenticated principal or task differs from the pinned initiator binding fails before model work. Task identity never comes from prompt text or ACP metadata. A Reelier task is provisioned before the Eve session begins; an empty or unknown task fails closed rather than letting the model create authority through prose.

## Data flows

### Start or resume a turn

1. Eve route auth verifies the caller.
2. The binding derives and validates task, principal, workload, session, and harness identity.
3. `adapter.open(taskId)` reads the ledger only.
4. The binding renders `ResumeProjectionV1` as turn-scoped system context.
5. If the projection says `reconcile-before-retry`, the model receives the status tool but no instruction or automatic path that resends the Outcome.
6. Opening, reconnecting, rewinding, compacting, or replacing the harness performs zero Outcome requests and zero provider dispatches.

### Checkpoint

1. The model supplies public semantic events and the cursor it observed.
2. The binding adds authenticated identity and authority digests outside model input.
3. The ledger atomically appends one canonical segment or returns `stale-cursor`.
4. A stale result is rendered honestly and causes a fresh `open()`; it is never silently upgraded to success.

If Eve crashes after the append commits but before the tool result completes, Eve may rerun the tool step. The same expected cursor cannot append a second segment. The rerun observes `stale-cursor`, reopens the task, and continues from ledger truth.

### Consequential Outcome

1. The model chooses a stable semantic `requestId`, source references, and allowed choices.
2. The binding supplies authenticated identity outside the request.
3. Path C gates and dispatches, or refuses, through its existing opaque-handle boundary.
4. A completed verified native receipt graph is imported into the continuity ledger.
5. If Eve crashes while the tool step is unresolved and reruns it, the same semantic `requestId` reaches the Path C idempotency boundary. It may return existing or reconciled status; it must not multiply provider writes or effect budget.
6. Ambiguous state remains ambiguous until `statusOutcome` obtains authoritative reconciliation and verifier-produced evidence is imported.

## Required conformance scenarios

The v1 runner fails unless every candidate proves all of these:

1. Host identity wins over prompt and checkpoint identity fields.
2. Cross-task, cross-principal, and cross-workload access refuses.
3. Fresh and replacement adapters produce the same projection for the same ledger head.
4. `open()` and repeated resume perform zero Outcome/status/provider dispatch operations.
5. Checkpoint cursor contention produces exactly one segment and one honest stale result.
6. A crash after checkpoint commit but before tool return produces no duplicate event segment.
7. An ambiguous consequence resumes with `reconcile-before-retry` and no redispatch.
8. Status reads use the existing request ID and cannot introduce provider authority.
9. Repeating an interrupted Outcome step with the same request ID produces at most one provider write and one conserved reservation.
10. A different request ID is never inferred as a retry of the first.
11. Unchecked, absent, pending, and failed evidence never renders as verified or complete.
12. Mutation, structural casting, transcript prose, and harness-local state cannot manufacture verified claims or consequences.
13. Reconnecting an Eve stream from an overlapping cursor deduplicates instrumentation by `meta.id` without altering ledger state.
14. Clearing or compacting Eve model history does not clear Reelier task continuity.
15. Resetting an Eve session retires that session but a newly authenticated replacement session can resume the same Reelier task.
16. A changed model fixture does not change adapter semantics or the resume projection.

Failure injection points are before append, after append/before return, before Outcome gate, after reservation, after provider send intent, after provider apply, before receipt publication, and before status return. Provider behavior remains hermetic and reversible.

## Safety and liveness invariants

- Resume is read-only and never dispatches.
- Retries reuse semantic identity and cannot multiply effect or budget.
- Only verifier-produced native evidence can create `verified` claims or consequences.
- Agent-authored memory is always `unchecked`.
- Ambiguity blocks resend and remains visible until authoritative reconciliation.
- Identity and authority are derived outside model input.
- Ledger corruption, missing external trust anchors, stale cursors, and cross-task access fail closed.
- A recorder or harness outage may interrupt convenience, but it cannot upgrade evidence or bypass the Path C gate.
- Replacing Eve, the model, the Workflow world, or the provider adapter does not change the continuity contract.

## Explicit non-goals

- General semantic memory, embeddings, transcript search, preference learning, or RAG.
- Saving every thought, tool result, or chat message.
- Inferring task truth from model summaries.
- Automatically authorizing, retrying, or compensating a consequential Outcome.
- Claiming Eve ACP is durable across process restarts.
- Adding Eve to Reelier's runtime dependencies.
- Deploying Eve, calling a model provider, using production credentials, or writing a live provider.
- Creating or onboarding a Grok Bot.
- Proving topology completeness, bypass closure, content correctness, wisdom, fairness, or safety.

## Evidence and release boundary

The first implementation release remains prototype integration evidence until an independent reviewer reruns the kill/resume matrix from a clean checkout. The load-bearing claims and required evidence are:

| Claim | Evidence | Maturity after first pass |
|---|---|---|
| Adapter semantics survive harness replacement | reusable black-box conformance runner | reproduced |
| Eve session/process restart preserves Reelier continuity | real local-world kill/resume fixture | reproduced |
| Interrupted steps do not duplicate a hermetic Path C write | dispatch counter, reservation lineage, receipt graph | reproduced |
| Resume performs no write | zero request/status/dispatch counters during open/reconnect | reproduced |
| Works on Grok Bot | none in this design | unexplained / not claimed |
| Production topology is complete | none in this design | absent / not claimed |

The independent checker must differ from the implementer for the immutable candidate range. No live deployment or provider test occurs without a separate approved runbook naming credentials, disposable resources, cleanup, cost ceiling, and authoritative post-state.

## Compass check

1. **Pain removed:** repeated human reconstruction and duplicate-action supervision after context loss.
2. **Evidence:** current kernel tests and Eve's pinned local durability contract are engineering evidence; broad user demand remains a thesis signal.
3. **Smallest transition:** authenticated task projection -> optional checkpoint or one governed Outcome/status read.
4. **Postponed:** general memory, live providers, ACP durability, UI, Grok Bot, multi-runtime packaging.
5. **Strengthened primitives:** principal/workload binding, semantic identity, ordered ledger, reconciliation, exception state, portable verified evidence.
6. **Broad agent/narrow exit:** the model prepares freely; only Outcome request/status crosses the consequential boundary.
7. **Bypasses:** the hermetic fixture does not prove production credential or egress closure; completeness stays unclaimed.
8. **Portability:** the contract names no model, Eve API, provider, or Workflow world; Eve is only the first adapter.
9. **Identity:** derived from route auth and host task binding, never request body.
10. **Retry/concurrency:** cursor CAS and Path C semantic request identity prevent multiplication.
11. **Authoritative result:** provider read-back plus verified native receipt graph, not Eve tool completion.
12. **Ambiguity:** explicit consequence state and `reconcile-before-retry`.
13. **Maker/checker:** immutable-range independent review is mandatory.
14. **Maturity:** hermetic reproduced evidence, not certified production support.
15. **Falsifier:** any resume dispatch, identity override, duplicate write/reservation, or upgraded uncertain claim rejects the design.
16. **Outcome per review:** one human-defined task envelope can safely survive many autonomous turns and replacement agents.
17. **Evidence location:** conformance report, kill/resume logs, dispatch counters, ledger segments, and verified receipt graph produced by the implementation plan.

## Success criterion

From a clean checkout, one command starts the hermetic Eve fixture, runs the full adapter conformance and process-kill matrix, and emits a closed report proving that a replacement Eve process resumes the same Reelier task, preserves ambiguity, reconciles before retry, and performs at most one hermetic provider write—without model credentials, production credentials, network provider calls, or human approval between turns.
