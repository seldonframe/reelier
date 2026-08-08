# D2 measured: the grant fixes 1 of 16 and breaks 7. It is not a permission — it is a contradiction.

> The owner decision on 2026-08-07 was "grant the housekeeping permission." Before implementing it I
> measured what granting does. **It is refuted**, for the second time this question has been asked
> and the second time measurement has said no. Recorded here rather than implemented.

## What was granted, precisely

The gate is one predicate, `src/authority/host/fs-ledger.ts:1517`:

```ts
if(!permitWrite && !(budgetLive && (this.mayAdvanceDeadPrepCleanup(binding)
                                 || this.mayDrainPublishedSlot(binding)
                                 || this.mayProgressWithdrawalChain(binding)))) return "busy";
```

`permitWrite` is `permitPrepHousekeepingWrite`, passed `true` at exactly **one** call site —
`recover()` at `:569`. Every other operation, `observeClock` included, is a lock-seeking contender
with `permitWrite === false` and holds only the three listed families.

The 16 reds want a **fourth**: a lock-seeking contender initiating an `abandoned`-family dead-slot
retirement. The comment immediately above that line already says what that costs:

> Initiating an abandoned-family retirement stays reserved to recover(); committed dead-owner
> slot-orphan tests pin a lock-seeking operation to leave those byte-identical.

## The measurement

Applied to build output only (`dist-test/src/…`, restored afterwards; `src/` never modified):

```js
|| (binding.descriptor.kind === "dead-slot" && binding.descriptor.disposition === "abandoned")
```

Full ledger suite, same machine, back to back:

| | unique failing names |
|---|---|
| control (HEAD) | **18** |
| with the grant | **24** |

**Fixed by granting — 1:**

- `pre-admission housekeeper retires one dead slot before preparation and mutates no semantic state`

**Broken by granting — 7:**

- `dead complete stage at after-lock-publication-owner-sync` *fresh* and *warm* withdraws to the aborted terminal and recover heals
- `dead complete stage at after-lock-publication-stage-sync` *fresh* and *warm* withdraws to the aborted terminal and recover heals
- `dead exact slot plus same-owner stage is recoverable but unsupported`
- `dead publication stages beside their same-owner slot withdraw through the typed protocol`
- `hybrid epoch guard classifies K1 before every legacy compatibility mutation`

## Two things this refutes, one of them mine

1. **The grant does not turn the family green.** It fixes exactly **one of sixteen**. The other 15
   need something else, still unidentified.
2. **"The 16 are one family behind one switch" is false.** That framing is inherited, it is in the
   continuation prompt, and it is wrong. The 16 are ~5 root tests plus subtests, and only the one
   standalone test responds to this permission at all.

This is the second refutation of the same shape. The spec already records the first
(`docs/specs/compiled-authority-v1.md:476`): granting write authority to *every* contender took the
suite from 410/91 to 388/113 on 2026-08-04. The wide reading was refuted then; the narrow
`abandoned`-family reading is refuted now.

## What D2 actually is

Not a permission to grant. **Two committed pins that contradict each other:**

- `test/authority/ledger.test.ts:1748` drives `observeClock` (lock-seeking) and requires the dead
  slot to be retired to `admissionRetiredName(owner,"abandoned")`.
- The seven tests above require a lock-seeking operation to leave dead-owner slot-orphan residue
  **byte-identical**.

Both cannot hold. No implementation satisfies both, which is why no amount of care in the grant
helps — this is not a bug to fix but a decision about which pin is right, and it belongs to whoever
signed them.

The honest options, none of which should be taken silently:

1. **The seven win.** `observeClock` must not initiate abandoned retirement. Then
   `ledger.test.ts:1748` is wrong and should be retired or re-scoped to `recover()` — and the 16
   shrink by one with the other 15 still unexplained.
2. **The one wins.** Lock-seeking contenders may initiate abandoned retirement, and the seven
   byte-identical-preservation pins are wrong. That is a real weakening of a preservation guarantee
   and needs saying out loud.
3. **Neither — the classification is wrong.** Some third reading in which the dead slot is retired
   without disturbing what the seven observe. Nobody has proposed one, and it should not be assumed
   to exist.

## The other 15, diagnosed (owner asked for this before deciding)

Upper bound first. Opening the permission gate **completely** (`if (false && !permitWrite …)`, the
wide reading) fixes **8 of 18** and takes the suite to **70** failing names. So no permission
policy — none, at any width — reaches the other 10. That is the whole question settled by one run:

| grant | fixes | total failing |
|---|---|---|
| none (control) | — | **18** |
| narrow (`dead-slot` + `abandoned`) | 1 | 24 |
| **wide (gate fully open)** | **8** | **70** |

The 18 are **four unrelated groups**, not one family:

| group | n | names | actual cause | reachable by permission? |
|---|---|---|---|---|
| **A. dead-owner residue healing** | 8 | `dead-empty`, `dead-zero`, `dead-partial`, `dead-complete`, `dead exact slot`, `pre-admission housekeeper retires one dead slot…`, + parents *"…preparation states are non-authorizing…"* and *"…slot classification gives corruption precedence…"* | `observeClock` meets dead residue it may not clean, so refuses `busy` instead of healing and advancing | **yes** — the only group that is |
| **B. live-owner residue** | 5 | `marker-only`, `marker-plus-stage`, `marker-plus-ack`, `orphan-ack`, + parent *"…slot retirement and purpose-bound ack crash windows converge"* | `ledger.test.ts:1713` builds residue with `pid: process.pid` — **the owner is this live process**. `:1518` refuses any `dead-slot` transition whose owner is not dead, before permission is consulted | **no** |
| **C. preservation** | 3 | `before-admission-slot-rename`, `before-lock-publication-rename`, + parent *"…revalidates owner bytes at every publication boundary"* | `"replacement remains at the selected owner path"` — `actual: false`. The injected replacement does not survive. Nothing to do with housekeeping | **no** |
| **D. truncation artifact** | 2 | `the collision branch emits before…` + parent | asserts `busy`; settled verdict is `corruption` (F1) | **no** |

Group B is the sharp one, and it is decisive against the inherited framing. The sibling test at
`:1737` — *"atomic admission prep-retired ack windows converge only with creator or dead-owner
authority"* — sets up the **same** crash windows but mocks the owner **dead**, and it **passes**.
Same shapes, same code path, opposite liveness, opposite result. Group B is therefore asking whether
a contender may retire residue owned by a **live** process — itself — which `pid` alone cannot
distinguish from residue that process is still using. That is a generation/nonce question, not a
permission question, and no grant will answer it.

**So "the 16 ungranted-housekeeping reds" was wrong in three ways at once:** the count is 18, only 8
of them are about housekeeping permission at all, and reaching those 8 costs 52 new failures.

## Not claimed

- Any verdict on which pin is correct. That is the escalation, not the finding.
- That group A's 8 are unreachable by some *narrower* grant than the wide one. Two widths were
  measured (1 fixed, 8 fixed); the space between them was not searched.
- Any diagnosis of groups C or D beyond the failing assertion. Their causes are named, not explained.
