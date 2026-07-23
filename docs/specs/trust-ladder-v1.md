# Trust Ladder v1 — Spec

_Drafted 2026-07-22. The rungs that move a receipt from "trust me" to "check my references": signing (flight-recorder v1 §6, made real), trusted timestamps, provider request-ids, and cross-tenant corroboration with **reputation-only** standing (decided 2026-07-22 — economic stake/slashing is an explicit non-goal). Ships as 0.20.0 (OSS) + a reelier-cloud wave; implementation starts after flight-recorder v2 (0.19.0) merges, and builds on its primitives (`canonicalJson`/`digestSha256`, the manifest, the write receipt block)._

**The governing principle — a ladder of graded claims, never a blanket ✓:** a receipt asserts several *independent* claims, each provable to a different grade. The receipt page renders them as separate rows (green/amber/grey), each stating exactly what it proves and how to raise it. A single "verified ✓" would be a lie by compression; the ladder is the product.

**What no rung claims (state it on the page, verbatim-honest):** none of this proves a run wasn't *fabricated before it was recorded*. Signing proves unaltered-since-push by a known key-holder; timestamps prove existed-by-T; request-ids make claims externally falsifiable; corroboration makes fabrication expensive. "Fabrication-proof" is not in the vocabulary. The standing word-split rule evolves, not lapses: after §1 ships, **"tamper-evident" is permitted for the unaltered-since-push claim only** — never for the receipt as a whole; "compliance-grade" stays banned everywhere.

---

## 1. Signing — Ed25519 over the record (integrity + identity)

**Job:** make "this receipt was produced by the holder of this key and has not been altered since push" cryptographically true, and never one word more.

