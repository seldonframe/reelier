Files changed

- `src/authority/tool-effect-contract.ts`
- `src/authority/agent-mandate.ts`
- `src/authority/index.ts`
- `contract/authority/v1/tool-effect-contract.schema.json`
- `contract/authority/v1/golden-vectors.json`
- `contract/authority/v1/adapter-contract-v1.json`
- `src/authority/adapter-contract.ts`
- `scripts/build-authority-contract.mjs`
- `test/authority/effect-contract.test.ts`
- `test/authority/wire.test.ts`
- `test/authority/package.test.ts`
- `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-1-report.md`
- `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-1-fix-round-1-report.md`
- `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-1-fix-round-1a-report.md`
- `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-1-fix-round-1b-report.md`

What changed per file

- Unit 1A closes inert V2 mission snapshots and governed outcome/context verification.
- Unit 1B aligns the ToolEffect JSON Schema with runtime-representable bounds and closures, regenerates the public adapter ABI, pins declaration exports independently, and pins legacy V1 vector digests.
- The report files correct their prior incomplete inventory and unbalanced Markdown fence.

Commits

- 1A: `fd7de798`, `002761d1`, `345c97d4`, `726b3f2f`, `e9dc7c8c`.
- 1B: `aeaa95b7`, `5efdf542`, `e8320e03`, `2118ac89` before report publication.

Deviations from the plan and why

- None. Cross-array result-label disjointness remains a runtime-only rule because it is not expressible in the published JSON Schema dialect.

Test results

```text
See task-1-fix-round-1b-report.md for the final verbatim gate output.
```

Open risks

- JSON Schema validators alone cannot enforce disjoint result labels across the four result arrays.
