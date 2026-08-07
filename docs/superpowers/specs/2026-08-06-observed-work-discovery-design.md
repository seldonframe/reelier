# Observed Work Discovery — Design

## Goal

Turn supported local agent history into privacy-preserving, reviewable Arena opportunities without treating a Reelier skill as an autonomous agent or claiming unsupported workflows were auditioned.

## Architecture

The OSS CLI owns parsing, clustering, ranking, redaction, preview, consent, signing, and upload. It reuses the existing session adapters and effect classifier, so `scan`, `from-session`, `discover`, and `init` cannot disagree about what a session contains. A discovery bundle contains only a versioned workflow shape and aggregate metadata; no raw prompts, arguments, responses, credentials, or absolute paths leave the machine.

Cloud owns tenant-scoped intake, signature and nonce validation, private import review, deterministic intent correction, recipe generation, and export. A confirmed fingerprint is mapped to the existing Slack → Notion → Linear fixture only when the exact supported workflow shape matches. Every other workflow gets a portable recipe and `not_evaluated` status; it never links to an unrelated battle.

## Flow

1. `reelier discover` scans the three supported history roots and prints ranked opportunities. `reelier init` calls the same engine in Step 0, preserving its existing record/compile/receipt flow.
2. Selection produces an exact preview with “shared” and “never shared” sections. Upload requires explicit confirmation, unless the purpose-specific `--yes` flag is supplied.
3. The CLI uses the existing API-key config and the existing local Ed25519 signing key. Cloud verifies the signed bundle against the public key carried in the signed payload and binds persistence to the authenticated tenant.
4. Cloud returns a private tokenized import URL. The import page shows only sanitized metadata and asks for a one-sentence job confirmation or correction.
5. Confirmation produces an `AgentRecipeV1`, defaulting writes to `approve_before_write`. Exact Slack/Notion/Linear fingerprints link to the existing Arena challenge; unsupported fingerprints show the recipe and local-run instructions with `not_evaluated`.
6. Supported battles reuse the existing blind Arena vote/reveal flow. Export returns the portable pack file map with `instructions.md`, `policy.yml`, `evals/first-task.yml`, adapter-specific setup directories, and `REELIER.md`.

## Privacy and honesty invariants

- Fingerprints contain ordered names, argument key shapes, effect classes, and coarse aggregates only.
- Bundle validation rejects credential-like keys, raw prompt/response fields, absolute home paths, oversized fields, unknown top-level fields, and replayed nonces.
- Tenant ownership is enforced at intake and on every token-scoped mutation/export.
- `verified` is never inferred from a skill or from a successful upload. `not_evaluated`, `unchecked`, and `absent` remain neutral/non-pass states.
- Supported execution is gated by the existing Arena publication/certification path and `REELIER_ARENA_CANONICAL_EXECUTION`; the discovery feature does not bypass that kill switch.

## Testing

OSS tests cover stable/different fingerprints, all supported source adapters, ranking, side-effect labeling, redaction, consent, and init compatibility. Cloud tests cover bundle cryptography and validation, tenant/nonce/size restrictions, import correction, supported versus unsupported routing, blind/revealed payloads, idempotent votes, export ownership, and privacy-safe serialization. Existing Arena and full repository suites remain required before push/deploy.
