# Compiled Authority v1

Path C delegates bounded outcomes, never credentials. It is opt-in and does not alter Path A's live MCP recording or Path B's frozen replay bytes.

Authority objects are independently versioned, closed JSON objects. Their bytes are RFC 8785/JCS; their digest is `sha256:<lowercase hex>`; Ed25519 signatures cover exactly `reelier-authority-v1\nsha256:<digest>`. The digest is over a closed JCS envelope containing the authority purpose and payload digest, so purpose is bound without inserting a purpose line into the signature domain. Unknown versions and malformed, stale, revoked, cross-tenant, duplicate, or unchecked authority refuse before provider dispatch.

Roles are accountable sponsor, operator signer, authenticated requester, gate, connector account, and provider. An immutable signed `OutcomeContract` binds the tenant and contract ID; definition alias and digest; pack digest; validity; accountable sponsor; authenticated requester audiences; delegation leaf digest; connector and provider account; source resolver, projection schema, allowed read endpoints, and authorized projection JSON Pointers; allowed risk classes; quantitative limits; and a tenant-policy commitment. Append-only revocation changes activation state rather than editing a contract. A contract edit creates a new digest and activation.

The four v1 quantitative limits are `maxEffectsPerWindow`, `windowSeconds`, `maxEffectsPerSourceTrigger`, and `maxBodyBytes`. They are positive bounded integers. V1 uses fixed-window attenuation: a descendant's `windowSeconds` must remain exactly equal to its parent's value. The three maxima `maxEffectsPerWindow`, `maxEffectsPerSourceTrigger`, and `maxBodyBytes` may remain equal or decrease, never increase. Task 2's delegation validator enforces those exact parent/child comparisons and the later gate enforces runtime counts; the wire layer only proves that the complete comparable values were signed.

`policyCommitment` is the closed tuple `{ schemaId, jcsBase64, digest }`. `jcsBase64` decodes to exact JSON bytes, those bytes must already be their RFC 8785/JCS form, and `digest` is SHA-256 over those exact decoded bytes. This commits tenant-specific templates, channel, timing window, and state policy without exposing a mutable provider template ID. The statically bundled definition identified by `schemaId` owns interpretation; credentials, secret references, authorization headers, and provider template IDs are not contract fields.

Delegation grants are signed explicit roots (`parentDigest: null`) or children (`parentDigest: sha256:…`). Every grant binds the sponsor, grantor, grantee, tenant, validity, and closed constraints for definition aliases, audiences, connector/account pairs, projection pointers, risk classes, and the same quantitative limits. Arrays are nonempty, bounded, and unique; there is no wildcard or implicit-all form. Task 2 validates chains and rejects descendant widening; host-local trust roots and activation/revocation history are not wire inputs.

Requests contain only a caller-stable request ID, opaque source references, and bounded definition choices: never tenant, connector, account, endpoint, recipient, body, URL, provider arguments, or credentials. The gate-local authenticated-request constructor strictly parses and detaches that wire value, seals authenticated tenant/requester and route/tool definition alias outside it, retains exact canonical bytes, and derives both the request digest and the global request key. The request key hashes domain `reelier-authority-request-key/v1\0` followed by four-byte big-endian-length-prefixed UTF-8 field-name/value pairs for `tenant`, `requester`, and `requestId`, in that order. Definition alias is deliberately excluded from the global tuple but remains separately sealed; the durable ingress owner treats an alias mismatch as conflict.

Source bundles are constructed by the kernel from a registered deterministic resolver; mutable hosts never submit candidate bundle semantics. A resolver plans bounded opaque reads, the kernel assigns ordered indexes and digests, and arbitrary-order host observations are copied and normalized before the resolver receives immutable Base64 evidence. The plural wire bundle commits nonzero `sourceRefsDigest`, `readSetDigest`, and ordered `{index, planDigest, endpointId, rawDigest}` provenance. It binds resolver-derived source/trigger identities and a projection whose every leaf has exactly one grounded, authored, or unresolved claim; interior paths, missing leaves, duplicate ownership, and unauthorized pointers refuse. Claim arrays are sorted by pointer then ID. Kernel time supplies `observedAt`; `freshUntil` uses the contract freshness capped by the registered resolver maximum, both bounded to 1..300 seconds. The compiler recomputes the source snapshot and checks every read endpoint against both static and contract allowlists.

