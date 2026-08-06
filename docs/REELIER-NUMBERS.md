# Reelier — numbers worth knowing

**Pinned to `codex/universal-compiled-authority` @ the D3(a) freeze commit, measured 2026-08-06
on Windows 11.**

_Every number here is quoted somewhere: in a commit message, a PR body, a plan, or an estimate. Two
were quoted wrongly in a single session — "15 missing fault points" (really 34) and "402 pass"
(really 411) — and both were inherited from an earlier summary rather than measured. Numbers with a
quoting habit need a pinned home and a command that reproduces them. **Re-run the command before
repeating the number.** If a number here disagrees with a chat message, a commit body, or your
memory, this file is not automatically right either — the command is._

Each row is marked **measured** (reproduced at this pin) or **inherited** (carried from earlier work,
not re-verified here — treat as a hypothesis).

---

## 1. Ledger-lock fault ABI

| Quantity | Value | Status |
|---|---|---|
| Fault points declared in the spec taxonomy | **58** | measured |
| Entries in exported `ledgerLockFaultPoints` | **58 — FROZEN** (D3(a): the one ABI break, performed 2026-08-06 after the six withdrawal points landed; 71 before the freeze, 65 before Batch B, 61 before Batch A) | measured |
| Entries in public `ledgerFaultPoints` | **125** (138 before the freeze) | measured |
| Fault-point literals emitted anywhere in `src/` | **84** per `lint:fault-pins` = 58 public lock points + 13 internal boundaries (`ledgerInternalBoundaries`, module-private — still emitted, observable through the injector, never part of the ABI) + 5 reservation-family + 8 gate-decision-family (`src/authority/decision.ts`) | measured |
| Declared in spec, not emitted (the backlog) | **0** — closed by Batch B slice B2c (the chain cleanup + the sixth point) | measured — **but see the gating caveat below** |
| Exported but **not** in the spec taxonomy | **0** — the 13 extras were deleted in the freeze commit; the registry-completeness pin ("…complete and disjoint") is green | measured |

```bash
npm run lint:fault-pins
```

**Gating caveat on the backlog row — read this before quoting it.** Emission is all
`lint:fault-pins` measures; it does **not** mean an emitted point is reachable on a default path.
The admission-preparation family fires only behind a disabled host-private runtime option, and the
post-transition housekeeping points fire only when a transition was PERMITTED — the committed
pin "pre-admission housekeeper retires one dead slot before preparation" stays red after Batch A's
emission because observeClock still holds no abandoned-slot retirement authority (an owner
decision, not an emission gap; measured 2026-08-05, the fourth "probably just emission" claim this
project has refuted by running it). The linter has no third state for *emitted but gated*; reading
this row with the caveat attached is the difference between a real number and the exact trap the
linter exists to prevent.

The freeze was the one sanctioned source break (D3(a)): a consumer narrowing exhaustively on
`LedgerFaultPoint` (125 names; its ledger-lock subset is the frozen 58) re-narrows once against
the frozen surface and never again. The injector still receives the 13 internal boundary names
at runtime — longstanding behavior, now stated at both the `fault()` seam and the public
`faultInjector` option — so injector callbacks should treat unknown names as internal
boundaries, not errors. The only guard against a deleted name re-entering the registry is the
registry-completeness pin's `deepEqual`; `lint:fault-pins` counts declared names by literal
shape and cannot see the difference.

## 2. Test suite

| Quantity | Value | Status |
|---|---|---|
| Ledger suite | **639 pass / 50 fail** after Batch D phase 1a (+2: the exact-disable-value and unknown-value-construction pins; 637/50 after the D6(a) tolerance, 628/50 after D5(a), 619/59 after B2b, 597/59 after the W1 recognition, 583/59 after the D3(a) freeze). The 100-process flake was PASSING in the re-saved baseline, so under load it can surface as "newly failing" — re-run it in isolation per §3 before believing that; on 2026-08-06 it failed even in isolation (spawn errno -4094 at 1–3.3GB free), the §3 mechanism reproducing | measured |
| Post-B1 ledger suite (the prior recorded gate) | 546 pass / 75 fail | superseded 2026-08-05 |
| Pre-B1 ledger suite (the Batch A recorded gate) | 518 pass / 75 fail | superseded 2026-08-05 |
| Post-warm-prep-fix ledger suite as previously recorded here | 516 pass / 75 fail — written mid-Batch-A and stale by 2 against the Batch A baseline `--save`; kept as the third instance of a number in this file diverging from its own command | superseded 2026-08-05 |
| Pre-Batch-A ledger suite (the prior recorded gate) | 498 pass / 80 fail | superseded 2026-08-05 |
| Full `npm test` | **2,285 pass / 51 fail / 1 skipped** at Batch D phase 1a — the ledger floor's 50 plus one documented rotating member (gate's unknown-exceptions test, re-passed in isolation), 100-process member passing. Earlier: 2,261/60/1 after the Batch C continuation slice (the recorded 59 plus the 100-process spawn refusal, §3); 2,246/62/1 under 1GB free (three rotating members), 2,244/59/1 for the W1 slice with zero rotation (2,228/61/1 after the D3(a) freeze) | measured |
| Full `npm test` at the warm-prep fix (prior recorded) | 2,157 pass / 80 fail / 1 skipped (pre-fix same-day: 2,145/80/1) | superseded 2026-08-05 |
| Failures outside `ledger.test.ts` | **0** on an idle machine; 1–3 per run under load, differing each run, each passing in isolation (Batch B added a third observed rotating member: "unknown exceptions and clock failure are closed unavailable, never guessed signed refusals") | measured |
| Ledger suite wall clock | ~80–90 s | measured |
| Full `npm test` wall clock | ~5 min | measured |
| Full Stryker mutation run | ~11.5 h at committed concurrency | inherited |

