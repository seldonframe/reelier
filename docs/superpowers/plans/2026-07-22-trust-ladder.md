# Trust Ladder Implementation Plan (OSS 0.20.0 + reelier-cloud)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps. TDD, commit-per-task. Spec: `docs/specs/trust-ladder-v1.md` — read it first; it wins on any conflict.

**Goal:** Ship the graded-claims ladder: Ed25519 signing + verified keys, RFC-3161 timestamps, provider request-id refs, GitHub-OIDC CI attestation, cross-tenant corroboration — receipt page renders per-claim rows, never a blanket ✓.

**Repos:** OSS = worktree `C:\Users\maxim\CascadeProjects\reelier-trust` (branch `feat/trust-ladder`, on 0.19.0). Cloud = worktree `C:\Users\maxim\CascadeProjects\reelier-cloud-trust` (branch `feat/trust-ladder-cloud` off origin/main). The two sides build in parallel; **the wire contract below is the law for both** — neither side may drift from it without updating this plan.

## The wire contract (push payload, all fields optional siblings of `record`)

```typescript
signature?: { alg: "ed25519"; keyId: string; sig: string }        // sig = base64(ed25519-sign(sha256hex-digest-string of canonicalJson(record)))
timestamp?: { tsa: string; token: string }                          // token = base64(DER TimeStampResp); imprint = sha256(canonicalJson(record))
ciAttestation?: { provider: "github-actions"; token: string }       // OIDC JWT, audience "reelier.com"
```
`StepRecord.refs?: Array<{source: "header"|"body"; key: string; value: string}>` rides inside `record` (additive, omitted when empty).
Cloud NEVER fails ingest on absent/unverifiable trust fields — absent = grey rung; present-but-failed-verification = stored as failed, rendered "did not verify", never rendered as the claim.

## Global constraints (both repos)

- Never-lies: every field optional, omitted when unknown; old CLIs/records unaffected; no second-class shaming of unsigned/laptop pushes.
- OSS: no new runtime deps (node:crypto has Ed25519 + sha256; hand-roll the minimal ASN.1 for RFC-3161 like policy.ts hand-rolled YAML). Cloud: `jose` is acceptable for JWKS/JWT (Next.js repo, has deps).
- Banned copy: "tamper-evident" allowed ONLY for the unaltered-since-push row after signing ships; "compliance-grade" never. "fabrication-proof" never.
- OSS tests: node:test, full `npm test` green before every commit (545 baseline). Cloud: repo's existing test/lint story + `npx next build` green.
- Commits end with "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>".

---

## OSS Slice A — signing core (Tasks A1–A4)

**A1 — `src/signing.ts`** (+ `test/signing.test.ts`): `generateSigningKeypair(dir): {keyId, privatePath, publicPem}` (node:crypto `generateKeyPairSync("ed25519")`, PEM to `<dir>/<keyId>.pem` private + `<keyId>.pub.pem`; keyId = first 16 hex of sha256(public DER)); `loadSigningKey(dir): {keyId, privateKey} | null` (newest key wins; malformed → null + stderr warn, never throw); `signRecordDigest(privateKey, digest: string): string` (base64); `verifyRecordSignature(publicPem, digest, sigB64): boolean`. Tests: roundtrip, tamper→false, keyId stability, missing-dir→null.

**A2 — `reelier init --signing`** (cli.ts): after existing init work, when flag present: generate into `~/.reelier/signing/` (`os.homedir()`), print keyId + public PEM + "register it: https://reelier.com/settings/keys". Idempotent: existing key → print existing, don't regenerate (mirror `reelier approve` unchanged-semantics). Test with HOME/USERPROFILE redirected to a temp dir (`withEnv` pattern from test/push-cli.test.ts:70–85).

