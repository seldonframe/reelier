# Compiled Authority v1

Path C delegates bounded outcomes, never credentials. It is opt-in and does not alter Path A's live MCP recording or Path B's frozen replay bytes.

Authority objects are independently versioned, closed JSON objects. Their bytes are RFC 8785/JCS; their digest is `sha256:<lowercase hex>`; Ed25519 signatures cover exactly `reelier-authority-v1\nsha256:<digest>`. The digest is over a closed JCS envelope containing the authority purpose and payload digest, so purpose is bound without inserting a purpose line into the signature domain. Unknown versions and malformed, stale, revoked, cross-tenant, duplicate, or unchecked authority refuse before provider dispatch.

Roles are accountable sponsor, operator signer, authenticated requester, gate, connector account, and provider. An immutable signed `OutcomeContract` binds the tenant and contract ID; definition alias and digest; pack digest; validity; accountable sponsor; authenticated requester audiences; delegation leaf digest; connector and provider account; source resolver, projection schema, allowed read endpoints, and authorized projection JSON Pointers; allowed risk classes; quantitative limits; and a tenant-policy commitment. Append-only revocation changes activation state rather than editing a contract. A contract edit creates a new digest and activation.

The four v1 quantitative limits are `maxEffectsPerWindow`, `windowSeconds`, `maxEffectsPerSourceTrigger`, and `maxBodyBytes`. They are positive bounded integers. The window is a fixed duration of `windowSeconds`; a descendant may lower either effect count and may not increase `windowSeconds` or `maxBodyBytes`. Later gate/compiler modules enforce those comparisons and runtime counts; the wire layer only proves that the complete comparable values were signed.

`policyCommitment` is the closed tuple `{ schemaId, jcsBase64, digest }`. `jcsBase64` decodes to exact JSON bytes, those bytes must already be their RFC 8785/JCS form, and `digest` is SHA-256 over those exact decoded bytes. This commits tenant-specific templates, channel, timing window, and state policy without exposing a mutable provider template ID. The statically bundled definition identified by `schemaId` owns interpretation; credentials, secret references, authorization headers, and provider template IDs are not contract fields.

Delegation grants are signed explicit roots (`parentDigest: null`) or children (`parentDigest: sha256:…`). Every grant binds the sponsor, grantor, grantee, tenant, validity, and closed constraints for definition aliases, audiences, connector/account pairs, projection pointers, risk classes, and the same quantitative limits. Arrays are nonempty, bounded, and unique; there is no wildcard or implicit-all form. Task 2 validates chains and rejects descendant widening; host-local trust roots and activation/revocation history are not wire inputs.

Requests contain only a caller-stable request ID, opaque source references, and bounded definition choices: never tenant, connector, account, endpoint, recipient, body, URL, provider arguments, or credentials.

Source bundles bind the definition digest and projection schema ID in addition to tenant-scoped provenance, observation/freshness, source and trigger identity, raw digest, and the projection. Grounded, authored, and unresolved claims are separate bounded arrays of closed `{ claimId, projectionPointer }` entries. Claim IDs and pointers are globally unique across the three classes. Grounded pointers must resolve through own properties in the supplied projection. Task 2 additionally checks the bundle's definition/schema against the signed contract, projection authorization, freshness, and content schema.

Ingress idempotency is `(tenant, requester, requestId)` over canonical request bytes; semantic deduplication independently derives an outcome key from tenant, contract digest, definition alias, source identity, and trigger identity.

Verification, authorization, source completeness, dispatch, acknowledgement, reconciliation, topology, and completeness use `verified`, `failed`, `unchecked`, or `absent`. Neither `verified` nor a signature means safe, wise, semantically correct, or complete. Hard enforcement needs separate OS identity/container, authenticated ingress, agent-inaccessible secrets, and restricted provider egress; same-user topology is `unchecked`.

N-1 readers must reject `reelier.authority-receipt/v1` or render its authority claims unchecked. They must never create a whole-receipt pass. Path A/B readers and fixtures remain compatible and byte-identical.
