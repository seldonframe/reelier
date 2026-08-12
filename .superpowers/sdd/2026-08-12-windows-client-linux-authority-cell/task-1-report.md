Files changed

- `contract/authority/v1/adapter-contract-v1.json`
- `scripts/build-authority-contract.mjs`
- `src/authority/adapter-contract.ts`
- `src/authority/index.ts`
- `test/authority/contract.test.ts`
- `.superpowers/sdd/2026-08-12-windows-client-linux-authority-cell/task-1-report.md`

What changed per file

- `adapter-contract-v1.json`: generated closed v1 adapter manifest with sorted paths, SHA-256 member digests, the golden-vectors digest, domain string, and nonzero aggregate digest.
- `build-authority-contract.mjs`: adds the explicit contract member list, deterministic descriptor generation, closed-membership validation, copied-directory `--check`, and descriptor drift refusal.
- `adapter-contract.ts`: exposes the frozen descriptor/digest and a substrate-neutral verifier that accepts caller-supplied bytes only; it has no runner, credential, filesystem, or provider behavior.
- `index.ts`: exports only the adapter contract descriptor/digest/verifier surface alongside existing authority exports.
- `contract.test.ts`: RED/GREEN coverage verifies canonical membership and digest properties, mutation/omission/duplicate/reorder/traversal/self-inclusion refusal, and copied-directory stale-output refusal.

Deviations from the plan and why

None.

Approved digest

`sha256:f022be345b7a04b5bd67843e4e830047567eb34ba85634118ec179000702f36f`

Test results (verbatim tail)

```text
adapter-contract bytes: F022BE345B7A04B5BD67843E4E830047567EB34BA85634118EC179000702F36F F022BE345B7A04B5BD67843E4E830047567EB34BA85634118EC179000702F36F F022BE345B7A04B5BD67843E4E830047567EB34BA85634118EC179000702F36F

> reelier@0.32.1 check:authority-contract
> node scripts/build-authority-contract.mjs --check

> reelier@0.32.1 build
> tsc -p tsconfig.json && node scripts/build-authority-contract.mjs --copy-schemas && node scripts/build-packs.mjs

built cloudflare_api_token, cloudflare_dns, github_issue_labels, gmail, gmail_labels, hubspot_slack_information_flow, neon_database, slack_channel_topic, stripe, vercel_deployment

✔ adapter contract v1 is a closed, canonical manifest and refuses stale copied output (84.2613ms)
ℹ tests 5
ℹ pass 5
ℹ fail 0
```

Open risks

- None identified within Task 1 scope. The contract membership is explicit and verification never enumerates the filesystem.
