# RETRACTED — there is no `bindIngress` defect. The rotating red was an over-strict test.

> **This document asserted a defect that does not exist.** It was committed and pushed in that state
> (`b69a551`) and is corrected here rather than deleted, because a capabilities repo that quietly
> removes its own wrong claims teaches nothing. What follows is the retraction, the actual cause,
> and the specific reasoning error — that last part being the only durable value here.

## The claim that was wrong

The original document asserted:

> `"busy"` is not a member of `BindIngressResult`'s reason union (`integrity-failure` | `conflict`),
> so this is also a type-safety hole papered over by the `as` cast.

**It is a member.** `src/authority/ledger.ts:128`:

```ts
export type BindIngressResult =
  | Readonly<{ok:true;status:"claimed";evaluationEligible:true;ingressClaimDigest:string}>
  | Readonly<{ok:true;status:"exact-existing";evaluationEligible:false;ingressClaimDigest:string}>
  | Readonly<{ok:false;reason:"conflict";evaluationEligible:false;ingressClaimDigest:string}>
  | Readonly<{ok:false;reason:"integrity-failure"|"busy"|"lock-owner-unverifiable"|"corruption"}>;
```

And this is not incidental. `ReserveReason` (`:80-92`), `TransitionReason` (`:94-103`) and
`RecoverResult` (`:117-119`) all carry the same three lock reasons. `RecoverResult`'s failure member
is *exactly* the lock union and nothing else. **Reporting a lock the call could not take as a result
reason is a deliberate, three-times-repeated API decision.**

So `bindIngress` returning `{ok:false, reason:"busy"}` is the contract working as designed. The
`as Promise<BindIngressResult>` cast is a narrowing convenience, not a cover-up.

## The asymmetry was read backwards

The original document made much of five methods guarding with `isLockFailure` while `bindIngress`
does not. That asymmetry is principled, and in the opposite direction to the one claimed:

| | return type | can it express a refusal? | therefore |
|---|---|---|---|
| `lookupIngress`, `lookupIngressClaimLinkage`, `getReservation`, `getReservationHistory`, `getHighWaterMark` | `… \| undefined` | **no** | must **throw** |
| `bindIngress`, `reserve` | a result union carrying the lock reasons | **yes** | must **return** |

The guard is absent from `bindIngress` because it would be wrong there, not because it was
forgotten.

## Two independent facts that would have caught this immediately

1. `ledger.test.ts:2215` pins `assert.deepEqual(await ledger.bindIngress(second), {ok:false,
   reason:"corruption"})` — `bindIngress` is *specified* to return a lock-family reason.
2. The "fix" was written and it broke that test on the first focused run.

## The reasoning error, stated plainly

The reason union was read off the **implementation's return sites** (`integrity-failure`,
`conflict`) rather than the **declared type**. Everything downstream — "type-safety hole",
"load-bearing cast", "four-state honesty breach", the recommendation to throw — followed from that
one unchecked inference, and was asserted with a confidence the evidence never supported.

The grounding table in `CLAUDE.md` §10.3 exists for exactly this: bind a claim to a symbol and
re-check the symbol. A claim about a **type's members** must be read from the type.

## What the cause actually was

`fuzz.test.ts` asserted `ok === true` on two results whose unions explicitly permit transient lock
failure:

- line 43, `assert.equal(binding.ok, true)` on `BindIngressResult`
- line 56, `assert.equal(recovered.ok, true)` on `RecoverResult`

The K1 operation fence budgets acquisition against **real monotonic time**
(`monotonicNow() + lockTimeoutMs`, default 30 s), and K1 admission has been active by default since
`bc21407` — so under machine load the budget elapses and a legal `busy` is returned. The test then
failed on a contractual outcome. That is why an **identical fixed seed** rotated: the generated
inputs never varied, only the wall-clock pressure did. It also explains the platform split — the
test failed on Windows locally and passed on Linux CI in the same commit.

Both assertions now tolerate `busy` and `lock-owner-unverifiable` and skip, while `corruption` — a
durable condition — still fails loudly.

## Evidence for the fix

| condition | before | after |
|---|---|---|
| normal (~17 s) | mixed (3 fails in 5 observations) | pass ×4 |
| **deliberate CPU contention** | **fail** at 347 s | **pass** at 407 s |

The contention row is the discriminator: a *slower* run than the one that previously failed now
passes.

## What remains untouched and unclaimed

- **No product code changed.** The attempted `bindIngress` change was reverted; `src/` is as
  committed.
- **`reserve()`'s result is discarded entirely** by the fuzz test (line 53, no check). Not a
  correctness problem for this property, but it is unexamined.
- **The `gate.test.js` rotators are undiagnosed.** `contract-expired` and
  `capability-already-reserved` are both legal `ReserveReason`s, so they may be the same
  over-strict-assertion shape — but that is a hypothesis, and this document has already been wrong
  once by not checking one.
- **The four Linux-only failures are undiagnosed.**
- **The 16 core reds are unchanged** — still the ungranted housekeeping-permission family, still
  awaiting the D2 decision, still not to be "fixed".
