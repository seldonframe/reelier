# Task 3 brief — adapter coverage envelope

## Objective

Add a closed, conformance-only coverage envelope that maps existing Codex and Claude Code
`RouteCoverageV1` discovery rows without changing their authority. The envelope identifies the
harness instance, adapter, source/config/plugin evidence, discovered inventory, wrapped and
unwrapped routes, direct HTTP and private-host bypasses, mode, freshness, topology,
completeness, aggregate status, and explicit reason codes.

## Files touched

- `conformance/coverage-envelope/v0/input.schema.json`
- `conformance/coverage-envelope/v0/report.schema.json`
- `conformance/coverage-envelope/v0/check.mjs`
- `test/coverage-envelope-conformance.test.ts`
- `.superpowers/sdd/task-3-coverage-envelope-brief.md`
- `.superpowers/sdd/task-3-coverage-envelope-report.md`

No `src/` file is changed. Existing route adapters and discovery types are consumed as-is.

## Contract

- Input is closed and accepts only `codex` with `reelier-codex-coverage`, or `claude-code` with
  `reelier-claude-code-coverage`.
- Harness instance identity, adapter digest, source-instance identity, and config/plugin content
  digests are explicit SHA-256 commitments. Paths, endpoints, credentials, and source bytes are
  not accepted.
- Route rows use the existing `reelier.route-coverage/v1` schema. The mapper does not define a
  second route or delegation protocol.
- Inventory rows retain route identity, discovery source, transport, observation, enforcement,
  freshness, evidence commitments, and reason codes. They add only a derived routing label:
  `wrapped`, `unwrapped`, or `unknown`.
- `wrapped` is derived only from the existing `wrapped-route-observed` reason on an observed
  route. Uncovered, direct HTTP, writable-browser, host-private, `route-unwrapped`, and
  `plugin-private` rows are `unwrapped`. Everything else is `unknown`.
- Direct HTTP and private-host route IDs are explicit subsets of the inventory. Plugin-private
  routes count as private routes.
- Requested `enforced` mode is preserved only when every source and route is verified and fresh,
  topology and completeness are verified with evidence digests, and the inventory has no
  unwrapped or unknown routing. Otherwise the report is `observed`, `failed`, and carries
  `enforced-mode-refused`.
- Discovery never upgrades execution: observed routes with `unchecked` enforcement remain
  observed and non-passing. Catalog-only evidence remains unknown and non-passing.
- `unknown`, `uncovered`, `unchecked`, `absent`, and `pending` evidence are always non-success.
- A completeness claim contradicted by unwrapped, unknown, direct, or private routes cannot pass.
- Aggregate `status` is `passed` only for an honestly enforced envelope; every other shape is
  `failed`. Failure reports remain schema-valid and machine-readable.

## TDD and verification

1. Add focused tests for the Codex and Claude mappings plus catalog-only, stale, unwrapped,
   direct/private, unknown-like, exact-schema, and completeness-upgrade regressions.
2. Run the focused test before implementation and record the expected RED result.
3. Commit the failing test.
4. Implement the smallest conformance schema and mapper that passes.
5. Run fail-fast `npx tsc --noEmit -p tsconfig.test.json` before focused tests.
6. Run the focused compiled test, `npx tsc --noEmit`, and `git diff --check`.
7. Append exact command evidence and remaining risks to the Task 3 report.

## Non-claims

- An observed envelope does not prove governed execution, universal traffic completeness,
  provider outcome correctness, or safety.
- The mapper performs no discovery itself and makes no external calls.
- No Eve, Grok, hermetic outcome, live provider, credential, or receipt work is in scope.
