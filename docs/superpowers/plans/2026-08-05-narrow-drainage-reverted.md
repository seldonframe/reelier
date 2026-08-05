# Narrow foreign-dead-slot drainage — built, measured, reverted

_Written 2026-08-05 at `62f2949`. The owner granted the narrow route; it was implemented, it passed
its own gates, and independent review then measured two defects that made it unshippable. The code is
reverted. This file is what the next attempt needs, so nobody re-derives it._

---

## 1. The decision it implements

Owner, 2026-08-05: **any contender may retire a DEAD-OWNER slot as `published`, but only where the
exact same-owner active lock or a named successor is present.** The wide rule was rejected. This is
the route whose absence blocks K1 activation — see `2026-08-05-s4-activation-measured.md`.

That decision stands. What follows is about the implementation, not the grant.

## 2. Why it was reverted

**It only works on a pristine root.** Measured, same crashed-publication shape, one variable changed:

```
dead-owner `.published` marker + same-owner lock                      -> advanced, residue []
the same, plus ONE unrelated `.released` marker                       -> corruption
```

Every real root carries that second artifact: a successful acquisition leaves
`.authority-ledger-lock-<pid>-<nonce>.released` as steady-state residue. So the drainage worked on
fresh directories and failed on every root that had ever been used.

Cause: `classifyHybridPublishedSuccessor` requires **exactly one** candidate, counting the active
`lock` plus every `RETIRED_LOCK` entry **regardless of owner**. An unrelated successor from a prior
acquisition makes the count two, and the graph is corruption. The pre-classification hook that drains
legacy residue only fires when the sole K1 name is the bare fixed slot, so it never runs once the
slot has become a `published` marker.

**Nothing in the suite could see this.** Every test uses `withRoot`, which hands out an empty
directory. The slice's own 11 pins passed, the option-gated 37 passed, the baseline gained 11 with no
new failing name, and the full suite was clean. The defect is invisible to a fresh-root corpus by
construction — the same blindness that let the S1 and S2 residue defects survive their own green
suites, walked into a fourth time.

**Second defect, independently reproduced.** A hard exit between the marker's `unlink(owner.json)`
and its `rmdir` leaves an empty `.published` marker, which classifies as permanent corruption and
refuses reads. The `abandoned` twin survives the identical window because
`classifyHybridAuthenticatedPartialSlotMarker` rescues it — and that rescue returns `null` for any
disposition other than `abandoned`. The slice extended `boundSlotArtifact` to pass `published` into
that rescue, which made the call site *look* handled while the rescue itself still refused. There is
no fault point between those two syscalls, so no pin can reach the window today.

## 3. What was right, and worth keeping next time

The shape of the change was sound and its gates were real:

- The route derivation works: a dead-owner slot with its own lock retires to `published`, the marker
  and its acknowledgment drain, and the root self-heals in **one** acquisition — matching what the
  default path does from the equivalent crash.
- Narrowness held. The committed orphan pins at `ledger.test.ts:1137`/`:1171` stayed green; they seed
  `abandoned` markers with no lock and are out of reach by construction. Live owners, foreign-owner
  locks and foreign hosts were all refused, and independent review threw twelve hostile
  authority-entry variants at it without finding an exploitable one.
- The `recovery-pending` successor is safe to drain. Measured A/B on roots carrying a real dispatched
  reservation: high-water mark, reservation state, journal event count and `recover()` output are
  byte-for-byte identical with and without the K1 artifact. The housekeeper never acknowledges a
  `recovery-pending` marker, so legacy semantic recovery runs afterwards unchanged.
- Idempotent under concurrency: two ledgers in one process and four racing child processes both
  converge with zero residue.

## 4. What the next attempt must do first

1. **Fix `classifyHybridPublishedSuccessor` to count only SAME-OWNER successors**, or drain unrelated
   legacy residue before classifying. This is the blocker; everything else is downstream of it.
2. **Extend `classifyHybridAuthenticatedPartialSlotMarker` to `published`** (its terminal is the
   successor artifact, not the marker's own bytes, so the binding check needs a published variant),
   and widen the dispatch in `classifyClosedHybridGraph` to match. Add a fault point between the
   marker's `unlink` and `rmdir` so the window becomes pinnable at all.
3. **Write the pins on WARM roots.** At least one acquisition before the fixture is seeded. A
   fresh-root pin cannot see either defect above. `option-gated acquisitions leave a reusable root`
   is the pattern to copy.
4. **Decide the fixed-slot successor forms.** Measured: `slot + live lock` drains, but
   `slot + released` and `slot + publication-aborted` wedge, and `slot + recovery-pending` is
   permanent corruption. The spec grants all four. Either extend coverage or narrow the spec sentence
   — but do not leave code claiming coverage it does not have.
5. **Pin a read entry point.** The grant makes `getHighWaterMark()` a writer on another process's
   artifacts. That is intended — it is the wedge being removed — but nothing recorded it.
6. **Move the docs in the same commit.** The spec still says this route is unperformed and that only
   `recover` holds housekeeping write authority; the comment above the permission gate still says the
   slot family is reserved. All three become false the moment the grant ships.

---

## Postscript 2026-08-05 — rebuilt and shipped

The route shipped on `codex/universal-compiled-authority` in three gated slices, each independently
RED- and GREEN-reviewed:

1. `9252f18` — same-owner successor counting (item 1 above), landed FIRST as its own slice with
   live-owner warm pins, plus lock-conditioned tolerance for an unserviced foreign
   `recovery-pending` beside the live same-owner lock (spec :567/:747-748; the GREEN review
   measured the original throw refusing the acquisition's own reclaim lineage). Two reachable
   lineages stay corruption because committed pins :1119/:1134 pin the byte-adjacent no-lock
   graphs; recorded as a spec discrepancy for the owner beside the successor rule.
2. `d869a64` — the marker-owner-remove window (item 2): the fault point at all three removal
   sites, the `published` authenticated-partial rescue, and the first exercise of the
   owner-restoring unwind repair.
3. The drainage commit (item and grant) — retire-as-published on the byte-identical same-owner
   lock, the published cleanup lifecycle for any contender, `recover()` parity, the committed
   busy-matrix flip in the same commit, and the docs moved with it.

What the measurements settled (item 4): the ACTIVE LOCK is the only fixed-slot successor a real
crash leaves; `slot+publication-aborted` converges to the bare slot via the pre-classification
drain and recovers through the abandoned route (measured end to end, so no published route for it);
`slot+released` has no reachable lineage; `slot+recovery-pending` classifies corruption. The spec
sentence was narrowed accordingly beside the rule.

NEW measured defect, recorded in the spec and NOT fixed here: a WARM preparation-stage crash
(prep + steady-state `.released`) is permanent corruption from both entry points — the fifth
fresh-root-blindness instance. Must be resolved before any activation flip.
RESOLVED in Batch A, 2026-08-05 (later): released-only classification tolerance on the
preparation-family branches, both designs built and measured first — see the spec's warm-prep
record (grep "A related measured limit") and the Batch A postscript in
`2026-08-05-s4-activation-measured.md`.
