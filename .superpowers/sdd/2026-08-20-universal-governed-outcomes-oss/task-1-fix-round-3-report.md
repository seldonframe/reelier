Files changed

- `src/authority/tool-effect-contract.ts`
- `test/authority/effect-contract.test.ts`
- `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-1-fix-round-3-report.md`

What changed per file

- `src/authority/tool-effect-contract.ts`: removes all bulk own-descriptor/key/symbol enumeration. Wire data is now only own enumerable string data properties. Closed records inspect expected descriptors directly and reject expected missing, hidden, or accessor fields without invocation; bounded enumerable iteration rejects unknown fields and stops at key 65. Arrays precheck length, inspect each bounded index descriptor directly, and reject the first named enumerable key. Hidden and symbol extras are never enumerated or executed and therefore cannot enter detached output or digests. The trusted verification context follows the same direct-descriptor and bounded-enumerable rules.
- `test/authority/effect-contract.test.ts`: adds actual one-million-property object and one-element-array regressions proving no bulk descriptor materialization, plus hidden/symbol getter tests proving extras never execute or affect parsed values/digests. Expected hidden/accessor fields remain fail-closed. The same out-of-band behavior is verified on the trusted observation context.
- `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-1-fix-round-3-report.md`: records the exact scope, commits, verification, and remaining considerations.

Commits

- `76b909d3 test(authority): define enumerable-only wire data`
- `6b10b779 fix(authority): parse enumerable wire data incrementally`

Deviations from the plan and why

- None. No index, package, schema, generated artifact, or V1 ABI change was necessary.

Test results (verbatim tail)

```text
✔ every frozen wire kind has a valid, deterministic golden vector (11.3842ms)
✔ additive governed-effect vectors do not rewrite pinned V1 wire digests (0.3534ms)
ℹ tests 75
ℹ suites 0
ℹ pass 75
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2637.0079

> reelier@0.32.1 check:authority-contract
> node scripts/build-authority-contract.mjs --check
```

Commands completed with exit code 0:

```text
npm run build
npx tsc -p tsconfig.test.json --pretty false
node --test dist-test/test/authority/effect-contract.test.js dist-test/test/authority/wire.test.js dist-test/test/authority/compile.test.js dist-test/test/authority/contract.test.js dist-test/test/authority/agent-mandate.test.js dist-test/test/authority/package.test.js
npm run check:authority-contract
git diff --check
```

Open risks

- Hidden and symbol properties are intentionally outside the wire language. Consumers inspecting raw caller objects may still see them, but the parser ignores them without execution and they cannot affect the detached parsed value or its digest.
- The million-property regression adds roughly 1.5 seconds to the focused compiled test on this Windows worktree; it is intentionally retained as the direct bounded-enumeration witness required by the ruling.
