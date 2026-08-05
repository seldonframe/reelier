# Reelier — words that have to mean one thing

**Pinned to `codex/universal-compiled-authority` @ `214801b` (2026-08-05, Batch B checkpoint).**

_Entry criterion: a term is here only because misusing it caused a concrete, traceable error. This is
not a dictionary of the domain — it is the list of words that have already cost time. Each entry says
what went wrong._

---

## Test state

**failing** — a test that runs and fails. **Not** "pending", **not** "skipped".

> Cost: the ledger suite's 90 non-passing tests were called "pending" for most of a session. A
> reviewer flagged it as materially misleading, because reading a still-red pin as "pending" is
> exactly what let an unsatisfiable test survive as a slice's stated acceptance criterion. `node
> --test` reports these as `fail`; there were zero skipped and zero todo.

**pending / skipped** — reserve for what the runner actually reports as skipped or todo.

## Pins

**pin** — a committed test that fixes a behaviour so a later change cannot silently alter it.

**phantom pin** — a pin that no implementation can turn green, because it targets something
unreachable: a fault point absent from `src/`, a value the product cannot produce, or a state its own
fixture cannot reach. **Indistinguishable from an honest failing test in a suite run.**

> Cost: three found in one session. `:954` injected at a fault point absent from `src/`, and was
> handed over as a slice's acceptance criterion. `:1686` hard-coded a ticket the in-process floor
> makes unreachable. `:1639` asserted corruption for a root shape its fixture left legacy-only.
> Detector: `npm run lint:fault-pins`.

**blocked pin** — reachable in principle, but gated behind a decision or an unbuilt mechanism. A
blocked pin is *not* a phantom: it becomes satisfiable once the blocker moves.

## Work shape

**emission** — adding a `this.fault(...)` call at a boundary in code that already performs the
operation. Cheap and mechanical.

**mechanism** — code that performs an operation which does not yet exist. Needs a design review.

> Cost: "the transitions exist, so this is mostly emission" was asserted twice and wrong twice. Half
> the missing fault points needed mechanism. The coordination-cleanup family looked like pure
> emission — both methods implemented the lifecycle — yet the emissions greened nothing, because the
> operation the tests drive could not reach them. **Verify by running, never by reading.**

**slice** — one gated unit of work: smallest change, measured against baseline, reviewed, committed
or reverted. **family** — a group of fault points sharing a spec taxonomy heading. **task** — an SDD
ledger item (3B2, 3C). A family is usually several slices; a task is many.

## Evidence

**measured** — reproduced at the current pin by running a command. **inherited** — carried from an
earlier summary and not re-verified. Inherited numbers are hypotheses.

> Cost: "15 missing fault points" (really 34) and "402 pass" (really 411) were both inherited and
> both repeated as fact. See `docs/REELIER-NUMBERS.md`.

**gate** — the pass/fail check a slice must clear: pass count must not drop and the failing set must
gain no names. Enforced by `npm run baseline`.

**load artifact** — a test failure caused by machine load rather than by the change. On this machine
a crashed child (`3221226505`, Windows `STATUS_STACK_BUFFER_OVERRUN`) is always this, never an
assertion failure.

**fresh-root blindness** — a defect invisible to every test whose fixture starts from an empty
directory, because real roots always carry steady-state residue (at minimum the previous
acquisition's `.released` marker). Detect by probing WARM roots — one real acquisition before the
fixture — from both entry points.

> Cost: six instances so far, each surviving a green suite. The plan docs carry the running
> count: the narrow-drainage revert was the fourth, the warm preparation-stage crash the fifth,
> and the withdrawal family's warm corruption the sixth — that last one additionally pinned in by
> three committed fresh-root pins, which is what created decision D4
> (`docs/superpowers/plans/2026-08-05-withdrawal-chain-measured.md` §4).

> Cost: a baseline taken alongside three subagents reported 411 pass as 410 and produced a phantom
> regression. Always re-run the named test in isolation before believing it.

## Contenders

**publication contender** — an operation seeking the active lock and a semantic callback
(`observeClock`, `reserve`, `bindIngress`). **housekeeping episode** — an operation seeking neither
(`recover`).

> Cost: the distinction was originally keyed on housekeeping *write permission*, which tied fence
> queueing to an unrelated question and made nine specified fault points unreachable. The two are now
> independent; see the open-discrepancy notes in `docs/specs/compiled-authority-v1.md`.

**narrow rule / wide rule** — whether a lock-seeking operation may perform a pre-admission
housekeeping transition. Narrow: only lock-free operations may. Wide: any contender may. The shipped
bound is neither in full — a lock-seeking contender may *advance* a dead preparation's cleanup
lifecycle and perform the granted dead-owner published-slot drainage (exact same-owner lock or
successor present; owner decision 2026-08-05), and nothing else. The abandoned slot family stays
lock-free-only.

## Product

**attest** — prove post-state scope by reading back through a probe tool. Requires a read-back tool
to exist. **emit** — commit the artifact that left, pre-dispatch, when no read-back exists. `emit`
proves what was sent, never that it arrived.

**four-state** — `verified` / `failed` / `unchecked` / `absent`. Never collapse to a boolean, and
never render `absent` or `unchecked` as a pass. This is the single most important property in the
product.

**verified** — proof of *scope*: what changed. Never proof of safety, correctness, or completeness.
No receipt proves that every write was receipted.
