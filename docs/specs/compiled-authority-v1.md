# Compiled Authority v1

Path C delegates bounded outcomes, never credentials. It is opt-in and does not alter Path A's live MCP recording or Path B's frozen replay bytes.

Authority objects are independently versioned, closed JSON objects. Their bytes are RFC 8785/JCS; their digest is `sha256:<lowercase hex>`; Ed25519 signatures cover `reelier-authority-v1\n<purpose>\nsha256:<JCS digest>`. Unknown versions and malformed, stale, revoked, cross-tenant, duplicate, or unchecked authority refuse before provider dispatch.

Roles are accountable sponsor, operator signer, requester, gate, and provider. An immutable signed OutcomeContract pins the definition and scope; append-only revocation changes activation rather than editing the contract. Delegation is monotonic attenuation. Requests contain only a caller-stable request ID, opaque source references, and bounded definition choices: never tenant, connector, account, endpoint, recipient, body, URL, provider arguments, or credentials.

Source bundles name tenant-scoped provenance, observation/freshness, source and trigger identity, raw digest, and the authorized projection. Ingress idempotency is `(tenant, requester, requestId)` over canonical request bytes; semantic deduplication independently derives an outcome key from tenant, contract digest, definition alias, source identity, and trigger identity.

Verification, authorization, source completeness, dispatch, acknowledgement, reconciliation, topology, and completeness use `verified`, `failed`, `unchecked`, or `absent`. Neither `verified` nor a signature means safe, wise, semantically correct, or complete. Hard enforcement needs separate OS identity/container, authenticated ingress, agent-inaccessible secrets, and restricted provider egress; same-user topology is `unchecked`.

N-1 readers must reject `reelier.authority-receipt/v1` or render its authority claims unchecked. They must never create a whole-receipt pass. Path A/B readers and fixtures remain compatible and byte-identical.
