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

Cross-process mutation is serialized by an atomically published lock directory and an
exclusive-created, cryptographically random owner record. Owner publication uses the exact unique
staging directory
`.authority-ledger-lock-publication-<64-lower-hex-host-digest>-<16-lower-hex-ticket>-<positive-safe-pid>-<64-lower-hex-nonce>.tmp`,
where `host-digest` is SHA-256 over the UTF-8 bytes of the exact canonical owner hostname, without a
`sha256:` prefix. The name therefore carries same-host provenance and ephemeral admission metadata
before any owner bytes exist.
The publisher creates that real directory exclusively, creates a real regular single-link
`owner.json` exclusively, writes its complete canonical owner with a progress-checked write-all loop,
file-syncs it, rereads and verifies the exact canonical bytes, syncs the staging directory, rereads
and verifies again, atomically renames the whole staging directory to `lock`, rereads and verifies the
published owner, syncs the ledger root, and rereads and verifies once more before any callback. A zero
or out-of-range `bytesWritten`, a changed object/type/link count, or any byte mismatch fails closed and
preserves the untrusted artifact; no callback runs. The closed
`before-ledger-operation-callback` fault point occurs exactly once at the operation-callback entry
boundary, immediately before any callback-specific prepare, read, or mutation. It occurs zero times
for every publication, revalidation, acquisition-snapshot, confinement, or recovery refusal. The
shared `lock` path is never publication staging and is therefore never ownerless. The exact durability
fault topology is closed: after stage creation through stage-directory sync, `lock` is absent and
exactly one publication stage exists; that stage is respectively an empty directory, contains a
zero-byte `owner.json`, contains a nonempty strict-prefix partial owner, or contains the complete canonical
owner after owner-file sync and stage-directory sync. After whole-directory rename and after root sync,
`lock` contains the complete canonical owner and no publication stage remains. A live same-host
publisher's byte-identical empty, zero-byte-owner, partial-owner, or complete-owner stage is busy and
preserved. After its named same-host PID is proved dead, each of those exact states is recoverable by a
successor, but only the creator may publish its own stage: a successor never renames another owner's
stage to `lock`. `empty` means no owner file; `zero` means an exact zero-byte owner file; `partial`
means only a nonempty proper byte prefix of the uniquely reconstructed canonical
`{ host, nonce, pid, v: 1 }` owner committed by the stage name. `complete` means only those exact full
canonical bytes. Arbitrary non-JSON bytes, valid JSON of another shape or value, suffixes, trailing or
extra bytes, and all non-prefix truncations are corruption and remain byte-identical. Foreign-host or unverifiable stage provenance, malformed or mismatched owner bytes,
links/reparse points, hard-linked owner files, and extra contents fail closed without target mutation.
Multiple stages with distinct valid host/PID identities may coexist as real contenders and are
independently validated; two stages for the same host and PID but different nonces are ambiguous and
fail closed. Every publication artifact name, type, link count, byte state, binding, and owner liveness
is classified before any candidate is mutated. A corrupt, transiently unreadable, or unverifiable
artifact prevents deletion of every otherwise recoverable stage. Mutation candidates are revalidated
byte-for-byte and by the frozen non-following filesystem object identity immediately before
creator-only cleanup or dead-owner cleanup. Creator cleanup may remove only its exact
name/host/PID/nonce/type/single-link directory and owner identities and exact expected empty, zero,
strict-prefix, or complete bytes; an atomic same-name directory or owner replacement is preserved even
when its bytes are identical. A changed inode/file identity, increased link count, or different bytes
refuses. Replacing a regular owner with a directory or reparse point, or replacing a real stage
directory with a regular file or reparse point, is likewise preserved and refuses without traversing
or mutating the replacement target. It never removes another live stage.
Filesystem identity is read with non-following `lstat({ bigint: true })`; device, inode/file ID, mode,
and link count remain exact bigint values throughout comparison and are never rounded through a
JavaScript `number`. Two distinct adjacent identities above `Number.MAX_SAFE_INTEGER` remain distinct.
Every publication stage has the exact name `.authority-ledger-lock-publication-<host64>-<ticket16hex>-<positive-pid>-<nonce64>.tmp`, where every hex field is lowercase. `ticket16hex` is an unsigned 64-bit integer in the inclusive range `0000000000000001` through `ffffffffffffffff`; zero, nonhex or uppercase text, any width other than 16, and an overflow spelling are corruption. After an exact successfully classified stable generation, let `maxVisible` be its maximum ticket (or zero when empty). If `maxVisible` is `ffffffffffffffff`, acquisition returns `busy` without sampling the admission clock. Otherwise it samples raw `admissionClock()` and requires a bigint in `0n..0xffffffffffffffffn`; non-bigint, negative, or greater values are corruption. The immutable ticket is `max(raw, maxVisible + 1)`, so raw zero is valid and allocates ticket one in an empty generation. The default admission clock is the local `process.hrtime.bigint()` monotonic domain. The ticket is stage metadata only: canonical owner bytes remain exactly `{ host, nonce, pid, v: 1 }`; the ticket is neither serialized nor bound into those bytes. A stage with any valid ticket and exact host/PID/nonce owner binding is valid; duplicate stages remain ambiguous by host+PID even if ticket and nonce differ.

