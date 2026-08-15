# One-Command Agent Bootstrap and Consequential Gateway Design

**Status:** Implementation-planning target, incorporating the founder's two-command direction and an independent maker/checker review. It does not claim the feature is shipped.

**Constitutional sources:**

- `C:/Users/maxim/CascadeProjects/reelier-cloud/docs/company/FOUNDATION.md`
- `C:/Users/maxim/CascadeProjects/.worktrees/reelier-cloud-engineering-system/docs/company/BUILDING-COMPASS.md`
- `docs/company/plans/2026-08-01-universal-compiled-authority.md` in the private Cloud repository
- `docs/superpowers/specs/2026-08-12-universal-agent-channel-design.md`
- `docs/superpowers/specs/2026-08-14-continuity-adapter-conformance-design.md`
- Cloud ownership complement: `C:/Users/maxim/CascadeProjects/.worktrees/reelier-cloud-managed-cell-plan/docs/superpowers/plans/2026-08-14-managed-authority-cell-productization.md` at immutable Cloud commit `892a91d`

## Decision

Reelier will expose a two-command founder-facing experience:

```text
npx reelier@latest init my-agent
npx reelier@<version-printed-by-init> up
```

If that exact Reelier version is already installed on the command path, `reelier up` is the equivalent shorthand. The clean-directory contract is the pinned `npx` form; initialization never relies on a global install or floating second invocation.

The commands are an orchestration layer over Paths A, B, and C, not a fourth trust path and not a reinterpretation of their claims. `init` discovers and prepares; an independent operator authority activates; `up` supervises the usable lanes and refuses any Path C dispatch that lacks exact activated authority.

The internal architecture remains “wide intelligence, narrow consequential exits.” Models and harnesses may prepare broadly. Only deterministic, activated Path C Outcomes cross the certified consequential boundary.

## User experience

### `reelier init`

Bare `reelier init` remains the existing checkpointed, inspection-only operation. It never rewrites configuration, deploys, gates, signs activation, uploads, or dispatches.

### `reelier init <agent-name>`

Named initialization adds a reversible project-bootstrap transaction around the existing inspection:

1. Inspect known runtime, MCP, plugin, connection, replay, and Path C surfaces.
2. Write a closed project descriptor pinned to the exact executing Reelier version and canonical installed-build digest, plus the package/tarball integrity digest when the package manager exposes one.
3. Generate a workload key under the user's private Reelier home, outside the project, and write only its public-key commitment into an unsigned workload-registration request. The private key never enters project artifacts or reports. Key creation is not identity certification.
4. Write unsigned authority and Outcome Profile drafts for eligible candidates. Drafting is not activation or conformance certification.
5. Import already signed profile conformance records and tenant activations from operator-configured directories; never create either signature.
6. Plan reversible host configuration changes, show the exact coverage delta, and apply them only after explicit mechanical consent. `--yes` may consent to reversible file changes but can never sign or activate authority.
7. Run a hermetic installation canary. It proves only local component wiring.
8. Write a closed bootstrap report stating what was observed, replayable, activated, refused, or uncovered.

Non-interactive initialization never activates authority. If no activation exists, initialization still succeeds in observation-ready mode and says that Path C is unavailable.

Imported governance is restartable data, not process memory. The project records exact artifact and trust-head digests plus an opaque governance reference. On every `up`, Reelier resolves that reference only through the operator-owned trust directory under the user's Reelier home, reloads the draft, certification, activation, and public verification anchors, rechecks current trust and revocation, and recreates the opaque validated handle. Initialization may read and report this material but never writes the trust directory.

### `reelier up`

`up` loads the pinned project descriptor, verifies the executing Reelier build matches it, and starts or checks only the components the project controls:

- the configured Path A wrapper routes, whose stdio child lifecycle remains owned by the agent host rather than a Reelier daemon;
- the Path B frozen skills already present, reported as manual replay capabilities and never executed automatically;
- the Path C authenticated Outcome host only for externally activated definitions;
- the Continuity ledger/projection service;
- configured local runtime processes through closed runtime descriptors.

Externally managed runtimes such as a hosted bot are reported as externally managed; `up` starts their Reelier endpoint but never claims to launch or exclusively control the remote runtime.

The founder-facing default is a managed remote Authority Cell. Named initialization never asks a founder to provision Linux and `up` never creates a Cell. The managed Cell performs profile admission on its Linux host. Advanced operators may point the same client contract at an independently provisioned self-hosted Linux Cell; that path is explicit and receives no stronger claim merely because it is local.

The client authenticates with its short-lived principal credential, reads a sanitized Cell/session binding, and requires exact agreement on cell, tenant, principal, task, runtime session, job, grant, allocation, profile, activation, and contract digests before it exposes the Outcome requester. Workload and harness identity come from the installed, conformance-checked runtime adapter; request/model fields cannot supply or override any identity component.

The binding also carries its observation time, freshness deadline, and session expiry. The client refuses stale bindings, expired or revoked principal sessions, wider binding lifetimes, and Authority/adapter contract substitution. `up` never launches or provisions the Cell; both managed and advanced self-hosted Cells must already have admitted the exact governance through their operator-owned trust store before they can issue a binding.

`up` must remain useful without Path C activation. Unknown writes observed through Path A remain `unchecked`. Path B drift continues to fail closed. Missing, malformed, self-authored, stale, revoked, widened, or untrusted Path C activation refuses before dispatch.

## Product concepts and protocol objects

The founder-facing concepts remain six simple nouns:

1. Identity
2. Authority
3. Operation
4. Attempt
5. Observation
6. Receipt

They are presentation groupings only. The implementation preserves the canonical durable objects as separate records: tenant, principal, workload, runtime session, provider account, trust root, profile draft, profile certification, activation, delegation grant, semantic operation, compiled effect, budget reservation, attempt, send-started marker, provider acknowledgment, authoritative read-back, reconciliation, Outcome, receipt claims, prior/cleanup/terminal edges, exception, and continuity projection.

In particular, authorization, compilation, reservation, transport send, provider acknowledgment, and reconciled business Outcome never collapse into one status.

## Maker, approver, executor, reconciler, and verifier

