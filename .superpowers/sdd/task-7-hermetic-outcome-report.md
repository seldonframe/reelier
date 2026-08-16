Files changed

- `conformance/hermetic-outcome/v0/check.mjs`
- `conformance/hermetic-outcome/v0/bundle.schema.json`
- `test/hermetic-outcome-conformance.test.ts`
- `.superpowers/sdd/task-7-hermetic-outcome-report.md`

## What changed per file

- `conformance/hermetic-outcome/v0/check.mjs` adds a local-only deterministic emitter and checker for exactly eight artifacts: `descriptor.json`, `delegation.json`, `coverage.json`, `dispatch.json`, `provider-state.json`, `receipt.json`, `failure-injection.json`, and `final-report.json`. The fixture uses existing Reelier delegation grants, principal, authority-cell session binding, decision context, gate event, post-state evidence, and authority receipt semantics. A fixed public fixture Ed25519 seed signs the child delegation commitment; it is test material and explicitly not a production key or credential. The checker derives artifact joins from actual inputs. Fix round 2 additionally binds each attempt to `reservation.id`, binds attempt/request/reservation idempotency keys to the authorized decision context, binds child signer/grantor, parent grantee, child grantee, session principal/grant/tenant, and decision requester/capability/tenant, requires the dispatched digest to equal the authorized request digest, and derives expected post-state from the authorized request plus pre-state before comparing exact observed provider state.
- `conformance/hermetic-outcome/v0/bundle.schema.json` closes the aggregate bundle and every nested Task 7 artifact. It fixes discovery coverage to `status: failed`, `passEligibility: false`, and `mode: discovery-only`; fixes the final report to `status: non-passing`; requires final-report commitments for receipt, delegation, provider-state, dispatch, coverage, and failure-injection; and keeps dispatch closed while adding the authorized provider request and authoritative reservation `id`.
- `test/hermetic-outcome-conformance.test.ts` proves deterministic bytes across independent output directories, the exact closed artifact set, schema validity, reversibility, cryptographic delegation commitment, existing authority-schema conformance, host binding, attenuation, reservation/dispatch/provider/receipt evidence, and explicit human/non-claims. Fix round 2 adds regressions for a different self-authored reservation, signer/grant/parent/session/decision identity substitutions, unrelated dispatch, altered authorized request, and contradictory post-state whose expected and observed digests were copied from the contradiction.
- `.superpowers/sdd/task-7-hermetic-outcome-report.md` records Task 7 scope, RED/GREEN evidence, verification outputs, external escalation boundary, deviations, and remaining gaps.

## Evidence bundle

The deterministic transition starts at `{ resourceId: "fixture_switch", value: "off", revision: 0 }`, applies one reserved and acknowledged effect to reach `{ resourceId: "fixture_switch", value: "on", revision: 1 }`, obtains an exact authoritative post-state digest, and restores the original state. The retry reuses the same reservation and idempotency key, records `decision: "duplicate"`, has `providerEffectDelta: 0`, and leaves `providerEffectCount: 1`.

The parent grant permits two effects per window/source trigger, the two local source-trigger operation aliases, and 2048 body bytes. Its signed child permits one effect, only `hermetic_state_set_v1`, and 1024 body bytes; references the independently derived parent commitment digest; and is linked through the authoritative child signer/grantor, parent grantee, child grantee, session principal, session grant ID/digest, and tenant to the full existing `reelier.authority-cell-session-binding/v1` host observation. Both dispatch attempts reference `reservation.id`; their request keys and the authorized request idempotency key equal the reservation and decision-context key. The dispatched digest equals the authorized decision-context request digest. Expected post-state is derived from the authorized request and pre-state, never from observed post-state. The receipt links the child capability digest, actual dispatch decision context/gate event, and actual provider-state evidence digest.

Coverage is intentionally discovery-only and non-passing. A valid Task 7 bundle therefore has locally verified outcome evidence while its final aggregate status remains `non-passing`; this does not upgrade topology, traffic completeness, or route enforcement.

