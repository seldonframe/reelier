# Flight Recorder v2 — Spec

_Drafted 2026-07-22. Three features, all from one dev.to comment (Mads Hansen, on the snapshot-testing post): a per-skill **manifest** with fail-closed preflight, **operation-scoped write approval** replacing blanket `--allow-writes` as the final boundary, and a **mocked-failure replay mode**. Together they make the three-test taxonomy real — and the taxonomy itself (credited) goes in the docs:_

- _replay against recorded expectations → **workflow determinism**_
- _replay against injected failures → **recovery behavior**_
- _replay against live read-only dependencies → **environment drift**_

**Prime directive split (the v1 directive, applied precisely):** record-time capture must never break the plane — manifest capture that fails degrades to omission + a visible gap marker, never an error to the agent. Replay/CI is the *check* side: failing closed there is its entire job. Fail-open at the recorder, fail-closed at the gate.

---

## 1. Per-skill manifest + fail-closed preflight (drift, caught before step 1)

**Job:** byte-identical replay can still be wrong if the world changed. Before replay, prove the tools are still the tools that were recorded — tool present, input schema unchanged — and fail closed with a named drift instead of a mid-replay assertion blowup.

**Mechanics:**
- **Digest:** `sha256:` + SHA-256 hex of the tool's `inputSchema` serialized as *canonical JSON* (recursive key sort — plain `JSON.stringify` is insertion-ordered and unstable). One new helper `digestToolSchema(inputSchema)` following the existing `createHash("sha256")` pattern (cli.ts).
- **Capture at wrap time (fail-open):** the proxy already holds every downstream tool's `inputSchema` (`DownstreamTool`, mcp-client.ts:12–20; routes at buildToolRoutes, 150–165). Extend the trace meta record (the `collectToolAnnotations` seam, recorder.ts:231–243) with per-tool `schemaDigest` + best-effort server identity from the MCP handshake (`serverInfo.name`/`version` when present — omitted, never guessed). Capture failure = omit + gap marker.
- **Stamp at skill-creation time:** `from-session`/compile threads digests from the trace meta into a new optional `Skill.manifest`; `serializeSkill` (writeback.ts:95–117) writes it as ONE frontmatter key holding single-line canonical JSON:
  ```
  manifest: {"v":1,"tools":[{"name":"crm.create_contact","server":"seldonframe","digest":"sha256:ab12…"}]}
  ```
  Only tools **used by the skill's steps** — drift in unused tools must not fail a replay. The frontmatter parser stays flat: one new key, `JSON.parse` the value.
- **`reelier manifest <skill.md> --wrap …`:** stamps/refreshes the manifest from live servers — covers hand-authored skills (no trace to inherit from) and the legitimate-upgrade path after an intentional tool change. Prints old→new digest per tool; refuses to run without `--wrap`.
- **Preflight in `cmdRun`:** `connectDownstream` already calls `listTools` before step 1 (cli.ts:198–199 → mcp-client.ts:88) — zero extra round-trips. After connect, compare the manifest against live digests. Missing tool or digest mismatch → print a structured drift report (per tool: recorded digest, live digest, server) and **exit 1 before step 1 executes**. `--ignore-manifest` is the explicit break-glass (loud warning + `manifestIgnored: true` in the run record). Skill without a manifest → one-line warning, proceed (additive; every existing skill stays valid).

**Design decisions:** manifest lives *in* SKILL.md (single-file portability is what the registry distributes; approval + manifest travel in the same PR diff), not a sidecar. Digest equality only — no semantic schema diffing (a changed schema is drift, full stop; "compatible change" detection is a lie waiting to happen). Preflight is a gate, not analytics: it does not reuse `reelier diff` (which compares run outcomes, diff.ts:34–47).

**Known limits:** server identity is best-effort handshake metadata — two servers exposing identical tool names+schemas are indistinguishable if neither reports `serverInfo`. A manifest stamped against collision-renamed tools (`<i>_<name>`, mcp-client.ts `buildToolRoutes`) records the renamed form; replaying with a different wrap order can rename differently — the drift report names this case explicitly when the digest exists under another tool name.

**Verify:** unit — canonical-JSON stability (key order, nesting, unicode), digest match/mismatch/missing-tool/extra-tool matrix, manifest parse/serialize roundtrip byte-identical for skills without a manifest; e2e — fixture MCP server, record → stamp → replay green, then mutate the fixture's schema → replay exits 1 pre-step-1 with the drift report; `--ignore-manifest` runs and the record says so.

## 2. Writes hardening — op-scoped approval + idempotency keys (the final boundary, narrowed)

**Job:** `--allow-writes` is a blanket yes to *every* write in the skill — too broad to be the final safety boundary. Replace it: each write step carries a human approval bound to the hash of the exact operation, replay refuses anything that drifted from what was approved, and the receipt records what the write actually produced.

**Two hashes, deliberately distinct (state this in the docs, plainly):**
- **Approval hash** — `sha256(canonical JSON {tool, server, argsTemplate})` where `argsTemplate` is the step's args with `{{placeholders}}` **intact**. Binding to filled args would brick every skill that binds a value from a prior step; template-binding means a human approves the *operation shape* — and for fully-static steps the template IS the exact args.
- **Run idempotency key** — `sha256(canonical JSON {tool, server, filledArgs})` computed at execution time, recorded in the receipt. This is the per-run "exact normalized arguments + target environment" identity.