Contention uses no additional durable handoff, queue, persisted counter, phase priority, or process-local cohort. The filename's syntactic lexicographic fields are ticket, decimal PID text, then nonce. Valid election uses ticket first and, for the only valid equal-ticket case of distinct PIDs, canonical decimal PID text. Two stages with the same host and PID are ambiguous corruption before election regardless of their tickets or nonces, so nonce is never an election tie-break. After one fully classified generation has had its root-name set closed and every live stage revalidated by exact name, canonical bytes, and frozen non-following filesystem identity, only the eligible head may exact-revalidate its own stage and attempt the atomic stage-to-`lock` rename. Equal-ticket overlap between distinct PIDs is resolved by decimal PID text and makes no causal FIFO promise. A causally later entrant that observes an earlier ticket must receive a larger ticket, so admission tickets prevent a later lower-sorting PID from overtaking a visible earlier stage; they improve causal admission ordering but do not promise starvation freedom under continuous churn. A non-head contender may optimize subsequent bounded waiting polls by inspecting only the active lock and its exact predecessor from that closed generation, with monotonic backoff. Predecessor disappearance, replacement, death, or unverifiable liveness, and any root-name generation change, invalidate the optimization and require a new complete closed-generation enumeration, classification, and election before promotion. Corrupt, ambiguous, foreign, or unverifiable artifacts continue to fail closed. Tickets are ephemeral: they are not persisted beyond the stage and are never changed after stage creation; a crash or restart allocates a new ticket from its then-visible generation.

Only at the unstaged mutating pre-admission boundary, observing at least two syntactically canonical publication-stage names may produce a non-authorizing saturated wait without reading or validating stage content. That observation is valid only when every name binds the local host digest, every host/PID publisher identity is unique, and every named PID is positively live. Repeated saturated observations wait with the existing monotonic backoff only until the unchanged bounded acquisition budget is consumed; they neither widen that budget nor consult the wall clock. The observation does not close a generation and authorizes no stage creation, cleanup, election, lock publication, ledger mutation, or operation callback. A smaller cohort, or any dead, unverifiable, ambiguous, malformed, or foreign publisher name, falls through to the complete settlement/classification protocol. Every actual admission and every cleanup, election, publication, mutation, or callback remains reachable only from that complete protocol; the saturated observation cannot strand abandoned stages or grant authority.

