### Task 5: Expose the harness-neutral four-tool surface and Eve 0.39 rehearsal fixture

**Base:** `87550ef6`.

**Files:**

- Create `src/authority/host/agent-tools.ts`.
- Create `src/authority/ingress/agent-tool-contracts.ts` and generate MCP/HTTP/OpenAPI projections from it.
- Modify `src/authority/ingress/mcp.ts`.
- Modify `src/authority/ingress/http.ts`.
- Create `src/authority/ingress/openapi.ts`.
- Modify `src/authority/host/local.ts`.
- Modify `src/authority/host/index.ts`.
- Create `test/authority/agent-tools.test.ts`.
- Modify `test/authority/ingress.test.ts` only to extend its exact MCP inventory with the four canonical agent tools while retaining every legacy tool.
- Modify `test/authority/local-multi-definition-jobs.test.ts`.
- Modify files under `conformance/continuity-adapter/v1/eve-fixture/agent/` and `conformance/continuity-adapter/v1/eve-fixture/tests/` only as needed for the four-tool adapter.
- Create `test/continuity/eve-governed-outcomes.test.ts`.
- Create `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-5-report.md`.

**Requirements:**

Define agent status, Outcome proposal, Outcome request, and Outcome status once in a closed canonical contract and project the same semantics to MCP, HTTP/OpenAPI, and Eve. Retain legacy job tools unchanged until a separate public removal. The new adapter exposes only the new quartet. Opaque references remain authenticated task/session/Cell-bound; raw aliases and provider identities never become callable. Tenant, account, destination, provider status IDs, GitHub merge policy, Linear target states, credentials, and signing keys remain host-owned.

Add a harness capability descriptor so Eve, Codex, Claude Code, Cursor, Grok, and Hermes can be certified against the same request/response ABI without provider-pack changes. The descriptor certifies protocol/transport capability only; it does not claim the named harness was live-tested unless its fixture passed.

Update the Eve 0.39.0 deterministic mock fixture to execute one composite GitHub+Linear mission and one Linear-only mission with fresh mission, grant, allocation, session, and authority identities. Exercise process restart and ambiguity through the ordinary quartet. Prove one standing activation, zero routine approvals, exactly two reconciled Outcomes, provider no-resend, no credentials/raw prompts/model reasoning in durable records or fixture logs, and two Outcomes per one post-run review. The real-process test may skip only with a precise missing Eve/native prerequisite; hermetic behavior must never skip.

Use strict RED/GREEN TDD and `apply_patch`. Reuse frozen contracts/kernel/transports/packs; do not add provider-specific branches to ingress or agent tools. Commit logical units. Run focused ingress/host/continuity tests, both typechecks, build, authority/package/adapter/bootstrap contracts, full suite honest status, diff check, and independent review. No external provider writes, push, merge, tag, publication, or subagents.

**Independent-review fix amendment:**

The initial implementation is not accepted because the real Eve test only booted and the hermetic rehearsal used a parallel in-memory lifecycle. Add only these files beyond the original list: `src/authority/host/outcome-kernel-fs-storage.ts`, `src/authority/host/github-linear-mission-runtime.ts`, `test/authority/outcome-kernel-fs-storage.test.ts`, `test/authority/github-linear-mission-runtime.test.ts`, `conformance/continuity-adapter/v1/eve-fixture/agent/lib/agent-tool-schema.ts`, `conformance/continuity-adapter/v1/eve-fixture/scripts/eve-governed-outcomes.mjs`; and modify the fixture's `package.json`, `tests/cell.test.ts`, and `tests/runtime.test.ts`. All four quartet tool files are explicitly in scope. The fixed proof must use the production kernel, reviewed Task 4 pack/transport composition, durable file-backed recovery, actual Eve prompts/tool calls, and artifact-derived assertions. Deterministic local providers are allowed and are not live provider certification. Keep `liveTested: false` unless a verifier-bound fixture evidence artifact exists.

**Post-Task4C replacement amendment:**

