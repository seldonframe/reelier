Files changed

- `conformance/hermetic-outcome/v0/check.mjs`
- `conformance/hermetic-outcome/v0/bundle.schema.json`
- `test/hermetic-outcome-conformance.test.ts`
- `.superpowers/sdd/task-7-hermetic-outcome-report.md`

## What changed per file

- `conformance/hermetic-outcome/v0/check.mjs` adds a local-only deterministic emitter and checker for exactly eight artifacts: `descriptor.json`, `delegation.json`, `coverage.json`, `dispatch.json`, `provider-state.json`, `receipt.json`, `failure-injection.json`, and `final-report.json`. The fixture uses existing Reelier delegation grants, principal, authority-cell session binding, decision context, gate event, post-state evidence, and authority receipt semantics. A fixed public fixture Ed25519 seed signs the child delegation commitment; it is test material and explicitly not a production key or credential. The checker verifies the signature, parent/child commitment chain, host-bound principal, reduced child effect/body budget, reservation, accepted dispatch, provider acknowledgment, exact post-state, rollback, receipt joins, descriptor commitments, Task 6 report digest, duplicate retry zero-effect behavior, non-passing coverage, human exception, and non-claims.
- `conformance/hermetic-outcome/v0/bundle.schema.json` closes the aggregate bundle and every nested Task 7 artifact. It fixes discovery coverage to `status: failed`, `passEligibility: false`, and `mode: discovery-only`; fixes the final report to `status: non-passing`; and constrains existing Reelier authority artifact shapes used by the bundle.
- `test/hermetic-outcome-conformance.test.ts` proves deterministic bytes across independent output directories, the exact closed artifact set, schema validity, reversibility, cryptographic delegation commitment, existing authority-schema conformance, host binding, attenuation, reservation/dispatch/provider/receipt evidence, and explicit human/non-claims. Regressions reject duplicate retry effects, wrong receipt/delegation linkage, post-state mismatch despite acknowledgment, a missing artifact, and any passing upgrade to discovery-only coverage.
- `.superpowers/sdd/task-7-hermetic-outcome-report.md` records Task 7 scope, RED/GREEN evidence, verification outputs, external escalation boundary, deviations, and remaining gaps.

## Evidence bundle

The deterministic transition starts at `{ resourceId: "fixture_switch", value: "off", revision: 0 }`, applies one reserved and acknowledged effect to reach `{ resourceId: "fixture_switch", value: "on", revision: 1 }`, obtains an exact authoritative post-state digest, and restores the original state. The retry reuses the same reservation and idempotency key, records `decision: "duplicate"`, has `providerEffectDelta: 0`, and leaves `providerEffectCount: 1`.

The parent grant permits two effects per window/source trigger and 2048 body bytes. Its signed child permits one effect and 1024 body bytes, references the parent commitment digest, and is linked to the full existing `reelier.authority-cell-session-binding/v1` host observation. The receipt links the child capability digest, dispatch decision context/gate event, and provider-state evidence digest.

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

The GREEN implementation was committed as `1bcd169`.

Fresh emitting build before focused tests (`npm run build`, exit 0), verbatim tail:

```text
> reelier@0.32.1 build
> node scripts/build-authority-contract.mjs --check && node scripts/build-bootstrap-contract.mjs --check && tsc -p tsconfig.json && node scripts/build-authority-contract.mjs --copy-schemas && node scripts/build-packs.mjs

built cloudflare_api_token, cloudflare_dns, github_issue_labels, gmail, gmail_labels, hubspot_slack_information_flow, neon_database, slack_channel_topic, stripe, vercel_deployment
```

Focused GREEN (`npx tsc -p tsconfig.test.json --pretty false` then `node --test --test-concurrency=1 dist-test/test/hermetic-outcome-conformance.test.js`, exit 0), verbatim tail:

```text
✔ emits a deterministic closed reversible bundle using existing authority semantics (21.8736ms)
✔ duplicate retry reuses the reservation and causes no duplicate provider effect (4.6541ms)
✔ delegation and host binding remain valid existing Reelier authority artifacts (6.2478ms)
✔ rejects wrong receipt to delegation linkage (6.5781ms)
✔ rejects a provider post-state mismatch even when acknowledgment remains present (6.2616ms)
✔ rejects a missing artifact from the closed bundle (4.2017ms)
✔ discovery-only coverage stays explicit and non-passing (6.9975ms)
ℹ tests 7
ℹ suites 0
ℹ pass 7
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 301.2958
```

Relevant Task 1–7 conformance suites (exit 0), verbatim tail:

```text
✔ a passed matrix cannot contain unsupported top-level harness rows (0.5329ms)
✔ explicit missing evidence cannot coexist with a candidate or report (0.2567ms)
ℹ tests 69
ℹ suites 0
ℹ pass 69
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 4869.7046
```

Package contract checks (exit 0), verbatim output:

```text
> reelier@0.32.1 check:authority-contract
> node scripts/build-authority-contract.mjs --check

> reelier@0.32.1 check:bootstrap-contract
> node scripts/build-bootstrap-contract.mjs --check
```

`npx tsc -p tsconfig.test.json --pretty false`, `git diff --check`, and `git status --short` all exited 0 with no output before this report was added.

## Later GitHub escalation

Any GitHub proof is a separate operator-run integration after this branch. It requires an operator to select the repository/target, authorize the write and rollback, supply credentials outside the bundle, observe the provider result, verify cleanup, and retain the resulting Reelier receipt chain. Task 7 performs no GitHub API call, obtains no credential, and makes no claim about GitHub route enforcement, provider identity, production safety, or cleanup.

## Open risks and gaps

- The fixture Ed25519 key is deterministic public test material. It proves signature and commitment verification behavior, not production key custody, signer identity, or segregation of duties.
- The state provider, acknowledgment, authoritative read, and rollback are hermetic values. They prove checker semantics, exact local post-state, retry idempotency, and reversibility, not any live provider behavior.
- Discovery-only coverage remains failed/non-passing. Route topology, enforcement, and traffic completeness are unchecked and unproved.
- The human exception is explicit but not exercised: no operator approved an external write, supplied a credential, or reviewed a live cleanup.
- Task 6 linkage is a digest commitment to its local report. Task 7 does not convert Task 6's hermetic failure classifications into live fault-injection evidence.
- Content correctness and production safety remain explicit non-claims.
