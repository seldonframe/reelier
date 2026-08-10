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
Only the owner authenticated by the fixed admission slot may create that real directory. It creates
the directory exclusively, creates a real regular single-link
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
at most one protocol-admitted publication stage exists; that stage is respectively an empty directory, contains a
zero-byte `owner.json`, contains a nonempty strict-prefix partial owner, or contains the complete canonical
owner after owner-file sync and stage-directory sync. After whole-directory rename and after root sync,
`lock` contains the complete canonical owner and no publication stage remains. A live same-host
publisher's byte-identical empty, zero-byte-owner, partial-owner, or complete-owner stage is busy and
preserved. After its named same-host PID is proved dead, each exact state is recoverable only through
the typed atomic withdrawal protocol below; a successor never renames another owner's stage to `lock`.
`empty` means no owner file; `zero` means an exact zero-byte owner file; `partial`
means only a nonempty proper byte prefix of the uniquely reconstructed canonical
`{ host, nonce, pid, v: 1 }` owner committed by the stage name. `complete` means only those exact full
canonical bytes. Arbitrary non-JSON bytes, valid JSON of another shape or value, suffixes, trailing or
extra bytes, and all non-prefix truncations are corruption and remain byte-identical. Foreign-host or unverifiable stage provenance, malformed or mismatched owner bytes,
links/reparse points, hard-linked owner files, and extra contents fail closed without target mutation.
Legacy or manually injected stages with distinct valid host/PID identities are external membership
and are independently classified for compatibility; their presence never proves admission and never
widens K=1. In a K1-active generation, a stable generation with more than one publication stage is
invalid K1 topology and is preserved corruption. A legacy-only generation remains on the exact
compatibility classifier until that legacy residue is drained; its existing multi-stage refusal does
not establish K1 admission. Two stages for the same host and PID but different nonces are ambiguous and fail
closed. Every publication artifact name, type, link count, byte state, binding, and owner liveness
is classified before any candidate is mutated. A corrupt, transiently unreadable, or unverifiable
artifact prevents retirement of every otherwise recoverable stage. Mutation candidates are
revalidated byte-for-byte and by frozen non-following filesystem identity immediately before
creator-only or dead-owner atomic retirement. Retirement may rename only the exact
name/host/PID/nonce/type/single-link directory and owner identities and exact expected empty, zero,
strict-prefix, or complete bytes; an atomic same-name directory or owner replacement is preserved even
when its bytes are identical. A changed inode/file identity, increased link count, or different bytes
refuses. Replacing a regular owner with a directory or reparse point, or replacing a real stage
directory with a regular file or reparse point, is likewise preserved and refuses without traversing
or mutating the replacement target. It never retires another live stage.
Filesystem identity is read with non-following `lstat({ bigint: true })`; device, inode/file ID, mode,
and link count remain exact bigint values throughout comparison and are never rounded through a
JavaScript `number`. Two distinct adjacent identities above `Number.MAX_SAFE_INTEGER` remain distinct.
Coordination identity wire values preserve Node's raw bigint spelling and are never normalized with
`BigInt.asUintN`, modulo, absolute value, or `Number`. `dev` and `ino` use canonical signed decimal
`0|-?[1-9][0-9]*` in `[-2^63, 2^64-1]`; `mode` and `nlink` use canonical unsigned decimal
`0|[1-9][0-9]*` in `[0, 2^64-1]`. Every component is at most 20 characters before `BigInt` parsing;
`+`, `-0`, leading zeroes, whitespace, JSON numbers, overflow, and missing or extra keys refuse.
Exact artifact validation separately requires the observed mode and `nlink === 1n`. Stored canonical
strings compare directly to `rawBigInt.toString(10)`; signed and unsigned spellings of the same bit
pattern are never equivalent. This identity is local evidence, not a portable normalized identifier.
The K1 classifier and every coordination-cleanup validator use this one encoding, parser, and exact
matcher rather than reimplementing identity conversion.

The K1 epoch guard activates when a closed root generation contains any exact artifact or any
reserved-family lookalike in the admission-preparation, fixed-slot, preparation-retirement,
slot-retirement, creator-withdrawal, coordination-cleanup-ack, or coordination-cleanup-stage
families. Concretely, the reserved activation stems are `.authority-ledger-admission-`,
`.authority-ledger-creator-withdrawal-`, and `.authority-ledger-coordination-cleanup-`; an exact
component or any broader name under one of those stems activates the guard. A publication stage,
active `lock`, legacy retired-lock marker (including
`publication-aborted`), or legacy lock-cleanup file does not activate K1 by itself; a root containing
only those artifacts continues through the exact current legacy compatibility handling. Once K1 is
active, the complete root generation is classified before any legacy active-lock retirement,
publication-stage settlement/removal/publication, semantic clock read, or operation callback. An
exact valid or recoverable-but-unsupported K1 residue returns bounded `busy` byte-identically.
Valid in-flight residue includes an exact fixed slot plus its same-owner publication stage in any of
the `empty`, `zero`, strict-prefix `partial`, or `complete` construction states. It also includes an
exact same-owner `withdrawn` slot-retirement marker and purpose-bound cleanup record whose terminal
artifact is the byte-identical `publication-aborted` marker; the epoch guard preserves that crash
graph rather than treating every K1-plus-`publication-aborted` generation as impossible.
Impossible topology, malformed or broad-prefix membership, cross-owner binding, digest mismatch, or
duplicate authority returns `corruption` byte-identically. Snapshot churn retries only within the
acquisition deadline and then returns `busy`; a same-name replacement after a closed generation is
`corruption`. Classification creates no K1 artifact and grants no cleanup, publication, retirement,
semantic-time, or callback authority. Mixed old/new binaries writing the same ledger concurrently are
an unsupported deployment topology; compatibility mode is not a permissive mixed-writer claim.

Mutating admission has capacity K=1 and uses the one literal fixed slot
`.authority-ledger-admission-0/owner.json`. One exact canonical owner `{ host, nonce, pid, v: 1 }` is
created once and remains byte-identical across preparation, fixed slot, publication stage, active
`lock`, creator withdrawal, slot retirement, and every coordination cleanup record for that
acquisition; publication never mints a second nonce or owner.

The contender exclusively creates the real single-link preparation directory
`.authority-ledger-admission-prep-<host64>-<positive-safe-pid>-<nonce64>.tmp`, captures its
non-following identity, exclusively creates its real regular single-link `owner.json`, captures that
identity, writes the canonical owner with a progress-checked write-all loop, file-syncs, rereads and
exactly validates bytes and identity, syncs the preparation directory, revalidates both objects, then
atomically renames that exact directory to `.authority-ledger-admission-0`, syncs the ledger root, and
performs final exact validation. An existing destination is completely classified and never
overwritten. Preparation has the exact monotonic states `empty -> zero -> strict-prefix -> complete ->
synced`: empty has no owner, zero has an exact zero-byte owner, strict-prefix is a nonempty proper
prefix of the uniquely reconstructed canonical owner, complete has all canonical bytes before the
required file/directory sync barriers, and synced is the same exact complete bytes and identities
after both barriers. Only synced may become the fixed slot; the fixed slot is always complete.

An unpromoted or dead exact preparation atomically retires to
`.authority-ledger-admission-prep-retired-<host64>-<positive-safe-pid>-<nonce64>.<empty|zero|partial|complete>`
without changing its frozen contents, then root-syncs. A live exact preparation is classified but is
non-authorizing and bounded-waits before returning `busy` unchanged. A dead exact preparation may be
retired only after full-root classification and exact final revalidation. Foreign, unverifiable,
malformed, replaced, linked/reparsed, duplicate-provenance, duplicate-preparation, or broad-prefix
preparations are preserved corruption. The retired `.complete` spelling retains byte-complete
preparation contents whether interruption occurred immediately before or after the prep sync barrier;
the name alone never asserts that the barrier completed.