Ingress idempotency is `(tenant, requester, requestId)` over canonical request bytes; semantic deduplication independently derives an outcome key from tenant, contract digest, definition alias, source identity, and trigger identity.

## Gate-local commitments and authority state

Connector registrations are opaque runtime-branded, non-secret gate-local values keyed by tenant,
connector, and account. Their closed canonical commitment binds provider account identity, sorted unique
read/write endpoint allowlists, sorted risk classes, and a nonzero operator-configuration digest. Read
and write endpoint classes may not overlap. Registrations contain no callback, URL, credential, or
provider transport function, and returned snapshots are detached.

The local commitment set also binds every tenant trust root by signer/principal/purpose and raw
SHA-256 SPKI digest, the selected static pack definition excluding its functions, and each selected
source resolver excluding its functions. Arrays use locale-independent UTF-16 code-unit order.
Detached Ed25519 signatures have their own closed `reelier.authority-signature/internal-v1`
commitment and must decode from canonical Base64 to exactly 64 bytes.

The exact authority-state commitment is
`reelier.gate-authority-state/internal-v1`. It binds tenant, authenticated definition alias, a
positive persistent safe-integer version, every strict stored contract candidate, the full ordered
delegation envelopes and activation/revocation events, the tenant trust-root set, selected definition,
all required resolver and connector registration digests, and a nonzero operator-installed local gate
policy digest. Candidate records use `reelier.authority-state-candidate/internal-v1`; their canonical
contract/delegation Base64, parsed value digests, advertised digests, signer IDs, signature digests,
and ordered events are all committed. Candidates sort by record digest. Advertised/value mismatch or
an untrusted but strictly shaped signature remains commit-able for later rejection; malformed or
noncanonical wire bytes/signatures, duplicate candidate commitments, missing registrations, broken
indexes, or nonchronological events produce no state digest.

The runtime-branded `AuthorityStatePort` is an internal wrapper around one trusted local backend. It
loads the complete tenant/alias candidate set, replaces backend tokens with unforgeable local tokens,
advances a backend-owned persistent `(version,digest)` high-water, holds a short current-state read
lease around a callback, and copies raw source observations. Its closed results distinguish changed,
rollback, refused, corruption, and unavailable states. The wrapper proves token/detachment integrity,
not backend fsync conformance; this slice supplies no production authority-state backend or provider
read implementation. Contract selection, gate decisions, dispatch handles, provider writes,
credentials, and receipts remain unbuilt.

Fixed contract-window limit keys hash the exact tenant, contract digest, UTC window-start epoch
milliseconds, and duration milliseconds under
`reelier-authority-contract-window-limit-key/v1\0`, using the same four-byte length-prefix encoding.
The window containing signed capability `issuedAt` is half-open and starts at
`floor(epochMs / durationMs) * durationMs`. Provider-source-trigger keys hash tenant, connector,
provider account identity, resolver, source identity, and trigger identity under
`reelier-authority-provider-source-trigger-limit-key/v1\0`; they deliberately contain neither
contract nor definition and are not time-windowed.

Every gate decision is bound to an independently versioned, closed `DecisionContext` preimage. It always names the authenticated `tenant`, authenticated `requester`, authenticated `definitionAlias`, caller-stable `requestId`, canonical request digest, and ingress request key. It also carries explicit nullable contract, capability, outcome, effect, source-bundle snapshot, and authority-state snapshot commitments. Every property is required: `null` means the artifact did not exist at the decision point, while omission, empty-string sentinels, and all-zero digest sentinels are invalid. Capability ID and capability digest have paired nullability, and downstream artifacts cannot exist without their required upstream commitments. An accepted dispatch context requires every nullable commitment to be non-null. Refusal handling may report only neutral artifact presence (`absent` or `unchecked`) at this wire layer; the gate runtime is not built in this prerequisite slice.

`CompiledCapability` closes the exact authenticated tenant/requester/definition alias, request digest/key, contract and source commitments, authority-state digest, four quantitative limits and their commitment, capability/outcome/effect identities, and issue/expiry times. `limitsDigest` is exactly `authorityDigest({v:"reelier.capability-limits/internal-v1", contractDigest, limits})`; every capability digest is nonzero SHA-256. Contract handling has two branded phases: signature, purpose, wire, tenant, and trust verification may stage a trusted digest; alias, delegation, registered resolver freshness, audience, validity, and activation/revocation eligibility must then pass before compilation.

