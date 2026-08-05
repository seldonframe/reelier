# Creator-withdrawal chain — measured, and blocked on two owner decisions

_Written 2026-08-05 (Batch B) at `214801b`, on `codex/universal-compiled-authority`. Every claim
below was produced by running a probe or a test on this tree during this session; the probe recipes
are in §6. This is the Task 1(i) measurement record the Batch B prompt required before the seal
proposal; the normative seal proposal itself is recorded in the spec beside the
"Under-defined — the seal" note. The session STOPPED at the owner checkpoint: the seal needs
sign-off (D1(a)'s own condition), and the measurement surfaced a committed-pin conflict (D4, §4)
that the batch stop-rules reserve to the owner._

---

## 1. Verdict

1. **The chain is pure mechanism, re-verified.** `src/` has no creation site for any
   creator-withdrawal artifact: nothing renames a stage to a withdrawal or `publication-aborted`
   marker on the creator's failure path (it is removed — `finishCreatorPublicationStage`,
   `src/authority/host/fs-ledger.ts:2167`), nothing retires a slot as `withdrawn` (the string is
   never passed to `admissionSlotRetiredName` outside classification), and a dead external stage
   is silently removed, not withdrawn (`removeDeadPublicationStage`, `:2148`).
2. **Classification already recognizes all eight evidence-bound crash states** — every one returns
   bounded `busy` with zero mutation on a fresh root, from both entry points, live or dead owner.
   **Nothing progresses any of them.** The committed eight-state matrix
   (`ledger.test.ts:1760`) is red because the progression side does not exist, not because
   recognition is missing.
3. **NEW measured defect — the sixth fresh-root-blindness instance.** On a warm root (one prior
   successful acquisition, steady-state unrelated `.released` marker present), every one of those
   same residues classifies **permanent `corruption` from both entry points**, live or dead. And
   unlike the warm-prep instance Batch A fixed, this one is **pinned in by three committed
   subtests** (§4) — extending the released-only tolerance flips them, so it is an owner decision
   (D4), not a slice.
4. The seal semantics are proposed in the spec from these measurements (Task 1(ii)); the six
   points stay unemitted pending sign-off, per the D1(a) grant sentence.

## 2. What was measured

All fixtures byte-replicate the committed test helpers; owners marked "live" use the probing
process's own pid (as the committed fixtures do), "dead" a reaped child pid. "Warm" roots took one
real successful `observeClock()` acquisition first. Both entry points were driven.

| Shape | fresh, live | fresh, dead | warm (either) |
|---|---|---|---|
| All eight `:1760` states | `busy`, zero mutation | `busy`, zero mutation | **`corruption`**, both entry points |
| `:1022`/`:1746` graph (`publication-aborted` terminal + `withdrawn` slot + bound slot-ack) | `busy` (matches `:1022`) | `busy` (the D1(a) dead-owner route does not exist yet) | **`corruption`** |
| Bare fixed slot + same-owner creator-withdrawal marker (W1) | `corruption` | `corruption` | — |
| Bare fixed slot + same-owner `publication-aborted` marker (W2) | `busy` | `busy` via observe; **fully drained** via `recover()` (the granted drainage: pre-classification drain + abandoned route) | — |
| Withdrawal graph + SAME-owner `released` (W3) | `corruption` (correct: impossible lineage) | — | — |
| Lone `publication-aborted` marker, no graph (P5) | drained by the legacy machinery, `advanced`/`equal` | same | same |
| Dead external publication stage, all four states (P4) | — | stage **removed** (`rm`), never withdrawn; `advanced`; the fault points `:1676` demands never fire | — |
| Creator stage-construction failure, default path, all four boundary states (P3) | stage validated then **removed** (`before-creator-stage-withdrawal-validation` → `before-publication-stage-remove-attempt` → `after-publication-stage-cleanup-root-sync`); terminal error preserved by identity; no marker | — | — |
| K1 option-ON creator failure after slot creation (P6) | stage removed, **bare slot left behind**, no withdrawal; residue then `busy` for the live owner | — | — |

## 3. The transition map — exists vs missing

**Exists (classification, `src/authority/host/fs-ledger.ts`):** the withdrawal-graph guard branches
(`:1697-1719`), ack binding and monotonicity (`:1781`, `:1800-1805`), the creator-withdrawal
cleanup-stage validator (`:1876-1881`), the orphan finals (`:1887-1918`), and the withdrawn-slot
terminal rule accepting either the creator-withdrawal marker or the same-owner
`publication-aborted` marker (`:1801`, `:1710`).

**Missing (mechanism, in dependency order):**

