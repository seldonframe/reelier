# Files changed

- `SPEC.md` (new, repo root) — the normative formats specification
- `README.md` — added a one-line pointer to SPEC.md under the intro paragraph

# What changed per file

## SPEC.md (new)

Written from scratch by reading `src/{skill,assert,trace,recorder,runner,compile,redact,writeback,escalate,mcp-client,mcp-tool}.ts` line-by-line plus every `test/*.ts` file's assertions, and cross-referencing the SeldonFrame consumer's independent re-implementation at `packages/crm/src/lib/deployments/replay/trace-format.ts` in the sibling repo (Seldon Frame) for the "SF profile" trace-cap claim in the task brief. Sections, in order, with line counts (`wc -l` equivalent by section boundary):

- **§0 Versioning & compatibility policy** (~45 lines) — npm semver governs format changes; minor-bump-on-additive-shape-change precedent (0.2.0's `escalationAttempted` + honest totals split); states the legacy-derivation rule as normative up front; declares each structure open vs. closed (trace records = closed discriminated union on `t`, tolerant of extra fields within a known type; SKILL.md step bullets = closed 5-key set; non-step sections = open/free-form; RunRecord/StepRecord = open-additive).
- **§1 The five atoms** (~12 lines) — table, matches README's existing table verbatim (verified identical).
- **§2 Trace format** (~140 lines) — full `TraceRecord` union with every field/type, `seq`/`i` ordering rules (monotonic seq from 0, meta-first, call-before-result pairing by shared `i`), redaction (3 rules from `src/redact.ts`, marked SHOULD not MUST since it's documented as conservative/known-incomplete), and the **two-profile size-cap section** (§2.4): reelier's own proxy is verified uncapped (grepped `src/recorder.ts` — no truncation/count-limit code), vs. the SF profile's `TRACE_BODY_MAX_CHARS = 20_000` / `TRACE_MAX_RECORDS = 200` sourced from the sibling repo's `trace-format.ts`, documented as an external storage-layer convention layered on the same wire format, not a different format.
- **§3 SKILL.md format** (~230 lines) — frontmatter requirements (fence rules, required `name`/`description`, unrecognized-key tolerance), step-header/body-splitting grammar, exact field-requiredness table (intent/action/effect required, assert/bind repeatable-optional) with the literal `SkillParseError` message text for every rejection, the `action` line grammar, the **complete assert mini-language table** (every regex form from `src/assert.ts`), the **complete bind mini-language table**, the single-physical-line newline-injection constraint with its two-layer defense (assert.ts regex + escalate.ts `containsNewline`), the closed `effect` enum with the destructive-gating contract (including the L2-never-destructive independent-of-`--yes` rule), and the changelog write-back convention.
- **§4 Run-record format** (~90 lines) — full `StepRecord`/`RunRecord` field tables including `escalationAttempted` vs `level` semantics (stated as an explicit "distinct fields" note with the burned-tokens-but-never-healed example), the totals-honesty rule stated as a normative MUST ("a consumer MUST NOT present an unchecked step... as evidence of a passing check"), and the legacy-derivation rule as an explicit consumer algorithm (check for `totals.unchecked` presence, else derive from `steps[].outcome`).
- **§5 MCP proxy contract** (~45 lines) — the three control tools' schemas/semantics from `src/recorder.ts`'s `ListToolsRequestSchema`/`CallToolRequestSchema` handlers, the 1:1 passthrough + never-redacted-live-path guarantee (with exact line references showing `redact()` is only applied to the trace-write copy, not the returned `result`), and the collision-prefixing rule from `buildToolRoutes`.
- **§6 Runner semantics** (~110 lines) — the L0 loop as a 6-step normative sequence (fill template → destructive gate → execute → evaluate asserts/binds → outcome → conditional bind-merge), an explicit divergence definition, the full L1/L2/L3 ladder description including the `allowDestructive` vs L2-destructive-exclusion independence, and the mandatory-write-back rule (synchronous, before run-record write, non-crashing on FS failure).
- **§7 Conformance** — table mapping each format area to its reference test file(s).
- **Deviations noted** (report-only, not normative) — 5 items, listed below.

## README.md

Added two lines after the intro paragraph, before "## Status": `The formats are specified in [SPEC.md](./SPEC.md) — a normative, RFC-style reference...`. No other README content touched.

# Deviations noted (for the orchestrator — these are observations, not fixes)

1. **No `formatVersion` field on RunRecord/StepRecord** — the only version signal a consumer has is presence/absence of `totals.unchecked`/`totals.skipped`. Works today, fragile against a future non-additive change.
2. **No version field on trace records either**, and the SF profile (`packages/crm/.../trace-format.ts` in the Seldon Frame repo) independently re-implements the same `TraceRecord` union rather than depending on this package — the two are kept in sync by hand, not by a shared type. A future `t` variant added here wouldn't be caught by either side's tests.
3. **`json.<dotpath> > / <` against a non-number silently evaluates to a failed assert, not a thrown error** (`src/assert.ts:134-139`) — documented as actual behavior in the spec, flagged here as a possible ergonomics gap (a stricter validator might reject non-numeric comparisons at L1/L2 patch-validation time; currently only the empty-assertions-stripped check exists there).
4. **Unchecked cast on the MCP proxy's `inputSchema` passthrough** (`src/recorder.ts:163`, `as {type: "object"; ...}`) — if a downstream ever advertised a non-object-typed tool schema this would misrepresent it without validation. No test exercises this.
5. **Control-tool "already recording"/"not recording" responses are plain-text, not `isError: true`** — a caller that only checks `isError` (rather than parsing response text) would treat a rejected `reelier_start_recording`/`reelier_stop_recording` call as a success. Documented as actual behavior; flagged as a naive-client trap.

No code was modified to address any of these, per the task's explicit instruction to only list them.

# Test results (verbatim tail)

```
ℹ tests 95
ℹ suites 0
ℹ pass 95
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1053.3103
```

All 95 pre-existing tests pass unchanged (docs-only change, as expected).

# Grammar verification

Spot-checked every assert form and every bind form in `SPEC.md` §3.4/§3.5 against both the regexes in `src/assert.ts` (read directly) and their exercised cases in `test/assert.test.ts` (including the newline-injection rejection test at line 27-38, which the spec's §3.4 "Single-physical-line constraint" section is built directly from). Step-field requiredness (§3.2 table) was checked against `test/skill.test.ts`'s "rejects a step missing required 'intent'/'action'/'effect'" tests and the corresponding `SkillParseError` message strings in `src/skill.ts:255-263`. Trace field names (§2.2) were checked against the `TraceRecord` union in `src/recorder.ts:15-19` and against the independent SF-side re-implementation in the sibling repo's `trace-format.ts` (used only to source the §2.4 two-profile section, not to alter the core §2.2 table, which is reelier's own).

# Open risks

- The "SF profile" §2.4 content depends on a file in a **different repository** (`Seldon Frame`, not `reelier`) that this repo has no dependency on and no test coverage against — if that consumer's `trace-format.ts` changes its caps, SPEC.md would silently go stale. Flagged in the spec text itself ("Deviation #2") but worth a cross-repo doc-sync note if SPEC.md is meant to be authoritative going forward.
- SPEC.md is fairly long (~830 lines). Task brief asked for "tight" RFC-ish style; I erred toward completeness (every grammar form, every field, cited line numbers) over brevity given the "third parties emit/consume without reading source" bar. If the orchestrator wants it trimmed, the Deviations-noted section and some of the explanatory prose in §6 are the best candidates to cut without losing normative content.