The prior Task 5 runtime/storage/rehearsal proof is rejected and must be replaced by the reviewed Task4C signed five-definition composition. One disposable rehearsal creates one fresh genuine signed standing activation/grant/Job Card/Cell lineage shared by both Outcomes. Within it, the two Outcomes must have distinct runtime-derived mission, request, reservation, allocation, Eve process, and Eve session identities; do not fabricate a second authority lineage. Activation confirmation and zero routine approvals must be derived from signed activation/gate artifacts, not report constants.

In addition to the scope above, authorize modification of `src/authority/host/agent-tools.ts`, `src/authority/host/github-linear-mission-runtime.ts`, `src/authority/ingress/agent-tool-contracts.ts`, `src/authority/ingress/http.ts`, `src/authority/ingress/mcp.ts`, `test/authority/agent-tools.test.ts`, `test/authority/ingress.test.ts`, `test/authority/github-linear-mission-runtime.test.ts`, `conformance/continuity-adapter/v1/eve-fixture/agent/agent.ts`, `conformance/continuity-adapter/v1/eve-fixture/agent/lib/cell.ts`, `conformance/continuity-adapter/v1/eve-fixture/scripts/eve-governed-outcomes.mjs`, `conformance/continuity-adapter/v1/eve-fixture/scripts/eve-process.mjs`, `conformance/continuity-adapter/v1/eve-fixture/tests/cell.test.ts`, `test/continuity/eve-binding-static.test.ts`, `test/continuity/eve-governed-outcomes.test.ts`, and `test/continuity/eve-kill-resume.test.ts`. Authorize creation of `test/continuity/support/genuine-governed-eve.ts` and deletion of `conformance/continuity-adapter/v1/eve-fixture/agent/lib/governed-outcomes.ts`.

The Cell router must resolve the current genuine runtime for every request so a post-crash status reaches runtime B, never a captured runtime A. Harden canonical and backend parsing against nested proxies/accessors/symbols and unbounded graphs without executing hostile traps. All real-Eve and matrix waits require bounded terminal timeouts; pre-effect refusal must fail promptly rather than wait for an unreachable provider marker. Keep all four Eve tools on the remote canonical Cell quartet and remove stale request/status branches that bypass opaque-reference discovery. `createSignedJournalOutcomeKernelStorage` remains the genuine mission/effect lifecycle index; the existing file storage constructor is only the reviewed durable receipt-publication port and must not be presented as parallel lifecycle authority.

**Two-target signed-lineage amendment:**

The two missions require different immutable Linear targets: `github-linear` targets `REEL-TEST-1`, while `linear-only` targets `REEL-TEST-2`. One active definition cannot commit two distinct Tool Effect contract, policy, semantic-identity, and idempotency digests. Extend the one standing signed Job Card from five to seven internal definitions: the three existing GitHub definitions, the existing composite Linear comment/status pair, and a new explicit Linear-only comment/status pair. The external canonical quartet and its two context-bound opaque Outcome references do not change. The reviewed authority commits a closed exact mode-to-target map, including workspace, team, project, issue, pre/target status, comment marker, evidence URL/digest, and binding refs. The runtime selects a pair only after resolving the authenticated opaque mode; issue and target fields never enter model input. Each selected status effect consumes only its paired verified comment receipt.

Authorize these additional production/build files: `src/authority/packs/github-linear-outcomes.ts`, `src/authority/host/linear-outcome-runner.ts`, `src/packs/linear-outcomes/manifest.ts`, `src/packs/linear-outcomes/compile.ts`, `src/packs/linear-outcomes/source.ts`, `src/packs/linear-outcomes/index.ts`, `scripts/build-packs.mjs`, and `src/packs/conformance.ts`. Authorize these additional tests: `test/authority/github-linear-outcomes.test.ts`, `test/authority/linear-outcomes-pack.test.ts`, `test/packs/conformance.test.ts`, and `test/acceleration-preflight.test.ts`. The first-party inventory remains twelve packs; the Linear Outcomes manifest grows from two definitions to four and the overall exact alias inventory grows from sixteen to eighteen. `src/authority/pack.ts` is not authorized unless a focused RED proves an endpoint or purity allowlist must change and this scope is amended first. Historical Task4C documents remain unchanged.