**Open discrepancy — four things the preparation/promotion rules above do not settle.** Found by
building them (option-gated S1, `codex/universal-compiled-authority`), measured 2026-08-04. Recorded
here rather than decided; the implementation's current choice is named in each entry so it can be
overruled without archaeology.

1. **"the real *single-link* preparation directory" is not implementable as written.** A freshly
   created POSIX directory has `st_nlink == 2` (`.` plus the parent's entry); Windows/NTFS reports
   `1`. A literal `nlink === 1` check therefore makes the fixed slot uncreatable on Linux and macOS
   while passing on Windows — measured: the same build returns `advanced` on Windows and
   `corruption` on `node:22-slim`, with zero of the nine boundaries firing. The implementation now
   omits the directory link check entirely, matching the publication-stage precedent, and enforces
   `nlink === 1` only on the regular `owner.json`. Either "single-link" must be defined for
   directories (no *extra* hard links / no reparse point) or the clause should be scoped to the
   owner object.
2. **"An existing destination is completely classified and never overwritten" has no stated
   outcome, and the platform default violates it.** POSIX `rename(2)` *removes* an existing empty
   destination directory and succeeds, so "never overwritten" cannot be satisfied by the rename
   itself — it requires an explicit pre-rename classification. The spec does not say what that
   classification returns (`corruption`, `busy`, or a zero-mutation refusal). The implementation
   treats a present destination as `corruption` with the destination preserved byte-identical.
3. **The degraded terminal (`If a successful publication cannot retire its exact slot…`) does not
   state the operation's return value,** and does not sanction a *no-attempt* path — which is what a
   slice that has not yet built slot retirement must take. The implementation returns `busy`, a
   value taken from the still-red committed pin at `test/authority/ledger.test.ts:1672`, not from
   this document. Related: `after-lock-retire`/`before-lock-retire` are listed unconditionally under
   Lock durability, but the implementation suppresses them on this branch.
4. **A `published` slot's own recovery authority is destroyed by the next acquisition.** Measured on
   a root left by the degraded terminal: the next acquisition drains the same-owner
   `publication-aborted` marker while leaving the unretired fixed slot, and
   `slot-retired.published` names that successor as the only remaining authority to retire the slot.
   Three subsequent default acquisitions then return `busy` and reads refuse. Whether the successor
   is protected while a matching unretired slot is present is unstated.

5. **The prose and a committed pin disagree on whether generation closure precedes the `published`
   slot retirement.** The active-owner sentence below lists the duties in the order closure ->
   retire -> cleanup pass. The committed pin at `test/authority/ledger.test.ts:1822` pins the
   opposite order, expecting `slot-retire-root-sync` BEFORE `generation-closed`. The implementation
   follows the pin, because the `published` precondition as written requires only the byte-identical
   active lock, which it checks. Recorded rather than resolved: one of the two has to give, and
   which one is the owner's call.
6. **Two fresh post-publication budgets, or one.** "Successful publication receives one separate
   fresh slot-retirement deadline. No wait, retry, progress, housekeeper transition, or root sync
   widens any budget" does not say whether the `publication-aborted` fallback spends that same
   budget or draws its own. The implementation now draws exactly one and shares it, which is the
   reading that keeps the stated bound meaningful, but the sentence admits the other.

7. **A `published` acknowledgment in the root defeats the dead-owner active-lock reclaim that
   succeeds without it.** Measured on two crashes leaving the same dead owner holding the same
   active lock: with only the lock present, the next acquisition reclaims it and the root recovers;
   with the owner's `slot-retired`/`published` acknowledgment also present, classification reaches
   the published-successor rule and returns `busy` before legacy reclaim is consulted, and the root
   stays busy indefinitely. The acknowledgment is minted as a recovery record, so it removing the
   one recovery that used to work is a contradiction the document should settle. Related to the
   already-recorded absence of a housekeeping route for foreign K1 residue.
8. **The pre-callback generation closure is weaker than the words describing it, and does not
   re-enumerate on churn.** "Closes and exact-revalidates the complete coordination generation" is
   implemented as a two-enumeration name-set stability check plus exact revalidation of the single
   retirement marker; no full root snapshot is taken, so an identity, type or byte change to any
   other artifact — including the active lock the acknowledgment names as its terminal — is not
   detected. Separately, the paragraph on pre-callback closure requires churn to cause bounded
   full-root re-enumeration against the same deadline and permits a stable subsequent generation to
   proceed; the implementation instead converts the first churn observation into the degraded
   terminal with no retry. Either the closure should reuse the full snapshot primitive and loop, or
   the sentence should be narrowed to what a single-artifact revalidation can honestly claim.
9. **The half-drained retirement marker window — resolved 2026-08-05, widened 2026-08-06.**
   Marker removal is unavoidably two syscalls — unlink the owner object, then remove the
   directory. The `after-coordination-cleanup-marker-owner-remove` point sits between them at
   every removal site; the crash shape it exposes — an emptied marker beside its durable
   acknowledgment — classifies through the authenticated-partial rescue for every retired-slot
   disposition (`abandoned`, `published`, and — Batch C, after the window measured permanent
   corruption on both the creator continuation and the dead-owner chain — `withdrawn`) and for
   sub-complete withdrawal terminals, each authenticated by its exact bound acknowledgment; the
   active owner's owner-restoring repair on the published pass is pinned by a test.

Full-root classification and corruption precedence occur before admission denial. A live exact fixed
slot bounded-waits under the acquisition deadline and then returns `busy` unchanged. A dead exact slot
is recoverable only after full classification and final exact revalidation. The exact slot owner alone
may create one publication stage. The slot remains exact through either publication-stage-to-`lock`
rename plus lock-root sync or creator-withdrawal-marker rename plus root sync. It then atomically
renames to `.authority-ledger-admission-retired-<host64>-<positive-safe-pid>-<nonce64>.<published|withdrawn|abandoned>`
and root-syncs. `published` requires the byte-identical active `lock`; `withdrawn` requires the exact
creator-withdrawal terminal marker; `abandoned` is dead-slot recovery before stage creation. Callback
eligibility begins only after both active-lock root sync and matching `published` slot-retirement root
sync. If a successful publication cannot retire its exact slot within its fresh slot-retirement
deadline, the owner atomically retires the active lock to its `publication-aborted` marker, root-syncs,
and runs zero callback.

Complete creator withdrawal atomically renames the exact stage to
`.authority-ledger-lock-<positive-safe-pid>-<nonce64>.publication-aborted` and root-syncs. Empty, zero,
and strict-prefix stages atomically rename without content change to
`.authority-ledger-creator-withdrawal-<host64>-<ticket16>-<positive-safe-pid>-<nonce64>.<empty|zero|partial>`
and root-sync. There is no observable complete-to-empty transition. The exact creator may finish its
own withdrawal; a successor may do so only after the owner is proved dead or an exact durable terminal
artifact proves authority. Withdrawal cleanup uses one fresh deadline and preserves the creator's
original thrown object by identity even if cleanup cannot finish; unresolved corrupt residue is
reported by the next acquisition. A withdrawal marker cannot be cleaned before its matching slot has
durably retired as `withdrawn`. Replacement, type, link, identity, byte, or marker mismatch is
preserved corruption. No broad prefix grants cleanup authority.

Every publication stage has the exact name `.authority-ledger-lock-publication-<host64>-<ticket16hex>-<positive-safe-pid>-<nonce64>.tmp`, where every hex field is lowercase. `ticket16hex` is an unsigned 64-bit integer in `0000000000000001..ffffffffffffffff`; zero, nonhex or uppercase text, any other width, and overflow are corruption. Ticket admission is fixed-width and monotonic over two values sharing one clock: a drawn ticket per operation and a minted `ticket16hex` per created stage. Every ledger-lock operation draws exactly one admission reading at fence arrival, before any wait and before any filesystem observation: a pure reading of the shared host monotonic admission-clock domain. A reading that is not an unsigned 64-bit integer is corruption; a reading at or below the in-process floor — the largest ticket previously drawn or minted in the same process, zero when none — is lifted to one more than that floor, never corruption; an in-process floor of `ffffffffffffffff` makes drawing impossible and returns bounded `busy` unchanged. The lifted reading is the operation's drawn ticket. Whichever contender creates a publication stage mints `ticket16hex` at stage creation as the greater of its drawn ticket and one more than the visible maximum — the largest ticket present in the publication-stage and creator-withdrawal names of the closed generation snapshot its admission attempt observed, external and legacy membership included, reusing that snapshot with no further stage observation. A visible maximum of `ffffffffffffffff` makes minting impossible and returns bounded `busy` unchanged. For a publication contender the drawn ticket grants exactly one authority: a same-process K1 operation-fence admission queue position; a housekeeping episode's drawn ticket lifts the in-process floor and grants nothing. Neither value grants capacity beyond K=1, cross-process priority, cross-process election or FIFO, cleanup, promotion, or stage-retirement authority, deadline widening, or corruption-precedence bypass; neither value is ever serialized into canonical owner bytes. The stage host/PID/nonce and bytes must equal the fixed-slot owner exactly.

No ledger-lock operation reaches a fault-point-bearing filesystem hook without holding the local K1
operation fence, held from before its first such hook through its target root sync; fence
acquisition itself captures the frozen root identity before endpoint bind and revalidates it after.
The fence is one same-process held-set entry plus one exclusively bound loopback endpoint at
`127.0.0.1`. Its primary port remains
`20000 + ((u32be of the first four bytes of SHA-256 over <canonical-resolved-root> NUL <root-dev> NUL
<root-ino>) mod 30000)`, where `<canonical-resolved-root>` is the natively realpath-resolved root —
on Windows with separators normalized to forward slashes and case folded to lowercase, elsewhere
verbatim. If that port is unavailable, the implementation may try at most 63 additional,
deterministically ordered candidates derived from the complete root-material digest, always inside
`20000..49999` and always under the one original acquisition deadline.

Every Reelier fence endpoint identifies itself with the complete root-material digest before its
accepted socket is reset. On `EADDRINUSE`, an exact matching identity is same-root contention and the
contender retries the same candidate. An explicit different identity is an unrelated listener and
permits the next deterministic candidate. Silence, timeout, or an unverifiable peer never permits a
fallback and remains contention. On Windows, the contender first holds a named-pipe mutex whose name
contains the complete root-material digest. Only that holder may select a TCP candidate, so
`EACCES` may advance to the next candidate without splitting same-root writers. On other platforms,
`EACCES` remains contention. Exhaustion of the candidate set or original deadline yields the
refusal-only classification. Inbound connections are reset and all accepted sockets are destroyed
during close, so a local dialer cannot wedge the awaited close.

Fence phases are private runtime boundaries and never exported ledger fault points. Cross-process
contention is resolved only by the exclusive endpoint and grants no ordering. The refusal-only
classification is the sole fence-less filesystem access, read-only and fault-silent by construction,
writing nothing: corruption keeps precedence over contention, and a refusal-pass `busy` means not
proven corrupt, never proven healthy.

> **RESOLVED (2026-08-10).** The identity-aware deterministic fallback above closes the Windows
> reserved-port liveness discrepancy measured on 2026-08-07 without repeating the reverted “fail
> immediately on every `EACCES`” experiment. That experiment incorrectly treated an errno as proof
> of permanent reservation and failed under 100-way Windows contention. The resolved rule preserves
> one deadline, serializes Windows contenders through the full-digest named-pipe mutex, recognizes
> same-root TCP holders by the full root-material digest, and never treats a silent or unverifiable
> occupant as foreign. The original investigation remains at
> `docs/superpowers/plans/2026-08-07-gate-rotator-rootcause.md`.

Same-process fence contention distinguishes exactly two closed contender classes, declared at
invocation by whether the operation seeks the active lock and a semantic operation callback. That
classification governs fence queueing only, and is stated independently of pre-admission housekeeping
write permission so that the queueing rule does not silently depend on who may drain residue. Which
contenders hold that write permission is a separate, currently narrower question — see the open
discrepancy recorded below. A publication contender — an operation seeking the active lock and a
semantic operation callback — is entitled by its class to wait:
concurrently waiting same-process publication contenders are admitted in strictly increasing
drawn-ticket order, and one admitted with strictly positive remaining time begins its own full
admission attempt under
the same one original acquisition deadline; deadline exhaustion while waiting returns `busy` with
zero filesystem observation. A housekeeping-episode contender — an operation seeking neither the
active lock nor a callback, which therefore returns once the strictly non-authorizing pre-admission
housekeeper has made its one transition — holds no queue position: it refuses `busy` after at most
one bounded delay, never
awaiting release, with zero filesystem observation, zero fence acquisition, and zero fence-boundary
observation. A same-process holder already owns the only local K1 authority a housekeeping episode
could seek; whatever the holder's outcome, the episode's transition is at worst deferred, and the
next fresh acquisition re-derives it from the then-current generation.

Ticket monotonicity is scoped exactly. A minted stage ticket strictly exceeds every ticket visible in
the closed generation its attempt observed, and drawn and minted tickets strictly increase within one
process. Same-host cross-process order holds only as far as the shared monotonic-clock domain
provides it and resets with that domain when no ticket-bearing residue is visible. Fence admission
order among concurrently waiting same-process publication contenders follows drawn-ticket order; the
drawn tickets are not durably witnessed, and a stage name proves only strict dominance over the
generation its attempt observed — never inter-stage admission order, not a global total order, not
wall-clock time, and nothing across hosts.

There is no publication-stage election or predecessor protocol: admission order is decided at the
fence before any stage exists, never between stages, and no contender derives admission order,
election, predecessor, or promotion authority from another contender's stage — stages are observed
only to classify, refuse bounded `busy`, or preserve corruption. A clean root with no preparation,
fixed slot, active lock, publication stage, retirement marker, cleanup stage, or cleanup ack may
begin one admission attempt. A lone live external pre-slot publication stage is preserved and
bounded-waits to `busy`; a lone exact dead external stage may be atomically withdrawn but is never
promoted. More than one publication stage in a stable K1-active generation is invalid K1 topology and
is preserved corruption, even when every stage is individually canonical and has distinct provenance;
ticket admission never widens this. Legacy-only publication residue remains on its exact
compatibility behavior until drained.

The ledger-lock fault surface is the following exact, disjoint K=1 taxonomy; no election,
provisional-owner, or predecessor hook is part of the protocol:

- Admission preparation/fixed slot: `after-admission-prep-create`,
  `after-admission-prep-owner-create`, `after-admission-prep-owner-partial-write`,
  `after-admission-prep-owner-sync`, `after-admission-prep-sync`,
  `before-admission-slot-rename`, `after-admission-slot-rename`,
  `after-admission-slot-root-sync`, `after-admission-slot-final-validation`.
- Closed classification and pre-admission housekeeping: `after-admission-prep-enumeration`,
  `after-admission-slot-enumeration`, `after-pre-admission-housekeeping-initial-enumeration`,
  `after-pre-admission-housekeeping-generation-closed`,
  `before-pre-admission-housekeeping-final-validation`,
  `before-pre-admission-housekeeping-transition`, `after-pre-admission-housekeeping-root-sync`,
  `after-pre-admission-housekeeping-marker-remove`,
  `after-pre-admission-housekeeping-marker-root-sync`.
- Slot retirement: `before-admission-slot-retire-rename`,
  `after-admission-slot-retire-rename`, `after-admission-slot-retire-root-sync`,
  `after-admission-slot-retire-cleanup-root-sync`.
- Creator withdrawal: `before-creator-withdrawal-seal`, `after-creator-withdrawal-seal`,
  `before-creator-withdrawal-rename`, `after-creator-withdrawal-rename`,
  `after-creator-withdrawal-root-sync`, `after-creator-withdrawal-cleanup-root-sync`.
- Coordination cleanup: `after-coordination-cleanup-marker-enumeration`,
  `after-coordination-cleanup-stage-create`, `after-coordination-cleanup-stage-partial-write`,
  `after-coordination-cleanup-stage-file-sync`, `after-coordination-cleanup-ack-rename`,
  `after-coordination-cleanup-ack-root-sync`, `after-coordination-cleanup-marker-owner-remove`, `after-coordination-cleanup-marker-remove`,
  `after-coordination-cleanup-marker-root-sync`, `after-coordination-cleanup-ack-remove`,
  `after-coordination-cleanup-final-root-sync`.
  `after-coordination-cleanup-stage-partial-write` follows a deterministic, nonempty strict-prefix
  write of the canonical acknowledgment bytes before write-all continues; reaching it never depends
  on the operating system returning a short write. `after-coordination-cleanup-stage-file-sync`
  follows the complete canonical write and successful file sync. `after-coordination-cleanup-marker-owner-remove` follows the marker owner object's unlink and precedes its directory removal; at the housekeeper sites a marker whose owner object is already absent unlinks nothing and never reaches it, while the active owner's own cleanup pass reaches it unconditionally after its idempotent owner-removal step.
- Publication-stage construction: `after-lock-publication-stage-create`,
  `after-lock-publication-owner-create`, `after-lock-publication-owner-partial-write`,
  `after-lock-publication-owner-sync`, `after-lock-publication-stage-sync`,
  in that order.
- Publication rename attempt: `before-lock-publication-rename`, followed on the success branch by
  `after-lock-publication-rename` then `after-lock-publication-root-sync`, or on the mutually
  exclusive collision branch by `after-lock-publication-rename-collision`.
- Active-lock validation: `after-active-lock-metadata`, `before-active-lock-content-read`.
- Publication-stage classification: `after-publication-stage-enumeration`,
  `before-publication-stage-validation`.
- Pre-callback generation closure: `after-pre-callback-coordination-generation-closed`.
- Callback: `before-ledger-operation-callback`.
- Lock durability: `after-owner-file-sync`, `after-lock-directory-sync`, `before-lock-retire`,
  `after-lock-retire`.

The exported fault list is the stable registry/ABI-order concatenation of those groups, not a linear
execution trace across mutually exclusive branches. Duplicate membership, a missing boundary, or a
legacy election hook is a contract failure.

One monotonic acquisition deadline covers fence endpoint binding, same-process fence waiting, full
classification, pre-admission housekeeping, preparation/fixed-slot polling, stale recovery, and every
restart. Progress resets only the deterministic backoff sequence and never the deadline. Terminal
creator withdrawal receives one fresh cleanup deadline only for the exact creator's own failure path.
Successful publication receives one separate fresh slot-retirement deadline. No wait, retry, progress, housekeeper transition, or root
sync widens any budget.

Before creating a preparation, the contender runs a strictly non-authorizing pre-admission
housekeeper under the original acquisition deadline. Each iteration closes and exactly classifies one
complete coordination generation. Corruption preserves every artifact and returns `corruption`.
Retryable uncertainty bounded-waits and restarts full classification. From one stable generation the
contender derives at most one purpose-specific housekeeping authority, exact-revalidates every bound
name, byte, identity, lifecycle, predecessor, and terminal proof, performs exactly one coordination
transition plus its required ledger-root sync, and restarts full classification. Only an
admission-ready generation may begin preparation.

**Open discrepancy, twice bounded and now settled in the middle — who may perform a housekeeping
transition.** The paragraph above says "the contender" generically. Measured 2026-08-04: granting
write authority to every contender breaks eight committed groups that pin byte-identical
preservation for lock-seeking operations, taking the ledger suite from 410/91 to 388/113 — so the
wide reading is refuted. The narrow reading (only an operation seeking no active lock and no
callback, i.e. `recover`) left all nine coordination-cleanup fault points unreachable by any test,
because every committed crash-window test drives `observeClock`. The shipped bound sits between
them, with evidence on both sides: `recover` holds the general write authority, and a lock-seeking
contender may perform exactly three bounded families of transitions, all measured — ADVANCING a dead
preparation's already-retired cleanup lifecycle; the owner-granted (2026-08-05) dead-owner
PUBLISHED-slot drainage recorded beside the `slot-retired.published` rule below: retiring the slot
as `published` on the authority of its byte-identical same-owner active lock, then draining that
marker's cleanup lifecycle; and the D1(a)-granted (2026-08-05, Batch B) dead-owner LONE-WITHDRAWAL
retirement — the "lone legacy withdrawal" rule below performed with final same-host dead-owner
proof, mirroring the drainage's any-contender bound, because the creator's own failure path now
mints that marker on the default path and a narrower bound would leave observeClock refusing roots
that healed before the withdrawal existed. Initiating an `abandoned`-family retirement stays reserved to `recover`,
byte-identical under every lock-seeking contender, as the committed dead-owner slot-orphan pins require.

A related measured limit, recorded 2026-08-05 and RESOLVED the same day: a WARM preparation-stage
crash at any of the six pre-rename points on a root carrying the previous acquisition's
steady-state `.released` marker was permanent corruption from both `observeClock` and `recover()`.
The fix is classification tolerance, not service widening (both were built and measured): the
preparation, retired-preparation, and orphan prep-final branches treat exactly the UNRELATED
`released` marker as inert legacy residue, while `publication-aborted` (a committed pin holds it),
`recovery-pending`, and every same-owner marker stay corruption. Both entry points heal all six
shapes warm, observation mutates nothing beside a live preparation, and this gate is closed.

The pre-admission housekeeper may only retire the exact dead preparation, publication stage, or fixed
slot authorized below; progress one exact cleanup stage to its bound ack; remove one exact marker or
ack; and sync the ledger root after that transition. It may never create an admission preparation,
fixed slot, publication stage, active lock, or semantic cleanup artifact as housekeeping; touch the
journal, transactions, claims, ingress, decisions, or semantic clock; enter the operation callback;
infer cleanup authority from absence; or service a semantic `recovery-pending` lock retirement. A
fault after any housekeeping transition and before preparation therefore leaves callback count zero
and every semantic subtree and clock byte-identical.

In this section, `the exact creator's frozen creation snapshot` (shortened below to `the exact
creator snapshot`) is a private, in-memory, nonserializable authority value produced only by the
successful exclusive-creation path for that exact artifact in the current acquisition attempt. It
binds the artifact's exact name and canonical owner bytes; the directory and owner-file type, link,
and filesystem identities; and the creation and durability observations available when that creation
boundary completes. The value exists only for that one acquisition and its own failure-cleanup path.
It cannot be reconstructed after restart, shared with another ledger instance even in the same PID,
inferred from a PID, name, bytes, or liveness result, or supplied by disk or agent input. Any bound
replacement or mismatch invalidates the value and returns the artifact to normal closed
classification. Under the local-v1 topology this is an exact evidence binding, not a claim of a
native persistent handle or stronger no-follow guarantee.

Positive housekeeping authority is purpose-specific and closed:

- `prep-retired` requires either the exact creator snapshot for that preparation or a final same-host
  dead-PID result for the exact name/owner/identity snapshot.
- `slot-retired.abandoned` requires the exact creator snapshot for that fixed slot, or final same-host
  dead-PID proof plus a stable complete graph containing no matching publication stage, active lock,
  or withdrawal marker. A live fixed slot without an ack remains `busy` unchanged.
- `slot-retired.withdrawn` requires the exact fixed-slot marker and exact same-owner withdrawal
  marker; liveness grants nothing.
- `slot-retired.published` requires the exact same-owner active lock or the exact same-owner
  `released`, `recovery-pending`, or `publication-aborted` successor.
- Creator-withdrawal cleanup requires a durable `slot-retired` cleanup ack whose name and digest are
  committed in the withdrawal ack and which binds the exact withdrawal marker.
- A lone legacy withdrawal requires the exact creator snapshot for that withdrawal artifact or final
  same-host dead-owner proof;
  it is retired only and is never promoted.
- A cleanup stage or ack requires its exact record digest, filename, filesystem identities, lifecycle
  predecessor, and still-valid purpose proof.

**Resolved 2026-08-05 — the foreign-dead-slot route is granted, narrowly, and performed.** The owner
decision: any contender may retire a DEAD-OWNER fixed slot as `published`, but only where the exact
same-owner active lock or a named successor is present; the wide rule was rejected. The
implementation performs exactly that. A dead-owner {fixed slot, byte-identical same-owner `lock`}
generation derives a published-disposition retirement; the resulting marker's cleanup lifecycle —
stage, acknowledgment, marker removal, acknowledgment removal — is drained by any contender; the
dead lock then reclaims through the unchanged legacy machinery. One acquisition, measured end to end
from real crash lineages on used roots; `recover()` performs the same transitions without taking the
lock. The `abandoned` family — a bare dead slot with no lock or successor — stays reserved to
`recover()`, byte-identical under every lock-seeking contender, as the committed dead-owner orphan
pins require.

Successor forms, measured 2026-08-05: the ACTIVE LOCK is the only fixed-slot successor a real crash
leaves. A same-owner `released` cannot coexist with an unretired slot (release follows the cleanup
pass); a `released` or `publication-aborted` marker beside a BARE slot is drained first as inert
legacy residue by the pre-classification service, after which the slot retires `abandoned` via
`recover()` — measured end to end; and a same-owner `recovery-pending` beside a slot has no
reachable lineage and classifies corruption. The granted published retirement therefore performs on
the active-lock form only; for an already-retired `published` MARKER, all four successor forms in
the rule above remain valid terminal evidence. Every entry point — reads included, with
`getHighWaterMark` the pinned example — now performs these drainage writes on another process's
dead artifacts first; intended (the wedge being removed). K1 activation is no longer blocked here.

**Open discrepancy — two reachable crash lineages stay `corruption` because committed pins require
it.** Measured 2026-08-05 on `codex/universal-compiled-authority`, while making the published-successor
count same-owner-only (unrelated `released`/`publication-aborted` markers are steady-state residue on
every used root, and an unserviced unrelated `recovery-pending` marker beside the live same-owner lock
is the specified state — the acquisition's own dead-lock reclaim mints one in the iteration that
publishes). Two lineages remain refused: (1) `published` marker + same-owner `publication-aborted`
successor + unrelated `recovery-pending` marker — reachable when the active-owner cleanup pass fails
after a dead-lock reclaim, so the degraded terminal aborts the lock while the foreign marker is still
unserviced; (2) `published` marker + live same-owner lock + unrelated `recovery-pending` marker + that
marker's own durable legacy cleanup ack — reachable when a prior owner crashed inside its
recovery-pending drain. Both classified corruption before same-owner counting too (candidate count),
so nothing regressed, but the committed pins at `test/authority/ledger.test.ts:1119` and `:1134` pin
corruption for the byte-adjacent no-lock graphs whose same-owner successor is `released`, and no rule
separating them has been decided. A candidate: tolerate the unrelated marker when the same-owner
successor is the active lock or `publication-aborted`; its premise — that a `released` successor
cannot coexist with an unretired marker or undrained cleanup evidence — is unproven. Resolve
deliberately: satisfying the lineages flips the pins.

The precedence is closed and exact: fully enumerate and classify the root; any structural,
provenance, graph, replacement, identity, link, type, or byte problem returns `corruption` with zero
mutation; retryable uncertainty bounded-waits and restarts; one proved housekeeping transition may
occur and forces full reclassification; live exact preparation or slot bounded-waits and then returns
`busy` unchanged. Admission-ready means no active lock, fixed slot, preparation, publication stage, or
unresolved/inconsistent cleanup graph remains. Valid non-authorizing residue is drained first. Normal
lock retirement may coexist only for the next active owner and does not grant pre-admission semantic
recovery authority. Every coordination grammar above is literal and closed. Any lookalike or broader
prefix is corruption, not ignored membership.

This local-ledger protocol requires all writers to share one host, filesystem, PID/liveness namespace, and monotonic-clock domain. POSIX `CLOCK_MONOTONIC` and Windows QPC provide the intended substrate; Linux time-namespace offsets are outside the hard-enforcement topology. The bounded acquisition and housekeeping deadlines are unchanged. Tickets do not defend against a malicious same-user filesystem writer.
After publication, the active owner—not the pre-admission housekeeper—closes and exact-revalidates the
complete coordination generation, durably retires the matching slot as `published`, and performs one
complete active-owner cleanup pass before callback entry. Valid live preparation, slot, active-lock, and transient-sharing waits use the same
deterministic monotonic delay sequence: 5ms, 10ms, 20ms, 40ms, then 50ms. Proven progress resets the
next delay to 5ms but never replaces or widens the applicable deadline. Every sleep is bounded by the
strictly positive monotonic time remaining.
A publication-stage name disappearance or change while the active owner closes the pre-callback
generation invalidates that coordination snapshot and causes bounded full-root re-enumeration against
the same housekeeping deadline; no callback runs from the invalidated generation. A stable subsequent
canonical generation may proceed. Exhaustion of already-classified valid coordination churn or
transient filesystem sharing is `busy`, authorizes zero semantic callback/provider effect or
authority-ledger mutation, and does not create a new public reason. Post-publication housekeeping may
perform only normal coordination-lock release/retirement cleanup; that cleanup is not an authorized
provider or ledger effect. Same-name identity, type, or byte replacement after a closed snapshot,
malformed topology, foreign provenance, and unverifiable liveness remain `corruption` (or the explicit
`lock-owner-unverifiable` result where applicable), never `busy`. Withdrawal and admission retirement
always leave authenticated durable markers and purpose-bound cleanup evidence. Every owner, stage,
slot, and lock object is exact-revalidated at owner-file sync, stage-directory sync,
stage-to-`lock` rename, active-lock root sync, and preparation-to-slot rename. The fixed slot remains
present and byte-identical until a valid publication or withdrawal successor is durable.
Every frozen filesystem identity in coordination evidence is the closed object
`{ dev, ino, mode, nlink }`, with each value the canonical decimal string encoding of the lossless
bigint returned by non-following `lstat`. `dev` and `ino` use the canonical signed decimal grammar
and range defined above; `mode` and `nlink` use the canonical unsigned decimal grammar and range.
A leading `+`, `-0`, a leading zero or other noncanonical spelling, an out-of-range value, a negative
`mode` or `nlink`, a numeric JSON value, a missing key, or an extra key is corruption. The coordination
cleanup ack is the strict
closed discriminated union `reelier.authority-ledger-coordination-cleanup-ack/v1`; `purpose` is exactly
`prep-retired`, `slot-retired`, or `creator-withdrawal` and participates in the record digest. There is
no optional-field superset.

**Open discrepancy — a fourth accepted purpose.** Measured 2026-08-04 at `6190ebc`: the parser
`assertCoordinationAck` (`src/authority/host/fs-ledger-coordination.ts`) accepts a fourth purpose,
`k1-writer-released`, with its own required key set and `recoveryAuthority`
`exact-writer-lease-or-dead-owner`. The string appears nowhere in this specification. The reading
that fits the rest of the system is that it is deliberate legacy support — the fence slice refuses
legacy writer residue everywhere, and refusing it requires being able to parse it, so the union has
to admit the shape in order to reject the artifact. That reading is not recorded anywhere, and this
paragraph as written forbids it. Resolve deliberately: either the union is closed at three purposes
and legacy residue must be recognised without parsing as an ack, or the union is closed at four and
this paragraph must say so. Do not narrow the parser on the strength of this paragraph alone —
legacy residue detection depends on it.

The `prep-retired` variant has exact keys
`{ directoryIdentity, kind, markerName, originalName, owner, ownerBytesDigest, ownerBytesLength,
ownerDigest, ownerIdentity, purpose, recoveryAuthority, state, v }`. The `creator-withdrawal` variant
has those keys plus mandatory `slotRetirementAckDigest` and `slotRetirementAckName`. `kind` is
respectively `admission-prep-retired` or `creator-withdrawal`; `state` is the marker's exact closed
state; `recoveryAuthority` is respectively `dead-owner-or-exact-creator` or
`exact-slot-retirement-ack`. The canonical owner is reconstructed exactly from the closed name even
for `empty`; only `ownerIdentity` is null for `empty`. `ownerBytesDigest` and `ownerBytesLength` bind
the raw absent/zero, prefix, or complete bytes, while `slotRetirementAckName` and
`slotRetirementAckDigest` bind the exact durable `slot-retired.withdrawn` ack that names and digests
this withdrawal marker. Missing, replaced, mismatched, or merely inferred slot evidence grants no
withdrawal cleanup authority.

The `slot-retired` variant has exact keys
`{ disposition, kind, markerName, owner, ownerBytesDigest, ownerBytesLength, ownerDigest,
ownerIdentity, originalName, purpose, recoveryAuthority, slotIdentity, terminalArtifactDigest,
terminalArtifactName, v }`; `kind` is `admission-slot-retired`, `originalName` is
`.authority-ledger-admission-0`, and `disposition` strictly discriminates three closed records with
the same key set. For `abandoned`, `recoveryAuthority` is `dead-owner-or-exact-creator` and the
terminal name/digest bind the exact durable abandoned slot-retirement marker snapshot itself, a
positive fact never reconstructed from absence. For `withdrawn`, `recoveryAuthority` is
`exact-withdrawal-marker` and the terminal name/digest bind the exact same-owner withdrawal marker.
For `published`, `recoveryAuthority` is `active-owner-or-exact-lock-successor` and the terminal
name/digest bind the exact same-owner active `lock` or exact `released`, `recovery-pending`, or
`publication-aborted` successor. No universal active-owner authority literal is valid across
dispositions.

For every union record, `ownerDigest` is the digest of the exact canonical owner,
`ownerBytesDigest` is the digest of the raw owner-file bytes, `ownerBytesLength` is their canonical
nonnegative decimal length string, and the final filename is
`.authority-ledger-coordination-cleanup-<64-lower-hex-record-digest>.ack`. The exclusive staging file
is the regular root file
`.authority-ledger-coordination-cleanup-stage-<purpose-code>-<64-lower-hex-record-digest>.tmp`, where
`purpose-code` is exactly `p` for `prep-retired`, `s` for `slot-retired`, or `w` for
`creator-withdrawal`. Every generated authority-ledger component is at most 255 UTF-8 bytes even
with the longest closed fields and a five-or-more-digit PID. The exact lifecycle is exclusive regular
stage-file create, canonical write-all, file sync, atomic rename to the final ack, root sync, exact
marker removal, root sync, exact ack removal, root sync; there is no stage-directory sync. Every
exclusive cleanup stage is recoverable at zero bytes, any exact nonempty proper prefix of the
reconstructed canonical ack, or the complete canonical bytes; continuation preserves the same file
identity and appends only the remaining suffix. Any non-prefix or replacement is corruption. The
deterministic injected partial-write boundary may use exactly the first byte, but recovery accepts
longer real prefixes too. Every cleanup step exact-revalidates its stage/ack identity, bytes, name
digest, predecessor,
and still-present purpose proof. Marker-only, marker-plus-matching-ack, and a valid
purpose-authorized orphan ack are recoverable windows; absence alone never grants authority.
A prep orphan ack is valid only after its exact original name is absent. A slot orphan ack is valid
only while its exact terminal proof still validates. A withdrawal orphan ack is valid only after the
matching `withdrawn` slot-retirement marker has already completed its durable cleanup. Invalid,
mismatched, or purpose-inapplicable orphan acks, markers, stages, identities, bytes, or terminal proofs
are preserved corruption. The active owner performs its cleanup pass exactly once after all required
sync barriers and before callback; the pre-admission housekeeper performs at most one transition per
closed generation and never enters callback. Withdrawal markers are never cleaned before their
matching slot retirement.

**Resolved 2026-08-05 (D1, owner grant (a)) — the two committed pins that disagreed about the
settled withdrawal graph.** Measured 2026-08-04 at `7254fd2`: for a byte-identical root — a
`withdrawn` slot-retirement marker, a same-owner `publication-aborted` terminal, and one bound
`slot-retired`/`withdrawn` acknowledgment — `test/authority/ledger.test.ts:1022` (owner PID
alive) required `busy` with zero mutation while `:1746` required `advanced` with every artifact
removed. The owner decided preservation wins: live coordination residue is never touched by a
foreign contender, and the chain completes only through the creator's own acquisition or a
DEAD-owner housekeeping route mirroring the published-slot drainage. `:1022` stands verbatim;
`:1746` was re-fixtured to a dead owner in the same commit that shipped the chain (Batch B),
keeping every ordering assertion, and now passes — `after-creator-withdrawal-cleanup-root-sync`
is reachable, emitted, and pinned on both the marker form and the aborted-terminal form.

**The seal — proposed from measurement and SIGNED 2026-08-05 (Batch B); the six
creator-withdrawal points are emitted under it. This resolves the former "Under-defined — the
seal" note.** Each clause below is forced by a committed pin or a measurement; the derivation is
`docs/superpowers/plans/2026-08-05-withdrawal-chain-measured.md`.

1. The seal is the durability-and-revalidation step between fence-held validation and the stage
   rename. After `before-creator-withdrawal-seal` the creator exact-revalidates its frozen stage
   snapshot, then makes the stage's exact current content durable — owner-object file sync when
   one exists, then stage-directory sync — and fires `after-creator-withdrawal-seal`. The seal
   mutates no root-visible name and never removes or truncates content: a hard exit anywhere
   between the seal points leaves exactly the one stage and no marker, and a complete stage is
   never observable content-less. Sealing exists so the atomic rename publishes an
   already-durable authenticated marker even when the creator crashed before the construction
   path's own sync boundaries ran.
2. The rename between `before/after-creator-withdrawal-rename` is one atomic whole-directory
   rename of the sealed stage to its terminal: a `complete` stage to the same-owner
   `.authority-ledger-lock-<pid>-<nonce>.publication-aborted` marker; an `empty`, `zero`, or
   `partial` stage to the same-owner
   `.authority-ledger-creator-withdrawal-<hostdigest>-<ticket>-<pid>-<nonce>.<state>` marker.
   `after-creator-withdrawal-root-sync` follows the ledger-root sync that makes the marker name
   durable; the original stage name is absent there.
3. `after-creator-withdrawal-cleanup-root-sync` names the root sync after step 6 of the chain
   below — the withdrawal terminal's marker removal — mirroring the slot family's
   `after-admission-slot-retire-cleanup-root-sync`, ordered after it and before the callback.
   (Amended at ship time, 2026-08-05: for the publication-aborted-terminal form, whose terminal
   drains through the legacy machinery once the chain's K1 evidence is gone, the point fires on
   the bound slot acknowledgment's removal root sync — the chain's last own act; the step-6
   placement is the withdrawal-marker form's, and a residue recovered from AFTER the boundary
   does not re-fire it.)
4. Under a K1-active generation the withdrawal terminal is created FIRST and the fixed slot then
   retires `withdrawn` on its authority (the `slot-retired.withdrawn` rule above), so the crash
   matrix below gains one in-flight residue: `bare fixed slot + same-owner withdrawal terminal`,
   whose only next transition is the withdrawn slot retirement. Shipped 2026-08-06 (Batch C):
   the sub-complete form classifies preserved bounded `busy` live (D4 released-only tolerance,
   pinned warm and fresh); a DEAD owner's window retires through the dead-slot `withdrawn` route
   on the marker's authority and the chain completes it — pinned on real crashed creators. The
   complete form drains per the successor-forms paragraph (inert-legacy service, `abandoned`).
5. Who acts, per the D1(a) grant verbatim: entering withdrawal is the creator's own failure
   path only, under its one fresh cleanup deadline. Chain crash residue is progressed only
   through the creator's own ACQUISITION — the in-flight operation holding the creation
   snapshot, which its own failure path is — or by a dead-owner housekeeping route mirroring
   the published-slot drainage; ALL live residue, same-process observers included per the
   exact-creator-snapshot rule, stays bounded `busy`, byte-identical. (Amended 2026-08-05,
   same day as the sign-off: the first recording said "the creator's own process", a
   mistranscription of the grant that the D5 discovery below exposed; D5 carries the one open
   re-fixture question.)
6. A lone dead COMPLETE external stage withdraws by the same atomic rename to that owner's
   `publication-aborted` marker instead of being removed. Sub-complete dead external stages keep
   the current authorized removal; no pin constrains them (measured 2026-08-05).

**Resolved 2026-08-06 (Batch D) — the dead-stage withdrawal route, owner grant.** Clause 6 covers
an EXTERNAL stage with no slot. The K1 shape it did not cover is the one every hard exit at the
five stage-construction boundaries actually leaves: `fixed slot + its SAME-OWNER publication
stage`. Measured on this tree (24-cell probe: the five stage-construction boundaries plus the complete
form's post-withdrawal landing shape, × warm/fresh × both entry points, zero probe errors): every
one of the twenty stage cells was permanently bounded `busy` from `observeClock` AND `recover()` —
the S4 re-spec's class-3 wedge and the flip's one operational regression. The owner
granted: a DEAD-owner sub-complete or complete stage beside its same-owner fixed slot may be
withdrawn by any contender through this same typed atomic withdrawal protocol — the seal, then the
one state-selected terminal rename — producing the W1 window the shipped chain completes.
Dead-PID-gated at derivation and at dispatch like every sibling route; a LIVE owner's stage stays
byte-identical from both entry points, held by its own pin; a cross-owner stage beside the slot
grants nothing and stays preserved corruption, also pinned. Sub-complete dead EXTERNAL stages
without a slot keep the clause-6 authorized removal above, verbatim and unchanged.

The route adds no fault point (the frozen 58/125 registry is untouched) because it reuses the
clause-6 seal and rename, which already carry `before/after-creator-withdrawal-seal` and
`before/after-creator-withdrawal-rename`; it syncs the ledger root itself and fires
`after-creator-withdrawal-root-sync` there, unlike the clause-6 path where the publication
settlement loop owns that sync. **It does add a new EMISSION SITE for an existing point, and that
is a contract change even though the registry did not move:** `before-publication-stage-validation`
now fires three times from the pre-admission housekeeping path — once for the route's own target
validation and twice inside the seal — before any `after-publication-stage-enumeration`. On the
complete form the acquisition then answers `busy` from the legacy drain and never enumerates at
all. The committed ordering pin ("publication-stage classification hooks are live and refuse
same-name identity replacement") asserts enumeration-then-validations and stays green only because
its fixture is a lone external stage with no slot, which cannot reach this route — so it is now
fixture-local rather than the invariant it reads as, and the emission shape is pinned instead in
the dead-stage family, where it can fail. **The two terminal shapes land differently, and the pins say so
rather than averaging them:** a SUB-COMPLETE stage renames to the same-owner creator-withdrawal
terminal, so the W1 dead-owner route retires the slot `withdrawn` and the chain drains the whole
graph inside the same acquisition (`observeClock` completes). A COMPLETE stage renames to the
`.publication-aborted` marker, which the legacy machinery drains, leaving the BARE SLOT — the
recover-reserved `abandoned` family. So `observeClock` progresses the complete form and still
answers bounded `busy`; `recover()` heals it. That is the unwedging, stated exactly: the root
becomes recoverable instead of permanently busy from every entry, and no observeClock abandoned-slot
retirement authority is granted here (that remains the open housekeeping-permission question). The
committed green pin `test/authority/ledger.test.ts:1020` ("dead exact slot plus same-owner stage is
recoverable but unsupported") flipped in the same commit, named: it keeps its result and its
zero-callback and zero-semantic-clock halves, and its untouched-root, zero-mutation, and
snapshot-pairing halves become the measured progressed shape — one opened epoch, two closed
generations (the transition's and the settled pass's), which is this section's
one-transition-per-closed-generation rule made visible.

**Not self-contained — updated 2026-08-05, and SHIPPED the same day.** Chain steps 1 to 3
require the fixed slot to retire as `withdrawn` through the `before/after-admission-slot-retire-*`
points, and `ledger.test.ts:1746` pins one slot-retirement point and one creator-withdrawal
point in a single ordered assertion — so the six creator-withdrawal points landed with the chain
(Batch B): the creator's failure-path withdrawal, the lone-withdrawal retirement, the
withdrawn-slot cleanup lifecycle, and the creator-withdrawal ack lifecycle, all dead-owner-gated
on the housekeeping side per D1(a), with `:1746` re-fixtured to a dead owner in the same commit
as granted. The fault-pin backlog is zero; the exported registry carries all 58 specified points
(plus the 13 forbidden extras the D3(a) freeze deletes).

> **Third and final re-fixture of this family — owner-granted 2026-08-07.** `ledger.test.ts:1713`
> ("…slot retirement and purpose-bound ack crash windows converge") built its four residues —
> `marker-only`, `marker-plus-stage`, `marker-plus-ack`, `orphan-ack`, exactly the positive residues
> enumerated below — with `pid: process.pid`, a **live** owner. Two independent gates refuse a
> live-owner `slot-retired-cleanup`: `fs-ledger.ts:1569` inside the permission predicate, and
> `fs-ledger.ts:2066` unconditionally. The second is why opening the housekeeping permission
> completely does not reach these four — measured 2026-08-07, they stay `busy` under the wide grant,
> so this was never a permission question and must not be recorded as one. Re-fixtured to
> `await exitedProcessPid()`, the same transformation granted for `:1746` (D1(a)) and `:1760`
> (D5(a)): measured 0/5 live, **5/5 dead**.
>
> This is conformance, not a weakening. The chain requires final same-host dead-owner proof;
> `recoveryAuthority: "exact-withdrawal-marker"` names the evidence that binds the ack, not who may
> act on it. Nor does it retire real coverage: residue carrying a live pid is either the creator's
> own, cleanable under exact-creator authority, or another live participant's, which must not be
> touched. The third case — live pid, no creator authority — is reachable only by writing the
> artifacts directly, as the fixture did, never by the ledger's own chain.
>
> **Separate hazard, flagged and NOT addressed here.** `processLiveness` is `process.kill(pid, 0)`
> and nothing else (`fs-ledger.ts:3785`) — it proves that *some* process holds that pid, never that
> it is the owner. The owner record already carries a `nonce` that liveness ignores. After pid
> reuse, genuinely dead residue reads `alive` indefinitely and every operation on that root returns
> `busy` with no recovery but manual intervention. Reachability is unmeasured; this is a flagged
> hypothesis, not a finding.

The creator-withdrawal chain is exact and monotonic:

1. The exact `.withdrawn` slot marker and exact same-owner withdrawal marker coexist.
2. The `slot-retired.withdrawn` cleanup ack is created and synced while both markers remain; it
   binds the withdrawal marker's exact name and digest.
3. The retired slot marker is removed and root-synced while the slot ack remains.
4. The creator-withdrawal ack is created and synced while the withdrawal marker and bound slot ack
   remain; it commits `slotRetirementAckName` and `slotRetirementAckDigest`.
5. The slot ack is removed and root-synced while the withdrawal marker and withdrawal ack preserve
   the complete proof chain.
6. The withdrawal marker is removed and root-synced while its exact orphan withdrawal ack remains.
7. The withdrawal ack is removed and root-synced, yielding admission-ready empty coordination.

The exact crash matrix recognizes the positive-evidence residues after steps 1 through 6 and the
root-synced admission-ready empty result after step 7. The selected positive residues are exact
`slot + withdrawal`, `slot + withdrawal + slot-stage`, `slot + withdrawal + slot-ack`,
`withdrawal + slot-ack`, `withdrawal + slot-ack + withdrawal-stage`,
`withdrawal + slot-ack + withdrawal-ack`, `withdrawal + withdrawal-ack`, and orphan
`withdrawal-ack`; both cleanup stages are regular files containing the exact canonical bound record
and are recognized only with their exact durable predecessors. Each state progresses only its next
exact transition and then restarts full classification. In particular, `slot absent + withdrawal
present + no ack` grants nothing and is preserved corruption while the owner lives; with final
same-host dead-owner proof it is exactly the lone-withdrawal residue the "lone legacy withdrawal"
rule above retires (shipped 2026-08-05, Batch B, both entry points, warm and fresh — pinned). Any
replacement or cross-owner/cross-digest variant is preserved corruption regardless of liveness.
Resolved 2026-08-06 (Batch C, the empty-terminal grant): an EMPTY withdrawal terminal is
acknowledged by the empty-terminal form — the withdrawn slot-ack binds `terminalArtifactDigest`
as the digest of the empty byte string, and the creator-withdrawal ack binds `ownerBytesLength`
`"0"`, the empty-bytes digest, and null owner identity — accepted by the cleanup-stage validator
and the orphan-final classifier for withdrawal-family terminals ONLY; `published` and
`abandoned` dispositions still require exact owner bytes. Forced by measurement: empty is the
most common W1 state (task 1(i)), so the prior withhold wedged the chain's main route.
Implementation note, recorded for owner ratification: the durable ack-binding validator was
widened alongside the two named validators — without it the grant-sanctioned durable slot-ack
(crash-state-5 residue) refused its own form — and the empty digest being a universal constant,
the SAME-OWNER binding is the empty form's whole authority, held by its own cross-owner pin. An entirely empty coordination state reconstructs only a new
canonical owner for a new admission attempt; it never retroactively authenticates missing cleanup
evidence.

**Resolved 2026-08-05 (Batch B) — the withdrawal family's warm-tolerance pin conflict (D4),
owner grant (a).** Measured at `214801b`: every crash residue in the matrix above classified
bounded `busy` on a fresh root and permanent `corruption` from both entry points on any root
carrying the steady-state unrelated `released` marker every used root keeps — the sixth
fresh-root-blindness instance, pinned in by three committed fresh-root pins. The owner granted
the released-only tolerance at the four withdrawal-family classification sites (the withdrawn-slot
terminal binding, the withdrawals branch, and both orphan finals), and the three pins flipped
busy-ward in the same commit, named: `ledger.test.ts:1141` retired case, `:1157` retired case,
`:1159`. The boundary is exactly the preparation family's: only the UNRELATED `released` marker
is inert; same-owner `released` and unrelated `publication-aborted` stay preserved corruption,
each held by its own boundary pin at every tolerance site, and the warm parity family at the end
of the ledger suite is the standing guard (parity oracles plus fresh-busy anchors, so neither a
re-widening nor a regression to corruption can ship silently). Derivation:
`docs/superpowers/plans/2026-08-05-withdrawal-chain-measured.md` §4.

**Resolved 2026-08-06 (Batch C) — the eight-state matrix's live fixtures against the
live-preservation family (D5, owner grant (a)).** Found 2026-08-05 (Batch B): the committed
eight-state test (`ledger.test.ts:1760`, expects `advanced` with full drainage, owner pid LIVE)
was contradicted shape-for-shape by the committed GREEN live-preservation family (`:1135`,
`:1140`, `:1143`, `:1154`, `:1156`, `:1158`, `:1167`, `:1170` withdrawn case), which pins
byte-identical bounded `busy` for the same residues with live same-pid owners. The owner granted
(a): `:1760`'s eight subtests were re-fixtured to dead owners in the same commit that made them
satisfiable — the same sanctioned transformation `:1746` received under D1(a) — keeping every
drainage, signal-count, and full-drain assertion; the live-preservation family (`:1135`–`:1170`)
and `:1022` stand verbatim; zero green pins flipped. All eight states plus the parent went green
by name against the recorded floor (619/59 → 628/50). One fixture amendment rode the commit,
named: the drive settles over up to three attempts on retryable bounded `busy` (the B2c
completion-oracle pattern; corruption and completion stay terminal on first sight, and the
callback counter stays exact because the callback fires only on the completing acquisition) —
the single-attempt drive was measured flaking once in eight runs under suite load.

**Resolved 2026-08-06 (Batch C) — the seventh fresh-root-blindness instance, the abandoned
family (D6, owner grant (a), contingent — the contingency did not trigger).** The `abandoned`
slot-retired branch, its orphan-final twin, and their two descriptor sites (the raw
entries-length counts withheld the recover-reserved drain on warm roots — the lone-withdrawal
precedent's wedge, fixed by its rule: unrelated inert `released` excluded from the count) now
apply the released-only tolerance with exactly the D4 boundary; same-owner `released`,
unrelated `publication-aborted`, and `recovery-pending` stay corruption, each held by its own
warm boundary pin. The four-site compiled-build A/B ran both directions BEFORE the source
change: zero committed movers (628/50 name-identical), so the grant's contingency passed. The
family stays recover-reserved — warm observe preserves bounded busy exactly as fresh. Still
recorded from the Batch B note: the unrelated `released` marker's own in-flight legacy cleanup
ack beside a withdrawal-family graph stays corruption, and the released-only boundary should
be revisited deliberately before an unrelated aborted marker becomes the eighth instance.

Every raw root snapshot is whole-generation state. Active-lock replacement or sustained membership
churn, an external publication stage changing dead-to-live, or atomic fixed-slot/stage replacement
invalidates the entire snapshot and restarts classification under the same acquisition deadline; no
preparation, publication stage, semantic clock read, or callback may occur from the invalidated
generation. Once an exact source name has been retired and its root sync completes, that name is
tombstoned for the current housekeeping generation. Reappearance at the initial, closed, final, or
post-marker-removal snapshot is corruption, preserves the replacement and every still-present typed
retirement/ack proof artifact, and cannot admit. Before marker removal the marker and ack survive;
after marker removal the marker remains absent and the surviving typed ack is preserved. Cleanup
never recreates removed history, and absence alone never grants authority. This applies equally to
creator and housekeeper rename-collision retries:
the same synced stage is retained, its directory and owner identities and bytes are revalidated before
every retry, and any replacement is preserved rather than published or deleted. Pre-callback
generation closure occurs only after every required coordination sync and final exact revalidation.

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
validate the active lock, the exact admission preparation/fixed-slot grammar, publication stages,
and typed creator-withdrawal markers, including their names, types, link counts, owner files,
purpose bindings, and exact identities. These literal forms are the closed confinement grammar; no
broad admission, withdrawal, publication, or retirement prefix is accepted. Immediately after atomic publication and before reading or mutating any other
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
state. A fresh monotonic active-owner housekeeping deadline begins only after owner publication
succeeds; it does not reuse a nearly expired acquisition deadline and does not apply to the
pre-admission housekeeper. Lock acquisition, retirement cleanup, and transient
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
The generation-closing root enumeration precedes every atomic retirement authorization. Transient
sharing failures at enumeration, validation, final pre-rename validation, and rename boundaries
restart full classification under the same deadline; exhaustion is `busy`, not corruption.
After publishing its own owner, the active holder applies the same protocol until it has one fully
classified stable generation. A retry result is never discarded: malformed replacement generations
refuse before retirement housekeeping or the operation-callback entry, preserving every artifact.
Immediately before every dead-artifact retirement attempt, liveness is probed again. PID reuse to a
live process preserves the artifact and yields busy/retry; an unverifiable final probe preserves it.
On rename-to-`lock` collision the creator retains its exact fully synced stage object and retries the
atomic rename of that same identity. It does not recreate or resync the stage and atomically withdraws
it only on terminal timeout/refusal/error after exact revalidation. The exact
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
