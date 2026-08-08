# Admission-preparation lifecycle — reviewed design

_Written 2026-08-04 at `224e085`, from a three-lens design review that read the spec, ran the pins,
and measured. This is the plan the S1–S4 slices execute against. Terms per `docs/GLOSSARY.md`._

---

## 1. Verdict

**The central tension is RECONCILABLE.** The hinge is `classifyHybridCoordinationEpoch` returning
`continue-legacy` (`fs-ledger.ts:873`) *before* the initial-enumeration fault whenever no K1-reserved
name exists — so `k1Initial === 0` holds on clean roots regardless of what the contender does next.
The green legacy set is a **wiring contract, not a veto**: no green pin needs deleting; the K1
clean-root cycle must simply drain all of its own artifacts and preserve the legacy counters.

**But the slice is inseparable from clean-root activation.** Every committed RED pin on the nine
points drives plain `observeClock` on a clean root; there is no K1-active-fixture escape. And the
success-path shape pins (`:1670`, `:1672`, `:1790`, `:1822`) drag in the **own-act slot retirement**
and pre-callback closure, so the honest scope is ~14 points, not 9.

**Separable from legacy-election deletion.** The legacy classifier must survive for legacy-residue
roots (`:1642`–`:1646`); this work branches around it, never removes it.

**No phantoms** among the nine-point pins. One corpus gap: `before-admission-slot-rename` has no
hard-exit subtest — only the byte-revalidation pin at `:1786` — so S1 must add the ninth boundary.

## 2. Decision refinement — own-act retirement is not blocked

The §2 slot-retirement blocker concerns **foreign dead-slot housekeeping**: the dead-owner orphan
pins at `:1137`/`:1171` seed *foreign* slots and forbid a lock-seeking contender touching them. The
active owner retiring **its own** slot as `published` after stage→lock rename is a different act —
spec: *"After publication, the active owner — not the pre-admission housekeeper — … durably retires
the matching slot as `published`"* — and collides with nothing. Three of the four slot-retire points
are reachable through the own-act path without the owner decision. Only foreign-dead-slot recovery
stays blocked on it.

## 3. Strategy — option-gated staging (house precedent: the fence runtime option)

Build the full lifecycle as private methods behind a new host-private symbol runtime option
(precedent: `__testK1OperationFenceRuntimeOption`), defaults untouched, so every sub-slice passes the
baseline gate and is committable. The final flip is small and reviewed on its own.

- **S1 — prep creation → slot promotion → slot-owner-bound stage creation**, option-gated.
  Busy/failure exits use the spec's own degraded terminal: a published lock that cannot retire its
  slot retires to `publication-aborted` and runs **zero callback** (spec `:243-245`, exactly what
  `:1672` demands post-activation). This avoids the creator-withdrawal chain entirely in S1.
  Gating RED pins (new, option-injected): a child-process hard-exit suite transliterating `:1653`
  across all **nine** boundaries, plus one completion pin asserting the degraded terminal.
- **S2 — own published-slot retirement** (the 4 slot-retire points via the own-act path; `:1137`/
  `:1171` unaffected).
- **S3 — active-owner inline cleanup** of the retirement marker/ack, extending the shipped
  coordination-cleanup machinery (required because `:1641` forbids any residue after success), plus
  `after-pre-callback-coordination-generation-closed`.
- **S4 — the activation flip**: clean-root `continue-legacy` forks to the K1 path when the root is
  admission-ready empty; legacy residue keeps the legacy path byte-identically. This is the slice
  where the committed RED corpus (`:1653`, `:1670`, `:1672`, `:1786`, `:1790`, `:1822`, `:936`)
  goes green.

## 4. The activation contract (S4's gate, from the pins)

1. Fence first; classify first; create only on an admission-ready empty root.
2. No K1 initial-enumeration hook fires on clean roots (`k1Initial === 0` preserved).
3. Single post-validation semantic clock read (`semanticNow === 1`).
4. One stage, one lock-root-sync, one lock-retire per success.
5. Full drainage on success **and** on busy exits — zero admission-family residue.
6. Preserved-in-place corruption for self-created preps (never delete what fails validation).
7. Legacy-residue roots take the legacy path byte-identically.

## 5. Prerequisites and risks

- **Busy-exit withdrawal coupling:** the own-act busy path eventually meets the creator-withdrawal
  open discrepancies. S1 sidesteps them via the `publication-aborted` degraded terminal; the full
  converge pin `:955` is the gate that will eventually force the question. Scope it out explicitly
  per slice until the owner resolves the recorded items.
- **Write amplification:** the activated cycle multiplies durable writes ~3–4× per operation. This
  machine already flips `:215`/`:936` (cross-process suites) under load — run them in isolation, on
  a quiet machine, before and after S4.
- **Registry:** the nine emissions extend `ledgerLockFaultPoints` at their spec group positions;
  same additive-runtime/source-breaking-type character as before.

## 6. Order of work

S1 RED pins → independent RED review → S1 implementation → gates → GREEN review → commit; then S2,
S3, S4 each through the same loop. Every slice: `npm run baseline` must show no dropped pass and no
new failing name; `npm run lint:fault-pins` before adopting any pin as a goal.
