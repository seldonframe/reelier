---
name: reelier-slice
description: Use when implementing any change to the Reelier authority ledger or Path C compiled-authority code - encodes the evidence-led slice loop, the baseline gate, the RED/GREEN review protocol, and the failure modes that have actually cost slices here.
---

# Reelier slice loop

The authority ledger punishes reasoning that was not measured. In one session four confident
estimates were each refuted by running something: "15 missing fault points" (34), "the transitions
exist so this is mostly emission" (half needed new mechanism), "opening this gate unlocks 22 tests"
(it cost 22), and "this committed pin is the acceptance criterion" (it was unsatisfiable by any
implementation). Every one was caught by a measurement that took under two minutes.

**The rule: the plan fixes the sequence of gates, never the outcomes. Measure, then decide.**

## The loop

Run every step. Do not skip 4 or 9 because the change looks small — both have caught defects in
two-line diffs.

1. **Measure the baseline.** `node scripts/baseline-diff.mjs --save` on a quiet machine.
2. **Identify the smallest behaviour gap.** One point, one boundary, one invariant.
3. **Add RED tests** — or identify existing committed ones. Then verify they are *satisfiable*
   (below).
4. **Independent RED review** (fresh subagents). Non-negotiable; see the lens set.
5. **Implement the smallest change.**
6. **Focused tests** — `--test-name-pattern` on the affected family.
7. **Compare against baseline** — `node scripts/baseline-diff.mjs`.
8. **Broader suite** — `npm test` when the change touches shared code or exported surface.
9. **Independent GREEN review.**
10. **Commit only if shippable.** A change that adds public surface and greens nothing is not
    shippable — revert it and record why.

## The gate

**Pass count must not drop, and the failing set must gain no names.** `baseline-diff` enforces both.

If it fails, the default is to **revert and record the measurement**, not to argue with it. A
reverted slice with a written finding is a good outcome; it is how the housekeeping-permission
question was located.

## Verify a pin is satisfiable before treating it as a goal

A test that injects at a fault point absent from `src/` fails because its injector never fires. It
looks identical to an honest RED pin in a suite run, and no implementation of its subject can turn
it green.

```bash
npm run lint:fault-pins
```

Also check by hand, because the linter only covers fault points:

- Does the fixture reach the code path? A pin can target a real boundary the test's *operation* never
  executes. `observeClock` and `recover` differ in what they may do.
- Does the fixture assert a value the product can produce? One pin hard-coded a ticket the monotonic
  floor makes unreachable.
- Do two committed pins contradict each other? Two asserted different results for the same root
  shape. Neither is a bug to fix silently — that is a decision to escalate.

## Review protocol

Fresh subagents, always adversarial, always grounded in a file+line or a reproducible run.

**RED review** — two or three lenses:

- *Does it fail for the right reason?* Run it; read the failing assertion; confirm the failure is the
  absent behaviour and not a fixture defect.
- *Could a wrong implementation also pass?* **The highest-value question.** Ask the reviewer to
  patch the build both ways and measure. This caught a pin that passed under both the correct and
  the incorrect placement of the same one-line change.
- *Blast radius* of the pin itself, especially anything touching an exported array or type union.

**GREEN review** — two lenses:

- *Correctness and spec conformance* of the change, including branch mutual-exclusion and per-attempt
  pairing.
- *ABI and blast radius*: does the value reach `ledgerFaultPoints` or `LedgerFaultPoint`? Additive at
  runtime can still be source-breaking for a consumer that narrows on the type.

**Design review** for any slice needing new mechanism. Give it a candidate bound and require it to
build and measure alternatives rather than reason about them.

## Environment failure modes

- **Never run the suite alongside subagents.** A loaded machine crashes child processes in the
  100-process test and fabricates regressions. A baseline taken under load reported 411 as 410 and
  produced a phantom failure. `baseline-diff` refuses above 35% CPU busy.
- **A crashed child is an environment signal.** `Error: child <pid>: 3221226505` is Windows
  `STATUS_STACK_BUFFER_OVERRUN`, never an assertion. Re-run in isolation before calling it a
  regression.
- **The Bash tool's cwd silently resets** to the primary checkout after background-task
  notifications. Prefix every command with an explicit `cd` to the worktree; confirm with
  `node -p "require('./package.json').version"` (worktree 0.30.0, primary 0.29.x).

## Authority

The signed spec `docs/specs/compiled-authority-v1.md` is the contract. Tests are evidence of
implementation behaviour.

When they disagree, **stop and record the discrepancy in the spec beside the relevant rule, with the
measurement attached** — do not silently change either side. Hard-stop and escalate rather than
decide alone when resolving it would delete or weaken a committed pin, or invert a sentence the owner
signed off.

Verified numbers live in `docs/REELIER-NUMBERS.md`, each with a command that reproduces it. Re-run
the command before quoting the number; two inherited numbers were wrong in a single session.