The roles are purpose-separated even when a solo operator runs them on one machine:

| Role | May do | Must not do |
|---|---|---|
| Profile author | Produce an unsigned closed candidate | Mark it certified or activated |
| Conformance certifier | Test exact bytes and sign the profile digest plus vector-set digest | Activate tenant/account authority |
| Tenant operator | Activate an exact independently certified profile digest for named accounts, budgets, freshness, audiences, and delegation limits; separately record an unchecked self-authored choice for observation or shadow evaluation | Rewrite the certified profile, mint conformance status, or make an unchecked profile dispatchable |
| Workload | Request named Outcomes using request ID, opaque source handles, and bounded choices | Supply identity, credentials, endpoint, account, trust roots, or activation |
| Gate/compiler | Verify current authority and deterministically derive the sole allowed effect | Repair drafts, widen authority, or infer missing semantics |
| Dispatcher | Execute the sealed one-use attempt | Authorize semantics or retry ambiguity automatically |
| Reconciler | Read independent provider state | Upgrade absent evidence or manufacture post-state |
| Open verifier | Recompute claims from signed artifacts and external anchors | Author, repair, activate, or bless artifacts it verifies |

A tenant may record that it consciously accepts a self-authored profile, but conformance stays `unchecked` unless a separately trusted certifier signed the exact profile and vectors. An unchecked choice is observation/shadow-only and cannot authorize Path C dispatch. Explicit operator choice is not third-party certification.

## Outcome Profile boundary

“Outcome Profile” is product language for a closed bundle that joins existing Path C primitives. It is not an arbitrary plugin ABI and does not replace reviewed executable packs in v1.

An `OutcomeProfileDraftV1` contains only:

- stable profile ID and version;
- provider and account-binding requirements;
- referenced first-party pack alias, pack digest, and definition digest;
- authenticated account-probe requirement;
- source resolver, allowed reads, projection schema, and freshness requirement;
- model-selectable versus authority-derived fields;
- semantic operation-key inputs and idempotency rule;
- response-semantics profile digest;
- reconciliation recipe digest;
- declared topology requirements and non-claims;
- conformance-vector-set digest.

The draft cannot contain JavaScript, executable expressions, credentials, endpoints outside the registered pack, trust roots, signatures, or tenant activation.

The closed conformance report records exact profile, pack, definition, harness, vector, check-evidence, and source-revision digests plus four-state claims. `OutcomeProfileCertificationV1` signs the exact draft, report, and conformance-vector-set digests with a purpose-bound certifier key. An offline verifier recomputes those joins; the certification does not grant use.

`OutcomeProfileActivationV1` is a separate tenant-operator signature binding the exact draft and certification digests to tenant, validity, current trust head, and the existing signed Job Card, contract, deployment, and route-authority digests. Provider account, connector, audiences, budgets, delegation limits, and source authority remain authoritative only in those existing signed objects; the activation cannot duplicate, widen, or change them.

Public offline verification and host admission are deliberately different capabilities. Any caller may verify artifacts against caller-supplied roots and receive a non-authorizing report. Only the Cell's cold loader can mint the opaque host-admission handle, after resolving the fixed operator-owned trust directory, replaying a closed contiguous activate/revoke chain, checking current time/revocation, and joining the admitted bytes to installed packs and signed authority. A caller-created trust root, frozen object, cast, or self-consistent digest can never satisfy host admission.

OSS exposes one narrow Linux host composition root that performs that cold load internally and returns only the existing authenticated Authority Cell server; it never returns the admission handle or accepts caller-provided roots, paths, governance bytes, or verification callbacks. Managed Cloud deployment and advanced self-hosted service machinery call this root. Cloud owns provisioning, entitlement, isolated deployment, secret custody, founder UI, pricing, and lifecycle; OSS owns the deterministic admission/runtime protocol. Legacy `authority serve` remains unchanged.

Existing reviewed executable packs remain the deterministic compiler. They become reference implementations and escape hatches only after at least two materially different operations prove that a future closed declarative compiler can replace them without provider-specific escape hatches. This project does not prematurely delete or weaken static packs.

## Approved Task 2 amendment — independently signed Authority binding

**Approved:** 2026-08-14. This section preserves the original Outcome Profile rationale above and
corrects the authority-evidence gap found during Task 2 review. It supersedes the original Task 2
receipt/binding shape where the two conflict. The Outcome Profile contract is branch-only and
unshipped, so its v1 schemas and digest may change in place. `AuthorityReceiptBundle`, Authority
Contract v1, Path C gate/compiler/ledger/dispatch semantics, and the existing inner verifier remain
byte-for-byte unchanged.

Profile trust and Authority trust are separate domains. The existing activation
`trustHeadDigest` continues to mean the profile-governance replay head. A new required
`authorityTrustHeadDigest` commits the independently replayed current Path C Authority trust head.
No producer or verifier may substitute one for the other: their keys, purposes, event preimages,
and head algorithms differ.

Activation binds a stable route scope, never a future request. Replace activation-time
`routeAuthorityDigest` with `routeScopeDigest`, the digest of this closed record:

```ts
export interface AuthorityRouteScopeV1 {
  readonly v: "reelier.authority-route-scope/v1";
  readonly tenant: string;
  readonly definitionAlias: string;
  readonly connectorRegistrationDigest: string;
  readonly operatorConfigurationDigest: string;
  readonly routeDigest: string;
  readonly providerId: string;
  readonly connectorId: string;
  readonly accountId: string;
  readonly providerAccountIdentity: string;
  readonly endpointId: string;
  readonly credentialSlotId: string;
  readonly sourceReadRouteDigest: string;
  readonly projectionSchemaDigest: string;
}
```

Dynamic slot instance/version, authenticated-identity digest, expected materialized-request digest,
authority generation, and authority expiry remain receipt-time fields of the existing
`RouteAuthoritySnapshotV1`. At verification time its stable-field projection must equal the exact
`AuthorityRouteScopeV1`. A route substrate without an equivalent stable scope refuses governed
dispatch; broad observation or replay remains available through Paths A/B.

