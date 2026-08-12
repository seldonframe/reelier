# Task 4A — certified runner ABI and registry

## Outcome

Task 4A freezes a closed, inert certification runner ABI without adding provider execution. V2 endpoint manifests derive aliases and endpoint identities from the installed static-pack constants. V2 runner manifests bind the fixed private registry and its content-derived implementation digest. Scenario plans bind selected non-secret operator intent, typed cleanup/before-state, the controlled-cut case, and runner/test/endpoint/registry digests.

Task 3C remains structurally inert: the Cell exposes no runner, provider, credential resolver, dispatch adapter, or caller-supplied executable behavior. Its opaque permit still only revalidates and consumes no effect. V1 runner and endpoint manifests remain parseable but cannot satisfy preparation or dispatch readiness.

The provider registry covers exactly GitHub labels, Cloudflare DNS, Slack topic, Cloudflare-to-Vercel secret, Vercel promotion, and Neon migration. HubSpot is absent. The compound secret entry is explicitly unavailable and non-dispatchable because token-create and Vercel environment-secret helpers are not registered static packs; Task 4A did not add pack definitions.

## Commits

- `a5837b2` RED — specify V2 runner ABI, endpoint derivation, compound binding, config migration, plans, and private exports.
- `ee3ccf9` GREEN — implement closed schemas/parsers, config v3, registry, scaffold/preflight/readiness binding, and exact lifecycle.
- `b3d4eb0` RED — reject accessor-backed executable input without invocation.
- `836d206` GREEN — close accessor handling, offline export links, examples, runbook, and compatibility fixtures.
- `d480a6f` RED — require closed readiness inputs and zero provider/credential/dispatch/budget access.
- `c8d75cf` GREEN — close preflight/readiness requests, add forged-binding and zero-call coverage, and add config v3 schema.
- `6080dbd` — make the scenario-plan schema pattern portable.

## Files

Contracts:

- `contract/authority/v1/certification-endpoint-manifest-v2.schema.json`
- `contract/authority/v1/certification-runner-manifest-v2.schema.json`
- `contract/authority/v1/certification-scenario-plan.schema.json`
- `contract/authority/v1/certification-operator-config-v3.schema.json`

Implementation:

- `src/authority/certification/{cell,commitment,config,export,initializer,manifests,preflight,readiness,runner-registry,scenarios}.ts`
- `src/authority/host/certification-config.ts`

Tests:

- `test/authority/certification-runner-abi-v2.test.ts`
- `test/authority/certification-{authority,cell,config,initializer,preflight,scenarios}.test.ts`
- `test/authority/certification-input-fixture.ts`

Operator material:

- `authority/certification.example.json`
- `docs/runbooks/live-certification.md`
- this migration note and report

## Verification

At implementation head `6080dbd`:

```text
npm run build                                                        PASS
npx tsc -p tsconfig.test.json --pretty false                         PASS
focused authority/certification tests                               100 passed, 0 failed, 0 skipped
npm run check:authority-contract                                     PASS
```

The focused set covered certification authority, Cell, config, export, filesystem, initializer, preflight, readiness, runner ABI, scenarios, CLI, delegation service, and principal registry. Per instruction, the full `npm test` suite was not run.

Security assertions include:

- exact corrected GitHub, Cloudflare DNS, Slack, and Neon constants;
- compound per-endpoint provider, credential, account/resource commitment, method, and direction;
- deterministic secret-blind v2-to-v3 Cloudflare migration;
- selected-only closed plans rejecting secret-shaped, authorization, callback, function, module/path/source/code/command, unknown, and accessor input;
- forged runner implementation, test, endpoint, plan, and registry bindings refuse preparation/readiness;
- signed plan drift invalidates an issued inert permit and consumes zero budget;
- V1 parses but is non-dispatchable;
- private registry is metadata-only and absent from public package surfaces;
- injected provider/fetch, credential resolver, dispatch adapter, and budget ledger spies remain exactly zero.

## Deviations and risks

- No token-create or Vercel-secret pack definition was added. Their compound registry entry is deliberately `dispatchable:false` with an explicit unavailable reason.
- Fly topology and ten-principal Codex remain selected certification scenarios but are not provider runner registry entries; they retain their separate Task 5/6 preparation paths and do not receive fake endpoint manifests.
- Registry implementation digests commit the complete closed built-in runner metadata in this ABI slice. Actual provider runner implementations and live test evidence remain later Task 4 slices.
- The v2 migration can only duplicate the old opaque Cloudflare reference; it cannot infer which distinct credential the operator intended. The v3 output is deterministic, but live setup must replace duplicated references with purpose-separated credentials.
- Universal completeness remains `unchecked`; no live/provider action, credential resolution, dispatch, budget consumption, push, merge, publish, or deployment occurred.

## Review

Fresh independent review is pending because the collaboration thread limit was reached after the required review was requested. This report must be updated with the reviewer verdict and any fix commits before Task 4A handoff is final.