1. **The creator's failure-path withdrawal** replacing stage removal in
   `finishCreatorPublicationStage`: seal → atomic whole-directory rename → root sync, with the
   destination decided by the sealed stage state — `complete` →
   `.authority-ledger-lock-<pid>-<nonce>.publication-aborted`; `empty`/`zero`/`partial` →
   `.authority-ledger-creator-withdrawal-…<state>` (pinned by `:1727`, `:1731`, `:972`).
2. **Dead-external-stage withdrawal** replacing the silent `rm` in `removeDeadPublicationStage`
   for a COMPLETE dead stage: atomic rename to that owner's `publication-aborted` marker
   (pinned by `:1676`). Sub-complete dead external stages have no pin; the current authorized
   removal stands unless the owner says otherwise (recorded in the spec proposal).
3. **The K1-path slot chain, marker-first.** Spec :508 makes the same-owner withdrawal marker the
   slot's `withdrawn` retirement authority, so the marker must be durable BEFORE the slot
   retire-rename. That forces the W1 window (bare slot + withdrawal marker) to become a
   recognized in-flight residue — today it is `corruption` (measured), so the chain cannot be
   built crash-safe without that classification change. The complete-stage twin (W2) already
   classifies and drains via the granted published/abandoned drainage machinery.
4. **The cleanup chain, steps 2–7,** creator-side under the fresh cleanup deadline (spec :443),
   plus the residue progression routes granted by D1(a) (the creator's own acquisition; the
   DEAD-owner housekeeping route). `after-creator-withdrawal-cleanup-root-sync` mirrors the slot
   family's `after-admission-slot-retire-cleanup-root-sync` (`:1033`): it fires after the
   withdrawal terminal's marker-removal root sync, before ack removal, and `:1746` orders it
   after the slot's twin and before the callback.
5. **The warm tolerance (D4-gated).** Without it, every transition above works only on
   never-used directories.

## 4. D4 — the withdrawal family's warm-tolerance pin conflict

**The conflict, empirically grounded.** The correct released-only tolerance (the exact
`blockingRetiredResidue` pattern the owner granted the preparation family in Batch A, applied at
the four withdrawal-family sites `:1712`, `:1719`, `:1897`, `:1913` of fs-ledger.ts) was patched
into the compiled build by an independent reviewer. It greens the warm parity family (§5) and
leaves 127 adjacent subtests green — and flips exactly three committed subtests from `corruption`
to `busy`:

- `ledger.test.ts:1141` — "orphan creator-withdrawal final plus unrelated **retired** residue is
  corruption" (the `retired` case seeds an unrelated `.released` marker; the `active` and `k1`
  cases are untouched).
- `ledger.test.ts:1157` — "step-five creator final plus unrelated **retired** residue is
  corruption" (same: only the `retired` case flips; `active` and `publication-stage` hold).
- `ledger.test.ts:1159` — "withdrawn slot lineage plus unrelated released retirement is
  corruption".

Each is the byte-adjacent twin of a busy-pinned fresh shape (`:1135`, `:1140`, `:1156`, `:1158`,
`:1167`), so the corpus **deliberately** pins "unrelated `released` beside withdrawal residue =
corruption" — written before the warm lineage was measured. The committed corpus is internally
consistent but only on fresh directories: on every used root (which always carries a steady-state
unrelated `.released`), those three pins mandate permanently bricking every withdrawal crash
residue, which makes the eight-state matrix (`:1760`, committed, expects `advanced`) and the
D1(a) chain itself satisfiable only on never-used directories.

**Options.**

- **(a) Extend the released-only tolerance to the withdrawal family; the three subtests flip in
  the same commit that ships it, named.** The boundary stays exactly Batch A's: same-owner
  `released` and unrelated `publication-aborted` remain corruption (both measured today, and both
  get their own pins — §5). **Recommended: it is the warm-prep decision applied to the fourth
  family in a row, and without it D1(a)'s own chain cannot complete on any root that has ever
  been used.**
- **(b) Status quo.** The pins stand; the chain (when granted) completes on fresh roots only, and
  every real used-root withdrawal residue stays permanent corruption. This makes Task 1(iv) ship
  a crash window on every used root — worse than not shipping the chain.
- **(c) Wide tolerance.** Refuted by measurement and by the committed neighbors (`:1136`,
  `:1139`, `:1152`); not an option.

**Grant sentence for (a):** "Owner decision: the released-only classification tolerance extends
to the withdrawal family (unrelated `released` markers are inert beside withdrawal-chain residue;
same-owner `released` and unrelated `publication-aborted` stay corruption);
`ledger.test.ts:1141`(retired), `:1157`(retired), and `:1159` flip busy-ward in the same commit,
named, with the warm parity family committed as the guard."

## 5. The reviewed RED family, reverted with this finding

