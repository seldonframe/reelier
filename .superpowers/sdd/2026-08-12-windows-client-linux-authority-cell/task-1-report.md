Files changed

- `.gitattributes`
- `contract/authority/v1/adapter-contract-v1.json`
- `package.json`
- `scripts/build-authority-contract.mjs`
- `src/authority/adapter-contract-template.ts`
- `src/authority/adapter-contract.ts`
- `src/authority/index.ts`
- `test/authority/contract.test.ts`
- `.superpowers/sdd/2026-08-12-windows-client-linux-authority-cell/task-1-report.md`

What changed per file

- `.gitattributes`: LF-pins all v1 authority contract inputs and generated adapter source.
- `adapter-contract-v1.json`: generated closed v1 descriptor using normalized input bytes, sorted members, per-file SHA-256 values, the golden-vector digest, domain separation, and a nonzero aggregate digest.
- `package.json`: makes normal build and prepublish paths run the non-mutating adapter-contract freshness gate before compiling or packing.
- `build-authority-contract.mjs`: normalizes CRLF/LF before hashing/checking, checks generation of both descriptor and TypeScript export, supports copied source/directory checks, and removes the obsolete inline renderer.
- `adapter-contract-template.ts`: template for the generated public adapter surface; it deep-freezes the descriptor, members, and member values and byte-correctly verifies caller-supplied normalized `Uint8Array` values.
- `adapter-contract.ts`: generated frozen public descriptor/digest and narrow verifier.
- `index.ts`: exports the frozen adapter contract surface without runner, credential, filesystem, or provider behavior.
- `contract.test.ts`: covers cross-EOL stability, source staleness, deep immutability, member-byte mutation and omission, plain-`Uint8Array` verification, package-script staleness refusal, and closed-manifest refusal paths.

Deviations from the plan and why

None.

Approved digest

`sha256:7f46242b26d9c921f4e1ec9de6418ac5fc8c03d70c4415c25e799ae0e73a1512`

Test results (verbatim tail)

```text
✔ adapter contract v1 is a closed, canonical manifest and refuses stale copied output (580.9496ms)
ℹ tests 5
ℹ pass 5
ℹ fail 0

> reelier@0.32.1 check:authority-contract
> node scripts/build-authority-contract.mjs --check

> reelier@0.32.1 build
> node scripts/build-authority-contract.mjs --check && tsc -p tsconfig.json && node scripts/build-authority-contract.mjs --copy-schemas && node scripts/build-packs.mjs

built cloudflare_api_token, cloudflare_dns, github_issue_labels, gmail, gmail_labels, hubspot_slack_information_flow, neon_database, slack_channel_topic, stripe, vercel_deployment
```

Open risks

- None identified within Task 1 scope. The explicit manifest is checked without verification-time filesystem enumeration, and input hashes normalize LF/CRLF.
