Files changed

- `contract/authority/v1/tool-effect-contract.schema.json`
- `contract/authority/v1/adapter-contract-v1.json`
- `src/authority/adapter-contract.ts`
- `test/authority/effect-contract.test.ts`
- `test/authority/wire.test.ts`
- `test/authority/package.test.ts`
- `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-1-report.md`
- `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-1-fix-round-1-report.md`
- `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-1-fix-round-1b-report.md`

What changed per file

- The ToolEffect schema now closes result semantics, identifier/digest/pointer syntax, bounded unique arrays, model byte limits, nonempty host bindings, and verified/readback dependency.
- Generated adapter ABI artifacts were regenerated from the schema change.
- AJV behavior tests cover arbitrary providers, all schema-representable runtime violations, and the documented cross-array limitation; package tests pin runtime and declaration ABI independently; wire tests pin V1 golden digests.
- The original and round-one reports now have complete inventories and balanced Markdown fences.

Commits

- `aeaa95b7` `test(authority): pin tool effect schema behavior`
- `5efdf542` `fix(authority): align tool effect schema ABI`
- `e8320e03` `test(authority): pin public declaration ABI`
- `2118ac89` `test(authority): pin V1 wire golden compatibility`

Deviations from the plan and why

- No source/runtime modules were changed: unit 1A already completed that ownership.
- Standard JSON Schema cannot express disjoint values across distinct arrays. The schema enforces each individual array and the parser enforces cross-array disjointness.

Test results

```text
> reelier@0.32.1 build
> node scripts/build-authority-contract.mjs --check && node scripts/build-bootstrap-contract.mjs --check && tsc -p tsconfig.json && node scripts/build-authority-contract.mjs --copy-schemas && node scripts/build-packs.mjs

built cloudflare_api_token, cloudflare_dns, github_issue_labels, github_release, gmail, gmail_labels, hubspot_slack_information_flow, neon_database, slack_channel_topic, stripe, vercel_deployment

node --test dist-test/test/authority/effect-contract.test.js dist-test/test/authority/wire.test.js dist-test/test/authority/compile.test.js dist-test/test/authority/contract.test.js dist-test/test/authority/agent-mandate.test.js dist-test/test/authority/package.test.js
ℹ tests 71
ℹ suites 0
ℹ pass 71
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2589.3047

> reelier@0.32.1 check:authority-contract
> node scripts/build-authority-contract.mjs --check

npx tsc -p tsconfig.test.json --pretty false
(exit 0)

git diff --check
(exit 0)
```

Open risks

- Schema-only consumers must not treat cross-array result-label overlap as valid authority; they need the runtime parser.
