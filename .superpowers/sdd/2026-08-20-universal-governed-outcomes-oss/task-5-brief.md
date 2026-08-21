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
- Modify `test/authority/local-multi-definition-jobs.test.ts`.
- Modify files under `conformance/continuity-adapter/v1/eve-fixture/agent/` and `conformance/continuity-adapter/v1/eve-fixture/tests/` only as needed for the four-tool adapter.
- Create `test/continuity/eve-governed-outcomes.test.ts`.
- Create `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-5-report.md`.

**Requirements:**

Define agent status, Outcome proposal, Outcome request, and Outcome status once in a closed canonical contract and project the same semantics to MCP, HTTP/OpenAPI, and Eve. Retain legacy job tools unchanged until a separate public removal. The new adapter exposes only the new quartet. Opaque references remain authenticated task/session/Cell-bound; raw aliases and provider identities never become callable. Tenant, account, destination, provider status IDs, GitHub merge policy, Linear target states, credentials, and signing keys remain host-owned.

Add a harness capability descriptor so Eve, Codex, Claude Code, Cursor, Grok, and Hermes can be certified against the same request/response ABI without provider-pack changes. The descriptor certifies protocol/transport capability only; it does not claim the named harness was live-tested unless its fixture passed.

Update the Eve 0.39.0 deterministic mock fixture to execute one composite GitHub+Linear mission and one Linear-only mission with fresh mission, grant, allocation, session, and authority identities. Exercise process restart and ambiguity through the ordinary quartet. Prove one standing activation, zero routine approvals, exactly two reconciled Outcomes, provider no-resend, no credentials/raw prompts/model reasoning in durable records or fixture logs, and two Outcomes per one post-run review. The real-process test may skip only with a precise missing Eve/native prerequisite; hermetic behavior must never skip.

Use strict RED/GREEN TDD and `apply_patch`. Reuse frozen contracts/kernel/transports/packs; do not add provider-specific branches to ingress or agent tools. Commit logical units. Run focused ingress/host/continuity tests, both typechecks, build, authority/package/adapter/bootstrap contracts, full suite honest status, diff check, and independent review. No external provider writes, push, merge, tag, publication, or subagents.
