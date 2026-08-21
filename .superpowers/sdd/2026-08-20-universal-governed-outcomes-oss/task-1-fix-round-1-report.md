Files changed

- `src/authority/tool-effect-contract.ts`
- `src/authority/index.ts`
- `test/authority/effect-contract.test.ts`

Commits

- `ad797fb5 test(authority): reject inert hostile contract graphs`
- `e5b7aefd fix(authority): snapshot effect contracts inertly`
- `3402e471 fix(authority): parse governed lifecycle records`

What changed

- Added descriptor-based bounded inert snapshots for ToolEffect parsing, which rejects nested accessors without invoking them.
- Made the outcome verifier parse raw input and added closed reservation, attempt, and observation parsers/digests.
- Enforced provider-crossing dispatch for verified outcomes and prevented provider-crossing resend after ambiguity.

Test results (verbatim tail)

```text
npm run build
npx tsc -p tsconfig.test.json
node --test dist-test/test/authority/effect-contract.test.js
tests 4
pass 4
fail 0
```

Open risks

- Review round remains incomplete: provider-pack, mission-claim, governed-receipt parsers/digests, verification-time/maximum-grade enforcement, schema alignment, independent declaration pinning, and report inventory repairs still require work.