**Mechanics (OSS):**
- `reelier init --signing` — generate an Ed25519 keypair via `node:crypto` (`generateKeyPairSync("ed25519")`; zero new deps). Private key → `~/.reelier/signing/<keyId>.pem` chmod-equivalent restricted, **never** inside a repo, never uploaded. `keyId` = first 16 hex chars of sha256(public key DER). Public key printed + written beside it for registration.
- `reelier push` — when a signing key exists: sign `digestSha256(record)` (the canonical-JSON digest of the exact RunRecord being pushed — reuse 0.19.0's `canonicalJson`; no new hash scheme). Payload gains optional `signature: { alg: "ed25519", keyId, sig: <base64> }` — same optional-field discipline as `skillContentSha256`; unsigned pushes unchanged, **no second-class shaming** (v1 rule).
- `reelier verify <permalink|file>` — offline: fetch `/r/<token>/json` (or read the local record), recompute the canonical digest, verify the signature against a public key given via `--key <pem>` or fetched from the tenant's published key page. Prints per-claim results, never a bare OK.

**Mechanics (cloud):**
- Tenant key registry: dashboard page to register/revoke public keys (revocation = "no longer signs for this tenant from date D" — it cannot unsign history; the page says so).
- Server-side verification on ingest; `/r/<token>` renders **"signed by <owner> ✓"** only when verification passes. Exact page copy: *"Produced by the holder of key `<keyId>` and unaltered since push. Does not prove the run wasn't fabricated before signing."*
- **Cross-seam integration test is mandatory** (CLI sign → push → DB → page renders claim), per the v1 contract-mismatch lesson.

**Design decisions:** local keypair first, keyless OIDC (Fulcio/Rekor) deliberately later — the cons are recorded (identity-provider dependence, public-log privacy, log-dependent verification forever, excludes local runs) and it would make laptop receipts second-class. No key escrow: lose the key, register a new one; old receipts stay verifiable against the old public key.

**Known limits:** a compromised machine signs "honest" receipts; key revocation is forward-looking only.

**Verify:** sign→push→verify roundtrip; single-byte tamper → loud fail; unsigned record renders exactly as today; revoked-key receipt shows "signed (key since revoked, valid at push time)".

## 2. Trusted timestamp — RFC-3161 (existed no later than T)

**Job:** kill backdating: a receipt carries third-party proof it existed by time T.

**Mechanics:**
- At push (when `--timestamp` or `timestamp: true` in config): request an RFC-3161 token over the same canonical record digest from a public TSA (default endpoint shipped in config, user-overridable — same explicit-update discipline as prices.yml: never silently switch TSAs). Store the DER token base64 in the payload: `timestamp: { tsa: <url>, token: <b64> }`.
- **Fail-open, marked:** TSA unreachable → push succeeds, receipt shows "no timestamp" (grey rung), stderr notes it. A push must never hang on a third party (prime directive's spirit at the push seam).
- Cloud independently stamps `receivedAt` on ingest and renders both ("timestamped by <TSA> at T · received by reelier.com at T'").
- **Verification honesty (v1 scope):** `reelier verify` checks the token's message-imprint matches the record digest and prints the standard `openssl ts -verify` command for full TSA cert-chain verification. Full dependency-free ASN.1/PKCS#7 chain verification in-CLI is real work for marginal v1 value — the page and CLI both say exactly which half we verified. Native chain verification is a v2 line item, not a silent gap.

**Design decisions:** RFC-3161 over running our own transparency log (standing infra with an uptime promise = expensive rung; revisit only if TSA quality disappoints). Timestamp is opt-in at first ship, default-on one minor version later (let the failure modes surface before they're on every push).

**Verify:** imprint-match unit tests against a fixture token; TSA-down path pushes cleanly with the grey rung; both timestamps render.

## 3. Provider request-ids — cross-checkable references

**Job:** move claims from self-asserted to externally falsifiable: capture identifiers the operator cannot mint, so an auditor can cross-check against the provider's own logs.

**Mechanics:**
- **`http.*` builtin tools (headers visible):** capture response headers from an allowlist — `request-id`, `x-request-id`, `x-amzn-requestid`, `x-amz-request-id`, `x-goog-request-id`, `stripe-request-id`, `cf-ray` — into the step's receipt: `refs: [{source: "header", key, value}]`.
- **MCP-wrapped tools (headers invisible — the honest constraint):** the proxy sees tool *results*, not HTTP transport. Capture body-level fields from an allowlist of request-id-shaped keys (`request_id`, `requestId`, `x_request_id`) at the top level of JSON bodies: `refs: [{source: "body", key, value}]`. A server that doesn't surface them yields nothing — per-tool gap, shown as such, never guessed.
- Extends the 0.19.0 `StepRecord.write.resource` discipline to reads: `StepRecord.refs?` is optional, omitted when empty, allowlist-only (no heuristic scraping beyond the named keys — a wrong "reference" is worse than none).
- **Redaction interplay:** request-ids are identifiers, not secrets — but they pass through `src/redact.ts` like everything else; if a redaction rule catches one, redaction wins (the receipt shows the ref as redacted rather than leaking).
- Receipt page renders refs per step with the grade: *"cross-checkable against <source>'s logs — Reelier did not verify these upstream"* (that verification is the witnessed-relay/notarization rung, not this one).

**Verify:** header capture matrix on http.* fixtures; body capture on MCP fixtures incl. absent/near-miss keys (`requestIdentifier` must NOT match); redaction-wins test; page renders grade text.

## 4. Cross-tenant corroboration + reputation — the economic rung (cloud)

**Job:** make fabrication *expensive and legible* rather than pretending it's impossible: independent tenants producing matching receipts, and a tenant's standing shown as facts.

**Mechanics:**
- **Corroboration:** reuse the workflow fingerprint (flight-recorder v1 §3: ordered tool-name sequence + normalized arg shapes, never values) computed server-side per pushed receipt. Receipt page: *"N distinct tenants have produced matching receipts for this skill"* — distinct-tenant only (the established anti-gaming basis for ranking), never raw run counts.
- **Reputation = facts, not scores:** the tenant block on a receipt shows — verified-org badge (domain verification: DNS TXT or meta tag, manual review fallback), account age, distinct skills with pushed receipts, distinct-tenant corroborations received. **No numeric trust score** — a composite number is gameable and overclaims precision; facts let the reader weigh.
- **Reputation-only (decided 2026-07-22):** no deposits, no slashing, no economic stake. If a receipt is shown fabricated, the remedy is the fact-block itself (corroborations retracted, org flagged after human review) — governance by visibility, not custody.

**Design decisions:** all §4 is cloud-side; the CLI learns nothing new (keeps the local-first trust story clean). Fingerprint matching is content-addressed on shapes, so no tenant ever sees another tenant's arg values.

**Known limits:** sybil tenants can manufacture "distinct" corroboration — mitigations are the verified-org badge weighting and distinct-tenant definitions (same billing identity = one tenant); state the limit on the methodology page rather than hiding it.

**Verify:** fingerprint-match fixtures across seeded tenants; distinct-tenant counting under same-org duplicates; domain-verification flow e2e; flagged-org rendering.

## The receipt page — the ladder rendered (cloud)

Per-claim rows, each green/amber/grey + one-line "how to raise this":
1. **Unaltered since push** — signature (§1)
2. **Timestamped** — TSA + receivedAt (§2)
3. **Produced by** — key owner + verified-org badge (§1/§4)
4. **Tools verified** — manifest preflight passed (0.19.0)
5. **Writes approved** — hash-bound approvals + idempotency keys (0.19.0)
6. **Cross-checkable refs** — request-ids (§3)
7. **Corroborated** — N distinct tenants (§4)

Grey is honest, never shameful: each grey row names its upgrade path ("sign your pushes: `reelier init --signing`"). This page is the gateway mechanic — every rung a local user wants lit is a cloud touchpoint.

## Non-goals (v1)

Economic stake / slashing / deposits (decided 2026-07-22: reputation-only) · keyless OIDC (Fulcio/Rekor) · running our own transparency log · TLS notarization / zkTLS · witnessed relay (revisit only as explicit opt-in later — it cuts against push-outward) · TEE attestation · numeric trust scores · full in-CLI RFC-3161 chain verification · any "compliance-grade" copy · "tamper-evident" outside the §1 claim.

## Order + effort

1. **Signing** (OSS + cloud, incl. the mandatory cross-seam test) — ~3 days; unlocks the narrow "tamper-evident" claim
2. **Request-ids** (OSS + page rendering) — ~1–2 days; biggest honesty-per-effort ratio
3. **Timestamp** (OSS + page) — ~2 days
4. **Claims-ladder page + corroboration + reputation** (cloud) — ~3–4 days

Gate: starts after flight-recorder v2 (0.19.0) merges to main; this branch rebases onto that merge before implementation. Standard loop per feature: implementer in worktree → adversarial review → verify → merge. One OSS release (0.20.0), one publish.