After the existing deployment loader has verified its signed Job Card, trust, states, connectors,
descriptors, adoptions, and enforcement, the host derives a path-free/key-object-free snapshot:

```ts
export interface AuthorityDeploymentSnapshotV1 {
  readonly v: "reelier.authority-deployment-snapshot/v1";
  readonly tenant: string;
  readonly jobCardDigest: string;
  readonly jobCardAuthorityDigest: string;
  readonly authorityStateDigest: string;
  readonly connectorRegistryDigest: string;
  readonly trustRootSetDigest: string;
  readonly connectionDescriptorsDigest: string;
  readonly connectionAdoptionsDigest: string;
  readonly enforcementDigest: string;
  readonly routeScopeDigest: string;
}
```

`deploymentDigest` is `authorityDigest(parsedDeploymentSnapshot)`, never a digest of a caller
record, path, raw deployment JSON, loaded key object, or self-asserted activation field.

Outcome Profile Contract v1 gains an eighth standalone member,
`SignedProfileAuthorityBindingV1`, discriminator
`reelier.profile-authority-binding/v1`. It carries purpose
`profile-authority-binding`, tenant, profile/activation/inner-receipt digests, exact Job Card,
contract, deployment, route-scope, dynamic route-snapshot, and Authority-trust-head digests,
`observedAt`, signer ID, and Ed25519 signature. Its signature uses the existing crypto purpose
`authority-evidence` over this domain-separated preimage; neither `AuthorityKind` nor
`AuthoritySignaturePurpose` widens:

```ts
const preimageDigest = authorityDigest({
  v: "reelier.profile-authority-binding-signature-preimage/v1",
  purpose: "profile-authority-binding",
  artifactDigest: authorityDigest(unsignedBinding),
});
```

The signer is the same active Authority Cell key descriptor whose role is `authority-cell` and
purpose is `authority-evidence` that signs the inner evidence artifact. Its SPKI and signer ID come
from the validated six-signer authority. It must be distinct from the profile certifier, profile operator, human
Job Card signer, local gate, topology, lease, and authenticated-provider-identity signers. As-of
Authority key descriptors/trust events and the Job Card trust pin are external verifier anchors;
the receipt cannot declare its own signer current.

`ProfileGovernedAuthorityReceiptV1` retains the four profile artifacts and the unchanged inner
`AuthorityReceiptBundle`. It adds `authorityBindingEvidence` containing the exact signed Job Card,
the parsed deployment snapshot, stable route scope, exact persisted dynamic
`RouteAuthoritySnapshotV1`, the later-amendment artifact-key binding/commitment, and
`SignedProfileAuthorityBindingV1`. Existing outer edges remain and add `authorityBindingDigest`.
The verifier preserves the original inner-kernel trust requirement through the executable
fifth-amendment order: strictly parse all records; externally verify profile, Job Card, readiness,
Authority as-of trust, outer signature, and artifact binding/commitment before constructing the four
artifact roots; run the unchanged inner verifier; verify exact signed artifact identities;
then perform deployment/scope projection and every activation, inner-contract, binding, artifact,
and edge digest join. It compares activation
`contractDigest` directly to `inner.bundle.contract.digest` and never upgrades or rewrites an inner
claim.

The governed runtime uses a load/core split. It loads the actual deployment once and derives the
actual installed pack, one exact eligible signed contract, signed Job Card, deployment snapshot,
route scope, and current Authority head before constructing the gate/runtime. Those objects and
digests are stored behind a private brand/`WeakMap`; no caller digest record, profile-root callback,
or cast can mint the binding. The accepted request persists its actual dynamic route snapshot, and
the governed publication creates outer evidence only from that private provenance, the actual inner
bundle, and the persisted snapshot. The validated receipt authority's existing `evidence` capability
also signs the domain-separated outer binding; there is no second outer signer option. The factory performs no
provisioning, listening, activation, or session-endpoint work.

The amendment also closes the five review evidence gaps: the no-dispatch matrix observes real
source/credential/reservation/prepare/provider counters; the physical operator-root identity is
pinned and revalidated across all six reads and replacement/symlink/junction races; Task 2 runs a
real public-factory positive in a Linux child with isolated `HOME`/`USERPROFILE`; hostile input,
artifact, trust, route, authority, receipt, and claim mutations are exhaustive; and shared fixtures
live in a helper that registers no tests. Maker remains different from verifier, the verifier
produces the receipt graph, and the existing Path A/B/C, Continuity, Cloud ownership, Task 6
session-binding, and Task 7 packed-consumer boundaries remain intact.

### Approved Task 2 second amendment — complete governed execution seams

**Approved:** 2026-08-14. The first amendment and the rationale that led to it remain decision
history. This second amendment supersedes only its incomplete execution seams: full inner-bundle
production, eligible-contract selection, stable route projection, dispatch-time freshness, and the
local Linux evidence claim. Authority Contract v1, every Authority schema, `AuthorityReceiptBundle`,
the existing bundle parser/verifier, reservation intent/ledger records, dispatch semantics, and
inner claims remain byte-for-byte unchanged. There is one receipt kernel and one verifier.

The host gains a general, purpose-separated receipt construction authority. Its public surface is
type-only: `ProducedReceiptKindV1`, `PurposeBoundReceiptSignerV1<K>`, and
`AuthorityReceiptSigningAuthorityV1`. The authority contains exactly six Ed25519 signer capabilities:
`sourceBundle`/`source-bundle`, `compiledCapability`/`compiled-capability`,
`transportEffect`/`transport-effect`, `evidence`/`authority-evidence`,
`receipt`/`authority-receipt`, and `packManifest`/`pack-manifest`. Every signer is an exact own-data
record `{ purpose, signerId, publicKey, sign({ purpose, digest }) }`; the six keys are authorized for
their exact purpose under the third-amendment artifact binding or direct external Authority trust,
as applicable, and distinct across purposes. Private keys never
enter Reelier. The existing receipt authority's evidence signer is reused for the domain-separated
outer binding. The six receipt keys are distinct from profile
operator/certifier, Job Card human, local-gate, topology, lease, and identity keys. Governed
dispatch requires the complete six-signer receipt authority; no separate binding-signer option is
accepted.