**A3 — push signs** (push.ts `pushOneRecord`, payload assembly ~:368): when `loadSigningKey` finds a key: `signature = {alg:"ed25519", keyId, sig: signRecordDigest(key, digestSha256(record))}`. No key → field omitted, zero output. Digest input = the EXACT record object being pushed (post-redaction — sign what ships, not what ran; assert this in a test: redacted record's signature verifies against the pushed bytes, not the pre-redaction record).

**A4 — `reelier verify <permalink|file> [--key <pub.pem>]`** (cli.ts + reuse get.ts's REELIER_CLOUD_URL fetch): fetch `/r/<token>/json` (or read local file) → recompute `digestSha256(record)` → per-claim output lines: `unaltered-since-push: ✓ (key <id>)` / `✗ SIGNATURE INVALID` / `— unsigned`; `timestamp: imprint ✓ + openssl ts -verify command printed` / `— none`. Exit 0 only when nothing present FAILED (absent claims don't fail verify). Tests: fetch-monkeypatched matrix (valid/tampered/unsigned/no-key-provided).

## OSS Slice B — TSA + refs + CI attestation + docs (Tasks B1–B4)

**B1 — `src/tsa.ts`** (+ fixtures): `buildTimeStampReq(digestHex): Buffer` — minimal DER writer for TimeStampReq v1 {hashAlgorithm: sha256 OID 2.16.840.1.101.3.4.2.1, hashedMessage, certReq: true} (~100 lines, scoped exactly like policy.ts's YAML subset — if TSA ever needs more, that's the signal for a real ASN.1 lib, not growth here); `requestTimestamp(tsaUrl, digestHex, fetchImpl): Promise<{tsa, token} | null>` — POST application/timestamp-query, ANY failure → null + one stderr line (fail-open, spec §2); `imprintMatches(tokenB64, digestHex): boolean` — parse just far enough to find the messageImprint octets (search for the sha256 OID + following OCTET STRING; document the shortcut honestly). Push: `--timestamp` flag (and `REELIER_TSA_URL` override; bundled default in one const). Tests: DER golden-bytes fixture, imprint match/mismatch, TSA-down → push still succeeds with no timestamp field.

**B2 — request-id refs**: tools.ts http.get/post — after `headersToRecord` (:70/:89), filter allowlist `["request-id","x-request-id","x-amzn-requestid","x-amz-request-id","x-goog-request-id","stripe-request-id","cf-ray"]` → attach to the runner via Observation (add `Observation.refs?` populated by the tool, threaded to `StepRecord.refs` in executeStep on ANY executed step incl. reads). mcp-tool.ts `mcpResultToObservation`: single-JSON-body case only, top-level keys `["request_id","requestId","x_request_id"]` (exact match — `requestIdentifier` must NOT match). Redaction-wins: refs pass through redact.ts like everything else; a masked ref renders masked. Tests: capture matrix, near-miss keys, redaction-wins, refs absent → field omitted.

**B3 — CI attestation** (push.ts): `detectCiOidc(fetchImpl): Promise<{provider,token} | null>` — when `ACTIONS_ID_TOKEN_REQUEST_URL` + `ACTIONS_ID_TOKEN_REQUEST_TOKEN` present: GET `${url}&audience=reelier.com` with `Authorization: Bearer ${reqToken}` → `{provider:"github-actions", token: value}`; any failure → null + one stderr line, never blocks push. Attach as `ciAttestation`. Tests: env+fetch monkeypatch (present/absent/fetch-fails).

**B4 — docs + Action + CHANGELOG**: README trust-ladder section (per-claim table, exact §1 page wording); the GH Action's documented snippet gains `permissions: id-token: write`; CHANGELOG 0.20.0. Word-split check: "tamper-evident" appears ONLY next to the unaltered-since-push claim. Version bump rides the merge, NOT a task.

## Cloud Slice C — verify at ingest + render the ladder (Tasks C1–C5)

**C1 — schema** (drizzle migration, additive only): new table `tenant_signing_keys {id, tenantId→tenants, keyId (unique per tenant), publicKeyPem, label?, createdAt, revokedAt?}`; `run_records` gains nullable: `signatureKeyId`, `signatureVerified boolean`, `tsaUrl`, `tsaImprintOk boolean`, `ciProvider`, `ciRepo`, `ciSha`, `ciWorkflow`, `ciRunId`, `ciVerified boolean`; `tenants` gains `verifiedDomain?`, `domainVerifiedAt?`. Raw payload trust fields also kept verbatim inside a `trust` JSONB column (audit trail).

**C2 — ingest verification** (api/v1/runs/route.ts validation path :46–55): parse optional trust fields; **signature**: look up tenant's non-revoked key by keyId → verify ed25519 over the EXACT digest string the CLI signs: `digestSha256(record)` — i.e. `"sha256:" + hex(sha256(canonicalJson(record)))`, canonicalization ported byte-for-byte from OSS `src/canonical-json.ts` (cross-seam test is the guard; note digestSha256 canonicalizes internally — do NOT double-canonicalize) → set columns; unknown keyId or bad sig → `signatureVerified: false`, ingest still 202. **ciAttestation**: `jose` createRemoteJWKSet(`https://token.actions.githubusercontent.com/.well-known/jwks`), verify issuer/audience("reelier.com")/exp → extract `repository`, `sha`, `workflow_ref`, `run_id` → columns; token discarded after verification (store claims only). **timestamp**: store tsa url + `imprintMatches` result (same shortcut parser, ported). Absent fields → all columns null. Tests: fixture JWTs (valid/wrong-aud/expired/tampered), sig matrix, and the **mandatory cross-seam test**: a record signed by the actual OSS CLI code verifies here (share a fixture generated by `reelier push` against a capture server).

**C3 — key registry + domain verification** (dashboard): `/settings/keys` — paste public PEM → server derives keyId (must match sha256 derivation), list/revoke; `/settings/org` — claim domain, generate TXT challenge `reelier-verify=<random>`, "check now" does DNS TXT lookup (node:dns), sets verifiedDomain. Revocation is forward-looking; the page says so (spec §1 copy).

**C4 — receipt page claims ladder** (r/[token]/page.tsx + PublicReceipt): add the 7 rows (spec "The receipt page" section) — green/amber/grey per stored columns + 0.19.0 record fields (manifestIgnored → "tools verified" state; write blocks → "writes approved" state; refs → "cross-checkable refs" count); each grey row gets its one-line upgrade hint; exact §1/§5 claim wording (incl. the does-NOT-prove sentence). `/r/<token>/json` gains the trust columns additively (keep `version: 1` — additive fields don't break consumers; bump only if shape of existing fields changes).

**C5 — corroboration** (ingest + page): fingerprint = sha256(canonicalJson(ordered [toolName, argShape] per step)) where argShape = keys-only skeleton (never values — port the idea from flight-recorder v1 §3); store on run_records; receipt renders "N distinct tenants produced matching receipts" (distinct tenantId count over same fingerprint + passed=true, excluding self); tenant fact-block (verified domain badge, account age, distinct skills pushed). No numeric score anywhere.

**Deploy reality:** no auto-deploy — after merge, `npx vercel --prod` (CLI authed as fixlyai). Cloud merges to main via `merge origin/main` + `push HEAD:main` (main is locked in the reelier-cloud-mainwt worktree).

## Order + gates

A and C build in PARALLEL (different repos; the wire contract pins the seam). B follows A (same OSS files). Adversarial review (opus): Slice A (signing = trust boundary) and C2 (verification = trust boundary) get it mandatorily; B and the rest of C get standard review. Then: cross-seam integration test → verify-runner both repos → GATE 2 (Max: merge both, `npm publish 0.20.0`, `npx vercel --prod`).
