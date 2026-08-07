# `bindIngress` conflates a busy lock with an authority refusal — root cause, 2026-08-07

_Found while investigating the rotating ledger failures before quarantining them. The quarantine was
NOT taken: it would have buried this. Every claim below is reproduced by a command._

## What was actually failing

The rotating red is `fixed-seed bounded ledger state-machine fuzz never creates two committed
reservations for one ingress or outcome` (`test/authority/fuzz.test.ts:16`).

**It is not the double-commit invariant.** That property is asserted at source lines 58–59 and has
**never failed in any observed run**. The failing assertion is compiled `fuzz.test.js:39`, which is
source line 43:

```ts
const binding = await ledger.bindIngress(authenticated);
assert.equal(binding.ok, true); if (!binding.ok) continue;   // <- this
```

A precondition, not a safety property. The test's name promises something it never reaches. (The
dead `if (!binding.ok) continue` after an unconditional assert shows the author already suspected
`ok:false` was reachable.)

## Root cause

`withLock` is declared (`src/authority/host/fs-ledger.ts:615`) as returning

```ts
Promise<T | Readonly<{ ok: false; reason: "busy" | "lock-owner-unverifiable" | "corruption" }>>
```

— the failure member **carries `ok: false`**, the same shape a real result uses.

Every lock-taking method guards against it:

| method | line | guard |
|---|---|---|
| `lookupIngress` | 486 | `if (isLockFailure(result)) throw new AuthorityLedgerReadError(...)` |
| `lookupIngressClaimLinkage` | 492 | same |
| (three more) | 578, 605, 611 | same |
| **`bindIngress`** | **471–480** | **none — `return this.withLock(...) as Promise<BindIngressResult>`** |

`bindIngress` is the only one. The `as` cast is what hides it from the type checker: `"busy"` is not
a member of `BindIngressResult`'s reason union (`integrity-failure` | `conflict`), so without the
cast this would not compile.

**Why it is load-dependent rather than input-dependent.** The `busy` deadlines are computed from
**real monotonic time** — `monotonicNow() + this.options.lockTimeoutMs`, default 30 s (lines 624,
646, 722, 1264, 2760, 2854) — not from the test's injected `now: () => at`. K1 admission, active by
default since Batch D (`bc21407`), routes every acquisition through `withK1OperationFence`, which
returns `{ok:false, reason:"busy"}` at four separate deadline checks (648, 649, 654, 665). That is
why this surfaced only after the flip, and why a *fixed* fast-check seed still rotates: the inputs
are identical every run; the wall-clock pressure is not.

## Reproduction

`scratchpad/repro-bindingress-busy.mjs`, against `dist/` on this branch:

```
CONTROL (default 30s budget): {"ok":true,"status":"claimed",...}
STARVED (lockTimeoutMs: 0):   {"ok":false,"reason":"busy"}
```

`bindIngress` returns `ok:false` with `reason:"busy"` — outside its own declared union.

## Why this matters beyond a flaky test

A caller cannot distinguish **"the lock was busy"** (transient, retryable, nothing was decided) from
**"this ingress conflicts"** (durable, meaningful, an authority decision). Anything treating
`ok:false` as a refusal will durably refuse a request that merely hit a busy lock.

In four-state terms that is rendering an `unchecked` as a `failed`, on the Path C write path. It
does not breach never-list #1 as written — nothing is rendered as a *pass* — but it is the same
class of error with the sign flipped, and on the side that silently denies rather than silently
allows.

## The fix is an owner decision

Two shapes, both small:

**(a) Throw `AuthorityLedgerReadError`, matching all five siblings.** No new reason, no contract
change, precedent already established in this file. Changes `bindIngress` from result-returning to
throwing on transient lock failure.

**(b) Extend `BindIngressResult` with a distinct transient reason.** Callers keep the result shape
and can retry without exception handling — but it changes a frozen contract.

Recommendation: **(a)**. Smallest change, matches established precedent in the same file, and a
transient infrastructure condition arguably should not be an authority *decision* at all. (b) is
defensible if callers should retry without try/catch.

Either way the fuzz test should then tolerate a *distinguishable* transient rather than asserting
`binding.ok === true` — but only after the fix, because today it cannot tell the two apart.

## What this does NOT fix

**Fixing the honesty bug does not make CI green.** The 30 s real-time budget still elapses under
load; only the *reporting* of that becomes honest. The two problems are separate:

1. the conflation (a real defect, fixable now);
2. the load sensitivity of a 30 s budget in a suite that runs ~2,480 tests serially.

## Measured CI state, first Linux evidence this branch has ever had

Run `31188302048` @ `48ab28c` — **both legs failed**.

| | Windows (local, `25dd32d`) | Linux (CI, `48ab28c`) |
|---|---|---|
| tests | 2,480 | 2,480 |
| pass | 2,456 | 2,457 |
| fail | 23 | 21 |
| skipped | 1 | 2 |
| fuzz test | failed | **passed** |
| `gate.test.js` | 4 failed | 0 failed |

Linux carries names Windows did not: `type-replacement`, `rename collision retains one synced
creator stage and fixed slot across replacement classes`, `option-gated acquisitions leave a root
that every entry point can still use`, `ledger-lock publication rename attempt declares and emits
its before boundary`. **The failing set is platform-divergent as well as load-divergent**, which is
the strongest argument against quarantining by name: the list is not stable enough to be a list.

The README badge (1,650) versus the Linux pass count (2,457) is a **second, independent** CI
blocker that has not even been reached — the job fails at the test step before `check-badge.mjs`
runs.