```bash
node scripts/baseline-diff.mjs            # compare against the recorded baseline
node scripts/baseline-diff.mjs --save     # record a new one, on a quiet machine
```

**The failing tests are failing, not "pending" or "skipped."** Calling them pending is how a
still-red pin looks benign — it is what let an unsatisfiable test survive as a slice's acceptance
criterion.

## 3. Load sensitivity — read before trusting any comparison

`100 real processes converge on one committed reservation and one dispatch eligibility` is
**load-sensitive**, and this is the single most common source of fake regressions here.

| Machine state | Observed | Status |
|---|---|---|
| Quiet | 3 of 3 passes | measured |
| Three subagents running | ~1 of 3 passes | measured |
| Machine ambient CPU floor (unrelated resident apps) | ~34%, reaching 53% | measured |

The full suite is also noisy on this machine: two consecutive runs of the same code each produced
**one different** additional failure — the fixed-seed ledger fuzz in one (14.9 s in a passing run,
143 s in the failing one, 14.2 s alone), the decision-boundary ambient-dependency check in the other
— and **both passed in isolation**. A single full-suite run cannot clear an invariant here; re-run
the named test alone before believing it.

It fails as `Error: child <code>: <stderr>` with code `3221226505` — Windows `0xC0000409`
(fast-fail), a crashed child, never an assertion. **Diagnosed 2026-08-05 (Batch A), mechanism
measured, fix deliberately not applied:** the test spawns all 100 children in one `Promise.all`;
one child is **58MB RSS** at module load (measured, Node v24.9.0), so the burst wants ~5.8GB of
transient commit on a 16GB machine whose ambient free memory floats between **3.0 and 4.7GB**
(both endpoints measured the same day). When suite/subagent load pushes free memory below the
burst, children die at V8 boot — fast-fail on commit exhaustion, which is why stderr is empty.
On the diagnosis day the failure would NOT reproduce: isolation 3/3 pass, 6 CPU hogs holding
1.8GB pass, a concurrent `gate.test.js` run 2/2 pass — consistent with the 4.7GB-free reading.
The mechanical fix is bounded spawn concurrency (e.g. 25 at a time; all 100 still contend on one
root, assertions untouched), but it is **unvalidatable while the failure does not reproduce** —
an A/B today shows pass→pass. Apply it only on a day the failure reproduces, with the A/B run
under the reproducing load. Until then: **a crashed child is an environment signal, not a
defect** — re-run in isolation before attributing it to any change, and never run the suite
alongside subagents.
`scripts/baseline-diff.mjs` refuses to measure above 70% CPU busy (`REELIER_BASELINE_MAX_BUSY`). That
limit is deliberately coarse: the ambient floor above overlaps the range seen under self-inflicted
contention, so CPU alone cannot separate them and the isolation re-run remains the real check.

## 4. K1 operation fence

| Quantity | Value | Status |
|---|---|---|
| Derived port range | `20000`–`49999` on `127.0.0.1` | measured |
| Port derivation | `20000 + ((u32be of first 4 bytes of sha256(canonical-root NUL dev NUL ino)) mod 30000)` | measured |
| Windows canonicalisation before hashing | realpath, `\` → `/`, lowercased | measured |
| `netsh`-excluded range on this machine | `49246`–`49345` | inherited |

Roots whose derived port lands in an OS-excluded range are permanently unserviceable on that machine
by design — no scan, no fallback. Test helpers preflight and resample, so the suite no longer rolls
dice on machine port state.

## 5. Example corpus

| Quantity | Value | Status |
|---|---|---|
| `read` steps | **45** | measured |
| `idempotent-write` steps | **2** | measured |
| `destructive` steps | **2** | measured |
| Non-read steps that are GBrain | **3 of 4** | measured |
| Steps that are an **attested** write | **1** | measured |

```bash
grep -rh "^- effect:" examples/ | sort | uniq -c
```

The single attested write is GBrain's `put_page`, probed by `get_page`. `CLAUDE.md` §5 says all four
write steps are GBrain; that is wrong on two counts, and the corpus demonstrates one attested write
rather than four. See `docs/strategy/icp.md` §10.

## 6. Versions

| Quantity | Value | Status |
|---|---|---|
| Worktree `package.json` | **0.30.0** | measured |
| Published on npm | 0.29.0 (publishing is manual) | inherited |

## 7. Re-verifying this file

```bash
npm run lint:fault-pins                                   # §1
node scripts/baseline-diff.mjs                            # §2
grep -rh "^- effect:" examples/ | sort | uniq -c          # §5
node -p "require('./package.json').version"               # §6
```

Anything marked **inherited** has no command here and has not been re-measured at this pin. Promote a
row to measured only by running something, not by finding it repeated elsewhere.