The DecisionContext digest is the ordinary authority digest, exactly SHA-256 over the RFC 8785/JCS UTF-8 bytes of the full context. This adds no signature domain. `GateEvent.decisionContextDigest` commits the gate verdict to that exact subject. A portable `AuthorityReceipt` contains both the full DecisionContext preimage and its digest, plus `gateEventDigest`; strict receipt parsing recomputes the embedded context digest. Portable bundle validation additionally requires the receipt and GateEvent to name the same context digest and requires `gateEventDigest` to equal the digest of that exact GateEvent. Detached signatures remain outside all wire objects, so a context, GateEvent, or receipt from another decision cannot be substituted without breaking a digest edge or signature.

Verification, authorization, source completeness, dispatch, acknowledgement, reconciliation, topology, and completeness use `verified`, `failed`, `unchecked`, or `absent`. Neither `verified` nor a signature means safe, wise, semantically correct, or complete. Hard enforcement needs separate OS identity/container, authenticated ingress, agent-inaccessible secrets, and restricted provider egress; same-user topology is `unchecked`.

N-1 readers must reject `reelier.authority-receipt/v1` or render its authority claims unchecked. They must never create a whole-receipt pass. Path A/B readers and fixtures remain compatible and byte-identical.

## Durable authority ledger

Before authority loading or source work, `bindIngress` exclusively creates an immutable closed
`reelier.authority-ingress-claim/internal-v1` record named by the global request-key hex. It independently
re-parses the branded request's canonical bytes and recomputes its wire, digest, tuple key, and alias.
Only the creator receives `claimed` and evaluation eligibility. Exact retries receive
`exact-existing`; any byte, digest, tuple, or alias mismatch receives `conflict` plus only the existing
owner's verified claim digest. A redacted lookup exposes request ID/key, alias, claim digest, and bound
status, never canonical bytes or reservation/capability internals. Binding alone creates no decision,
capability, transaction, journal, dispatch, or receipt artifact.

The Path C ledger then atomically binds the ingress tuple `(tenant, requester, requestId)` to the exact
verified ingress claim and closed canonical `OutcomeRequest` bytes/digest, while independently claiming `(tenant, outcomeKey)`, the
capability ID and canonical capability bytes/digest, the effect digest, and every deterministic
fixed-window limit slot. Collision precedence is ingress-identical reuse, ingress byte conflict,
semantic duplicate, capability integrity conflict, then limit exhaustion. A claim file by itself is
never authority: a reservation becomes visible only through its exact verified journal commit.
The stored authenticated alias, request digest/key, contract, source bundle/snapshot, authority-state,
limits, limits digest, capability ID, outcome key, effect digest, issue time, and expiry time must equal
the values inside the strictly parsed closed canonical `CompiledCapability`; detached scalar identities
are refused before any claim is acquired. There are exactly two signed intent slots, in order:
`contract-window` and `source-trigger`. Their maxima equal the sealed per-window and per-trigger maxima.
Each committed limit assignment has exactly one matching signed intent slot in canonical key order, carries that slot's exact signed maximum, and has
an index in `[0, maximum)`. Capacity across independently committed intents is evaluated against the
minimum signed maximum without rewriting any reservation's own assignment.

The filesystem implementation uses canonical content-addressed transaction records, exclusive-created
claim files, and immutable sequence-numbered journal entries. It does not rely on multi-process append
atomicity. Every file is synced before its commit becomes visible. Parent directories are synced on
POSIX; Windows directory flushing is best-effort and is reported as such, never as verified durability.
The operator supplies one resolved existing root. Tenant, requester, request, provider, and capability
strings never become path components; derived filenames are lowercase SHA-256 hex. Symlinks, Windows
junctions/reparse paths, root escape, malformed/truncated or noncanonical JSON, filename/content digest
mismatch, unknown records, illegal transitions, and journal gaps refuse recovery rather than being
guessed through.

The pre-release transaction/intent record is `reelier.authority-ledger-transaction/v4`. It requires
the exact verified ingress-claim digest and complete decision-context digest in addition to the v2
authority fields. V1 through v3 records,
missing/tampered ingress records, and broken reservation-to-ingress linkage fail closed as corruption;
recovery never migrates them by inference.

