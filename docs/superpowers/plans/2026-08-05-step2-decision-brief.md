# Step-2 decision brief — three owner decisions that gate Batch B and the merge

_Written 2026-08-05 at `46c89d0`. Each decision below is a recorded hard stop: sessions have
measured the evidence and stopped, per the rule that resolving a committed-pin conflict or an
under-defined spec sentence is yours, not theirs. Each section ends with a ready-to-paste grant
sentence per option; put the chosen sentence verbatim into the Batch B prompt, the way the
2026-08-05 drainage grant was carried. Recommendations are marked; every claim has a
file anchor or a session measurement behind it._

---

## D1 — the creator-withdrawal chain (blocks six fault points, part of the red 80, gates the merge-green suite)

**The conflict, verified 2026-08-05 by reading both fixtures.** Two committed pins seed the
BYTE-IDENTICAL graph — a `withdrawn` slot-retirement marker + the same-owner
`publication-aborted` terminal + the bound `slot-retired`/`withdrawn` acknowledgment, owner pid
LIVE (`process.pid`) — and drive the same operation, a fresh default `observeClock`:

- `test/authority/ledger.test.ts:1022` ("withdrawn slot graph bound to publication-aborted is
  valid crash residue") demands `{ok:false,reason:"busy"}` with the root byte-identical. Passes
  today.
- `test/authority/ledger.test.ts:1746` ("atomic admission active owner cleans coordination once
  after every sync barrier") demands `{ok:true,status:"advanced"}` with the whole chain completed
  — slot-cleanup sync ×1, withdrawal-cleanup sync ×1, callback ×1, in that order. Fails today.

There is no creator in either fixture — both are foreign observers of live-pid residue. The name
of :1746 says "active owner", but its fixture hand-seeds the graph and runs a NEW acquisition, so
as written it demands that any contender finish another live process's withdrawal. Additionally
the spec declares `before/after-creator-withdrawal-seal` fault points but no paragraph defines
what the seal DOES (recorded in the spec as "Under-defined — the seal"), and
`ledger.test.ts:1746` pins one slot-retirement point and one creator-withdrawal point in a single
ordered assertion, so the six creator-withdrawal points are not emittable until this is settled.

**Options.**

- **(a) Preservation wins; re-fixture :1746 to a dead owner or the creator's own continuation.**
  Live coordination residue is never touched by a foreign contender (consistent with every other
  family, including the drainage grant's dead-owner bound and the slice-1 live-owner pins). The
  chain completes via (i) the creator's own in-flight acquisition and (ii) a dead-owner
  housekeeping route mirroring the published-slot drainage. :1022 stays verbatim; :1746 keeps
  every ordering assertion but its fixture kills the owner pid (or drives a crashed child's
  resumed chain). Cost: one committed pin edited in the same commit that ships the chain — the
  sanctioned pattern used for the drainage busy-matrix flip. **Recommended: it is the drainage
  precedent applied to the withdrawal family, and it is the only option that keeps live-owner
  preservation coherent across the codebase.**
- **(b) Completion wins; flip :1022.** Any contender may finish a fully-evidence-bound withdrawal
  graph even for a live owner. Cost: a foreign observer mutates a mid-flight acquisition's
  artifacts, racing the live creator — the exact class of behavior every other family refuses,
  and slice-1's live-owner pins would sit inconsistently beside it. Not recommended.
- **(c) Both stand, scoped by driver.** Keep busy-preserved for `observeClock` and grant
  completion to `recover()` only. :1746 would then need re-driving through `recover()` — but its
  callback assertion cannot survive that (recover runs no semantic callback), so this is really
  (a) with a weaker completion story for crashed roots. Only pick if you want the withdrawal
  chain completable exclusively by recover() and the creator.

**The seal.** Whatever option you pick, a session must propose the seal's semantics from
measurement (what the chain needs between fence-held validation and the stage rename — the
taxonomy places both seal points immediately before `before-creator-withdrawal-rename`), and you
sign it off before it enters the spec. The brief deliberately does not invent it.

**Grant sentences.**
- (a): "Owner decision: the creator-withdrawal chain completes only through the creator's own
  acquisition or a DEAD-OWNER housekeeping route mirroring the published-slot drainage;
  `ledger.test.ts:1022` stands verbatim, and `:1746` is re-fixtured to a dead owner in the same
  commit that ships the chain, keeping all its ordering assertions. The seal's semantics are
  proposed from measurement and recorded in the spec before the six withdrawal points are
  emitted."
- (b): "Owner decision: a fully-evidence-bound withdrawal graph is completable by any contender
  regardless of owner liveness; `:1022` flips to drained in the same commit, named."
- (c): "Owner decision: withdrawal completion is granted to recover() and the creator only;
  `:1746` is re-driven accordingly and its callback assertion re-scoped."

## D2 — the two recorded corruption lineages beside the successor rule

**The state.** Two crash lineages reachable from real double-crash sequences classify as
permanent corruption because committed pins `:1119`/`:1134` pin corruption for the byte-adjacent
no-lock graphs (spec, "Open discrepancy — two reachable crash lineages stay `corruption`"):
(1) `published` marker + same-owner `publication-aborted` successor + unrelated
`recovery-pending`; (2) `published` marker + live same-owner lock + unrelated `recovery-pending`
+ that marker's own durable legacy cleanup ack. Both also corrupted before this session's work
(candidate-count), so nothing regressed — these are pre-existing wedges, now named.

**The candidate rule (already written in the spec).** Tolerate the unrelated `recovery-pending`
when the same-owner successor is the active lock **or** `publication-aborted`; keep corruption
when the successor is `released`. This satisfies both lineages AND both committed pins — nothing
flips. Its premise — a `released` successor cannot coexist with an unretired marker or undrained
cleanup evidence, because release only happens after the cleanup pass — is code-supported but
was not proven exhaustively.

**Options.**
- **(a) Adopt the candidate rule, premise proven first.** A session measures the premise (crash
  matrix over the release path), implements the tolerance, extends the legacy-ack excusal to the
  second lineage, keeps every committed pin. **Recommended — it is a strict wedge removal with
  zero pin cost, contingent only on the premise holding under measurement; if the premise fails,
  the session stops and reports.**
- **(b) Status quo.** Rare double-crash lineages stay permanently bricked; the record stands.
  Defensible if you would rather spend Batch B entirely on D1.
- **(c) Wide tolerance (flip :1119/:1134).** Most reality-honest, highest churn. Not recommended
  while (a) is available.

**Grant sentences.**
- (a): "Owner decision: adopt the candidate recovery-pending rule (tolerate beside a same-owner
  active-lock or publication-aborted successor; corruption beside released) contingent on the
  session first measuring the release-ordering premise; no committed pin may flip."
- (b): "Owner decision: the two corruption lineages stand as recorded; do not implement the
  candidate rule."

## D3 — the 13 non-spec registry entries and ABI-freeze timing

**The state.** `ledgerLockFaultPoints` carries 13 election/provisional/predecessor names the spec
forbids; 10 specified points are still unemitted (6 withdrawal — D1-gated — and 4
pre-admission-housekeeping — Batch A). Removing the 13 and finishing the additions is additive at
runtime but source-breaking for any consumer narrowing on `LedgerFaultPoint`. The freeze gates
reelier-cloud#54, which merges only after the OSS ABI is frozen and PR #85 is merged.

**Options.**
- **(a) One break: freeze after D1's points land.** Sequence: Batch A (4 points) → D1 decision →
  withdrawal chain + 6 points → delete the 13 → freeze → S4 flip → merge #85 → cloud#54.
  **Recommended — a single source-breaking change, and the frozen surface is the final one.**
- **(b) Delete the 13 now.** Gets the forbidden names out early at the cost of a second break
  when the withdrawal points land. Only worth it if a consumer is actively narrowing on the type
  today (none known).
- **(c) Freeze now.** Freezes a surface the spec says is wrong (13 extras, 10 missing). Not
  viable.

**Grant sentence.**
- (a): "Owner decision: the ABI freezes once, after the withdrawal fault points land; the 13
  non-spec entries are deleted in the freeze commit; cloud#54 waits for the freeze plus the #85
  merge, in that order."

---

**What to do with this brief:** pick one option per decision (a/a/a is the coherent set), paste
the three grant sentences into the Batch B prompt, and Batch B becomes executable without a
single mid-session escalation. If you pick differently, the Batch B prompt needs its stop-rules
adjusted to match.

---

## Postscript 2026-08-05 (Batch B) — a fourth decision surfaced, and the seal awaits sign-off

Batch B ran with grants D1(a) and D3(a) (D2 deferred), measured the withdrawal chain, and stopped
at its designed checkpoint with two items on the owner's desk:

- **D4 — the withdrawal family's warm-tolerance pin conflict.** The chain's crash residues are
  permanently `corruption` on every used root (the sixth fresh-root-blindness instance), and
  unlike the warm-prep case, three committed pins REQUIRE that corruption — extending the
  released-only tolerance flips `ledger.test.ts:1141`(retired), `:1157`(retired), and `:1159`,
  verified by a compiled-build A/B. Without the grant, D1(a)'s own chain completes only on
  never-used directories. Options, evidence, and the ready-to-paste grant sentence:
  `2026-08-05-withdrawal-chain-measured.md` §4. Recommended: (a), the Batch A warm-prep decision
  applied to the fourth family in a row.
- **The seal proposal** is recorded in the spec beside the (now PROPOSED) "Under-defined — the
  seal" note, each clause forced by a committed pin or a measurement. Per the D1(a) grant
  sentence, the six creator-withdrawal points stay unemitted until you sign it.

Batch B's remaining tasks (the chain build, the six emissions, the D3(a) freeze commit, the S4
re-spec, the flip, the contention gates) resume in one session once the seal is signed and D4 is
decided — carry both into the next prompt the way this brief's grants were carried.

**Same-day update:** the owner signed the seal and granted D4(a) in-session; the tolerance
shipped with the warm parity family and the three named pin flips. A fifth decision (**D5**)
surfaced while scoping the chain build: `:1760`'s eight live fixtures contradict the committed
GREEN live-preservation family (`:1135`–`:1170`) shape-for-shape — the same conflict class the
brief recorded as `:1022` vs `:1746`, across the whole matrix. Recommended: the `:1746`-style
dead-owner re-fixture (implied by D1(a)'s own words plus the exact-creator-snapshot rule; zero
green pins flip). Recorded in the spec beside D4; the chain build proceeds meanwhile via the
dead-owner route and the creator's own in-flight path, with `:1760` red as fixtured.

A sixth decision (**D6**) was measured by the D4 slice's own GREEN review: the ABANDONED family
has the same warm corruption (the seventh fresh-root-blindness instance, live and dead owners,
both entry points) three lines below the site D4 fixed. Outside the D4 grant, so recorded in the
spec beside D5 and left unfixed; the fix is the same one-helper tolerance if granted.

**2026-08-06 update — D1's chain SHIPPED, D3(a) PERFORMED.** The six creator-withdrawal points
are emitted (backlog 0), the dead-owner chain completes all eight crash states from both entry
points warm and fresh, `:1746` is re-fixtured green per the grant, and the ABI froze in one
commit: `ledgerLockFaultPoints` 71 → **58** (exactly the spec taxonomy; the 13
election/provisional/predecessor extras moved to a module-private internal-boundaries list, still
emitted for the corpus, never in the ABI), `ledgerFaultPoints` 138 → **125**, and the
registry-completeness pin is GREEN. Remaining before the flip: the K1 creator-side chain
continuation (the W1-window acceptance criterion), the S4 re-spec, and the contention gates.
Open on the owner's desk: D5 (the `:1760` re-fixture), D6, D2, and the housekeeping-permission
question.

**2026-08-06 update (Batch C) — B2b SHIPPED (the W1 acceptance criterion holds: zero wedged
cells in the reviewer's 82-cell crash matrix), D5(a) PERFORMED (the eight `:1760` states plus
parent green by name, 619/59 → 628/50, zero green pins flipped, resolved in the spec beside
D4).** Still open on the owner's desk: D2, the housekeeping-permission question, the D6
contingent grant (its A/B is next in this batch), and — new this batch, recorded for
ratification — the empty-terminal grant's ack-binding-validator widening (spec, beside the
empty-terminal resolution).
