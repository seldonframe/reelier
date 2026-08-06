# S4 — the activation contract, re-specced from Batch C measurements

_Written 2026-08-06 on `codex/universal-compiled-authority` after B2b (the W1 window closed:
recognition, empty-terminal form, creator continuation, dead-owner route), D5(a), and D6(a)
shipped — ledger floor 637/50. Every number here was produced by running a probe on THIS tree;
the predecessor (`2026-08-05-s4-activation-measured.md`) is superseded where they disagree. The
probe is `s4-respec-probe.mjs` (session scratchpad; recipe in §4) — clause counters option OFF
vs ON on clean and legacy-residue roots, and a hard-exit crash sweep at every reachable
boundary, option OFF and ON minted, fresh and warm, each residue driven through default
`observeClock`, option-ON `observeClock`, and `recover()`._

## 1. Verdict

**The seven activation clauses hold, or fail only into recorded, owner-visible bounds — and the
flip was then attempted on this evidence and REVERTED by its stop-rule: see §6.** The clauses
were necessary but not sufficient; the committed default-mode fixture corpus is the blocker the
clause table cannot see. The predecessor's blocker (clause 5's crash half — option-ON
crash residue permanently wedged or corrupt) is CLOSED by B2b for every sub-complete form, and
the remaining non-draining classes are each pinned, recorded bounds that predate this batch —
none is new, none is silent, and none regresses a default-path behavior that works today
except the one named in §3 (the slot+dead-stage window, pinned by committed `:1020`).

## 2. The seven clauses, measured on this tree