Cross-process mutation is serialized by atomic lock-directory creation and an exclusive-created,
cryptographically random owner record. Acquisition is bounded. A live same-host owner is never evicted
because time elapsed; a foreign, corrupt, or otherwise unverifiable owner refuses. An abandoned lock is
reclaimed only after same-host process liveness proves that its recorded PID is dead, and full recovery
runs before another reservation may be authorized.

The only lifecycle is `issued -> reserved -> dispatched -> acknowledged | definitive-failure |
ambiguous`, with `acknowledged | ambiguous -> reconciled`. Transitions are durable compare-and-transition
operations. Callers choose only the target state and, where required, the result digest; lifecycle time
is kernel-owned. Capability lifetime is exactly 60,000 milliseconds; reservation and dispatch require
`issuedAt <= now < expiresAt`. Before either authorization, the ledger commits a wall-clock high-water
observation, then stamps the reservation or transition from that exact same observation. Equality is
allowed and rollback refuses. Replay requires each lifecycle timestamp to equal the latest preceding
durable high-water instant and never precede the reservation's prior lifecycle timestamp. Recovery
under clock rollback conservatively marks durable dispatched work ambiguous at the existing high-water
instant; it never backdates the journal or creates new dispatch eligibility.

The same locked and fsynced journal high-water is exposed internally through argument-free
`observeClock()`. The kernel clock is read under the lock. A first or greater safe nonnegative instant
is durably appended and returns `advanced`; equality writes nothing and returns the exact durable
instant as `equal`; rollback refuses without mutation. Throwing, non-finite, or invalid clock output is
`clock-unavailable`, and lock or replay failures retain their closed reasons.

`dispatched` and `ambiguous` transitions carry no result digest. `acknowledged`, `definitive-failure`,
and `reconciled` require a nonzero SHA-256 result digest. Invalid presence or absence refuses before any
journal mutation and is corruption during replay. The verified history read returns the current
reservation plus its ordered reserve and transition entries, including sequence, from/to state,
kernel timestamp, journal event digest, and only the result digest appropriate to that target. History
is detached and deeply immutable, so acknowledgement and later reconciliation evidence remain distinct
even though the current snapshot retains only the latest result digest.

Recovery verifies canonical ownership and journal continuity, completes an abandoned reservation only
when every remaining claim is provably available, otherwise writes an immutable tombstone and removes
only claims verified as owned by that uncommitted transaction. A committed `dispatched` reservation
with no durable result becomes `ambiguous` on recovery and is never dispatch-eligible again.

## Signed gate decision

The gate is a closed, injected decision boundary with no network driver or credential dependency. It
binds ingress before loading authority, observes durable `planNow`, commits and advances the complete
authority-state snapshot, plans and performs bounded source reads, observes durable `decisionNow`,
materializes source evidence, then revalidates and compiles under the current-state lease. It obtains
the selected connector and checks the exact compiled endpoint and risk against that connector's
closed allowlists. Capability construction, both limit-key derivations, and one Event ID immediately
before reservation all remain inside the lease. A successful reservation under that lease is the write-
authorization linearization point; signing and durable decision append occur afterward. No provider
write or lifecycle transition to `dispatched` occurs at this boundary.

Every accepted or refused outcome is a signed closed `reelier.gate-decision-record/internal-v1` with
role `primary` or `conflict`, verified ingress-claim digest, nullable reservation ID, complete
DecisionContext and digest, GateEvent and digest, signer ID, and signature. A conflict is only a
refused `request-id-conflict` linked to a verified owner claim and differing attempted alias or request
digest. Accepted primary decisions must link a verified reservation with the same ingress,
capability, authority-state, and decision-context commitments. Refused primary decisions have no
reservation. Every lookup re-parses and verifies the record, signature, ingress ownership, and any
reservation linkage before returning status.

The durable sink installs the record and all applicable unique Event, primary-ingress, and accepted-
reservation indexes atomically. `appended` and `idempotent` results require rereading every applicable
index. Event collision is `event-id-unavailable`; primary collision permits one verified existing
status lookup; reservation collision is an internal-integrity failure even when the conflicting
record is otherwise valid. Corruption, absence, I/O failure, and unknown append outcome remain closed
and never produce a dispatch handle. An exact retry reads only the persisted primary decision and
returns redacted current status; it never re-evaluates, resigns, or reconstructs a handle.