Task 6 is consumed by digest from `.superpowers/sdd/task-6-failure-injection-report.md`. Its non-passing duplicate/provider mismatch dispositions remain recorded and are not upgraded. Task 7 adds local evidence that this particular deterministic duplicate reconciles to zero effect and that this checker refuses a post-state mismatch.

## Deviations from plan

None. Only the four Task 7 allowlisted paths were created or modified. No provider, credential, network, GitHub, Gmail, Stripe, authority runtime, delegation runtime, receipt runtime, route, coverage, continuity, or Task 6 implementation was changed. No second delegation or receipt protocol was introduced.

## Test results

Initial RED was committed as `2e08b80`. TypeScript compilation exited 0 and the focused test failed for the intended missing checker:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'C:\Users\maxim\CascadeProjects\reelier\.worktrees\five-harness-conformance\conformance\hermetic-outcome\v0\check.mjs'
...
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
```

The existing-contract binding RED was committed as `1a86ddf`. It failed because the first session-binding fixture omitted the existing contract's required fields and added two unsupported fields:

```text
✖ delegation and host binding remain valid existing Reelier authority artifacts (6.5879ms)
...
ℹ tests 7
ℹ suites 0
ℹ pass 6
ℹ fail 1
```

The initial GREEN implementation was committed as `1bcd169`. A final verifier audit added a RED regression in `65c2731`: the focused suite reported 6 passes and 2 failures because the exact post-state evidence lacked the complete existing field set and signature-specific rejection. The complete evidence shape and direct signature verification were committed as `7b9bded`.

Fresh emitting build before focused tests (`npm run build`, exit 0), verbatim tail:

```text
> reelier@0.32.1 build
> node scripts/build-authority-contract.mjs --check && node scripts/build-bootstrap-contract.mjs --check && tsc -p tsconfig.json && node scripts/build-authority-contract.mjs --copy-schemas && node scripts/build-packs.mjs

built cloudflare_api_token, cloudflare_dns, github_issue_labels, gmail, gmail_labels, hubspot_slack_information_flow, neon_database, slack_channel_topic, stripe, vercel_deployment
```

Focused GREEN (`npx tsc -p tsconfig.test.json --pretty false` then `node --test --test-concurrency=1 dist-test/test/hermetic-outcome-conformance.test.js`, exit 0), verbatim tail:

```text
✔ emits a deterministic closed reversible bundle using existing authority semantics (24.4855ms)
✔ duplicate retry reuses the reservation and causes no duplicate provider effect (5.2639ms)
✔ delegation and host binding remain valid existing Reelier authority artifacts (6.859ms)
✔ rejects wrong receipt to delegation linkage (6.7424ms)
✔ rejects a provider post-state mismatch even when acknowledgment remains present (7.0293ms)
✔ rejects an invalid exact post-state verifier signature (8.2132ms)
✔ rejects a missing artifact from the closed bundle (6.238ms)
✔ discovery-only coverage stays explicit and non-passing (7.0508ms)
ℹ tests 8
ℹ suites 0
ℹ pass 8
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 323.5228
```

Relevant Task 1–7 conformance suites (exit 0), verbatim tail:

```text
✔ a passed matrix cannot contain unsupported top-level harness rows (0.6866ms)
✔ explicit missing evidence cannot coexist with a candidate or report (0.3444ms)
ℹ tests 70
ℹ suites 0
ℹ pass 70
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 4831.9149
```

Package contract checks (exit 0), verbatim output:

```text
> reelier@0.32.1 check:authority-contract
> node scripts/build-authority-contract.mjs --check

> reelier@0.32.1 check:bootstrap-contract
> node scripts/build-bootstrap-contract.mjs --check
```

`npx tsc -p tsconfig.test.json --pretty false`, `git diff --check`, and `git status --short` all exited 0 with no output before this report was added.

### Reviewer fix round

The RED regressions were committed as `673529f`. The focused run exited 1 for the intended missing relationship-specific verification. Verbatim result summary and final relationship failure:

```text
ℹ tests 30
ℹ suites 0
ℹ pass 7
ℹ fail 23
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 454.5735