**Mechanics:**
- **`reelier approve <skill.md>`:** finds write steps via the existing effect ladder (`classifyEffect`, effect-verbs.ts:197–221 — covers both `idempotent-write` and `destructive`), shows each one (tool, effect class, normalized args template, server), confirms per step (`--all` for non-interactive), stamps `approve: sha256:<hex>` as a step field (rendered by `renderStepBlock` alongside `effect:`/`assert:`). Approval is a deliberate command, visible in the PR diff — never a side effect of freezing.
- **Replay gate** (replaces the blanket checks at runner.ts:303 and 323–335):
  - `approve:` present + hash matches the step as-loaded → execute; **no flag needed**.
  - `approve:` present + hash mismatch (tool/args-template/server drifted since approval) → **fail closed, always — `--allow-writes` does NOT override.** This is the boundary fix; the flag can widen the legacy path, never the approved path.
  - no `approve:` → legacy behavior (`--allow-writes` / `--allow-destructive` required) + a deprecation warning pointing at `reelier approve`.
  - L2 escalation with patched args (escalate.ts:40–44) re-hashes: patched args that leave the approved template → the write is NOT re-executed at L2 (existing destructive-at-L2 guard, runner.ts:511–513, extends to approval mismatch).
- **Receipt:** `StepRecord` gains optional `write: { idempotencyKey, approved: boolean, resource?: { id?, version? } }`. `resource` extracted from the response body by an honest heuristic — top-level `id`/`_id`/`version`/`etag`/`revision`/`sha` in JSON bodies — omitted when absent, never guessed. The L2 re-execution path (runner.ts:544–548) stamps the same field (today it evaluates and discards — a healed write leaving no record of what it produced is exactly the gap this closes). Duplicate idempotency key within one run → loud warning + both recorded, not a hard fail (rare-legitimate double-writes exist).
- **policy.yml stays the floor:** deny > dry_run > approval. An approved step that a policy denies is still denied.

**Design decisions:** approval lives per-step in SKILL.md (hash-bound, PR-reviewable, headless-CI-safe), not in policy.yml allow-rules (not bound to args — coarser than the ask) and not interactive-at-replay (breaks the CI wedge). Idempotency keys are recorded, not enforced against external state — Reelier has no cross-run ledger in v2 and MCP tools accept no idempotency header; claiming dedup we can't enforce would be a lie. The key makes duplicates *detectable* in receipts; enforcement is v3+ if ever.

**Known limits:** template-bound approval means a malicious/buggy bind can still vary the *values* inside an approved shape — state it; the mitigations are asserts on the binding step and policy deny rules. Resource extraction is a heuristic, labeled as such.

**Verify:** unit — approval-hash stability across serialize/parse roundtrip; match/mismatch/absent × flag matrix (mismatch + `--allow-writes` still refuses); destructive + L2 interactions; idempotency-key computation; resource-heuristic fixtures (present/absent/non-JSON). e2e — approve a fixture write skill → replay green with no flags → edit the step's args → replay fails closed naming the step → re-approve → green; receipt shows `write` block both paths.

## 3. Mocked-failure replay (recovery, tested on purpose)

**Job:** recovery behavior is currently only exercised when the world happens to break. Inject the breakage: replay with a chosen step forced to fail, and watch the real escalation ladder handle it — or not.

**Mechanics:**
- `reelier run <skill> --fail 3` (injected tool error at step 3: status 500, body `reelier: injected failure (--fail 3)`) · `--fail 3=429` (specific status) · repeatable for multiple steps.
- Injection sits in `executeStep` immediately before `tool.run()` (runner.ts:~347): the step's tool call is not dispatched; the synthetic Observation flows into the normal assert/bind evaluation and the **real** L1/L2 escalation ladder (attemptEscalation, runner.ts:437). Testing actual recovery, not a simulation of it. Pass/fail semantics unchanged: if the ladder heals the run, the run passes — that's the point.
- **Honesty markers (never-lies):** the injected `StepRecord` gains `mocked: true`; `RunRecord` gains `mockFailures: [3]`; the CLI banner and step output show INJECTED. **`reelier push` refuses a record with `mockFailures`** (structured error: mock runs are for local recovery testing; a mocked receipt must never sit beside real ones).

**Design decisions:** CLI flag only in v2 — no scenarios file, no failure DSL (YAGNI until someone asks); status-code injection only — no malformed-body/timeout simulation yet (each is a distinct failure class deserving its own honest design, not a rushed generic).

**Verify:** unit — flag parsing (`--fail N`, `--fail N=429`, repeated, invalid), injection short-circuits dispatch (fixture tool records zero calls), records carry `mocked`/`mockFailures`, push refusal; e2e — fixture skill with an L1-healable assert: `--fail` on that step → ladder heals → run passes → record says mocked and push refuses it.

## Non-goals (v2)

Semantic schema diffing · cross-run idempotency enforcement / external-state ledger · policy.yml allow-rules · interactive approval at replay · timeout/malformed-body injection · any change to record-time fail-open behavior · signing (still v1 §6, still gating the banned words).

## Order + effort

1. Manifest + preflight — ~2 days (the drift-CI wedge feature; ships alone if needed)
2. Writes hardening — ~3 days (safety boundary — gets the adversarial review)
3. Mocked-failure replay — ~1–2 days
4. Docs: README three-test taxonomy (credited) + this spec cross-linked — rides slice 3

One branch (`feat/flight-recorder-v2`), sequential slices (shared seams: runner.ts, cli.ts, writeback.ts), one release: **0.19.0**, one `npm publish` at the end.
