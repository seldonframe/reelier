# Reelier — numbers worth knowing

**Pinned to `codex/universal-compiled-authority` @ Batch A (warm-prep fix), measured 2026-08-05 on
Windows 11.** Update the pin hash to the Batch A commit when quoting.

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
| Entries in exported `ledgerLockFaultPoints` | **61** | measured |
| Entries in public `ledgerFaultPoints` | **128** | measured |
| Fault-point literals emitted anywhere in `src/` | **74** | measured |
| Declared in spec, not emitted (the backlog) | **10** | measured — **but see the gating caveat below** |
| Exported but **not** in the spec taxonomy (to delete) | **13** | measured |

```bash
npm run lint:fault-pins
```

**Gating caveat on the backlog row — read this before quoting 15.** The count fell from 24 to 15
because the fourteen admission-preparation, slot-retirement and cleanup-closure points are now emitted in `src/`, which is all
`lint:fault-pins` measures. It does **not** mean those nine are reachable on a default path: they
fire only behind a disabled host-private runtime option, and the committed pins that drive them on
the clean-root default path are still red. `10` therefore means "10 points have no emission
anywhere", not "47 points are done". The linter has no third state for *emitted but gated*; adding
one, or reading this row with the caveat attached, is the difference between a real number and the
exact trap the linter exists to prevent.

The 13 extras are election/provisional/predecessor hooks the spec explicitly forbids. Removing them
plus adding the remaining 24 is **additive at runtime but source-breaking at the type level** — a consumer
narrowing on `LedgerFaultPoint` gets TS2322 under `--strict`. That is why the ABI freeze must come
after this work, not before.

## 2. Test suite

| Quantity | Value | Status |
|---|---|---|
| Ledger suite | **512 pass / 79 fail** after the Batch A warm-prep fix (+13: the warm pin family; the 100-process flake was PASSING in the re-saved baseline, so under load it can surface as "newly failing" — re-run it in isolation per §3 before believing that) | measured |
| Pre-Batch-A ledger suite (the prior recorded gate) | 498 pass / 80 fail | superseded 2026-08-05 |
| Full `npm test` | **2,157 pass / 80 fail / 1 skipped** at the warm-prep fix (pre-fix same-day: 2,145/80/1); failing-set delta across those two runs was exactly the two documented rotating flakes | measured |
| Failures outside `ledger.test.ts` | **0** on an idle machine; 1 per run under load, differing each run, each passing in isolation | measured |
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

It fails as `Error: child <pid>: 3221226505` — Windows `STATUS_STACK_BUFFER_OVERRUN`, a crashed
child, never an assertion. **A crashed child is an environment signal, not a defect.** Re-run the
test in isolation before attributing it to any change, and never run the suite alongside subagents.
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