This local-ledger protocol requires all writers to share one host, filesystem, PID/liveness namespace, and monotonic-clock domain. POSIX `CLOCK_MONOTONIC` and Windows QPC provide the intended substrate; Linux time-namespace offsets are outside the hard-enforcement topology. The bounded acquisition and housekeeping deadlines are unchanged. Tickets do not defend against a malicious same-user filesystem writer.
After publication, the active owner closes and exact-revalidates the live generation before callback
entry. The exact `after-lock-publication-generation-closed` hook exposes a closed generation before
the elected branch, and `before-lock-publication-predecessor-validation` exposes each optimized
non-head predecessor poll. This deterministic predecessor election bounds redundant peer scans; it
does not claim starvation-free FIFO ordering.
Stable non-head predecessor polling and valid live active-lock waiting use the same deterministic
monotonic delay sequence: 5ms, 10ms, 20ms, 40ms, then 50ms for every remaining poll. Progress or
completed full-generation re-election resets the sequence to 5ms; no PID-derived jitter is used and
no deadline is widened. Every requested sleep is the smaller of the next sequence value and the
strictly positive monotonic acquisition time remaining. No sleep starts at or after the deadline,
and the sum of requested sleeps never exceeds the configured acquisition timeout. A retained
contender that observes a validated live active lock and later observes that lock absent resets the
next waiting delay to 5ms even before a full-generation re-election is otherwise required. With a
100ms acquisition budget and no other monotonic-clock advance, the exact requested sequence is
5ms, 10ms, 20ms, 40ms, 25ms: five positive waits totaling exactly 100ms.
Final-name invalidation only marks re-election pending: a valid active lock interposed before the
replacement closed generation retains the current delay, and reset occurs only after that
replacement generation completes.
A publication-stage name disappearance or change while the active owner closes the pre-callback
generation invalidates that coordination snapshot and causes bounded full-root re-enumeration against
the same housekeeping deadline; no callback runs from the invalidated generation. A stable subsequent
canonical generation may proceed. Exhaustion of already-classified valid coordination churn or
transient filesystem sharing is `busy`, authorizes zero semantic callback/provider effect or
authority-ledger mutation, and does not create a new public reason. Post-publication housekeeping may
perform only normal coordination-lock release/retirement cleanup; that cleanup is not an authorized
provider or ledger effect. Same-name identity, type, or byte replacement after a closed snapshot,
malformed topology, foreign provenance, and unverifiable liveness remain `corruption` (or the explicit
`lock-owner-unverifiable` result where applicable), never `busy`. Withdrawal adds no authenticated
artifact, queue, or handoff.
The exact closed per-attempt order is `before-publication-stage-final-validation`, then
`before-publication-stage-final-liveness`, then `before-publication-stage-remove-attempt`. The final
validation revalidates the exact directory and owner identity/type/link count/name/bytes; final
liveness re-probes the owner; and the remove-attempt hook occurs immediately before the destructive
publication-stage removal attempt. Each transient attempt restarts with complete root-generation
enumeration before that whole order repeats. A
transient failure never retries `rm` directly: it restarts those validations against the same
monotonic deadline. A same-name replacement installed before or during any attempt is preserved.
Recursive dead-stage cleanup is non-atomic. After exact final validation and dead-liveness
authorization, another correct remover may advance the same frozen directory identity through the
exact sequence `complete -> empty/no owner -> absent`. That sequence is non-authorizing removal
progress: disappearance is accepted only after a ledger-root sync, while the same-directory empty
intermediate causes bounded retry or `busy`, never integrity corruption. During closed-generation
revalidation, the exact same-directory `complete -> empty` transition is likewise only retryable
when that generation's initial liveness observation for the stage was `dead`. This exception does
not broaden construction progress. The prior removal authorization remains an identity tombstone
through the cleanup-root sync barrier and the next fully closed publication-name generation. Any
same-name reappearance before that closure is identity-replacement corruption and is preserved;
only a fully validated and liveness-closed generation that is about to return stably, with no
pending removal or root sync, may forget an authorization whose name stayed absent. Every raw name
snapshot—initial names, closure names, final names, and per-removal root re-enumeration—rejects an
observed tombstoned name as identity-replacement corruption rather than membership retry. Multiple
genuinely absent authorized stages may batch one root sync. A creator-owned stage, a live or unverifiable owner, a directory
identity/type/link replacement, an owner identity/type/link replacement (including canonical-same
bytes), new or malformed owner bytes, and malformed content remain corruption and are preserved.
After an exact removal, the pending ledger-root sync completes before the exact
`after-publication-stage-cleanup-root-sync` hook; only after that boundary may the next complete
generation close, and callback entry remains unreachable until that post-sync closure succeeds.
Acquisition is bounded. A live same-host owner is never evicted because time elapsed; a
foreign, corrupt, or otherwise unverifiable owner refuses. An abandoned lock is reclaimed only after
same-host process liveness proves that its recorded PID is dead and the owner bytes remain identical.
Reclaim and release atomically rename the whole lock directory to an exact PID-and-nonce-bound
retirement marker. Its exact root name is
`.authority-ledger-lock-<positive-safe-pid>-<64-lower-hex-nonce>.<disposition>`, where the closed
disposition is `released`, `recovery-pending`, or `publication-aborted`. Release uses `released`; a
proved-dead active owner is renamed to `recovery-pending`; failed publication of a byte-identical
self-created owner uses `publication-aborted`. PID liveness never changes or interprets a durable
disposition. Before cleanup a marker is a real directory containing exactly one real regular
`owner.json` whose canonical closed owner PID and full nonce match its name; unknown/malformed
dispositions, name/owner mismatch, links/reparse points, hard-linked owner files, path confusion, and
extra contents fail closed.