A package-private `AuthorityReceiptFoundationsV1` carries the exact already signed selected
contract, exact signed delegation chain, exact signed gate event, and parsed pack manifest.
`constructAuthorityReceiptBundle` takes only exact phase, dispatch state, outcome, one intrinsic
`observedAt`, those foundations, the fourth-amendment opaque validated six-signer handle, and
optional prior/recovered receipt state. It generates and signs only source bundle, compiled capability, transport effect, evidence,
receipt, and pack manifest artifacts; parses and verifies every returned signature; and delegates
assembly to the existing `createAuthorityReceiptBundle`. It does not publish, recover, send,
verify a completed bundle, or create trust roots. The certification lifecycle keeps its public API,
local-first/storage/recovery/extensions/cuts and delegates only this pure construction step to the
general module.

The governed host wraps its existing `DispatchPublication`. At publication it receives the actual
phase/state/outcome, private admitted provenance, and the exact durable
`state.reservation.intent.routeAuthority`; constructs the real inner bundle; immediately runs the
unchanged inner verifier; creates and signs the outer profile binding; immutably stores the outer
receipt; and only then forwards any configured portable publication. Restart recovery accepts only
an exact stored outer/inner/effect/prior chain, reuses recovered static artifacts, and reconciles
without automatic resend. Publication failure never causes a second provider effect.

Contract eligibility has one owner. A package-internal
`selectEligibleAuthorityContract({ snapshot, tenant, requester, definitionAlias, now, trustRoots,
packs, sources, connectors })` contains the existing gate `evaluate`/`evaluateCandidate` semantics
without byte-semantic change. `createAuthorityGate` calls it at both existing planning and
within-current-state sites. Governed preflight calls the same selector for every exact Job Card
audience and requires one unique shared digest equal to activation `contractDigest`. It is not
exported through any barrel.

Stable projection authority is route-owned. Closed `JsonHttpsRouteV1` gains a required nonzero
SHA-256 `projectionSchemaDigest`, included in parsing, canonical route digest, and read/write route
equivalence. It is never derived from a schema ID, pointer list, callback, or request snapshot. The
GitHub certification path computes its existing projection-schema digest first and writes that
exact value onto both routes; the dynamic snapshot copies the write route's field. Stable and
dynamic scope use the existing
`connectorRegistrationDigest(registry, tenant, connectorId, accountId)` algorithm.

The stable route scope is derived only from verified tenant, the Job Card's single definition alias,
the shared selected contract, the same installed definition/connector registry used by the gate,
and canonical native routes. Governed preflight requires exactly one write endpoint and exact
profile/provider/contract/connector/account/definition/write-endpoint/read-endpoint/projection joins.
`projectRouteScope(snapshot, { tenant, definitionAlias })` supplies the two verified contextual
fields absent from `RouteAuthoritySnapshotV1`; all other fields come from the parsed dynamic
snapshot. Canonical equality and digest agreement are checked immediately before reservation, and
the driver independently requires the snapshot projection digest to equal the canonical route.

Long-lived servers revalidate current authority twice per invocation: once before local
`outcome`/`invoke`, with every source/credential/reservation/prepare/provider counter still zero,
and again through a package-internal `beforeReserve(intent)` gate hook after the actual dynamic
snapshot/intent exists and immediately before `ledger.reserve`. With no hook, legacy gate bytes,
traces, and behavior are unchanged. Each check uses one intrinsic observation time, cold reloads the
fixed profile governance, rereads external Job Card trust/current Authority events, requires
unchanged physical root/manifest/profile/activation bindings and both fresh trust heads, requires
all receipt signers externally authorized through the validated handoff and appropriately segregated, and enforces
`activation.validFrom <= observedAt < activation.validUntil`. The pre-reserve check also projects
the exact intent route scope. The observation is stored only behind private capability provenance
for same-process publication; restart recovery relies on stored signed evidence plus fresh
reconciliation and never on that process map.

Digest derivations are fixed: `jobCardDigest = signedJobCardDigest(jobCard)`;
`jobCardAuthorityDigest = authorityDigest(parsed JobCardTrustMaterialV1)`;
`authorityStateDigest = authorityDigest(exact selected parsed AuthorityStateSnapshot)`;
`connectorRegistryDigest = authorityDigest(sorted exact connectorRegistrationDigest strings)`;
`trustRootSetDigest` uses the existing helper; descriptor and adoption digests are
`authorityDigest` of their parsed arrays in parsed order; enforcement is `authorityDigest` of its
parsed record; deployment is `authorityDigest(parsed AuthorityDeploymentSnapshotV1)`; and route
scope is `authorityDigest(parsed AuthorityRouteScopeV1)`.

The Task 2 Linux public-factory test is registered everywhere. On Linux it runs; on non-Linux it is
an explicit platform-gated skip with exact reason
`requires an already-available Linux Node executor`. A skip is not a pass. This Windows host has no
already available Linux Node executor or Docker daemon, and no install/start/download is authorized;
Linux execution remains mandatory Task 7/CI evidence and a final-report limitation.

### Approved Task 2 third amendment — governed prepared-dispatch publication

**Approved:** 2026-08-14. The first two amendments remain immutable decision history. This third
amendment supersedes only their incomplete prepared-dispatch publication and artifact-subkey
authorization details. Authority Contract v1, `AuthorityKeyDescriptorV1`, every Authority schema,
`AuthorityReceiptBundle`, its parser/verifier, the ledger and reservation wire records, provider-send
semantics, and every inner claim remain unchanged. The general constructor and governed publisher
continue to delegate to the one existing receipt kernel and verifier.