Counted on one clean-root `observeClock`, option OFF vs ON, then repeated on a legacy-residue
root (one prior real acquisition's steady-state `.released` marker).

| # | clause | status | evidence (measured this tree) |
|---|---|---|---|
| 1 | fence, classify, create only on an admission-ready empty root | **holds** | busy-exit probe: an option-ON acquisition over a live foreign stage refuses `busy` byte-identically, zero mutation (committed pins agree) |
| 2 | no K1 initial-enumeration hook on clean roots | **holds** | `k1Initial: 0` both paths, clean and legacy |
| 3 | single post-validation semantic clock read | **holds** | `semanticNow: 1` both paths, clean and legacy |
| 4 | one stage, one lock-root-sync, one lock-retire per success | **holds** | `stage: 1, lockRootSync: 1, lockRetire: 1, callbacks: 1` both paths (option ON adds `slotRetireRootSync: 1` — the slot lifecycle, by design) |
| 5 | full drainage on success, on busy exits, and on crash | **holds with recorded bounds** | success residue byte-identical both paths (`.released` alone, clean AND legacy roots); busy exits zero-mutation both paths; the crash half in §3 |
| 6 | preserved-in-place corruption for self-created preparations | **holds** | the committed tamper pins (unchanged by Batch C) |
| 7 | legacy-residue roots take the legacy path byte-identically | **holds observationally** | legacy-root success result and residue identical to clean-root, both paths — the drain-first mechanism the predecessor documented is unchanged |

Boundary-firing totals (all injector firings on one success, this probe's basis): 43 option OFF
vs 67 option ON — a 1.56× firing amplification. The predecessor's 7-vs-23 counted durable write
barriers only; the two bases are not comparable, and the durable-write ratio was not re-derived
here.

## 3. The crash table — what a hard exit leaves, and what heals it

The Batch C boundary sweep (this probe plus the 990-trial task 1(i) record and the B2b GREEN
review's 82-cell matrix) partitions every option-ON crash residue into exactly these classes:

1. **Drains from every entry point** (warm and fresh): the whole withdrawal chain — W1 windows
   (all three sub-complete states, including empty via the empty-terminal form), crash-matrix
   states 1–8, both marker-owner-remove windows, the aborted-terminal form, slot+lock (the
   granted published drainage), and every coordination-cleanup crash window. **This is the class
   the predecessor's verdict called the blocker; it is closed.**
2. **Recover-only (the ungranted housekeeping-permission class, pinned red by design):** dead
   preps (all states), bare dead slots, slot + same-owner `publication-aborted` (the complete-form
   W1 window: the marker drains as inert legacy, then the bare slot is the recover-reserved
   `abandoned` family). Default `observeClock` preserves bounded `busy`; `recover()` heals. The
   committed dead-* family and `:1748` pin exactly this bound and STAY RED on the flip.
3. **~~Permanently bounded busy from ALL entries — the one activation regression~~ — CLOSED
   2026-08-06 (Batch D, the dead-stage withdrawal grant).** `slot + dead publication stage`
   (hard exits at the five stage-construction boundaries) was permanently bounded busy from
   `observeClock` AND `recover()`, warm and fresh — re-measured this batch at 20/20 stage cells
   (five boundaries × warm/fresh × both entries) before the fix. The granted route now withdraws the dead stage through the typed atomic protocol the
   spec's crash-topology sentence named ("recoverable only through the typed atomic withdrawal
   protocol"): sub-complete stages mint the W1 window and the shipped chain drains everything
   (`observeClock` completes); complete stages mint the `.publication-aborted` terminal, which
   drains to the bare slot — still bounded busy for a lock-seeking contender, now healed by
   `recover()`. The committed pin `:1020` flipped in the same commit, named. **What remains
   ungranted and is NOT closed by this:** `observeClock` still holds no abandoned-slot retirement
   authority, so the bare slot left by the complete form is recover-reserved — the standing
   housekeeping-permission question, with the `dead-*` family and `:1748` still red by design.
4. **Option-independent, fail-closed by the journal's own rule:** a crash between the semantic
   clock file's create and write (`clock-after-create`/`clock-before-write`) leaves a truncated
   journal entry that refuses every later entry as `corruption` — measured IDENTICAL with the
   option off, so activation neither adds nor removes it. Recorded, out of scope.

The full per-boundary table (option OFF and ON minted, warm and fresh, three entries each) is
the probe's JSONL; §4 rebuilds it. **The sweep on this tree: 516 crash cells, zero probe
errors, zero unfired boundaries, and ZERO cells outside the four classes above** — 354 cells
drain clean from every entry (including every slot+lock cell via the granted published
drainage), the dead-prep and bare-slot cells split exactly default/option-busy vs
recover-clean (class 2), the 66 slot+dead-stage cells are busy from all three entries
(class 3), and the 24 clock cells are corruption from all three entries at both mints
(class 4). The option-OFF sweep confirms the legacy path's crash behavior is unchanged by
everything Batch C shipped.

## 4. Re-measuring this file

Ten-minute rebuilds, per the probe convention (describe, do not ship): the clause counters are
one recording-injector `observeClock` per cell over `dist-test/src/authority/host/fs-ledger.js`
with `{now,lockTimeoutMs}` and the option symbol; the crash table is the committed crash-child
pattern (`--input-type=module -e`, hard exit at the target point) on a `bindableTempRoot`-style
root, warm = one prior real acquisition, then each entry driven with a 3-attempt busy settle.

## 5. The activation contract, restated from measured behavior

Flipping `parseK1AdmissionPreparationRuntime`'s default (`undefined` → enabled) commits the
default path to: the K1 admission slot lifecycle on every acquisition (clauses 2–4 exact); the
same success residue and busy-exit behavior as today's default (clause 5's measured halves);
crash healing per §3's classes — full drainage for the withdrawal chain, recover-only for the
dead-* family, the pinned `:1020` busy bound for slot+dead-stage, and the option-independent
journal window. What the flip does NOT change: content correctness (never in scope), the
housekeeping-permission reds (`dead-*`, `:1748` — they pin the flip's own bound), D2's two
corruption lineages, and the completeness question. Expected green movers, by name, from the
committed default-path corpus (the S4 plan's hypothesis — verify by running at the flip):
`:1653`, `:1670`, `:1672`, `:1786`, `:1790`, `:1822`, `:936`.

## 6. THE FLIP WAS ATTEMPTED AND REVERTED — the stop-rule fired, recorded 2026-08-06

The one-line inversion was applied and gated on this tree. **The expected-green hypothesis was
RIGHT — all seven named movers went green, plus 21 more (28 newly passing).** But the gate also
produced **30 newly-FAILING names, including committed green pins**, so the flip was reverted
per the stop-rule ("a flip that moves any committed pin is reverted and recorded, not argued
with"). The floor restored clean at 637/50. Two failure mechanisms, both then verified by
measurement against a compiled-build patch:

1. **Signal-doubling.** Default-mode drives that count the two chain signals now ALSO count the
   acquisition's OWN K1 slot lifecycle: the healing acquisition retires its own published slot
   and fires `after-admission-slot-retire-cleanup-root-sync` a second time. Measured: `:1746`
   fails `2 !== 1` at its in-callback `slotSyncs` assertion. The same class takes the B2b
   dead-chain, dead-W1, and continuation families (their completing entries are default-mode).
2. **Fixture-premise shift.** Default-mode mint children now run the full K1 path, and B2b's
   own continuation HEALS the residue the fixture wants to seed: the lone-withdrawal family's
   mint asserts "the dead creator left its withdrawal marker" and fails — post-flip the child's
   terminal path completes its own chain and leaves nothing. Other members of the class: the
   `:1728`/`:1733` sealing families (children now create slots first), "two ledger instances in
   one PID", the reused-root class, and — definitionally — "the admission-preparation option
   leaves default clean-root behaviour untouched", which pins option-off === default-off and
   MUST flip with any activation.

**What the owner must decide.** The flip needs a preparatory fixture-migration slice that the
batch's staged-retirement sequence placed AFTER it: ~30 committed default-mode fixtures must
either construct with an explicit option-OFF value (preserving their pinned pre-flip semantics
— but no OFF value exists: the parser recognizes only absence and the one ON literal, so the
migration needs an explicit disable form first) or be re-fixtured to the flipped default's
semantics (signal counts +1, mint recipes changed — committed-pin edits beyond any current
grant). Either way it is committed-pin movement only the owner can sanction. Proposed order
for the next batch: (i) add an explicit `{mode:"legacy"}`-style disable value (or re-fixture
with new signal counts, the honest-but-larger option), (ii) migrate the ~30 fixtures under a
named grant, (iii) re-apply the flip — its expected-green set is already proven — then
(iv) the option-gated fixture migration and symbol deletion as originally staged.

## 7. Batch D execution record (grants received 2026-08-06; appended per phase)

**Phase 1a shipped.** `{mode:"legacy"}` is recognized as the exact disable value
(`parseK1AdmissionPreparationRuntime`, undefined → false untouched — verified by grep before and
after). The task-1 unknown-value decision, measured then pinned: every committed constructor
passes either nothing or the exact ON literal (zero junk-passers — grepped both the in-process
sites and the child-source templates), so an unrecognized value now throws `TypeError` at
construction, fail closed, before any filesystem access. Two pins, appended after every committed
anchor: "the admission-preparation runtime recognizes the exact legacy disable value"
(green-before/green-after by design — its discrimination, verified by compiled-build patching, is
against a throw implementation that forgets the legacy arm or swaps the arms) and "an
unrecognized admission-preparation runtime value refuses construction with a TypeError" (RED
before, green after; the RED review measured all four wrong shapes caught: missing legacy arm,
retained silent fallback, operation-time deferral, wrong error class). Gate: 637/50 → 639/50,
failing set name-identical, twice; full `npm test` 2,285/51/1 with the one rotating gate member
re-passing in isolation.

**Phase 1b shipped — seven per-family slices, `0bda077..978bb35`.** The work-list was
reproduced FIRST on this tree by the compiled-build A/B: 28 newly passing / 30 newly failing,
matching the Batch C measurement name for name. All 30 migrated line-neutrally (file 3850
lines at every commit; anchors :1746/:1748/:1760/:1777/:1822 verified holding), gate 639/50
name-identical after every slice — one interleaved run fabricated a regression under
back-to-back suite load and two refused at 88–100% CPU, the NUMBERS §3 signature, attributed
by settled re-runs. Migration bijection (GREEN-review verified against all ~340 construction
sites): :955 ×2, :1746, the :1852 hardExit child template, the reused-root family's four, the
lone-withdrawal dead members' three (live subtest untouched), the chain family's
runChain + warm warming (corruption-preservation members untouched), the dead-W1 completing
drive. **Acceptance A/B after the last slice: newly failing = exactly the definitional pin**
(which migrates in the flip's own commit per the grant); **newly passing = 32** — the original
28 plus the four `:1871`-family sync/rename members whose merged name-status clears once the
family's child is pinned. The measured 32-name list is the flip's expected-green set.
Phase-3 riders (GREEN review): `runChain` pins the recover entries and the zero-terminal
member too; the dead-W1 drive line also constructs its recover leaf; the hardExit family's
in-process successor `recover()` at `:1894` stays default-mode, making that family a
cross-mode scenario post-flip — measured green under the A/B, re-fixture deliberately.
