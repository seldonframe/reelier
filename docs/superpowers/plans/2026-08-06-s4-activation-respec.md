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

**The seven activation clauses hold, or fail only into recorded, owner-visible bounds. The flip
may proceed on this evidence.** The predecessor's blocker (clause 5's crash half — option-ON
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
3. **Permanently bounded busy from ALL entries — the one activation regression, pinned:**
   `slot + dead sub-complete publication stage` (hard exits at the five stage-construction
   boundaries). No granted route touches it; the committed GREEN pin `:1020` ("dead exact slot
   plus same-owner stage is recoverable but unsupported") REQUIRES the preservation, and
   unwedging it is the ungranted housekeeping-permission question. **Pre-flip, the same crash
   self-heals** (lone dead stage, settlement service). Post-flip it is a permanently-busy root
   until a route is granted. This is the owner-visible bound the flip accepts by proceeding;
   the spec's crash-topology sentence ("recoverable only through the typed atomic withdrawal
   protocol") names the shape of the eventual grant.
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
