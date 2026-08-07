# The rotating red is an OS-excluded TCP port. Measured, quantified, and spec-conflicting.

> Session A of the Path C continuation. The task was to make the gate trustworthy enough to gate
> with. The rotation is now fully explained and the explanation is **not** the one the handoff
> predicted, **not** the `fuzz.test.ts` shape, and **not** a defect in any test's assertions.
>
> **Status: diagnosed, not fixed.** The fix requires inverting a sentence in the signed spec, so it
> stops here per the stop-rules and is recorded beside the rule.

## The population, measured first

`baseline-diff.mjs` targets `dist-test/test/authority/ledger.test.js` — the **ledger** suite. The
handoff called the rotator "gate.test.js"; those are two different things and the conflation matters,
because the rotators live in both files.

CI run `31194562013` at `e8db1c6`, both legs, failing sets extracted from TAP `not ok` lines:

| | count | content |
|---|---|---|
| shared by both legs | **16** | the D2 ungranted-housekeeping family, byte-identical on Linux, Windows, and locally |
| ubuntu-only | 5 | `ledger-lock publication rename attempt…` + `the collision branch…`; `rename collision retains…` + `type-replacement`; `option-gated acquisitions…` |
| windows-only | 5 | `every found-record trust edge…`, `post-source contract expiry…`, `simultaneous trusted-candidate…` (all `gate.test.ts`); `prep-only housekeeper…` + `handoff literals…unexported` (`ledger.test.ts`) |

16 + 5 = 21 on each leg. **The two extra sets are disjoint.** Inherited numbers said ubuntu was
2456/22; it measured 2457/21. That is the seventh wrong inherited number — do not quote the eighth
without running it.

The 16 are stable everywhere and are red by design. Everything else is the subject below.

## The signature

Every non-D2 failure is the same shape: the operation consumes its **entire** K1 fence budget and
returns `busy`, which the gate honestly maps to `unavailable`, and the test asserts `refused`.

```
✖ kernel-owned observation time is fresh …   (30494.0026ms)
  + actual 'unavailable'   - expected 'refused'
```

The duration always equals the budget, at every budget tried:

| default `lockTimeoutMs` | failing test duration |
|---|---|
| 3 000 ms | 3 009 ms / 3 076 ms |
| 30 000 ms (real default) | 30 014 – 33 133 ms |
| 90 000 ms | **91 663 ms** |

**Raising the budget does not help.** That single row kills every "the machine is slow" explanation.

## Seven hypotheses, each refuted by a measurement

Recorded because the refutations are the reusable part.

| # | hypothesis | measurement | verdict |
|---|---|---|---|
| 1 | frozen/draining fixture clock stalls the ledger | standalone repro: 3× `observeClock` at a frozen instant → `{ok:true,status:"equal"}` in 26 ms | refuted |
| 2 | node runs the file's tests concurrently, so heavy tests starve light ones | probe: `A-start A-end B-start B-end` — sequential. The apparent 249 s-in-150 s overlap was the 3 ✖ lines printing twice; 249 063 − 99 290 = 149 773 ≈ wall 150 121 | refuted |
| 3 | orphaned async work accumulates across tests | 162 s of sampling: handles 2–3, requests 0–1, heap 12–28 MB, event-loop lag 0–13 ms, all flat | refuted |
| 4 | transient FS errors (Defender/indexer) retried to exhaustion | `isTransientLockError` instrumented — **never called once** | refuted |
| 5 | the acquisition loop spins | max iterations in one `attempt()` across a whole run = **1**, max 1 ms | refuted |
| 6 | post-acquisition housekeeping spins | `settlePublicationStages` + `serviceRetirementArtifacts` never exceeded 250 ms | refuted |
| 7 | `lockTail` queueing | real (up to 13.9 s) but **not the cause**: the failing calls measured `queued=0ms work=30004ms` | refuted as cause |

Two more, eliminated by tally: the hybrid coordination guard returned `continue-legacy` 1292/1292
times with `k1Names=[]`, and `inspectActiveLock` returned `absent` 1387/1387 times.

## The cause

`withK1OperationFence` (`src/authority/host/fs-ledger.ts`) uses an **exclusively bound loopback TCP
port** as its mutual-exclusion primitive, retrying `EADDRINUSE`/`EACCES` until the deadline. The port
is derived, not chosen — `src/authority/host/fs-ledger.ts:3725`:

