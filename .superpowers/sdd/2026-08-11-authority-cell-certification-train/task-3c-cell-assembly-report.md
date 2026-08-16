# Task 3C — Authority Cell certification assembly

## Files changed

- `contract/authority/v1/authority-key-descriptor.schema.json`
- `contract/authority/v1/certification-cell-activation.schema.json`
- `contract/authority/v1/certification-endpoint-manifest.schema.json`
- `contract/authority/v1/certification-runner-manifest.schema.json`
- `contract/authority/v1/certification-test-manifest.schema.json`
- `src/authority/certification/authority.ts`
- `src/authority/certification/cell.ts`
- `src/authority/certification/initializer.ts`
- `src/authority/certification/manifests.ts`
- `src/authority/certification/preflight.ts`
- `src/authority/host/delegation-service.ts`
- `src/authority/host/index.ts`
- `src/authority/host/principal-registry.ts`
- `test/authority/certification-authority.test.ts`
- `test/authority/certification-cell.test.ts`
- `test/authority/certification-export.test.ts`
- `test/authority/certification-filesystem.test.ts`
- `test/authority/certification-initializer.test.ts`
- `test/authority/certification-input-fixture.ts`
- `test/authority/certification-preflight.test.ts`
- `test/authority/certification-readiness.test.ts`
- `test/authority/certify-cli.test.ts`
- `test/authority/delegation-service.test.ts`
- `test/authority/principal-registry.test.ts`
- `.superpowers/sdd/2026-08-11-authority-cell-certification-train/task-3c-cell-assembly-report.md`

## Implementation

- Certification initialization now atomically scaffolds a selected-scenario-only, non-secret Authority Cell under `authority/`: JSON-form `authority.yml`, public trust/deployment references, empty append-only principal registry, ledger/decision/receipt/delegation stores, and closed provider endpoint manifests. Resume is exact, idempotent, link-confined, and refuses extra/unselected endpoints.
- Closed endpoint, runner, test, and Cell-activation schemas/parsers bind exact selected scenarios and digests. Empty `{}`/`[]`, open objects, scenario substitution, duplicate/missing manifests, and test-to-runner drift cannot satisfy preparation readiness.
- A human-signed, currently trusted Job Card activates only the initialization-generated task/job/root-grant/Cell identities. Concrete limits and the complete constraints preimage are checked against Job Card commitments. The root grant uses a readiness-activated `authority-cell/delegation-grant` key whose SPKI is purpose-separated from all other human/Cell keys.
- Root task/allocation registration is durable and exact-replay idempotent. A conflicting task, grant, allocation identity, signed grant, or effects budget refuses.
- The single certification principal and runtime session identity are derived from durable activation state. The existing `PrincipalRegistry` returns a short-lived bearer once and persists only its digest; restart, duplicate-session, expiry, and task-revocation paths remain fail-closed.
- `createCertificationCellHost` is the only public assembly surface. Its constructor canonicalizes one link-safe, operator-owned current-trust pin outside the entire certification workspace and retains that authority in an immutable host object. Activation records only a path digest, never the path. Every readiness/revalidation recanonicalizes the host path, rejects links/junctions or a move inside workspace-controlled output, matches the host and activation commitments, and then rereads current trust. Closed host methods accept neither a path nor a callback override.
- Task 3C execution is structurally inert: the public/certification API exports no runner registry, runner callback, provider callback, or arbitrary-code execution transition. One-use permit revalidation deletes the permit before checking current state, invokes nothing, and consumes zero effects. The private Task 4 dispatch transition must introduce host-owned execution and consume the effect immediately before its provider write; live-provider readiness remains false here.
- Root registration and durable principal issuance use serialized filesystem transactions. Conflicting root activations and duplicate live runtime-session credentials yield exactly one success even across independent service/registry instances.
- Signed readiness remains `dispatchable:false`; every generated/scaffold/activation/snapshot artifact retains `completeness:"unchecked"`.

## TDD commits

