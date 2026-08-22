# Operator + Authority Cell implementation report

This implementation adds the first local Operator vertical without creating a second authority
protocol: a closed Codex / Claude Code / Grok Build registry, atomic non-secret workspace state,
one-command onboarding, bounded harness process adapters, a local supervisor, and provider-neutral
managed/customer-hosted handoff and usage contracts. The Operator cannot mint authority, select
provider accounts, access credentials, or claim a verified Outcome. Local completeness remains
`unchecked` until the existing Cell returns an authoritative receipt.

Verification on the reviewed OSS authority base:

- Operator-focused tests: 18/18 pass.
- Existing init/signing/CLI-entrypoint tests: pass.
- Production TypeScript build: pass.
- `git diff --check`: pass.

The process adapter emits only event digests; it does not persist prompt text, model output,
provider bodies, credentials, or environment values. The supervisor keeps harness lifecycle and
Cell lifecycle separate: a clean harness exit is not a successful Outcome, and a refused Cell
result remains refused. The local Cell module is an adapter over an already-created genuine Cell
runtime; it does not introduce a parallel ledger, generic executor, or receipt store.

The managed handoff is intentionally not Cloud OAuth or billing. It is a one-shot signed contract
containing only opaque provider-account and authority/contract references. Vercel Connect, AWS,
Vault, Cloudflare, and enterprise IAM remain replaceable credential backends owned by the managed
or customer-hosted executor. Initial plan constants are provider-neutral: free local, $49 managed
Personal (10 concurrent executions), $299 managed Team (50), and Enterprise customer-hosted.
Receipts are never metered.

The full repository suite is a long authority-ledger stress corpus; it has not been rerun to a
completed aggregate on this final expanded tree. No provider, browser, cloud, billing, or credential
action occurred. Managed Cloud Task 0–5 remains an external prerequisite and is not claimed complete
by this OSS slice.
