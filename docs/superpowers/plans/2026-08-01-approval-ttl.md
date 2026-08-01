# Approval TTL — expire as a no Implementation Plan (wave Task 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `reelier approve --expires <duration>` stamps a time-to-live into a state-conditioned
approval. At execute time an expired approval is **neither a mismatch nor a pass** — it is its own
reason in the closed registry, and under `state_gate: refuse` it refuses before dispatch.

The operator ask, verbatim: *"approval requests that expire as a no when nobody answers them. With
those two I stopped checking every morning."*

**Architecture:** The TTL lives on `StepExpect`, so it enters the approval hash through the existing
`expect` branch's conditional-spread — meaning a skill that does not use it produces a
byte-identical hash. At execute time an expired binding produces
`stateCheck.outcome: "unevaluated"` with `reason: "approval-expired: …"`, which the **existing**
`state_gate: refuse` branch already refuses. Almost no new gate code.

**Tech Stack:** TypeScript 5.5 ESM, `node:test` + `node:assert/strict`. No new dependencies.

## Two decisions already made — do not re-litigate

1. **TTL applies to `expect:`-bearing steps only.** Founder-ratified 2026-08-01. This is what the
   wave plan actually describes: it says to add `approval-expired` to the `stateCheck.reason`
   registry, and `stateCheck` exists only on `expect:`-bearing steps. A plain approved write with no
   `expect:` cannot carry a TTL. **That is a real limitation and must be documented in SPEC, not
   left silent** — see Task 3.
2. **Clock injection is scoped to the expiry check.** Founder-ratified. Add `now` to the run options
   defaulting to `Date.now()`, following the existing `dryRunSkill(skill, vars, now = Date.now())`
   precedent (`src/runner.ts:452`). **Do not** thread `now` through the 10+ existing `Date.now()`
   calls in `runner.ts` — those feed recorded `ms` values and rewriting them is a regression risk
   for a side quest.

## Global Constraints

- **Never render `absent`, `pending`, or `unevaluated` as a pass.** An expired approval is
  `unevaluated` — it must never read as a pass, and in recorder mode it must not silently look fine.
- **The TTL must be covered by the approval hash.** The existing rule is that hand-editing a binding
  is an approval mismatch at the no-flag-override boundary; a hand-extendable TTL would be a hole.
- **Two controls, one job each — do not blur.** `--probe` (state-drift expiry: the approval dies
  when the world moves) and `--expires` (time expiry) are siblings, not variants. A step may carry
  both. Neither may be implemented in terms of the other.
- **No flag overrides a state-gate refusal.** `--allow-writes` / `--yes` are not consulted.
- **Never let a receipt imply more than it proves.** An expired approval proves the TTL elapsed. It
  does not prove the write would have been wrong.
- **Never lead with cost or speed savings.**
- Baseline: `npm test` → confirm before starting; do a clean build first (`rm -rf dist dist-test`),
  because stale compiled output from a previous checkout will inflate the count.

## File Structure

- **Create** `src/duration.ts` — the duration parser. **No such parser exists anywhere in `src/`**
  (verified). Pure, no IO.
- **Modify** `src/skill.ts` — `StepExpect` gains the field; parser accepts it; serializer emits it.
- **Modify** `src/approval.ts:56-75` — conditional spread inside the `expect` branch.
- **Modify** `src/cli.ts` — `cmdApprove` gains `--expires`, stamps it via `bindStep`.
- **Modify** `src/runner.ts` — the expiry check, `now` option, registry comment at `:132`.
- **Modify** `SPEC.md` — §8.6's closed registry, the `expect` grammar, and the stated limitation.
- **Create** `test/approval-ttl.test.ts`.

---

### Task 1: Parse a duration, and stamp it into the hash

**Interfaces produced:**
```ts
// src/duration.ts
export function parseDuration(input: string): number | null;  // ms, or null when unparseable
// on StepExpect:
expiresAt?: string;   // ISO-8601 instant, absolute — NOT a relative duration
```

