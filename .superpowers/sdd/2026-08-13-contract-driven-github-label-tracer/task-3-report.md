Files changed

- `src/authority/host/json-https-route.ts` (created)
- `src/authority/host/config.ts` (modified)
- `src/authority/drivers/json-https.ts` (modified)
- `test/authority/json-https-route.test.ts` (created)
- `test/authority/config.test.ts` (modified)
- `.superpowers/sdd/2026-08-13-contract-driven-github-label-tracer/task-3-report.md` (created)

What changed per file

- `json-https-route.ts`: adds an inert, closed route parser; canonicalization and digesting; and a duplicate-free route registry lookup. The GitHub label writer explicitly reads back through `github.issue.labels.readback`, which is independently registered as a GET labels route.
- `config.ts` and `json-https.ts`: explicitly label existing `endpoints` / `JsonHttpsEndpoint` as legacy runtime configuration, non-certifiable, and distinct from canonical route authority.
- `json-https-route.test.ts`: locks the closed parsing boundary, canonical sorting, semantic digest coverage, registry lookup, independent readback, accessors, prototypes, malformed origins/paths, and duplicate normalized entries.
- `config.test.ts`: confirms legacy endpoint configuration does not silently gain a native route-authority surface.

Commits

- RED: `4acba1687567a79e738d1edde9acfff1b333dedd` — `test(authority): specify canonical HTTPS routes`
- GREEN: `1cf3f09c09cd494299116497bf3d19bdbc9b5663` — `feat(authority): canonicalize native HTTPS routes`

Deviations from the plan

- The required command's `&&` could not run in the installed Windows PowerShell version. I used `; if ($LASTEXITCODE -eq 0) { ... }`, which preserves its conditional behavior. The RED compile failed for the expected missing module.
- The founder ruling superseded the contradictory brief sample: the write route uses `readEndpointId: "github.issue.labels.readback"`; `github.issue.get` is verified not to be silently redefined.

Test results

RED command/output:

```text
npx tsc -p tsconfig.test.json
test/authority/json-https-route.test.ts(10,8): error TS2307: Cannot find module '../../src/authority/host/json-https-route.js' or its corresponding type declarations.
```

GREEN command/output tail:

```text
✔ canonical HTTPS routes freeze the GitHub labels write and independent read routes (2.9658ms)
✔ canonical HTTPS route parsing is closed and inert (0.8449ms)
✔ canonicalization sorts methods and path prefixes while rejecting duplicate normalized entries (0.6635ms)
ℹ tests 11
ℹ suites 0
ℹ pass 11
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 758.8968
```

Self-review

- `git diff --check` passed.
- The parser reads own property descriptors before values, so malicious getters are not invoked.
- Canonical route identity includes every authority field; the test changes each field independently and observes a different digest.
- No legacy endpoint is converted, inferred, or admitted into the canonical registry.

Evidence maturity

- Deterministic, local unit coverage only. No provider network calls or credentials were used.

Open risks / concerns

- The new module is intentionally not added to the public `authority/host` barrel because that file is outside the approved Task 3 file list. A subsequent scoped integration task must expose it if public-package consumers require it.