Cross-process decision append uses a purpose-specific lock owner record containing the exact lock
wire version, local host, PID, and random nonce. A live same-host owner is busy; a foreign-host,
malformed, changed, or unverifiable owner remains unavailable. Reclaim is permitted only after
same-host process death is positively established, followed by a byte-identical owner reread before
atomically renaming the whole lock directory to a unique retirement tombstone. Release uses the same
exact-owner atomic retirement. The owner is reverified inside the renamed directory before bounded
tombstone cleanup; a failed rename leaves the original complete owner metadata in place. Malformed JSON, invalid
records, and duplicate durable indexes are explicitly classified as sink corruption; environmental
filesystem and lock failures are unavailable. These classifications never depend on exception text.

## Closed reason and presence protocol

The ordered refusal protocol is:

```text
request-id-conflict
authority-state-invalid | authority-state-rollback | authority-state-changed
contract-not-found | contract-not-eligible | contract-ambiguous | contract-untrusted
contract-alias-mismatch | contract-audience-mismatch | contract-inactive | contract-revoked |
contract-not-yet-valid | contract-expired | delegation-invalid
pack-mismatch | definition-mismatch | resolver-mismatch | connector-mismatch | account-mismatch |
endpoint-not-allowed | risk-not-allowed
source-read-refused | source-observation-invalid | source-projection-invalid | source-ungrounded |
source-stale
choices-invalid | compile-refused | effect-refused | effect-endpoint-not-allowed |
effect-risk-not-allowed
reservation-idempotency-conflict | semantic-duplicate | capability-integrity |
capability-already-reserved | limit-exceeded | not-yet-valid | expired | clock-rollback |
integrity-failure | busy | lock-owner-unverifiable | corruption
```

One strict stored candidate reports the first applicable reason in that order after state validity.
Zero candidates, one strict-but-untrusted candidate, several candidates with none eligible, and more
than one eligible candidate report `contract-not-found`, `contract-untrusted`, `contract-not-eligible`,
and `contract-ambiguous`, respectively. Candidate order, timestamps, learned scores, and heuristics do
not break ambiguity. Unknown exceptions are unavailable, never converted from message text into a
signed refusal. Accepted GateEvents use `reasonCode:"accepted"`.

| Stage/reasons | contract | authority state | source bundle | outcome + effect | capability |
|---|---:|---:|---:|---:|---:|
| request conflict | null | null | null | null | null |
| invalid or rollback state | null | null | null | null | null |
| state changed before reads | null | digest | null | null | null |
| not found, not eligible, ambiguous, or untrusted | null | digest | null | null | null |
| one trusted candidate fails planning eligibility | digest | digest | null | null | null |
| source read, observation, projection, grounding, or freshness refusal | digest | digest | null | null | null |
| state changed or contract expires after validated source | digest | digest | digest | null | null |
| choices, compile, or effect refusal | digest | digest | digest | null | null |
| post-compile connector endpoint or risk refusal | digest | digest | digest | both present | null |
| reservation refusal | digest | digest | digest | both present | ID and digest present |
| accepted | digest | digest | digest | both present | ID and digest present |

Planning refusals use `planNow`; definitive source-read refusal obtains a fresh durable instant; all
post-read, compilation, reservation, and accepted events use `decisionNow`. Rollback at either gate
clock observation is unavailable `clock-unavailable`; only a later reserve-time rollback is a signed
full-presence `clock-rollback` refusal.

## Redacted status and opaque handoff

Accepted and refused first attempts return only their frozen gate result. Existing results expose
request ID/key, verdict, closed reason, decision-context and GateEvent digests, lifecycle state,
kernel-owned update time, and optional receipt reference. Refused status has lifecycle `refused` and
uses the GateEvent time. Accepted existing status uses the live reverified reservation lifecycle and
time. No status exposes Event/capability IDs, full context, signer/signature, compiled effect, or
credentials.

Only a newly appended, locally reverified accepted decision receives a
`ReservedDispatchHandle`. The handle is an empty frozen branded object whose private state binds the
authenticated request, ingress claim, observed authority token/version/digest, revalidated contract,
delegation and source, compiled effect and capability bytes/digests, limits, reservation, and signed
decision. JSON serialization is empty; structured clones, structural lookalikes, and forged symbols
cannot unwrap it. It is intentionally absent from the public `reelier/authority` runtime exports.
Later dispatch code must independently recheck current authority, expiry, and exact recompilation
before recording `dispatched` and performing external I/O.