The certified prepared-dispatch coordinator gains one optional compatibility seam on
`DispatchPublication`: `publishReservation`. Legacy publishers that omit it behave byte- and
trace-identically. A governed publisher must implement it. After `commitPreparedDispatch` succeeds
and makes the attempt non-resendable, but before `consumePreparedDispatch` can call the provider,
the coordinator asks the governed publisher to construct, verify, and immutably store a reservation
inner bundle plus outer governed root. Any construction, signing, verification, or storage failure
propagates before provider send. The later terminal publication runs after the actual effect and
before terminal ledger transition, uses the durable reservation inner receipt as `priorReceipt`, and
reconciliation chains to the terminal inner receipt. On restart, the governed publisher loads and
verifies the stored reservation root by exact reservation/effect/route/foundation joins, restores
its static foundations, and reconciles without resend. A cut before root storage produces no
provider call; a cut after root storage but before send, after provider apply but before terminal
storage, or after terminal storage preserves a single unforked chain wherever an effect/evidence
node exists.

The general `AuthorityReceiptBundleConstructionInputV1.phase` therefore includes
`"reservation"`. That phase is byte-semantic compatibility, not a new Authority kind: it uses the
existing lifecycle result preimage `authorityDigest({ reservationId, phase: "reservation" })`,
receipt ID derivation over that result, one `reserved` timeline node, `dispatchedRequestDigest:
null`, reconciliation `not-attempted`/null projection, dispatch claim `absent`, unchecked provider
acknowledgment/reconciliation/topology/completeness, exact recovered static foundations, exact
signatures, and `priorReceiptDigest: null`. The certification lifecycle delegates this phase and all
later phases to the general constructor while preserving its current local-first/storage/recovery/
extension/cut bytes and three-node/restart/no-resend behavior.

Four generated artifact keys are not direct Authority descriptors and must never be made so.
`source-bundle`, `compiled-capability`, `transport-effect`, and `pack-manifest` callbacks are
authorized by the existing `CertificationArtifactKeyBindingV1` and its human-signed
`CertificationArtifactKeyBindingCommitmentV1`. The binding is signed by an active direct
`authority-evidence` parent, commits exactly four unique purpose/key-ID/SPKI/digest entries, links the
exact signed readiness, Cell, task, Adapter Contract, schedule, issuance, and expiry, and is verified
with existing `verifyCertificationArtifactKeyBinding`. The direct inner `authority-evidence` and
`authority-receipt` signer continues to use direct
descriptor/event replay. Neither `AuthorityKeyDescriptorV1` nor Authority Contract v1 widens.

The governed structural signing input contains the six callbacks plus an all-or-nothing artifact
authorization `{ binding, commitment }`; it confers no authority by itself. The package-private
validator specified by the fourth amendment matches the four artifact callbacks to binding entries,
the direct evidence callback to the active parent descriptor, and the receipt and outer binding
callbacks to separately active direct descriptors, and enforces every segregation rule before
minting the opaque handle used by construction. Admission validates the portable authorization
against fixed Job Card signed-readiness material and current external trust. Publication consumes
only a freshly validated handle bound to its single `observedAt`.
Offline verification has no callbacks: it matches the four actual signed inner artifacts to the
externally validated entries and replays direct signer activity at binding `observedAt` and verifier
time in the exact fourth-amendment order. The binding and
commitment travel in private provenance and in `authorityBindingEvidence`, so restart and an open
verifier never depend on caller assertions or process memory. `SignedProfileAuthorityBindingV1`
adds required `artifactKeyBindingDigest` and `artifactKeyBindingCommitmentDigest`, so neither
portable authorization object can be substituted independently of the signed outer join.

`DispatchPublication` compatibility is exact even when an outer receipt is stored:
`receiptRef = authorityDigest(inner.receipt.value)` and
`evidenceDigest = inner.evidence.digest`. Only an inner receipt-value digest may become the next
inner `priorReceiptDigest`. The immutable outer object is indexed by reservation/effect and that
inner reference; its own digest is an outer storage/evidence identity exposed only through outer
edges and verification, never a coordinator result or inner prior. Two-node and restart falsifiers
must fail any implementation that substitutes the outer digest.

### Approved Task 2 fourth amendment — durable-head recovery and validated trust handoff

**Approved:** 2026-08-14. This amendment preserves all three earlier amendments as decision history;
its conflicting recovery/trust details are superseded by the fifth amendment and 51-path allowlist. Authority Contract v1,
`AuthorityKeyDescriptorV1`, Authority schemas, `AuthorityReceiptBundle`, its parser and verifier,
ledger records, provider-send semantics, Paths A/B/C, Continuity, Cloud ownership, no-resend, and
Linux-evidence rulings remain unchanged.

`DispatchPublication` gains a second optional read-only compatibility seam, `loadDurableHead`.
Legacy publishers that omit it retain byte-, trace-, and behavior-identical recovery. The governed
publisher strictly parses and verifies its immutable stored inner/outer chain against fresh external
anchors before returning a detached closed head containing its reservation/effect/route identity,
tenant/request/capability identity, phase, ledger terminal kind, inner `receiptRef`, inner
`evidenceDigest`, dispatched-request digest,
and exact inner prior reference. It never reads or mutates the ledger. The coordinator remains the
single ledger lifecycle owner.

During certified restart, a dispatched ledger reservation is handled in this order. A verified
durable terminal head whose reservation, effect, route, request, root, and prior identities match
the recovered reservation causes the coordinator to perform only the matching ledger terminal
transition; it publishes no sibling and never resends. A verified reservation-only root may publish
one ambiguity child and transition to ambiguous. Absence of a durable root, multiple/forked heads,
tamper, invalid signatures, a phase/terminal mismatch, or any identity conflict each refuses recovery without
publication, transition, reconciliation, or send. The terminal mapping is closed: dispatch plus
`acknowledged` maps to ledger `acknowledged`; dispatch plus `definitive-failure` maps to
`definitive-failure`; dispatch or ambiguity publication plus `ambiguous` maps to `ambiguous`; and a
reconciliation publication maps to `reconciled`. Cancellation is never a dispatched-recovery head.
An ambiguous recovered head is written to the ledger with its inner `receiptRef`, so subsequent
reconciliation uses that exact inner head as prior. Outer digests never become ledger results or
inner priors.

The required crash matrix is therefore unambiguous: before reservation-root storage means zero send
and recovery refusal; after root storage/before send and after provider apply/before terminal storage
recover from the root by publishing one ambiguity child; after terminal storage/before ledger
transition adopts the verified terminal head with no sibling; after ledger transition is already
terminal. Optional portable forwarding cannot become another lifecycle owner: a failure after the
governed terminal is durable is recovered through the same terminal-head adoption.

