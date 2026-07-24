# Task tq1 — test-coverage measurement for reelier OSS CLI

## Files changed
- `tsconfig.test.json` — added `"sourceMap": true` (overrides parent's `false`, test build only)
- `package.json` — added `c8` devDependency, added `"test:coverage": "c8 npm test"` script
- `package-lock.json` — lockfile update from `npm install -D c8@^10`
- `.c8rc.json` (new) — c8 config
- `.gitignore` — added `coverage/`

## What changed per file
- **tsconfig.test.json**: `sourceMap: true` added under compilerOptions, `tsconfig.json` (the published-build config) left untouched. Verified `dist-test/**/*.js.map` are emitted; verified a clean `npm run build` (uses `tsconfig.json`) still produces **zero** `.map` files in `dist/`.
- **package.json**: `c8@^10.1.3` added to devDependencies; new `test:coverage` script wraps the existing `test` script unchanged.
- **.c8rc.json**: reporters `text/lcov/html`, `include: ["src/**/*.ts"]`, `exclude` for test/dist/dist-test/.d.ts/.test.ts, `all: true`, `reportsDirectory: "coverage"`, `skip-full: false`.
- **.gitignore**: `coverage/` added.

## Deviation from plan (and why)
The plan's `.c8rc.json` spec (reporters/include/exclude/all/reportsDirectory/skip-full) alone produced **0% coverage on every file** despite the suite passing and real V8 coverage data existing (confirmed granular non-zero ranges in `coverage/tmp/*.json`). Root-caused: c8's include/exclude filtering runs against the **compiled** file path (`dist-test/src/cli.js`) by default, before source-map remap to `src/cli.ts` — since our `include` glob (`src/**/*.ts`) only matches the remapped TS path, every file was filtered out pre-remap, and `all: true`'s own unexecuted-file enumeration then overwrote/zeroed everything.

Fix: added `"exclude-after-remap": true` to `.c8rc.json` (c8's `-a` flag) so include/exclude apply to the remapped `src/*.ts` paths instead. This is a one-line addition to the specified config, not a deviation from intent — without it, source-map-based TS coverage with `all: true` cannot work under c8 at all in this setup.

## Test results (verbatim tail of `npm run test:coverage`)
```
ℹ tests 695
ℹ suites 0
ℹ pass 695
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 19870.3123
--------------------|---------|----------|---------|---------|--------------------------------------
File                | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
--------------------|---------|----------|---------|---------|--------------------------------------
All files           |    87.9 |    84.87 |   93.22 |    87.9 |
 approval.ts        |     100 |      100 |     100 |     100 |
 assert.ts          |   97.15 |    94.25 |     100 |   97.15 | 135-136,170-171,193,236-237
 canonical-json.ts  |     100 |      100 |     100 |     100 |
 ci-scaffold.ts     |   98.83 |    96.29 |   85.71 |   98.83 | 170-171
 cli.ts             |   66.01 |    68.97 |   77.77 |   66.01 | ...
 cloud-config.ts    |   94.82 |     87.5 |     100 |   94.82 | 25,41-42
 compile.ts         |   99.09 |     91.7 |     100 |   99.09 | 125-129,340-341
 cost.ts            |   94.11 |    90.58 |     100 |   94.11 | ...
 diff.ts            |     100 |      100 |     100 |     100 |
 effect-verbs.ts    |     100 |    97.36 |     100 |     100 | 166
 escalate.ts        |   93.15 |     78.4 |     100 |   93.15 | ...
 from-skill.ts      |     100 |    93.75 |     100 |     100 | 64,69
 get.ts             |   88.55 |    84.55 |     100 |   88.55 | ...
 init.ts            |   95.41 |    86.53 |     100 |   95.41 | ...
 llm.ts             |   36.18 |       75 |   66.66 |   36.18 | ...
 login.ts           |   96.57 |       90 |      75 |   96.57 | 50-52,94-95
 manifest.ts        |   95.18 |    93.33 |     100 |   95.18 | 54-57
 mcp-client.ts      |   71.51 |    88.88 |   66.66 |   71.51 | 43-81,121-128
 mcp-tool.ts        |     100 |    89.65 |     100 |     100 | 30,37,63
 policy.ts          |   96.37 |    90.06 |     100 |   96.37 | ...
 prices.ts          |     100 |      100 |     100 |     100 |
 push.ts            |   94.57 |    86.59 |   94.44 |   94.57 | ...
 recorder.ts        |   97.37 |       90 |     100 |   97.37 | ...
 redact.ts          |     100 |      100 |     100 |     100 |
 runner.ts          |   95.16 |     88.8 |   93.75 |   95.16 | ...
 scan.ts            |   99.08 |    94.59 |     100 |   99.08 | 109-110
 serve.ts           |   95.97 |    72.91 |     100 |   95.97 | ...
 session-formats.ts |   90.64 |    78.16 |     100 |   90.64 | ...
 session.ts         |   98.64 |    88.23 |     100 |   98.64 | 132-134,143-145
 signing.ts         |   95.51 |    90.47 |   85.71 |   95.51 | 114-116,149-150,155-156
 skill.ts           |   93.26 |    86.79 |     100 |   93.26 | ...
 tools.ts           |   95.34 |    76.19 |     100 |   95.34 | 37-38,41-42,112-113
 trace.ts           |   35.29 |      100 |   33.33 |   35.29 | 6-9,23-51
 tsa.ts             |   93.75 |    88.23 |     100 |   93.75 | 22-29,148-152,213-214
 verify.ts          |   96.84 |    89.36 |     100 |   96.84 | 81-83,88-89,93-94,133-134
 wrap.ts            |   98.65 |    86.66 |     100 |   98.65 | 196-197,284-285
 writeback.ts       |   95.41 |    86.36 |     100 |   95.41 | 145-147,207-208,234-239
--------------------|---------|----------|---------|---------|--------------------------------------
```
Report shows **`src/*.ts`** paths (not `dist-test/*.js`) — remap confirmed working.

## Overall coverage
- Statements: **87.90%**
- Branches: **84.87%**
- Functions: **93.22%**
- Lines: **87.90%**

## 5 least-covered src files (by statements %)
1. `trace.ts` — 35.29% (lines 6-9, 23-51 uncovered)
2. `llm.ts` — 36.18% (large uncovered blocks: 122-169, 171-212, 220-254)
3. `cli.ts` — 66.01% (thin cmd layer, as expected)
4. `mcp-client.ts` — 71.51% (lines 43-81, 121-128 uncovered)
5. `get.ts` — 88.55% (scattered gaps: 396-397, 402-404, 467-468, 492-495)

## Self-review
- Report maps to `.ts` paths, not `.js` — confirmed above.
- Existing `test` script and `.github/workflows/ci.yml` untouched (git diff on CI file is empty; test script string unchanged in package.json).
- Published `dist/` build unaffected: `tsconfig.json` not edited, clean `npm run build` produces 0 `.map` files in `dist/`.
- `coverage/` is gitignored; not committed.
- Full suite: 695/695 passing (plan noted 690+; count is 695).

## Open risks / notes
- `exclude-after-remap: true` is required for this include/all combination to work with c8 + TS source maps — undocumented gotcha worth remembering if c8 config is touched again.
- `npm install -D c8` also updated `package-lock.json` (1000+ line diff, purely additive dependency tree) — committed alongside since it's required for `npm ci` reproducibility.
- Coverage numbers reflect current test suite state only; no coverage threshold/gate was added (not requested — measurement only, on-demand via `test:coverage`).