**Store an absolute instant, not a duration.** `--expires 24h` is resolved against approve-time and
stamped as an ISO instant. A stored relative duration would silently re-arm every time the file is
read, which is the opposite of expiring.

- [ ] **Step 1: Failing tests for `parseDuration`.** Grammar: `30m`, `24h`, `7d`, and combinations
      are **out of scope** — accept a single integer + unit from `{m, h, d}`. Cover: each unit;
      rejects `0h`, negative, empty, bare number, unknown unit, float, whitespace, absurd values
      (cap at some documented maximum — an approval valid for 100 years is not an approval).
      Returns `null` on every rejection; **never throws**, because the CLI turns `null` into a clean
      usage error and a parser that throws inside the runner would be a trust-layer crash.

- [ ] **Step 2: Failing tests for hash coverage.** These are the load-bearing ones:
      - a step with `expect:` **and no** `expiresAt` hashes **byte-identically** to today. Pin
        against a literal digest captured before the change, exactly as
        `test/expect-probe-args.test.ts:176` does for `probeArgs`.
      - a step with **no `expect:` at all** hashes byte-identically (the two expect-less branches at
        `src/approval.ts:77-84` must be untouched)
      - changing `expiresAt` changes the hash
      - hand-editing `expiresAt` in the file produces an **approval mismatch** at execute time —
        this is the hole the constraint exists to close, so test it end-to-end through `runSkill`,
        not just at the hash function

- [ ] **Step 3: RED, captured.**

- [ ] **Step 4: Implement.** `parseDuration` in `src/duration.ts`. Add `expiresAt?: string` to
      `StepExpect` (`src/skill.ts:57-70`), parse it, serialize it. Add the conditional spread inside
      the `expect` branch object literal at `src/approval.ts:61-73`, alongside the existing
      `fields` / `probeArgs` spreads — same pattern, same reason.

- [ ] **Step 5: Green, full suite, commit.**

---

### Task 2: Expire at execute time, and refuse under the gate

**The mechanism, and why it is small.** `src/runner.ts:1178-1191` already refuses when
`stateGate === "refuse" && stateCheck.outcome !== "match"`, forcing `action: "refused"`, and per
SPEC the record then carries **no `write` block and no `attest`** — dispatch provably never issued.
So an expired approval that produces `outcome: "unevaluated", reason: "approval-expired: …"` gets
gate-mode refusal **for free**. Do not add a second gate path.

**Where the check goes.** After the approval-hash comparison succeeds (`src/runner.ts:889-896`) —
hash match proves the binding is unmodified, so the TTL you are reading is the approved one — and
inside the `stateCheck` construction block (`:1057+`), as an **early branch before the probe runs**.
Expiry is a pre-probe fact; probing a binding that has already expired wastes a call and can emit a
misleading `probe-failed`.

- [ ] **Step 1: Failing tests** in `test/approval-ttl.test.ts`, following the shape of
      `test/state-gate.test.ts:243-262` (which asserts the exact reason substring in `failures[0]`
      via `assert.match`):
      - **recorder mode:** an expired approval **executes** and stamps the finding —
        `stateCheck.outcome === "unevaluated"`, `reason` matching `/approval-expired/`,
        `action === "stamped"`. The write **does** dispatch. This is the "two controls, one job
        each" rule: recorder records, gate refuses.
      - **gate mode (`state_gate: refuse`):** the step is `failed`, `stateCheck.action === "refused"`,
        and the record carries **no `write` block and no `attest`** — assert their absence
        explicitly; that is the proof the call never went out.
      - **not expired** → normal behaviour, byte-identical record to a no-TTL run.
      - **exactly at the boundary** — pick strict `>` or `>=` and pin it. State the choice in SPEC.
      - **no flag overrides it:** `--allow-writes` and `--yes` do not rescue an expired approval
        under the gate.
      - **expiry is checked before the probe:** with a tool that would fail if probed, an expired
        binding still reports `approval-expired`, not `probe-failed`. Assert the probe tool was
        never called.
      - **`--probe` and `--expires` compose:** a step carrying both, expired, reports
        `approval-expired`; a step carrying both, unexpired but state-drifted, reports `mismatch`.
        Neither swallows the other.
      - **injected clock:** every one of these uses the injected `now`, not wall time.