Raw signing callbacks and receipt-carried artifact bindings never confer authority. A
package-private validator in the already allowed trust/receipt-authority/lifecycle-authority
modules consumes the exact external signed readiness, strictly parsed current descriptors and
contiguous trust events, expected tenant/Cell/task and one observation time, exact binding and human
commitment, six purpose-bound signer capabilities, and mode-specific private segregation anchors.
The evidence capability is also the outer signer. It replays current activity/revocation; calls the
existing artifact-binding verifier; verifies the human commitment and validity interval; matches
IDs, SPKIs, purposes, parent, readiness, Cell/task, and Adapter Contract; enforces cross-purpose key
uniqueness; and returns only a module-private branded/`WeakMap` handle. The general inner-bundle
constructor accepts that handle, never raw callbacks or `{ binding, commitment }`. Governed outer
signing consumes the same handle. The lifecycle adapter can obtain one only while holding its
already verified opaque lifecycle material, whose binding and commitment are retained as exact
detached copies; casts, spreads, freezes, and structural lookalikes cannot mint it.

Offline verification is explicitly non-self-anchoring under the fifth-amendment order. It strictly
parses all records, verifies external profile and Authority as-of trust, the outer signature, and the
binding/commitment before constructing exact roots for the four artifact kinds. It then runs the
unchanged inner verifier and matches the exact signed inner source-bundle, compiled-capability, transport-effect,
and pack-manifest signer IDs, SPKIs, purposes, and signatures to the four authorized entries,
verifies every direct-authority inner artifact and the outer binding under external current
descriptors, and only then joins all profile, activation, deployment, route, inner, binding, and edge
digests. No callback exists offline. Receipt-carried subkeys become roots only after external
authorization and can never authorize themselves. A
self-consistent forged binding and inner bundle without valid external readiness/current-parent
authorization must fail.

### Approved Task 2 fifth amendment — first-principles cumulative reset

**Approved:** 2026-08-14. This section and the rewritten executable Task 2 fix wave supersede every
conflicting detail in the prior amendment narratives while preserving their rationale. The Authority
ledger implementation/API/wire, Authority Contract v1, `AuthorityReceiptBundle`, its parser/verifier,
Paths A/B/C, Continuity, Cloud ownership, Linux evidence, and no-resend rules remain frozen. Task 2's
ceiling is exactly 51 tracked paths.

The Authority ledger and governed receipt store have disjoint ownership. The coordinator alone owns
ledger transitions. The immutable governed store alone owns receipt-chain/prior truth and never
reads or mutates the ledger. Certified prepared commit is two durable appends: the
`reserved -> dispatched` transition may survive a crash before the `send-started` marker. Governed
dispatch/recovery checks that marker before constructing any store query. A markerless dispatched
row is permanently refused with no store call, transition, reconciliation, publication, or provider
send. Once `sendStarted === true`, and before provider send, the governed publisher constructs,
verifies, and atomically stores reservation root R. It stores terminal T after provider outcome and before the matching ledger
transition. Acknowledged/definitive transitions carry `T.innerReceiptRef`; ambiguous transitions are
always result-less because the concrete filesystem ledger rejects an ambiguous `resultDigest`.
Outer digests are never ledger results or inner priors.

Durable compatibility is an optional all-or-none pair: reservation publication plus a read-only head
query. Publication and query share one closed identity derived once from the actual persisted
reservation. Its reservation-intent digest is the domain-separated authority digest of the full
strictly parsed `StoredReservationIntent`-equivalent value, including canonical byte encodings,
ordered limits, optional execution context, and exact dynamic route; ledger/runtime/provenance
members are excluded. The query nests that identity and adds only ledger state plus literal
`sendStarted: true`; it is a dedicated strict record, not a `DispatchRequestState` cast. The returned closed union
commits the same query identity plus inner receipt/evidence reference, root, exact prior, phase, and
terminal kind. `null` means only that a verified readable store contains no chain; unreadable,
tampered, forked, or multiply headed storage throws. Semantic CAS permits exactly one R and at most
one successor for each exact prior/semantic phase; concurrent equal recovery returns the same stored
node and can never fork. Portable forwarding never owns lifecycle.

| Ledger L | Verified store head H | Coordinator action |
|---|---|---|
| `reserved`, pre-CAS | not queried | Preserve current cancellation/recovery bytes; no governed durable method runs. |
| `dispatched`, `sendStarted !== true` | not queried | Permanently refuse before constructing the strict query; zero store, transition, reconcile, publication, or provider calls. |
| `dispatched`, `sendStarted === true`, no chain | `null` | Refuse: send-started without R is an integrity failure; never send or synthesize. |
| `dispatched`, `sendStarted === true` | R | Semantic-CAS one ambiguity A after R, then result-less `dispatched -> ambiguous`; no resend. |
| `dispatched`, `sendStarted === true` | T acknowledged/definitive | Adopt T and transition with `T.innerReceiptRef`; no sibling/resend. |
| `dispatched`, `sendStarted === true` | T ambiguous or A | Adopt exact head and transition result-less to `ambiguous`; no sibling/resend. |
| `ambiguous` | exact T-ambiguous or A | No-op. The store head, not the ledger, supplies reconciliation prior. |
| `ambiguous` | Q reconciled | Adopt Q and transition with `Q.innerReceiptRef`; no resend. |
| `ambiguous` | anything else | Refuse as conflict/tamper/fork. |

Reconciliation first loads and verifies exact T-ambiguous or A, uses that head's inner receipt as
prior, semantic-CAS appends Q, and only then transitions the ledger to `reconciled` with
`Q.innerReceiptRef`. The crash matrix covers pre-CAS reserved; partial prepared commit after the
dispatched transition but before `send-started`; send-started before R; after R before
send; after provider apply before T; after T before ledger terminal; after result-less ambiguity; after
Q before reconciled; and every after-transition no-op. Phase/terminal, query, root, prior, identity,
signature, multiple-head, and concurrent recovery falsifiers all refuse without resend. Legacy
publishers missing both durable methods retain exact trace/call/transition behavior.

