Files changed

- `src/authority/tool-effect-contract.ts`
- `src/authority/types.ts`
- `src/authority/wire.ts`
- `src/authority/pack.ts`
- `src/authority/compile.ts`
- `src/authority/agent-mandate.ts`
- `src/authority/index.ts`
- `contract/authority/v1/tool-effect-contract.schema.json`
- `contract/authority/v1/golden-vectors.json`
- `contract/authority/v1/adapter-contract-v1.json`
- `src/authority/adapter-contract.ts`
- `scripts/build-authority-contract.mjs`
- `test/authority/effect-contract.test.ts`
- `test/authority/wire.test.ts`
- `test/authority/compile.test.ts`
- `test/authority/contract.test.ts`
- `test/authority/agent-mandate.test.ts`
- `test/authority/package.test.ts`
- `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-1-report.md`
- `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-1-fix-round-1-report.md`
- `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-1-fix-round-1a-report.md`
- `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-1-fix-round-1b-report.md`

What changed per file

- The authority source files add the closed provider-neutral governed-effect contracts, V2 mandate union, inert parsers/digests, and outcome transition verification without changing V1 wire semantics.
- The schema, generated vectors, adapter descriptor, source descriptor, and generator publish the closed contract language.
- The authority tests cover hostile inputs, lifecycle verification, schema behavior, V1 golden compatibility, and runtime/declaration export ABI pins.
- The SDD reports record the original work and both sequential review-fix units.

Commits

- `dd560c7d` through `fcb4645c`: original Task 1 RED/GREEN units.
- `ad797fb5` through `32733003`: first review-fix implementation units.
- `fd7de798` through `e9dc7c8c`: review-fix unit 1A.
- `aeaa95b7`, `5efdf542`, `e8320e03`, and `2118ac89`: review-fix unit 1B before report publication.

Deviations from the plan and why

- None. JSON Schema cannot express result labels being disjoint across separate arrays; AJV behavior tests document that structural limit and prove the runtime closes it.

Test results

```text
See task-1-fix-round-1b-report.md for the final verbatim gate output.
```

Open risks

- The standard JSON Schema artifact cannot represent cross-array result disjointness, so consumers must use the closed runtime parser for that invariant.
