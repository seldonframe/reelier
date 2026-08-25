# Files changed

- `src/authority/host/effect-transports.ts`
- `src/authority/host/index.ts`
- `test/authority/effect-transports.test.ts`
- `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-3b-report.md`

# Task 3B report — opaque trusted executor capability

## What changed

### `src/authority/host/effect-transports.ts`

- Replaced caller-supplied raw executable transport ports with a host-minted, nominal `TrustedEffectTransportExecutorV1` capability.
- Added `mintTrustedEffectTransportExecutorV1`, backed by a private module `WeakMap` that holds the trusted callback snapshot. The returned capability is a frozen null-prototype object with no own keys, callbacks, credentials, model/provider identity, or other inspectable authority material.
- Restricted minting input to inert closed records. Callback values are read once from data descriptors; accessor-bearing records, functions in the record root, arrays, unexpected keys, object proxies, and proxied callback functions are rejected without invoking traps.
- Changed compilation to require the minted capability and validate its private-registry membership before contract parsing, binding lookup, credential resolution, or provider dispatch.
- Kept executor callbacks callback-only and typed as TypeScript `void`. The runtime buffers synchronous sink settlement until the callback returns and requires the exact return value `undefined`; a non-`undefined` root is treated as an unsupported trusted-executor contract violation without inspecting the root or attaching Promise reactions.
- Removed the native-Promise detection/reaction bridge and its broad containment claim. The transport does not read `then`, `constructor`, or species from arbitrary callback return roots.
- Preserved serialized untrusted payload parsing, fixed sanitization for synchronous throws, exactly-once first settlement, projection provenance/HMAC isolation, restart/no-resend behavior, HTTP/MCP/CLI host binding, and the receipt ABI.

### `src/authority/host/index.ts`

- Exported the opaque capability type, inert callback input type, and host minting factory so a host can construct the required authority object. This is the only reason the public host index changed.

### `test/authority/effect-transports.test.ts`

- Added RED/GREEN coverage proving raw or forged executor objects refuse before binding or provider activity, while a genuinely minted executor succeeds.
- Added inert-minting tests for functions, accessors, record proxies, and proxied callbacks, including zero-trap assertions.
- Added unsupported-return tests proving arbitrary roots and fulfilled hostile-species Promises are not inspected or assimilated.
- Preserved and adapted coverage for sanitized synchronous throws, malformed serialized provider data, exactly-once double/late settlement, HMAC projection provenance/key isolation, restart/no-resend, binding resolution, and receipt shape.
- Removed the rejected-Promise containment test because the boundary cannot honestly prevent an unhandled rejection created by a malicious trusted executor.

## RED/GREEN commits

- `1cf1cc50 test(authority): require minted callback executors` — RED: 19 passed, 3 failed as intended.
- `1981609c feat(authority): mint trusted callback executors` — GREEN: focused transport suite 22/22.
- `0311c6f2 test(authority): reject proxied trusted callbacks` — RED: 21 passed, 1 failed as intended.
- `754dce0c fix(authority): reject proxied executor callbacks` — GREEN: focused transport suite 22/22.

## Deviations from the plan

- The Task-3-only source API intentionally changes `ports` to `executor`. The serialized effect contract, host-binding surface, provider protocol, and receipt ABI are unchanged.
- TypeScript permits a Promise-returning function where a `void` callback is expected, so source typing alone cannot reject every `async` implementation. Exact synchronous `undefined` enforcement is therefore also performed at runtime.
- No public package-contract test outside the declared file scope was edited. Existing package export coverage passed with the new host index exports.
- No native Promise reaction bridge was retained. A rejecting Promise returned by malicious trusted host code can still create an unhandled rejection; Task 3B explicitly does not claim otherwise.

## Test results

### Production and test compilation

Commands:

```text
npx tsc -p tsconfig.json --pretty false
npx tsc -p tsconfig.test.json --pretty false
```

Both exited 0 with no output.

### Focused and adjacent authority contracts

Command:

```text
node --test --test-concurrency=1 dist-test/test/authority/effect-transports.test.js dist-test/test/authority/effect-contract.test.js dist-test/test/authority/outcome-kernel.test.js dist-test/test/authority/dispatch-coordinator.test.js dist-test/test/authority/package.test.js
```

Verbatim tail:

```text
✔ public production export parses DecisionContext and its portable evidence against packaged schemas (715.2881ms)
ℹ tests 76
ℹ suites 0
ℹ pass 76
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 4964.8783
```

The transport file contributed 22 passing tests.

### Build and conformance contracts

Commands:

```text
npm run build
npm run check:authority-contract
npm run check:agent-adapter -- conformance/agent-adapter/v1/fixtures/grok-build-observed.json
npm run check:agent-adapter -- conformance/agent-adapter/v1/fixtures/grok-bot-observed.json
npm run check:continuity-adapter -- conformance/continuity-adapter/v1/core-candidate.mjs
```

All exited 0. Build tail:

```text
built cloudflare_api_token, cloudflare_dns, github_issue_labels, github_release, gmail, gmail_labels, hubspot_slack_information_flow, neon_database, slack_channel_topic, stripe, vercel_deployment
```

Both agent-adapter reports returned `"status":"passed"` with all 7 checks passing. The continuity-adapter report returned `"status":"passed"` with all 10 checks passing.

### Full suite status

`npm test` exited 1. The full-suite run reached failures outside the four-file Task 3B scope, including broad release-runner expectations, Linux-only host-cell tests on Windows, and absent optional build/Eve fixtures. Representative output:

```text
✖ common host serves the same closed outcome over HTTP (1.8187ms)
Error [AuthorityCellLinuxRequiredError]: Authority Cell hosting requires Linux...

✖ installed build digest covers this package's shipped files contract (57.964ms)
Error: ENOENT: no such file or directory, lstat 'C:\Users\maxim\CascadeProjects\.worktrees\reelier-universal-governed-outcomes\native\bootstrap-helper\manifest.json'

✖ real Eve 0.39.0 preserves Reelier continuity across process and session boundaries (1109.6406ms)
Error: Cannot find module '...\conformance\continuity-adapter\v1\eve-fixture\node_modules\eve\bin\eve.js'

✖ deterministic tag-conflict refuses without semantic widening (674.5871ms)
AssertionError [ERR_ASSERTION]: Missing expected rejection.
```

No claim is made here that every full-suite failure predates Task 3B; the focused and adjacent contract suites establish the scoped result.

## Open risks and explicit non-claims

- The executor callback is trusted host code. The opaque capability prevents raw untrusted injection; it does not prevent malicious trusted host code from exfiltrating credentials it already receives.
- A trusted executor must internally catch and translate asynchronous work into its callback protocol. Runtime code cannot prevent an unhandled rejection if malicious trusted code creates and returns a rejecting Promise. The hostile-species characterization uses a fulfilled Promise only and proves non-inspection, not rejection containment.
- JavaScript/TypeScript cannot make the nominal capability serializable or transferable across runtime/module instances. A capability is valid only in the registry that minted it.
- No live provider was contacted during verification.
