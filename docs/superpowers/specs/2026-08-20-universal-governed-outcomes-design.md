# Universal Governed Outcomes — Design

## Constitutional order

`FOUNDATION.md` and `BUILDING-COMPASS.md` govern this design. Reelier exists to let agents write. The harness reasons and acts; Reelier bounds consequential state transitions and proves the observed result. The governing metric is reconciled Outcomes per human review.

## Product contract

After `reelier init`, a human confirms one plain-language standing-powers mandate for exact accounts, destinations, operations, limits, validity, and environment. In-scope prompts from Eve, Codex, Claude Code, Cursor, Grok, Hermes, or another harness create attenuated missions without routine approvals. The human reviews completed Outcomes afterward.

The prompt expresses intent. It does not create or widen durable authority. A platform WebAuthn assertion creates or widens the standing mandate; ordinary in-scope prompts consume it invisibly.

## Provider-neutral governed-effect seam

The kernel knows no GitHub, Linear, Slack, Calendar, Slides, Outlook, MCP, HTTP, or CLI semantics. It accepts a closed `ToolEffectContractV1` describing one reviewed operation:

- contract, provider, operation, schema, and policy digests;
- effect class and bounded model-supplied inputs;
- host-owned credential, account, destination, and limit bindings;
- semantic identity and optional provider idempotency key;
- authoritative readback operation and closed projection;
- exact success, conflict, definitive-failure, and ambiguity rules;
- evidence grade supported by the provider: `verified`, `partial`, `pending`, `absent`, or `failed`.

`ProviderOutcomePackV1` compiles a contract into preflight, dispatch, readback, conflict detection, and reconciliation calls. Transport adapters carry reviewed calls over MCP, OpenAPI/HTTP, or CLI. Adding a provider contract or transport must not require a kernel change.

Unknown tools may be observed and a contract proposal generated, but an agent cannot activate, widen, or self-authorize that proposal. Exact proof is available only when the contract supplies authoritative readback. A send with delayed evidence may be `partial` or `pending`; no readback remains `absent`. None is rendered as `verified`.

## Universal durable lifecycle

The lifecycle is:

1. `AgentMandate` binds the human-confirmed powers.
2. `MissionClaim` attenuates one prompt to declared operations and prompt digest; raw prompts and reasoning are not durable evidence.
3. `EffectReservation` atomically claims semantic identity before provider dispatch.
4. `Attempt` records whether dispatch could have crossed the provider boundary.
5. `Observation` records authoritative readback or explicit inability to observe.
6. `Outcome` reconciles all required effects without conflating partial completion with success.
7. `Receipt` commits the immutable chain for offline verification.

A retry with the same request ID and semantics converges. Reusing it with different semantics refuses before dispatch. Revocation prevents undispatched effects immediately. An already ambiguous effect remains readback-only. Process death after the durable claim resumes from state; Neon failure before the claim means no write.

## Harness contract

All harness adapters expose only four model-facing capabilities:

- agent status;
- proposal of an Outcome;
- request an authorized Outcome;
- inspect Outcome status.

The harness never receives provider credentials, tenant IDs, provider account IDs, destination IDs, status IDs, merge policy, or authority-signing keys. The host resolves opaque references after authentication. The same contract is used by Eve first and can be certified for Codex, Claude Code, Grok Build, and other harnesses without changing provider packs.

## First live-certified Outcomes

GitHub and Linear are the first live-certified provider contracts, not special cases in the kernel.

`REEL-TEST-1` is a composite engineering Outcome: read the Linear issue, build in an isolated workspace, publish the exact candidate, create one PR, require the authorized CI workflow and exact accepted head, squash-merge it into unchanged `main`, reconcile the post-merge commit/tree, add one evidence comment to the exact Linear issue, then move it to the exact Done status. Comment and status each use their own one-effect allocation.

`REEL-TEST-2` is Linear-only: add one authorized resolution/link comment and move the exact issue to the exact terminal status. No git operation participates.

If GitHub merges while Linear remains pending or fails, the Outcome is partial/pending or failed. Reelier never rolls back the merge automatically and never renders the composite Outcome verified.

## Setup and activation

`reelier init` is one setup entry: authenticate the Reelier account with GitHub, connect one GitHub App repository, connect one dedicated Linear project through a replaceable credential broker, install/link the selected harness adapter, and report Ready. Provider credentials remain in the broker/provider boundary, never Neon or the harness. Vercel Connect may be the first Linear implementation, but its API is behind `CredentialBrokerPort` and is not part of the portable contract.

The first capable prompt opens `https://www.reelier.com` and requests one WebAuthn assertion over the exact mandate digest and challenge. The same assertion is not requested again while missions remain within that unchanged mandate. Widening, expiry, or revocation requires a new confirmation.

## Inversion and falsifiers

The phase fails if:

- adding a hermetic Slack-like, Calendar-like, or document-like contract requires editing the kernel;
- any provider write occurs before an atomic durable claim;
- ambiguous merge, comment, or status mutation is resent;
- provider credentials appear in harness input, model context, prompts, logs, Neon, Outcomes, or receipts;
- a prompt alone creates or widens authority;
- direct provider output is accepted without exact identity and readback validation;
- `partial`, `pending`, `absent`, `unchecked`, or ambiguity is presented as verified;
- an exact-SHA merge needs a routine mid-mission human approval;
- a non-git job passes through git-only fields or logic;
- raw prompts or model reasoning are persisted;
- two successful Outcomes require more than the one activation confirmation and one post-run review.

## Honest nonclaims

A verified receipt proves only the declared transition and observed result, not content correctness, safety, completeness, or business wisdom. Reelier cannot prove that direct shell, plugin-private, or direct HTTP writes bypassing its trusted executor did not occur. V1 ships a neutral seam and first certified GitHub/Linear packs; other providers become governed only when their contracts and adapters are reviewed and activated. No tag, deployment, package publication, deletion, payment, or automatic rollback is authorized by this phase.