Retirement paths only rename, sync the ledger root, validate, and leave the immutable marker. The next
complete active-lock owner is the sole marker scanner. It services every `recovery-pending` marker
durably and idempotently before every callback, including ingress-only callbacks, while `released` and
`publication-aborted` require no recovery. The recovery marker remains until every prior dispatched
reservation is durably non-dispatched. Cleanup is authorized by an immutable canonical
`reelier.authority-ledger-lock-cleanup-ack/v1` root file named
`.authority-ledger-lock-cleanup-<64-lower-hex-record-digest>.ack`. The closed record binds the exact
marker name, canonical owner, owner digest, disposition, and post-recovery journal head. Its exact keys
are `{ disposition, journalHead, markerName, owner, ownerDigest, v }`; `v` is the literal
`reelier.authority-ledger-lock-cleanup-ack/v1`, `owner` is the exact closed canonical marker owner,
`ownerDigest` is the authority digest of that owner, and the owner's PID and nonce must match the exact
marker name even when the marker is absent. For this local filesystem ledger, `owner.host` must equal
the current canonical host; foreign or unverifiable owner hosts fail closed. `journalHead` is the
nonzero authority digest of the latest canonical journal
event after recovery. `journalHead` is null only for `released`/`publication-aborted`, or for
`recovery-pending` when the recovered journal is empty. The filename digest is the authority digest of
that exact canonical closed ack record, without its `sha256:` prefix. Marker name, owner digest,
disposition, and non-null journal head must all match current verified state.

The final ack is never written in place. Its exact staging name is
`.authority-ledger-lock-cleanup-stage-<owner-pid>-<owner-nonce>-<64-lower-hex-ack-digest>.tmp`, with PID
and nonce copied from the validated marker owner and digest copied from the final ack name. The sole
active owner exclusive-creates the stage, writes the complete canonical ack, file-syncs, closes, then
atomically renames it on the same filesystem to the final `.ack` name and syncs the root. An empty,
partial, or complete stage is recoverable only when its exact name binds one complete validated marker
and the independently recomputed current ack digest. That exact stage may be removed and rebuilt under
the active lock; malformed, mismatched, orphaned, linked/reparsed, or duplicate stages fail closed. The
atomic rename means a final ack is always complete.

Before publication, acquisition performs only the narrow non-following metadata checks required to
validate the active lock and publication stages, including their names, types, link counts, and owner
files where present. Immediately after atomic publication and before reading or mutating any other
ledger content, the sole active owner performs a recursive non-following metadata/type/link-count
confinement audit of every fixed ledger subtree and root artifact. A nested reparse point, link, hard
link, path substitution, malformed artifact, or unexpected entry fails closed before retirement,
publication-stage, cleanup-stage, cleanup-ack, journal, transaction, claim, or ingress service changes
any bytes. Only after that confinement audit may it parse and service artifacts; the complete audit is
then repeated before the callback reads or mutates durable state. The absence of pre-audit content
reads is additionally a code-review invariant; filesystem mutation tests prove ordering but cannot
prove that a read did not occur.

