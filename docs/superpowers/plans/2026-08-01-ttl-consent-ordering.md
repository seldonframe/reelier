# Show the TTL instant before the consent prompt (issue #77)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `reelier approve --expires` currently prints the resolved deadline **after** the operator
has already answered. Print it **before**, so they agree to a date rather than to arithmetic.

**Architecture:** One shared resolver, two call sites. The instant is currently computed inside
`bindStep`; extract it so the pre-prompt line and the write use the *same* value by construction,
rather than two expressions that could drift apart.

**Tech Stack:** TypeScript ESM, `node:test`. No new dependencies.

## Why this is worth doing (from the review that found it)

- **The re-stamp path already does it right** (`src/cli.ts:2273-2278` prints before the prompt).
  That says the ordering was reasoned about once and not carried across — not that it was rejected.
- **The asymmetry runs backwards.** The operator *renewing* a deadline they already understand sees
  the date first. The operator meeting the control *for the first time* sees it only after
  committing.
- **`--expires 7d` resolves against the observation time**, not wall-clock-now. That is exactly the
  arithmetic nobody does in their head, and a date shown afterwards is a date you cannot decline.

## Global Constraints

- **Scope is the pre-prompt line only.** Leave `bindStep`'s echo — it is the record of the value
  actually written, and it stays because the two serve different purposes (preview vs. receipt).
- **The previewed instant and the written instant must be the same value**, not two computations
  that happen to agree today. That is the whole reason for the extraction.
- **`--all` must keep working unchanged.** It auto-answers; the line still prints.
- **Never render `absent` as a pass.** A step with no TTL prints no expiry line — it must not print
  "expires: never" or similar, which would read as a deliberate choice rather than an absence.
- **Never lead with cost or speed savings.**
- Baseline: clean build first (`rm -rf dist dist-test`), then `npm test`. Record the count.

## The three call sites (verified 2026-08-01)

| Path | Prompt | `bindStep` | Currently prints instant |
|---|---|---|---|
| fresh bind | `src/cli.ts:2514` | `:2520` | **after** — wrong |
| re-bind after drift | `:2333` | `:2350` | **after** — wrong |
| re-stamp (TTL change only) | `:2273-2278` | — | **before** — already correct |

`bindStep` computes the instant at `src/cli.ts:1946-1947`:
```ts
const carriedExpiresAt = step.expect?.expiresAt;
const expiresAt = expiresMs !== undefined ? new Date(observedAtMs + expiresMs).toISOString() : carriedExpiresAt;
```

---

### Task 1: Extract the resolver, preview it, prove the ordering

**Files:** `src/cli.ts`, `test/approval-ttl.test.ts`, `docs/REFERENCE.md`, `SPEC.md`

- [ ] **Step 1: Write the failing tests.** The existing test (`test/approval-ttl.test.ts:791`)
      asserts only that the instant appears *somewhere* in captured output, and runs under `--all`
      where the prompt is auto-answered — which is exactly why it could not catch this. Add tests
      that assert **ordering**, not mere presence:
      - fresh bind: the index of the `expires:` line is **less than** the index of the
        `Approve this step against this observed state?` prompt in the captured output
      - re-bind after drift: same, against the `Re-bind this approval to the current state?` prompt
      - the previewed instant and the instant written into the file are **byte-identical**
      - a step with **no** TTL prints no expiry line at all before the prompt
      - a carried-forward TTL that has already elapsed still says so before the prompt
      - `--all` still prints the line (it auto-answers; it does not suppress output)

      Also **fix the misleading assertion message** at `:791`, which currently says "on the consent
      line" — the claim this issue exists to make true, asserted before it was.

- [ ] **Step 2: RED, captured.** The ordering assertions must fail against today's code, and fail
      *because the index comparison is wrong*, not because the string is missing. Confirm that.

- [ ] **Step 3: Extract `resolveExpiresAt`.** A small pure function beside `bindStep`:
      ```ts
      function resolveExpiresAt(
        step: Step, observedAtMs: number, expiresMs: number | undefined
      ): { expiresAt: string | undefined; source: "new" | "carried" | "none"; elapsed: boolean };
      ```
      `bindStep` calls it instead of computing inline. The `source` and `elapsed` fields exist so
      both the preview and the echo can render the same three cases without re-deriving them.

- [ ] **Step 4: Print before the prompt** on the fresh-bind and re-bind paths, immediately after
      the existing `console.log(\`  ${state}\`)` line. Reuse the wording already in `bindStep` so the
      operator sees the same sentence twice rather than two different phrasings — including the
      ALREADY ELAPSED warning for a carried instant. Print nothing when `source === "none"`.

- [ ] **Step 5: Green, full suite, then the docs.**
      - `docs/REFERENCE.md` — update the `--expires` description if it describes the ordering.
      - **`SPEC.md` §6.1c's `[Reference implementation]` paragraph describes the current (wrong)
        ordering and MUST move in this PR**, or the spec goes stale in the other direction. It is
        marked reference, not normative, so this is a description change — but leaving it is how
        the next reader concludes the CLI is broken.

- [ ] **Step 6: Commit.**

## Exit gate

- [ ] Ordering is asserted by index comparison, on both paths, and the assertions fail on old code.
- [ ] Previewed instant === written instant, proven by test, not by inspection.
- [ ] No expiry line when there is no TTL.
- [ ] `SPEC.md` §6.1c no longer describes the old ordering.
- [ ] Full suite green; badge updated if the count moved.