✖ reservation idempotency key (5.9584ms)
  AssertionError [ERR_ASSERTION]: descriptor commitment mismatch for dispatch.json
```

The implementation was committed as `e78dbeb`. Fresh emitting build (`npm run build`, exit 0), verbatim tail:

```text
> reelier@0.32.1 build
> node scripts/build-authority-contract.mjs --check && node scripts/build-bootstrap-contract.mjs --check && tsc -p tsconfig.json && node scripts/build-authority-contract.mjs --copy-schemas && node scripts/build-packs.mjs

built cloudflare_api_token, cloudflare_dns, github_issue_labels, gmail, gmail_labels, hubspot_slack_information_flow, neon_database, slack_channel_topic, stripe, vercel_deployment
```

Fresh test typecheck and focused Task 7 (`npx tsc -p tsconfig.test.json --pretty false` then `node --test --test-concurrency=1 dist-test/test/hermetic-outcome-conformance.test.js`, exit 0), verbatim tail:

```text
  ✔ original attempt request key (5.2589ms)
  ✔ retry attempt request key (4.7796ms)
  ✔ reservation idempotency key (5.1893ms)
✔ rejects every tampered artifact join with a relationship-specific error (120.8266ms)
✔ rejects a missing artifact from the closed bundle (4.187ms)
✔ discovery-only coverage stays explicit and non-passing (5.1174ms)
ℹ tests 30
ℹ suites 0
ℹ pass 30
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 427.817
```

Fresh relevant Task 1–7 conformance suites (exit 0), verbatim tail:

```text
✔ invalid source reports cannot publish semantic checks (0.3298ms)
✔ listed missing evidence must be explicit and CLI failures remain schema-valid (385.905ms)
✔ a passed matrix cannot contain unsupported top-level harness rows (0.5521ms)
✔ explicit missing evidence cannot coexist with a candidate or report (0.2482ms)
ℹ tests 92
ℹ suites 0
ℹ pass 92
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 4982.6833
```

Fresh contract checks (exit 0), verbatim output:

```text
> reelier@0.32.1 check:authority-contract
> node scripts/build-authority-contract.mjs --check

> reelier@0.32.1 check:bootstrap-contract
> node scripts/build-bootstrap-contract.mjs --check
```

`npx tsc -p tsconfig.test.json --pretty false` exited 0 with no output. `git diff --check 6e98f7b..HEAD` exited 0 with no output. Before this report update, `git status --short` exited 0 with no output and the fix-round committed-path audit listed only the three Task 7 implementation/test files.

### Reviewer fix round 2

The primary RED regressions were committed as `73f5c89`. Test compilation exited 0; the focused run exited 1 because the checker accepted sibling-authored reservation, identity, dispatch, and post-state relationships instead of joining them to authoritative inputs. Verbatim tail:

```text
ℹ tests 38
ℹ suites 0
ℹ pass 27
ℹ fail 11
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 469.4856
```

The GREEN implementation was committed as `1bc2804`. Fresh emitting build (`npm run build`, exit 0), verbatim tail:

```text
> reelier@0.32.1 build
> node scripts/build-authority-contract.mjs --check && node scripts/build-bootstrap-contract.mjs --check && tsc -p tsconfig.json && node scripts/build-authority-contract.mjs --copy-schemas && node scripts/build-packs.mjs