Trust has two clocks and two domains. Historical cryptographic authority is verified against the
profile and Authority event prefixes valid at signed `observedAt`. The recorded head must identify a
valid as-of prefix, not equal the latest head forever. Verifier-time activity/revocation/expiry and
latest as-of head are reported separately and never erase valid historical proof. Event replay is
contiguous and time-filtered; future events relative to the relevant observation, forks, unknown
keys, prefix rollback, and recorded non-prefix heads refuse. Profile governance trust and Authority
trust remain separate roots, events, and heads.

`CurrentAuthorityTrustViewV1` is an opaque `WeakMap` handle created only from the full external
`JobCardTrustPinV1`, expected tenant/Cell/task, and one observation time. It verifies signed
readiness, descriptor/event chains and as-of/current heads. The admitted profile handle privately
retains exact profile certifier and operator signer ID+SPKI commitments. Governed provenance adds
the exact Job Card human, local gate, topology, lease, and authenticated-provider-identity anchors
that are actually configured. Lifecycle mode explicitly excludes profile/route-only anchors;
governed mode requires all applicable anchors. These private mode-specific anchors—not caller
records—drive segregation before a signing handle is minted.

There is one direct active `authority-evidence` Cell signer. It signs the inner evidence and, over
the already defined domain-separated preimage, the outer profile-authority binding. Current
readiness has one Cell key per direct purpose, so a second direct evidence key is invalid. The four
artifact subkeys are authorized first by the externally verified binding and human commitment. Only
then does `ValidatedAuthorityReceiptSigningAuthorityV1` combine the trust view, exact six signers,
binding/commitment, and mode anchors into an unforgeable constructor handle. No raw callbacks,
binding objects, stored verified flags, or structural copies reach construction.

`src/authority/certification/cell.ts` is the sole place with both the full pin and genuine lifecycle
material. It creates/registers a private refreshable trust context into that genuine material for
the unchanged public certification runner; no public runner API widens. The lifecycle adapter can
mint only lifecycle-mode validation from that registered context. Governed composition mints only
governed mode from admitted private provenance.

Offline verification accepts an exact closed options record whose direct Authority roots are an
enumerable `readonly TrustRootEntry[]`, never opaque `TrustRoots`. Every direct entry must match the
external Authority as-of view by tenant, signer, SPKI, and exact direct-purpose set; duplicate,
self-carried, missing, extra, or wrong-purpose roots refuse. No Job Card descriptor contains a
`principalId` mapping, so none is inferred or required from that view. After the external evidence
key verifies the outer signature, the parsed deployment snapshot digest must equal the signed
binding's `deploymentDigest`. The verifier then constructs the direct-only five-purpose root set,
recomputes `trustRootSetDigest` for the expected tenant, and requires exact equality to the
authenticated deployment snapshot. That full-set commitment binds each declared principal without
pretending the Job Card descriptor supplied it. Only after this equality and artifact binding
authorization are the four exact subkey entries appended to make the final temporary root set for
the unchanged verifier.

Offline verification order is fixed: strictly parse all closed records; verify profile artifacts
against external profile trust as of `observedAt`; verify external Authority readiness/event prefixes
and signed Job Card into the as-of trust view; verify the outer binding signature with the same
external direct evidence signer and authenticate the exact deployment snapshot digest; validate the
five direct purposes and their as-of signer/SPKI joins; require their recomputed root-set digest to
equal the authenticated deployment snapshot; verify binding/human commitment/current parent; only
now append the four externally authorized artifact subkeys; run the unchanged inner verifier; match
all four signed inner artifact signer IDs/SPKIs/
purposes; then verify deployment, route, activation, receipt, and edge joins and produce the graph.
Verifier-time status is attached separately. Receipt-carried keys never become provisional or
self-authorizing roots.

Governed gate signing is also side-effect-free. A package-private
`loadExistingLocalGateSigner(file)` resolves and opens an existing file read-only with no-follow/
stable-handle identity checks, parses exactly one Ed25519 private key, derives its public key, and
returns a detached signer. ENOENT is a typed refusal. It never creates a parent, generates a key, or
writes/renames/removes anything. Governed composition compares that public key to the pinned gate
anchor and passes the same preloaded signer into the internal runtime core without reopening it.
Public `loadOrCreateLocalGateSigner` and legacy runtime behavior remain byte-compatible.

## Why this does not require thousands of Reelier integrations

Reelier does not become the tool catalog, OAuth broker, or universal transport SDK. Existing MCP servers, host plugins, OpenAPI catalogs, Composio-style tool providers, Vercel Connect, and native provider adapters may describe or carry routes. A provider-neutral discovery adapter turns those descriptions into the same closed route rows; it does not confer trust.

Path A can observe any configured MCP-shaped route without bespoke semantic code. Path B can freeze any successfully recorded MCP workflow. Path C stays intentionally narrower: it governs a small catalog of semantic state transitions such as "set labels," "send reply," "issue refund," or "release deployment," and joins each one to reviewed source, compile, response, reconciliation, and receipt contracts. Many provider tool names may map to one semantic operation class. Unknown transports and operations remain usable through the broad lanes but never inherit a certified Outcome claim merely because a catalog listed them.

## Coverage and topology

Every discovered route is reported independently in one of these lanes:

- `observed`: Reelier has evidence that the configured call crosses Path A;
- `replayable`: a Path B skill and current manifest bind it;
- `outcome-capable`: a matching registered Path C pack/profile exists but is not necessarily activated;
- `activated`: current tenant activation and trust exist;
- `enforced`: activated plus fresh topology evidence proves the declared consequential surface is exclusively reachable through the Authority Cell;
- `uncovered`: an equivalent route is known to bypass Reelier;
- `unknown`: there is insufficient evidence to classify it.

Counts never imply completeness. Plugin-private MCP entries, direct HTTP, writable browser sessions, remote tools, ambient provider credentials, and equivalent write routes remain explicit coverage findings. OpenAPI, AI SDK, Composio, Vercel Connect, or another tool ecosystem may improve discovery and credential delivery; none alone proves interception, authority, or topology.