- [ ] **Step 2: RED, captured.**

- [ ] **Step 3: Implement.** Add `now?: number` to the run options (default `Date.now()`), following
      `dryRunSkill`'s precedent. Add the early expiry branch. Update the **stale** registry comment
      at `src/runner.ts:132` — it currently lists five values and the real registry has six, so it
      is already wrong before your change; make it seven and correct.

- [ ] **Step 4: Green, full suite, commit.**

---

### Task 3: The rubber-stamp story, and SPEC

**Answer the critique in the same slice.** The operator who asked for TTL expiry also flagged the
decay mode, unprompted and correctly:

> *"every benign change, a model version bump, a schema tweak, invalidates the chain and people
> learn to rubber-stamp the re-approval."*

That is a real failure mode, **it is not documented as a risk anywhere**, and 0.26.0's
`expect.fields` (narrow the projection so benign changes do not fire) is the answer nobody has been
told. Shipping TTL expiry without this makes the decay mode *worse* — now there are two clocks
invalidating approvals.

- [ ] **Step 1: Write the crisp story** into `docs/specs/trust-ladder-v1.md` or the state-approval
      spec — pick whichever already owns the approval ceremony and say why. It must cover:
      - **which field classes to project**: version-class fields (bump constantly, carry no meaning
        for the decision) vs named content fields (the thing you actually approved) vs
        background-mutated noise (counters, timestamps, ETags)
      - the **fixed-point property**, stated plainly: *the projection should change when the thing
        you care about changes, and not otherwise.* A projection that fires on every deploy trains
        the operator to stamp without reading, which is strictly worse than no approval at all.
      - a worked before/after: a binding over a whole response body vs the same binding narrowed
        with `expect.fields`, and what each does on a version bump.
      - how TTL interacts: a TTL is a **deliberate** re-approval cadence; projection drift is an
        **accidental** one. Narrow the projection first, then choose a TTL you are willing to honour.

- [ ] **Step 2: SPEC.md.**
      - §8.6's closed registry: add `approval-expired: …` as the seventh value, with its exact
        string shape.
      - The `expect:` grammar: document `expiresAt`, that it is an absolute ISO instant resolved at
        approve time, that it is covered by the approval hash, and the boundary semantics you chose.
      - **Document the limitation explicitly:** a TTL requires `expect:`. A plain approved write
        cannot expire. State it as a known scope boundary with the reason (the finding surface is
        `stateCheck`, which only expect-bearing steps carry) rather than leaving a third party to
        discover it.
      - `test/spec-record-shape.test.ts` will not fire here — no `StepRecord` field is added — but
        run it and confirm.

- [ ] **Step 3: CLI usage + commit.** Update `cmdApprove`'s usage string (`src/cli.ts:1743`) and the
      `--expires` help text. Reject `--expires` on a step with no `expect:` with a clear error
      naming the limitation, rather than silently accepting and never expiring.

## Task exit gate

- [ ] A TTL survives a round trip through approve → run.
- [ ] A hand-edited TTL fails the approval hash — tested end-to-end, not just at the hash function.
- [ ] Expired + `state_gate: refuse` produces **no `write` block and no `attest`** on the record.
- [ ] Recorder mode stamps and executes; gate mode refuses. Neither blurs into the other.
- [ ] Expiry is checked before the probe, proven by the probe tool never being called.
- [ ] `--probe` and `--expires` compose without either swallowing the other.
- [ ] A skill not using `expiresAt` hashes byte-identically, pinned against a literal digest.
- [ ] The rubber-stamp story is written down, and the expect-only limitation is in SPEC.