An interrupted partial/empty marker is removable only with its exact canonical, digest-named valid ack;
otherwise it is corruption. Cleanup then removes the marker, syncs the root, removes the ack, and syncs
the root again.
A valid orphan ack whose exact marker is absent represents the post-marker-sync/pre-ack-removal crash
window and is removed after validation; malformed, owner-digest-less, marker-mismatched, or otherwise
invalid orphan acks fail closed. Thus every acknowledged interruption is recoverable without inferring
state. A fresh monotonic housekeeping deadline begins only after owner publication succeeds; it does
not reuse a nearly expired acquisition deadline. Lock acquisition, retirement cleanup, and transient
Windows `decisions/`-subtree audit retries use monotonic deadlines. They never consult the
provider/authority semantic `now`, which remains reserved for durable high-water, validity, and
lifecycle decisions.
An active lock that disappears between non-following metadata and content inspection, or a publication
stage that disappears between enumeration and validation, invalidates the whole acquisition snapshot,
including every name and artifact generation previously observed; the bounded scan re-enumerates and
reclassifies the complete root and never interprets or mutates from the partial view. A same-name
replacement or a blocker introduced after the invalidated enumeration belongs only to the next
generation and cannot be missed by treating local `ENOENT` as a skipped entry. A replacement complete
live active lock therefore returns busy without beginning the contender's publication. If one
enumerated stage vanishes while another proved-dead candidate exists and a new live stage enters the
root, neither the dead candidate nor the live replacement is mutated and the result is busy; the
contender's publication does not begin. Transient Windows `EPERM`, `EACCES`,
and `EBUSY` at either boundary retry against the same monotonic acquisition deadline. Exhaustion of
those already-classified transient sharing retries, or of valid snapshot/generation churn, returns
`busy` without mutating any authority-ledger artifact or entering the semantic callback. Malformed
topology and closed-snapshot same-name identity/type/byte replacement still refuse as corruption. This
taxonomy does not widen the deadline, alter Paths A/B, or relax fail-closed behavior. The default
acquisition timeout remains 30,000 milliseconds; tests may select a smaller valid timeout without
changing that default.
The exact `before-publication-stage-root-reenumeration` fault point precedes the generation-closing
root enumeration. Transient sharing failures at every enumeration, validation, final pre-delete
validation, and removal boundary restart the whole bounded generation; none escapes as a raw error;
their deadline exhaustion is `busy`, not corruption.
After publishing its own owner, the active holder applies the same protocol until it has one fully
classified stable generation. A retry result is never discarded: malformed replacement generations
refuse before retirement housekeeping or the operation-callback entry, preserving every artifact.
Immediately before every dead-stage removal attempt, liveness is probed again. PID reuse to a live
process preserves the stage and yields busy/retry; an unverifiable final probe preserves it and refuses.
On rename-to-`lock` collision the creator retains its exact fully synced stage object and retries the
atomic rename of that same identity. It does not recreate or resync the stage and removes it only on a
terminal timeout/refusal/error after exact revalidation. The exact
`after-lock-publication-rename-collision` hook exposes that retained-object boundary.

The only lifecycle is `issued -> reserved -> dispatched -> acknowledged | definitive-failure |
ambiguous`, with `acknowledged | ambiguous -> reconciled`. Transitions are durable compare-and-transition
operations. Callers choose only the target state and, where required, the result digest; lifecycle time
is kernel-owned. Capability lifetime is exactly 60,000 milliseconds; reservation and dispatch require
`issuedAt <= now < expiresAt`. After validity and rollback checks, the ledger appends a wall-clock
high-water observation only when the durable mark is absent or `now` is greater. Equality reuses the
current durable view and instant without firing high-water write hooks; reservation and transition
timestamps still equal the latest preceding durable high-water. Rollback refuses. Replay requires each lifecycle timestamp to equal the latest preceding
durable high-water instant and never precede the reservation's prior lifecycle timestamp. Recovery
under clock rollback conservatively marks durable dispatched work ambiguous at the existing high-water
instant; it never backdates the journal or creates new dispatch eligibility.

After prepare, ingress verification, clock validity, durable clock handling, and transaction digest
computation, an exact committed transaction whose stored canonical intent equals the normalized input
returns its existing reservation with `dispatchEligible: false` before transaction create/EEXIST,
tombstone read, view reload, claim acquisition, or commit work. A later-time exact retry advances the
high-water first. This fast path never skips prepare or audits, rollback, expiry, or not-yet-valid
checks. Prepare rejects any tombstone whose transaction is already journal-committed; committed and
tombstoned coexistence is corruption. That invariant makes the post-prepare exact-commit shortcut
safe before a later tombstone read.

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
exact-owner atomic retirement. Owner publication writes and syncs the owner file, syncs the lock
directory, then syncs the decision root; a publication failure atomically removes the self-created
lock rather than leaving an ownerless directory. The owner is reverified inside the renamed directory
before bounded tombstone cleanup; a failed rename leaves the original complete owner metadata in
place. The constructor requires an already-existing real directory, performs no lazy root creation,
fixes its resolved non-symlink/reparse identity, rejects traversal through such paths, and refuses a
substitution observed before a later operation without writing through it. Portable Node path checks
cannot defeat an actively concurrent same-user filesystem swap; hard topology therefore requires a
separate OS identity with no agent mutation permission and is otherwise `unchecked`. Lock timeouts are
finite positive integers no greater than 60,000 milliseconds, and every retry deadline uses monotonic
time so wall-clock rollback cannot extend acquisition or cleanup. Malformed JSON, invalid records, and
duplicate durable indexes are explicitly classified as sink corruption; environmental filesystem and
lock failures are unavailable. These classifications never depend on exception text.

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