built cloudflare_api_token, cloudflare_dns, github_issue_labels, gmail, gmail_labels, hubspot_slack_information_flow, neon_database, slack_channel_topic, stripe, vercel_deployment
```

Fresh test typecheck plus focused Task 7 (`npx tsc -p tsconfig.test.json --pretty false` then `node --test --test-concurrency=1 dist-test/test/hermetic-outcome-conformance.test.js`, exit 0), verbatim tail:

```text
✔ rejects every tampered artifact join with a relationship-specific error (181.0059ms)
✔ rejects a missing artifact from the closed bundle (3.5868ms)
✔ rejects contradictory post-state even when observed and expected digests copy it (5.6667ms)
✔ discovery-only coverage stays explicit and non-passing (5.6213ms)
ℹ tests 41
ℹ suites 0
ℹ pass 41
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 492.5136
```

Fresh relevant Task 1–7 conformance suites (exit 0), verbatim tail:

```text
✔ invalid source reports cannot publish semantic checks (0.4266ms)
✔ listed missing evidence must be explicit and CLI failures remain schema-valid (457.2174ms)
✔ a passed matrix cannot contain unsupported top-level harness rows (1.0181ms)
✔ explicit missing evidence cannot coexist with a candidate or report (0.5142ms)
ℹ tests 103
ℹ suites 0
ℹ pass 103
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 5173.4407
```

`npx tsc --noEmit --pretty false` and `npx tsc -p tsconfig.test.json --pretty false` exited 0 with no output. `npm run check:authority-contract` and `npm run check:bootstrap-contract` exited 0.

The repository-wide `npm test` attempt is explicitly **incomplete/interrupted** and is not branch-green evidence. It was interrupted with Ctrl-C after reproducing the three authority-runtime failures below. The interruption caused Node to label pending/not-yet-run suites with `Promise resolution is still pending but the event loop has already resolved`; those cancellation artifacts are not a completed suite result, and there is no valid repository-wide pass/fail aggregate.

The three failures reproduced independently with `node --test --test-concurrency=1 dist-test/test/authority-runtime.test.js` (exit 1). They are outside the Task 7 allowlist and all refuse Windows authority hosting with `AUTHORITY_CELL_LINUX_REQUIRED`; Task 7 did not modify authority runtime code. Verbatim result:

```text
✖ authority runtime authenticates host identity, dispatches once, and returns durable status (0.7145ms)
✖ authority runtime does not trust identity fields from the request body (0.119ms)
✖ shadow runtime returns a report-only lifecycle and never an accepted receipt (0.1065ms)
ℹ tests 3
ℹ suites 0
ℹ pass 0
ℹ fail 3
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 112.7973
```

Each failure begins:

```text
Error [AuthorityCellLinuxRequiredError]: Authority Cell hosting requires Linux. Windows is supported as a client; run the Cell through WSL, a Linux container, or a remote Linux Authority Cell.
code: 'AUTHORITY_CELL_LINUX_REQUIRED'
```

Therefore only the emitting build, focused/relevant suites, typechecks, and contract checks above are green; the whole branch is not claimed green.

## Later GitHub escalation

Any GitHub proof is a separate operator-run integration after this branch. It requires an operator to select the repository/target, authorize the write and rollback, supply credentials outside the bundle, observe the provider result, verify cleanup, and retain the resulting Reelier receipt chain. Task 7 performs no GitHub API call, obtains no credential, and makes no claim about GitHub route enforcement, provider identity, production safety, or cleanup.

## Open risks and gaps

- Repository-wide verification is incomplete: `npm test` was interrupted, and its three independently reproduced authority-runtime tests refuse native Windows with `AUTHORITY_CELL_LINUX_REQUIRED`. A complete Linux repository-wide run remains absent; the whole branch is not claimed green.
- The fixture Ed25519 key is deterministic public test material. It proves signature and commitment verification behavior, not production key custody, signer identity, or segregation of duties.
- The state provider, acknowledgment, authoritative read, and rollback are hermetic values. They prove checker semantics, exact local post-state, retry idempotency, and reversibility, not any live provider behavior.
- Discovery-only coverage remains failed/non-passing. Route topology, enforcement, and traffic completeness are unchecked and unproved.
- The human exception is explicit but not exercised: no operator approved an external write, supplied a credential, or reviewed a live cleanup.
- Task 6 linkage is a digest commitment to its local report. Task 7 does not convert Task 6's hermetic failure classifications into live fault-injection evidence.
- Content correctness and production safety remain explicit non-claims.
