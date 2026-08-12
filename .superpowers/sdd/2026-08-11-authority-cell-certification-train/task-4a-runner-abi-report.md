# Task 4A — certified runner ABI and registry

## Outcome

Task 4A freezes a closed, inert certification runner metadata ABI without adding provider execution. V2 endpoint manifests derive aliases and endpoint identities from installed static-pack constants. V2 runner manifests bind the fixed private registry and its content-derived metadata digest; they do not claim an implementation digest. Every registry entry, manifest, preflight, readiness candidate, and signed readiness remains `executionReady:false` and `dispatchable:false` until a later task supplies a real implementation artifact and executed hermetic-test evidence.

Scenario plans derive exact source, resource, account, desired-state, cleanup, controlled-cut, policy-schema, and runner/test/endpoint/registry commitments from parsed operator configuration and reviewed pack constants. Task 3C remains structurally inert: the Cell exposes no runner, provider, credential resolver, dispatch adapter, or caller-supplied executable behavior. Task 4A metadata cannot issue an opaque permit; verification refuses before task status, budget, credential, or provider access. V1 runner and endpoint manifests remain parseable but cannot satisfy preparation or dispatch readiness.

The provider registry covers exactly GitHub labels, Cloudflare DNS, Slack topic, Cloudflare-to-Vercel secret, Vercel promotion, and Neon migration. HubSpot is absent. The compound secret entry is non-dispatchable because real implementation and executed-test evidence are absent.

## Commits

- `a5837b2` RED — specify V2 runner ABI, endpoint derivation, compound binding, config migration, plans, and private exports.
- `ee3ccf9` GREEN — implement initial schemas/parsers, config v3, registry, scaffold/preflight/readiness binding, and lifecycle.
- `b3d4eb0` / `836d206` — reject accessor-backed input and close export/examples/runbook compatibility.
- `d480a6f` / `c8d75cf` — require closed readiness inputs with zero provider, credential, dispatch, or budget access.
- `6080dbd` — make scenario-plan schema patterns portable.
- `178369b` — keep metadata-only runners, readiness, and Cell verification non-dispatchable; require exactly one endpoint/runner/test/plan artifact.
- `d3f56d0` — bind typed plans to provider-specific v3 desired state and descriptor-only inert operator authority.
- `9093ad7` — close Task 4A manifest/plan schemas and exact reviewed policy-schema commitments.
- `2d6eb95` — add portable-schema/runtime parity coverage.
- `ca1184b` — close exact v3 resource/metadata shapes, sorted scenario selections, selection conditionals, and safe path/reference patterns.

## Files

Contracts:

- `contract/authority/v1/certification-endpoint-manifest-v2.schema.json`
- `contract/authority/v1/certification-runner-manifest-v2.schema.json`
- `contract/authority/v1/certification-scenario-plan.schema.json`
- `contract/authority/v1/certification-operator-config-v3.schema.json`

Implementation:

- `src/authority/certification/{cell,commitment,config,export,inert,initializer,manifests,preflight,readiness,runner-registry,scenario-bindings,scenarios}.ts`
- `src/authority/host/certification-config.ts`

Tests and operator material include the focused certification suite, `authority/certification.example.json`, `docs/runbooks/live-certification.md`, and this report.

## Verification

At implementation head `ca1184b`:

```text
npx tsc -p tsconfig.test.json                                      PASS
focused authority/certification tests                              88 passed, 0 failed, 0 skipped
npm run check:authority-contract                                   PASS
```

The focused set covers certification authority, Cell, config, export, filesystem, initializer, preflight, readiness, runner ABI, scenarios, and runner behavior. Per instruction, the full `npm test` suite was not run.

Security assertions include exact reviewed endpoint constants; compound per-provider account/resource authority; typed config-derived plans with no arbitrary choices/source/recipe authority; zero-invocation accessor rejection; exact-one artifact counting; non-dispatchable metadata refusal before budget access; and an Ajv/runtime parity corpus covering positive inputs plus dispatchability, arbitrary-plan, credential-shaped nested value, missing selected field, unselected extra field, unsorted selection, unsafe path, and unsafe environment-reference negatives.

## Deviations and risks

- No provider runner implementation or live test evidence was added. Metadata digests commit metadata only.
- Fly topology and ten-principal Codex remain separate scenarios without fake provider endpoint manifests.
- V2 migration deterministically duplicates an old Cloudflare reference when both purpose-separated v3 slots are selected; the operator must replace it before live certification.
- Universal completeness remains `unchecked`; no live/provider action, credential resolution, dispatch, budget consumption, push, merge, publish, or deployment occurred.

## Cross-task scope deviations

Task 4A necessarily changed a small Task 2/3 ABI surface before freeze:

- `config.ts`, `commitment.ts`, `initializer.ts`, `export.ts`, and the v3 config schema now carry provider-specific non-secret `desiredState`. A typed runner plan cannot be authoritative unless its desired effect is committed by operator configuration; retaining arbitrary plan `choices` would make Task 4A mutable authority.
- `preflight.ts`, `readiness.ts`, `authority.ts`, `cell.ts`, and their tests now bind endpoint commitments plus explicit `executionReady:false`/`dispatchable:false`. Task 4A introduced runner/endpoint/plan artifacts, so earlier readiness records had to bind those artifacts and exact-one cardinality.
- `cell.ts` was tightened only to prevent the pre-existing Task 3C permit surface from turning metadata into provider authority. It performs no Task 5 behavior: no credential resolution, provider call, dispatch, reconciliation, cleanup, receipt, or budget reservation was added.
- Export/parser changes mirror those commitments for offline recomputation; they add neither authorization nor execution.

These deviations bind and preserve non-dispatchability. They do not implement a provider runner or expand Task 4A into Task 5.

## Review

The first independent review returned FIX FIRST. Commits `178369b` through `ca1184b` address every listed blocker. The same reviewer must re-review exact range `25be3a5..HEAD` before final handoff.