A 16-subtest family ("withdrawal-family crash residue classifies identically on warm and fresh
roots") was written at the END of the ledger suite, verified red for the right reason (all 14
parity subtests fail on `corruption` vs `busy`, zero fixture-defect failures), and independently
RED-reviewed with compiled-build patch discriminators. It was then **reverted uncommitted**,
because committing it beside `:1141`/`:1157`/`:1159` would put two mutually unsatisfiable pin
sets in the corpus — that is D4's call. The reviewed design, for the granted slice to rebuild:

- Fixtures byte-replicate `:1760`'s eight states plus the `publication-aborted`-terminal graph,
  seeded identically on a fresh root and on a warm root (one real prior acquisition; assert the
  steady-state `.released` is present). Live (own-pid) and dead (reaped-child) owners; both entry
  points for representative states.
- The oracle is **parity** — warm result `deepEqual` fresh result, and the same seeded artifacts
  survive (compared by role, not name: ack names embed identity digests and differ across roots)
  — never absolute outcomes, so the pins survive the chain landing (both roots progress
  together).
- Review findings to incorporate on rebuild: (i) each of the four tolerance sites needs its own
  over-tolerance boundary pin — the two written ones (same-owner `released`, unrelated
  `publication-aborted`, both measured corruption today) covered only the `:1712` site; add the
  same pair against the `withdrawal-withdrawal-ack`, `orphan-withdrawal-ack`, and
  `withdrawal-both-acks` states so a partially over-wide fix cannot ship silently. (ii) Anchor at
  least two states' fresh results absolutely (`busy`, already pinned by the corpus at `:1135`,
  `:1158`) so the family cannot be satisfied by a regression to corruption-everywhere.

## 6. Re-measuring this file

Ten-minute rebuilds, per this repo's probe convention (describe, do not ship):

- **Residue classification:** seed any §2 shape with the committed helpers
  (`creatorWithdrawalName`, `admissionRetiredName`, `slotCoordinationAck`,
  `incompleteCoordinationAck`, `coordinationAckName` — `ledger.test.ts:984-1000`, and the
  `:1760`/`:1746` fixture bodies verbatim), on a root allocated the way `bindableTempRoot`
  does (`:146`), then run `observeClock()`/`recover()` from
  `dist-test/src/authority/host/fs-ledger.js` with `{now:()=>t0,lockTimeoutMs:200}`. Warm the
  root first with one plain `observeClock()` for the warm variants.
- **Creator failure paths:** a `faultInjector` that throws at the four stage-construction
  boundaries (P3) or runs under `{[__testK1AdmissionPreparationRuntimeOption]:{mode:"prepare-and-promote"}}`
  (P6); record thrown identity, fired points, residue.
- **The pin-conflict A/B:** apply the four-site `blockingRetiredResidue` swap to the compiled
  build only, run `--test-name-pattern` on the two families around `:1141`/`:1157`/`:1159`, then
  rebuild `dist-test` with `npx tsc -p tsconfig.test.json`.

---

## Postscript 2026-08-05 (later) — the seal signed, D4 granted (a) and SHIPPED, D5 surfaced

The owner signed the seal proposal and granted D4(a) in-session. The tolerance shipped as the
four-site `blockingRetiredResidue` swap with the reviewed warm parity family as the guard — now
27 subtests after a second independent RED review: 14 parity, 5 fresh-busy anchors (one per
boundary-pinned state plus the aborted-terminal graph; the review measured that parity alone is
symmetric and cannot see a per-site regression to corruption — sites B/C shipped invisible until
the anchors covered all four), and 8 per-site over-tolerance boundary pins (each of the four
sites is individually discriminated; the unrelated-aborted pins uniquely catch a
disposition-filter widening, verified by mutation). The three pins flipped busy-ward in the same
commit, renamed "…is inert-tolerated busy": `:1141` retired case, `:1157` retired case, `:1159`.

**D5 — a second committed contradiction, found while scoping the chain build.** `:1760`'s eight
subtests (live same-pid owners, expect `advanced` with full drainage) are contradicted
shape-for-shape by the committed GREEN live-preservation family (`:1135`, `:1140`, `:1143`,
`:1154`, `:1156`, `:1158`, `:1167`, `:1170` withdrawn case), which pins bounded `busy` for the
same residues with the same live same-pid owners. The D1 brief named only `:1022` vs `:1746`;
this is the same conflict class across the whole matrix. Recorded in the spec beside D4 with the
recommended resolution — re-fixture `:1760` to dead owners exactly as `:1746` (implied by the
D1(a) grant's own words plus the exact-creator-snapshot rule; zero green pins flip) — versus
granting same-process progression (flips the nine green preservation pins). The chain build
proceeds meanwhile with the dead-owner route and the creator's own in-flight failure path;
`:1760` stays red as fixtured until the owner decides. The seal's clause 5 was amended the same
day to the grant's verbatim words ("the creator's own acquisition"; the first recording said
"process", the mistranscription D5 exposed).