Each row carries observation time, freshness deadline, and evidence digest. The initialization artifact is a baseline, not live truth. `up` re-observes supported surfaces before presenting current counts; unreadable, changed, or expired evidence downgrades to `unknown`. Enforced mode additionally requires fresh signed topology evidence from the Authority Cell.

Observed mode is the default. Enforced mode refuses unless provider credentials exist only inside the Authority Cell, equivalent raw egress and writable browser routes are absent, account identity is freshly probed, and the registered governed route is the only usable write route. It never silently falls back while retaining an enforced claim.

## Runtime descriptors and supervision

Runtime adapters are replaceable and closed. A local descriptor contains an adapter ID, pinned adapter version/digest, executable path, ordered arguments, working directory, allowed environment-variable names, authenticated session-binding method, and shutdown policy. It never contains secret values.

An external descriptor contains an adapter ID, pinned protocol digest, authenticated endpoint binding, and `externally-managed` launch mode. `up` may expose the gateway and health information but does not claim process ownership.

The supervisor:

- validates the full project and descriptor graph before spawning anything;
- validates host-owned wrapper configuration and starts any owned authenticated endpoint before local workloads, without daemonizing `reelier mcp` or `reelier serve`;
- passes identity through host-owned authenticated context, never model input;
- starts no Path C host when no activation validates;
- shuts down only exact child processes it created;
- preserves durable ambiguity and performs no automatic resend on restart;
- reports partial startup honestly and never upgrades coverage because a process is alive.

## Version and supply-chain pinning

The `@latest` selector is permitted only for the initial bootstrap fetch. Initialization records:

- exact Reelier semantic version;
- exact public commit when present;
- a mandatory canonical installed-build digest over the sorted shipped file set;
- package/tarball integrity digest when externally available;
- authority contract digest;
- Continuity adapter contract digest;
- runtime adapter IDs, versions, and digests;
- imported profile, certification, activation, and trust-root-set digests.

`up` verifies those pins before starting. A floating or substituted build refuses with an exact recovery command. It never silently rewrites the pin.

## Compatibility

- Bare `reelier init` and `reelier init --dry-run` retain their current inspection-only behavior and artifact versions.
- Existing `install`, `mcp --wrap`, `run`, `authority`, `connections`, `connect`, `deploy`, `doctor`, `coverage`, and Continuity APIs remain available as advanced/debugging commands.
- Existing Path A/B records remain byte-compatible.
- Existing Authority Contract v1, `AuthorityReceiptBundle`, Path C packs, inner receipts, gate behavior, and inner offline verification remain byte-compatible. The branch-only unshipped Outcome Profile v1 contract changes in place only as specified by the approved Task 2 amendment.
- Existing runtime adapters and conformance contracts remain replaceable; the bootstrap project references them by exact digest rather than importing private implementations.
- Managed Cell is the default UX on every founder platform. Existing self-hosted Linux Cell commands remain available as advanced operations and are never run by `init` or `up`.

## Failure behavior

- Inspection or coverage failure yields `unknown`, not absence or success.
- Mechanical configuration failure rolls back through existing backups or reports partial application precisely.
- Draft, certification, activation, trust, version, or topology substitution refuses Path C before dispatch.
- Path A recorder failure remains fail-open and recorded as degraded policy/coverage.
- Path B manifest drift remains fail-closed before replay dispatch.
- Path C ambiguity remains ambiguous until independent reconciliation; restart never resends automatically.
- A canary failure means installation self-test failed. A canary pass proves neither provider integration, profile conformance, activation, topology, traffic completeness, semantic correctness, nor safety.

## Implementation sequence

1. Freeze project, runtime, profile-draft, certification, activation, and bootstrap-report schemas plus mutation corpus.
2. Implement independent profile certification/activation verification around existing packs without adding a new executable DSL.
3. Add named bootstrap mode while preserving bare inspection.
4. Add reversible host configuration planning and truthful per-route coverage.
5. Add the pinned supervisor and runtime-neutral authenticated Outcome composition.
6. Prove A/B/C lane separation, no automatic activation, restart/no-resend, and externally managed runtime honesty in one hermetic tracer bullet.
7. Ship packed-consumer verification, migration documentation, and an open bootstrap conformance checker.

## Acceptance evidence

The feature is not complete until committed tests demonstrate:

- `init`-created keys, drafts, and canaries cannot satisfy certification or activation verification;
- `--yes` cannot activate authority;
- a distinct trusted certifier signature plus tenant operator activation is required for a certified activation claim;
- a public self-rooted offline verification result cannot be cast or promoted into Cell admission;
- a self-authored operator choice remains explicitly `unchecked`, observation/shadow-only, and non-dispatchable;
- bare `init` remains byte/behavior compatible and inspection-only;
- a clean directory with no global install can execute the exact pinned `npx ... up` command printed by named initialization;
- named `init` writes only declared reversible project artifacts and sanitized reports;
- per-route plugin, direct-HTTP, browser, and remote bypasses remain uncovered/unknown;
- `up` refuses build, adapter, profile, trust, activation, and topology substitution before process spawn or provider dispatch;
- unknown Path A writes remain unchecked, Path B drift refuses, and unactivated Path C refuses;
- a valid activated hermetic Outcome crosses send-started exactly once, reconciles from independent state, and publishes a verifiable receipt;
- killing and restarting the supervised runtime does not multiply the provider effect or budget;
- external runtimes are never reported as locally launched or exclusively controlled;
- the verifier can validate the final artifacts offline without using creator state;
- current Path A/B/C, Continuity, candidate, live-runner, and Gate 4 focused gates remain green.

## Falsifiers

Reject or redesign this architecture if any of these is true:

1. The simple UX requires collapsing Path-specific claims.
2. `init` must trust a root, profile, or activation it generated automatically.
3. A profile language requires arbitrary runtime code to cover the first two materially different operations.
4. `up` can report enforced coverage while an equivalent writable route remains available.
5. The supervisor must place provider credentials in the agent process.
6. A restart can create a second consequential effect or consume budget twice.
7. Users cannot understand the coverage report without learning internal Path A/B/C terminology.