- `f424fff` RED empty placeholders; `e756f33` GREEN semantic presence
- `6dad4ff` RED closed manifests; `520681d` GREEN closed parsers/digest binding
- `f7c2c2c` RED atomic scaffold; `48356d8` GREEN selected Cell scaffold
- `8ebe898` RED root replay; `c32a0ff` GREEN durable idempotent registration
- `29f82c4` RED delegation-key separation; `c196c87` GREEN purpose activation
- `b98076f` RED Cell assembly/permit; `d62539e` GREEN root/session/permit assembly
- `fe77dc0` RED conserved permit effects; `c1aec96` GREEN immediate consumption
- `79e626d` RED signed-manifest drift; `95d8921` GREEN signed preflight pin
- `a224f8a` RED unselected scaffold drift; `797ef7d` GREEN closed inventory
- `67a16ca` current-trust revocation and zero-runner regression coverage
- `58a838a` RED independent-review regressions for runner confinement, multi-scenario dispatch, current trust, concurrency, endpoint derivation, redaction, and canonical signatures
- `0d46fac` GREEN review-finding closure
- `9690113` RED require activation-bound trust and structurally inert Task 3C dispatch
- `623fc7c` GREEN remove all public runner/callback execution and effect consumption
- `eda13a2` RED require the host runtime, not mutable activation, to own current-trust path authority
- `68bf302` GREEN expose one closed host object and bind only the path digest in activation
- `38abcea` RED reject host-method dependency injection through runtime extra keys
- `c2b0c2c` GREEN exact-key validate/project host inputs and assign host authority last

## Focused verification

Commands run at the implementation head:

```text
npm run build
npx tsc -p tsconfig.test.json --pretty false
node --test --test-concurrency=1 dist-test/test/authority/certification-authority.test.js dist-test/test/authority/certification-cell.test.js dist-test/test/authority/certification-export.test.js dist-test/test/authority/certification-filesystem.test.js dist-test/test/authority/certification-initializer.test.js dist-test/test/authority/certification-preflight.test.js dist-test/test/authority/certification-readiness.test.js dist-test/test/authority/certify-cli.test.js dist-test/test/authority/delegation-service.test.js dist-test/test/authority/principal-registry.test.js
npm run check:authority-contract
```

Results: build passed; test compilation passed; authority contract drift check passed; focused tests **66 passed, 0 failed, 0 skipped**.

The full `npm test` suite was intentionally not run, per Task 3C scope.

## Deviations

- The generated `authority.yml` is canonical JSON with a `.yml` name. JSON is the repository's canonical emitted form and is accepted by the existing host loader.
- Cell assembly is exported from the host package only. The portable `reelier/authority` export allowlist remains unchanged.
- The root allocation uses the initialization-generated `rootGrantId`, rather than the legacy literal `root`, so task/grant/allocation identity is exact and restart-stable.

## Open risks

- Portable filesystem checks reject observed links/reparse points and substitutions but cannot prove absence of hostile concurrent same-user mutation; isolated Cell topology remains Task 5.
- Permits are intentionally process-local and non-recoverable. Process restart requires full readiness verification and a new permit.
- Named credential resolution and all live provider semantics remain Task 4. Task 3C reads no secret, accepts no credential callback, invokes no runner, and consumes no effect.
- Universal completeness remains unchecked; this assembly proves only the selected certification boundary.

## Independent review

Final release-train evidence: the later absent-directory integration regression was fixed in RED `3793a2e` / GREEN `0ad1455` and independently approved after 16/16 affected tests and 20/20 concurrent first-creation stress runs. Exact pushed head `123ae93` passed hosted Ubuntu and Windows CI in GitHub Actions run `31556549826`. Ubuntu confirmed 2,836 passing tests; local Windows passed 2,840 with 1 skip.

The first fresh read-only review requested nine changes, converted into RED regressions in `58a838a`. Its same-reviewer re-review closed seven and identified two remaining trust-boundary gaps; RED `9690113` and GREEN `623fc7c` removed execution. The next pass found mutable activation still selected the trust path; RED `eda13a2` and GREEN `68bf302` moved that authority into the host constructor. The following pass caught runtime object-spread injection; RED `38abcea` and GREEN `c2b0c2c` close all host method inputs, including symbol and prototype-key cases. The same reviewer then approved `a668acf..4215fbf` with no blocking or non-blocking findings and independently reproduced 66/66 focused tests plus the authority contract check.
