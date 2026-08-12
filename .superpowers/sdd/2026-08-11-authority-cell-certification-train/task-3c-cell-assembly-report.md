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
- `.superpowers/sdd/2026-08-11-authority-cell-certification-train/task-3c-cell-assembly-report.md`

## Implementation

- Certification initialization now atomically scaffolds a selected-scenario-only, non-secret Authority Cell under `authority/`: JSON-form `authority.yml`, public trust/deployment references, empty append-only principal registry, ledger/decision/receipt/delegation stores, and closed provider endpoint manifests. Resume is exact, idempotent, link-confined, and refuses extra/unselected endpoints.
- Closed endpoint, runner, test, and Cell-activation schemas/parsers bind exact selected scenarios and digests. Empty `{}`/`[]`, open objects, scenario substitution, duplicate/missing manifests, and test-to-runner drift cannot satisfy preparation readiness.
- A human-signed, currently trusted Job Card activates only the initialization-generated task/job/root-grant/Cell identities. Concrete limits and the complete constraints preimage are checked against Job Card commitments. The root grant uses a readiness-activated `authority-cell/delegation-grant` key whose SPKI is purpose-separated from all other human/Cell keys.
- Root task/allocation registration is durable and exact-replay idempotent. A conflicting task, grant, allocation identity, signed grant, or effects budget refuses.
- The single certification principal and runtime session identity are derived from durable activation state. The existing `PrincipalRegistry` returns a short-lived bearer once and persists only its digest; restart, duplicate-session, expiry, and task-revocation paths remain fail-closed.
- `verifyCertificationDispatchReadiness` returns a WeakMap-backed opaque permit whose JSON serialization throws. Permit use immediately rereads and verifies current Job Card trust, signed readiness, root grant signature/constraints, task/grant/allocation/principal state, remaining effects, exact signed semantic runner/test preflight, named credential availability, and endpoint commitments. The permit is deleted before revalidation, can be used once, consumes one effect immediately before the runner callback, and calls the runner zero times on every tested invalid/stale path.
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

## Focused verification

Commands run at the implementation head:

```text
npm run build
npx tsc -p tsconfig.test.json --pretty false
node --test <11 focused authority test files>
npm run check:authority-contract
```

Results: build passed; test compilation passed; authority contract drift check passed; focused tests **61 passed, 0 failed, 0 skipped**.

The full `npm test` suite was intentionally not run, per Task 3C scope.

## Deviations

- The generated `authority.yml` is canonical JSON with a `.yml` name. JSON is the repository's canonical emitted form and is accepted by the existing host loader.
- Cell assembly is exported from the host package only. The portable `reelier/authority` export allowlist remains unchanged.
- The root allocation uses the initialization-generated `rootGrantId`, rather than the legacy literal `root`, so task/grant/allocation identity is exact and restart-stable.

## Open risks

- Portable filesystem checks reject observed links/reparse points and substitutions but cannot prove absence of hostile concurrent same-user mutation; isolated Cell topology remains Task 5.
- Permits are intentionally process-local and non-recoverable. Process restart requires full readiness verification and a new permit.
- Named credential checks prove availability by slot only; secret values and live provider semantics remain Task 4 and are never read or persisted here.
- Universal completeness remains unchecked; this assembly proves only the selected certification boundary.

## Independent review

Pending fresh read-only review of `a668acf..HEAD`.
