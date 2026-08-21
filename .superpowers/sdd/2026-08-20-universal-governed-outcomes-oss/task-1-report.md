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
- `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-1-report.md`

Commits

- `dd560c7d test(authority): specify governed effect contracts` (RED test)
- pending: governed-effect implementation and generated adapter contract

What changed

- Added a provider-neutral, closed `ToolEffectContractV1` parser/digest plus governed outcome lifecycle parser and chronology verifier.
- Added the contract as an additive authority wire kind and public authority export; existing `TransportEffect` remains unchanged.
- Added neutral contract/pack and compile type seams, plus an additive V2 mandate union without changing V1 parsing or digests.
- Added its published JSON schema, golden vector, and regenerated adapter contract artifacts.

Deviations

- The existing requested broad test command cannot compile this worktree before the task because package self-references resolve only after the full build; the RED test correctly also failed for the missing module before implementation.
- The neutral mandate union is introduced as a type-only additive seam. A full V2 document parser/subset derivation was not added because the brief supplies no V2 wire field values or derivation API.

Test results (verbatim tail)

```text
node --import tsx --test test/authority/effect-contract.test.ts
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'tsx' imported from C:\\Users\\maxim\\CascadeProjects\\.worktrees\\reelier-universal-governed-outcomes\\
```

```text
npx tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop src/authority/tool-effect-contract.ts test/authority/effect-contract.test.ts src/authority/types.ts src/authority/wire.ts src/authority/pack.ts src/authority/compile.ts src/authority/agent-mandate.ts src/authority/index.ts
(exit 0)

node scripts/build-authority-contract.mjs --check
(exit 0)
```

Open risks

- The task’s complete required test suite could not be run in this worktree because `tsx` is not installed and baseline self-reference failures prevent `tsconfig.test.json` from compiling.
- V2 mandate behavior beyond its neutral union/type contract needs the exact V2 wire format before implementation.
