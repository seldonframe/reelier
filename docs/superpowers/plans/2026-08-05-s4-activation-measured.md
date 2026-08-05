# S4 — the activation flip, specced from measurement

_Written 2026-08-05 at `e8693e8`, after S1 (`670a06e`), S2 (`fc7a8b3`) and S3 (`621b317`) shipped.
Every number here was produced by running something on this tree; none is carried from the design
brief. Where this file disagrees with `docs/superpowers/plans/2026-08-04-admission-preparation-design.md`,
that brief was written before the mechanism existed and this one wins._

---

## 1. Verdict

**S4 is blocked on one decision, and it is a decision already on the owner's list.**

Six of the seven activation-contract clauses hold today, measured. The seventh — full drainage — holds
on the success path and fails on the crash path, and closing it requires **foreign-dead-slot
housekeeping**, which is recorded as blocked. Activating without it converts a self-healing failure
into a permanent one.

**Do not flip the default until that decision is made.** Everything else is ready.

## 2. The blocking measurement

A crashed acquisition, then every entry point tried against the root it left behind. The crash is a
child process hard-exiting at a fault point — the same technique the committed corpus uses.

| crash point | root after crash | default `observeClock` | `recover()` | verdict |
|---|---|---|---|---|
| **option OFF** `after-lock-publication-root-sync` | *(nothing)* | `advanced` | ok | **self-heals** |
| **option OFF** `after-lock-publication-stage-sync` | one publication stage | `advanced` | ok | **self-heals** |
| **option ON** `after-admission-slot-root-sync` | `.authority-ledger-admission-0` | `busy` | **ok — drains it** | **recovers via `recover()`** |
| **option ON** `after-lock-publication-root-sync` | `.authority-ledger-admission-0` + `lock` | `busy` | `busy` | **permanently wedged** |
| **option ON** `after-coordination-cleanup-ack-root-sync` | `…retired….published` + `…cleanup….ack` + `lock` | `busy` | `busy` | **permanently wedged** |

On a wedged root `getHighWaterMark()` throws `AuthorityLedgerReadError` — **reads are refused, not
just writes** — and the shape is stable across repeated acquisitions, so nothing is mid-flight.

**Why the third row recovers and the last two do not.** A dead-owner fixed slot with *no* lock
satisfies `slot-retired.abandoned`, whose authority is "final same-host dead-PID proof plus a stable
complete graph containing no matching publication stage, active lock, or withdrawal marker". That
route is implemented, and `recover()` holds the housekeeping write permission, so it drains. Once a
`lock` is present the graph no longer qualifies, and the applicable disposition becomes
`slot-retired.published`, whose authority — "the exact same-owner active lock or the exact same-owner
`released`/`recovery-pending`/`publication-aborted` successor" — **is present on disk**. The spec
authorizes the transition. Nothing performs it, because performing it means a later process retiring
*another* process's dead slot: foreign-dead-slot housekeeping.

**What the default path does instead.** It reclaims the dead-owner `lock` through the legacy
retirement machinery. With a K1 slot or `published` marker also present, classification refuses
`busy` before reclaim is ever consulted — so activation does not merely fail to add recovery, it
**removes recovery that works today**.

## 3. The seven clauses, measured

Counted on one clean-root `observeClock`, option OFF vs ON.

| # | clause | status | evidence |
|---|---|---|---|
| 1 | fence, classify, create only on an admission-ready empty root | **holds** | the guard refuses `busy` with zero mutation when a publication stage is present; pinned |
| 2 | no K1 initial-enumeration hook on clean roots (`k1Initial === 0`) | **holds** | `k1Initial: 0` both paths |
| 3 | single post-validation semantic clock read (`semanticNow === 1`) | **holds** | `semanticNow: 1` both paths |
| 4 | one stage, one lock-root-sync, one lock-retire per success | **holds** | `stage: 1, lockRootSync: 1, lockRetire: 1` both paths |
| 5 | full drainage on success **and** on busy exits | **success only** | success residue is byte-identical to the default (`…released` marker alone); crash residue is undrainable — §2 |
| 6 | preserved-in-place corruption for self-created preparations | **holds** | tamper cases return `corruption` with the artifact intact; pinned across three shapes |
| 7 | legacy-residue roots take the legacy path byte-identically | **holds observationally, not structurally** | result and final residue are byte-identical; the option-on path *drains* the residue and then takes the K1 path — 23 durable boundaries vs 7 |

**Write amplification: 3.29×** (7 → 23 durable boundaries per successful operation). The design brief
predicted 3–4×; that prediction held.

Clause 7 deserves a note. The brief expected legacy-residue roots to *stay* on the legacy path. They
do not: the residue is drained first, and the now-clean root takes the K1 path. The observable
outcome is identical, so the clause passes as written, but the mechanism is not what was designed.
Anyone re-reading the brief should not expect a fork that isn't there.

## 4. What S4 actually is, once unblocked

Small, and that was the point of staging it. `parseK1AdmissionPreparationRuntime` currently returns
`false` for `undefined`; activation is that default inverting, plus deleting the option once nothing
depends on it. The mechanism, its emissions and its pins already exist and are green behind the gate.

The work that is genuinely still open:

1. **Foreign-dead-slot drainage (blocked, owner).** A housekeeping route that retires a dead-owner
   fixed slot as `published` on the authority of its same-owner lock or successor, then drains the
   marker and ack. Without it, activation is a regression.
2. **Then the committed default-path corpus goes green** — `ledger.test.ts:1653`, `:1670`, `:1672`,
   `:1786`, `:1790`, `:1822`, `:936`. None has moved yet, by design; all twelve S1–S3 points are
   reachable only behind the disabled option.
3. **Contention gates.** Real-process N40 and exact N100, on a quiet machine. Note the 100-process
   test is currently ~50/50 on this host with the Windows crashed-child signature, measured failing
   2 of 3 in isolation on the pre-S3 tree — fix or quarantine that before trusting it as an S4 gate.
4. **A reused-root test class on the default path.** S3 added the first test in this corpus that runs
   several acquisitions against one root; every other test uses a fresh root and therefore cannot
   observe residue at all. That blindness is what let the S1 and S2 residue defects survive their own
   green suites.

## 5. How to re-measure this file

```bash
node scripts/baseline-diff.mjs            # 464 pass / 80 fail at e8693e8, on a settled machine
npm run lint:fault-pins                   # emitted 73 / declared 57 / unemitted 10
node -p "require('./dist-test/src/authority/host/fs-ledger.js').ledgerLockFaultPoints.length"  # 60
```

The §2 and §3 tables come from two scratch probes: crash a child at a fault point, then try every
entry point against the leftover root; and count boundaries on one clean-root operation with the
option off and on. Both are ten-minute rebuilds — rebuild them rather than trusting these numbers if
the pin has moved.

---

## Postscript 2026-08-05 — the blocking route shipped

Foreign-dead-slot drainage landed (see `2026-08-05-narrow-drainage-reverted.md` postscript for the
commits). The §2 wedge rows now drain: every entry point self-heals the crash-with-lock shapes in
one acquisition, `recover()` included, and `getHighWaterMark()` reads instead of raising — measured
by the committed warm-root pin suite "foreign-dead-slot drainage retires and drains the granted
shapes" and the flipped crash-window matrix.

S4 remains gated on: its own re-spec from these measurements; the contention gates (§4.3); the
reused-root default-path class (§4.4); and a NEW measured blocker recorded in the spec — a WARM
preparation-stage crash (prep + steady-state `.released`) is permanent corruption from both entry
points today. Activation over that defect would ship a root-bricking crash window on every used
root.
