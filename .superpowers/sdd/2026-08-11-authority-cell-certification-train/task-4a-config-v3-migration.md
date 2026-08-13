# Task 4A certification config v3 migration

`reelier.certification-operator-config/v3` purpose-separates Cloudflare credentials:

- `cloudflareDnsCredential` is required only by `cloudflare-dns`.
- `cloudflareBootstrapCredential` is required only by `cloudflare-vercel-secret`.

The parser still accepts closed v2 input. Migration reads only the already parsed opaque reference string; it never resolves `env:` or reads `file:` content. For each selected Cloudflare scenario it copies the old `cloudflareCredential` reference into the corresponding v3 slot. If both scenarios are selected, both new slots receive the same reference string so the migration is deterministic and lossless; the operator should then replace them with the two purpose-separated references before live certification.

Migration output is closed v3, selected-scenario-only, canonical, and idempotent. V1 input continues through the existing V1-to-V2 projection and then this V2-to-V3 step. HubSpot and manually supplied generated identities remain excluded.

The tracked example now emits v3. The runbook names `REELIER_CLOUDFLARE_DNS_TOKEN` and `REELIER_CLOUDFLARE_BOOTSTRAP_TOKEN`; it no longer instructs operators to stage the conflated `REELIER_CLOUDFLARE_TOKEN` for the v3 flow.
