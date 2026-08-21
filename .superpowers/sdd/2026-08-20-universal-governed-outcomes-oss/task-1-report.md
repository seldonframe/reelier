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
- `4c7061e0 feat(authority): add governed effect contracts`
- `42e88337 docs(sdd): report governed effect contract task`
- `f027a1ec test(authority): specify neutral mandate v2` (RED test)
- `7df9d748 feat(authority): add neutral mandate v2`
- `cbdd17f3 test(authority): define readback projection grammar` (RED test)
- `fcb4645c fix(authority): validate readback projections`

What changed

- Added a provider-neutral, closed `ToolEffectContractV1` parser/digest plus governed outcome lifecycle parser and chronology verifier.
- Added the contract as an additive authority wire kind and public authority export; existing `TransportEffect` remains unchanged.
- Added neutral contract/pack and compile type seams, plus a functional additive V2 mandate parser/digest and exact provider/account/destination subset mission derivation without changing V1 parsing or digests.
- Added its published JSON schema, golden vector, and regenerated adapter contract artifacts.
- Defined readback projection paths as closed RFC 6901-style JSON pointers and updated the package runtime/declaration export allowlists.

Deviations

- The existing requested broad test command cannot compile this worktree before the task because package self-references resolve only after the full build; the RED test correctly also failed for the missing module before implementation.
- V2 uses the orchestrator-specified closed bindings shape; no provider or harness enums were introduced.

Test results (verbatim tail)

```text
node --import tsx --test test/authority/effect-contract.test.ts
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'tsx' imported from C:\\Users\\maxim\\CascadeProjects\\.worktrees\\reelier-universal-governed-outcomes\\
```

```text
npx tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop src/authority/tool-effect-contract.ts test/authority/effect-contract.test.ts src/authority/types.ts src/authority/wire.ts src/authority/pack.ts src/authority/compile.ts src/authority/agent-mandate.ts src/authority/index.ts
(exit 0)

npx tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop src/authority/agent-mandate.ts test/authority/agent-mandate.test.ts src/authority/index.ts
(exit 0)

node scripts/build-authority-contract.mjs --check
(exit 0)

```text
npm run build
(exit 0)

npx tsc -p tsconfig.test.json
(exit 0)

node --test dist-test/test/authority/effect-contract.test.js dist-test/test/authority/wire.test.js dist-test/test/authority/compile.test.js dist-test/test/authority/contract.test.js dist-test/test/authority/agent-mandate.test.js dist-test/test/authority/package.test.js
tests 66
pass 66
fail 0
```
```

Open risks

- `node --import tsx --test` remains unavailable because `tsx` is not installed; the repository's compiled test path above is the verified local prerequisite-compatible path.
