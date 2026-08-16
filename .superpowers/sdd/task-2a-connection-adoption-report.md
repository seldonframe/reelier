Files changed

- `.superpowers/sdd/task-2a-connection-adoption-report.md`
- `contract/authority/v1/connection-adoption.schema.json`
- `contract/authority/v1/connection-descriptor.schema.json`
- `contract/authority/v1/connection-inventory.schema.json`
- `src/cli.ts`
- `src/connections.ts`
- `src/mcp-client.ts`
- `src/observation/index.ts`
- `test/connections-cli.test.ts`
- `test/connections.test.ts`
- `test/observation-contracts.test.ts`

## What changed per file

- `.superpowers/sdd/task-2a-connection-adoption-report.md`: records Task 2A scope, verification evidence, deviations, and remaining risks.
- `contract/authority/v1/connection-adoption.schema.json`: adds the closed adoption ABI without credential values.
- `contract/authority/v1/connection-descriptor.schema.json`: adds the closed usable-connection descriptor ABI with verified account identity, callable route, tool schema digests, secret ownership, and three independent coverage claims.
- `contract/authority/v1/connection-inventory.schema.json`: adds the closed inventory report/entry ABI, including non-usable states that cannot carry a fabricated descriptor and explicit malformed-entry issues.
- `src/cli.ts`: replaces loose connector JSON filtering with the closed inventory loader; malformed entries are printed as sanitized issues and cause refusal.
- `src/connections.ts`: adds reviewed inspection adapters, stable normalized MCP tool-schema digests, injected connection factories, reviewed read-only account probes, callable inspection, honest non-usable classifications, legacy connector-intent inventory handling, inventory orchestration, and the filesystem inventory loader. It rejects MCP error responses, missing declared endpoints, absent schema pins, and unadvertised server identities; it never starts a real downstream itself or returns provider bodies, route specifications, credential values, or caught error text.
- `src/mcp-client.ts`: distinguishes a server-advertised name from the existing opaque connection-spec fallback so inspection cannot publish a command line or URL as tool identity.
- `src/observation/index.ts`: strengthens `ConnectionDescriptorV1`, adds `ConnectionAdoptionV1`, closed inventory contracts and normalizers, enforces coherent verified/active states, and exposes the connection APIs only through `reelier/observation`.
- `test/connections-cli.test.ts`: verifies malformed inventory is reported/refused and its content is not disclosed.
- `test/connections.test.ts`: verifies stable schema digests, verified accounts, account mismatch, schema drift, host-private shadow-only handling, reviewed-probe absence, secret non-disclosure, and strict ABI schema behavior using hermetic injected downstreams.
- `test/observation-contracts.test.ts`: verifies descriptor/adoption closure and round-trip behavior and prohibits descriptors on non-usable inventory entries.

## Deviations from the plan

None. The plan explicitly allowed a minimal `src/mcp-client.ts` extension if required; the optional `advertisedName` field was required to distinguish reviewed server identity from the opaque route-spec fallback. Package metadata did not require modification: the `reelier/observation` subpath already ships its declarations/runtime, the existing `./contract/*` export exposes the schemas, and the existing authority build copies the whole ABI directory. `.tmp-pack/` was pre-existing and remained untouched.

## Test results

### Test compilation — `npx tsc -p tsconfig.test.json`

```text
Exit code: 0
Output: (none)
```

### Focused suites — `node --test --test-concurrency=1 dist-test/test/connections.test.js dist-test/test/connections-cli.test.js dist-test/test/observation-contracts.test.js`

```text
✔ candidate pack matches come only from installed manifest identities (0.7906ms)
ℹ tests 21
ℹ suites 0
ℹ pass 21
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 643.0502
```

### Contract drift and build — `npm run check:authority-contract; npm run build`

```text
> reelier@0.32.1 check:authority-contract
> node scripts/build-authority-contract.mjs --check

> reelier@0.32.1 build
> tsc -p tsconfig.json && node scripts/build-authority-contract.mjs --copy-schemas && node scripts/build-packs.mjs

built cloudflare_api_token, cloudflare_dns, github_issue_labels, gmail, gmail_labels, hubspot_slack_information_flow, neon_database, slack_channel_topic, stripe, vercel_deployment
```

### Public export, build copy, and package inventory

```text
public observation exports: ok
built authority connection schemas: 3/3
packed authority connection schemas: 3/3
```

### Full suite — `npm test`

```text
ℹ tests 2744
ℹ suites 0
ℹ pass 2743
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 237322.6674
```

## Open risks

- This slice provides the reviewed adapter boundary but intentionally adds no provider-specific adapters or provider runners; later slices must supply and review exact read-only identity probes and pinned schema digests.
- Host-private routes remain shadow-only and unsupported routes remain non-usable; this slice does not change host routing, import credentials, or claim universal observation/completeness.
- Declared-surface exclusive enforcement is reported independently and may remain `unknown`; adopted mode does not make raw-write bypasses disappear.
- Independent review completed after the safety fixes with no remaining Critical, Important, or Minor findings in the requested code scope.