```ts
port = 20_000 + digest.readUInt32BE(0) % 30_000        // sha256(canonicalRoot \0 dev \0 ino)
```

Instrumenting that catch during a full `gate.test.js` run:

```
[PORT] retries=544 distinct=1
[PORT]     544  EACCES port=49264
```

**`EACCES`, not `EADDRINUSE`. One port. 544 retries** (backoff capped at 50 ms ≈ 27 s ≈ the observed
33 s failure).

`netsh interface ipv4 show excludedportrange protocol=tcp` on this machine:

```
49152  49251        49409  49508        49887  49986
49252  49351   <--  49509  49608        50000  50059 *
                                        50060  50159
27339  27339                            65383  65482
```

**49264 is inside 49252–49351.** These are ordinary Hyper-V/WSL/Docker reservations.

Intersecting the exclusions with the derivation's range [20000, 49999] gives **501 unusable ports of
30 000 ≈ 1.67 % of roots**. Tests that loop over refusal reasons build dozens of fixture roots each,
so 1–5 hits per run is exactly the observed rate. Roots are `mkdtemp` — random per run — so **which**
test draws a poisoned port rotates. That is the rotation, entirely.

It explains every observation at once: exact-budget durations; budget-size independence (an excluded
port stays excluded); zero FS errors (`EACCES` on `listen`, not on a file); zero queueing; passing in
isolation (a fresh root redraws the port); the platform split (Windows reserves these ranges, Linux
does not); and the `Server` handle the earlier probe saw.

`ledger.test.ts` builds roots the same way (`tempRoot` → `mkdtemp(tmpdir(), …)`, `:142`), and its
rotators pass `lockTimeoutMs` of 20/100/2000 ms, where a *single* retry exhausts the budget. Same
mechanism, consistent with the evidence — **but not separately confirmed**, and it should not be
described as confirmed.

## Why this stops here

`docs/specs/compiled-authority-v1.md:338-349` specifies the endpoint

> bound with **no port scan, no reuse, and no fallback**

and defines the unbindable case as yielding a refusal-only classification and a `busy` that "means
not proven corrupt, never proven healthy."

**The implementation is conformant.** The spec models an unbindable endpoint as *contention* —
"contenders of every class retry binding under the one original acquisition deadline". An OS port
exclusion is not contention: it is permanent, and retrying cannot resolve it. The spec has no state
for "this address can never be bound on this host."

Four-state honesty is **not** breached: the failure degrades to `unavailable`, never to a pass. This
is a liveness/availability defect, not a correctness or honesty one.

## What it means beyond the tests — do not file this as test-only

Any operator whose ledger root hashes into an excluded range gets a **permanently unavailable
ledger**: every operation stalls for the full `lockTimeoutMs` (default 30 s) and then returns `busy`.
Nothing recovers it except moving the root. On a developer machine running Docker/WSL/Hyper-V — the
normal case — that is ~1.7 % of roots.

## The decision, which is the owner's

1. **Amend the spec to permit a bounded, deterministic fallback** on `EACCES` — e.g. a specified
   rehash chain — preserving determinism while surviving host exclusions. Inverts a signed sentence.
2. **Classify `EACCES` as permanent** and fail fast with a distinct, honest reason instead of
   burning the budget. Cheap and clearly right on its own merits, but it does **not** make the
   ledger usable for those roots, and does not de-flake the gate.
3. **Leave the product alone; make the tests select bindable roots.** De-flakes the gate without
   touching spec or `src`, but the product limit must then be recorded loudly, never silently.

(2) and (3) compose. (1) is the only one that fixes the product.

## Not claimed

- That the ubuntu ledger rotators are the same cause — consistent, unconfirmed.
- That 1.67 % generalizes; it is one machine's exclusion table.
- That any assertion in `gate.test.ts` is wrong. None are. The `fuzz.test.ts` tolerate-`busy`
  template **does not apply here**: these tests distinguish `refused` from `unavailable`, which is
  the four-state honesty boundary, and widening them would gut the thing they exist to check.

## Reproduce

```bash
cd .worktrees/universal-compiled-authority
netsh interface ipv4 show excludedportrange protocol=tcp
node --test --test-concurrency=1 dist-test/test/authority/gate.test.js
```

Instrument the `EADDRINUSE`/`EACCES` catch in `dist-test/src/authority/host/fs-ledger.js` (build
output only — `src/` was never modified during this investigation) to re-derive the `[PORT]` tally.
