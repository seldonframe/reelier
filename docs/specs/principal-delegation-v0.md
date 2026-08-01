# Principal and delegation — the monotonicity laws (v0)

**Status: DESIGN. Not implemented. No code in this repo reads or writes any field below.**
This document exists so the shape is settled before the first line is written, and so a reviewer
can attack the model rather than the implementation. Companion to `trust-ladder-v1.md` (what a
receipt proves about *bytes*) — this is what it proves about *whose authority*.

---

## 0. The question this answers

A receipt today can say: *the holder of key K signed this record.* It cannot say **on whose
behalf**, and it cannot say anything at all about an agent that was spawned by another agent.

At one agent that gap is cosmetic. At forty concurrent agents it is the whole problem, and it is
the one operators describe in their own words: knowing which of many actors did a thing, and who
answers for it. A key fingerprint is not an answer — it identifies a *keyholder*, not a
*principal*, and a fleet shares keys constantly.

---

## 1. What this is not

**This is not a trust score, and v0 deliberately has no numeric reputation.**

The obvious design is the common one: score each agent 0–N from its history, and gate capabilities
on thresholds. It is rejected here for a reason that is specific rather than aesthetic.

A score is unverifiable by construction. Given a number, a third party cannot check it — they can
only re-derive it from data they do not have, under weights nobody validated. Published examples of
this pattern assign weights and penalties as hand-picked constants, then ship several
"conservative / moderate / permissive" threshold presets, which is an honest admission that the
numbers are taste rather than measurement.

Worse, a score computed from *policy compliance* measures agreement with the same policy the system
already enforces. It is definitionally blind to the in-scope-but-wrong action — the failure that
actually hurts.

So v0 commits to the opposite property: **every claim below is checkable from the chain itself, by
someone who trusts none of the parties, with no corpus, no model, and no thresholds.** A score may
be layered on later, once observed-outcome data exists to calibrate it against. It is not a
prerequisite for answerability, and never-list #3 forbids blocking on one until calibration is
demonstrated.

---

## 2. The three laws

A delegation chain is an ordered list of principals, root first. Each link is a *grant*: one
principal authorizing another to act. Three properties MUST hold across every link.

### L1 — Authority attenuates [Normative]

> A delegated principal's authority MUST be a subset of its delegator's. Never equal-by-default,
> never a superset.

A grant may narrow (fewer tools, tighter globs, smaller budget). A grant MUST NOT widen. A chain
that widens at any link is **invalid**, and a verifier MUST reject it rather than resolve it to the
narrower value — silently repairing an over-broad grant would hide the fact that someone tried.

Consequence worth stating plainly: a leaf agent can never do something the root human could not
authorize, no matter how many hops separate them. Depth cannot launder authority.

### L2 — Constraints accumulate [Normative]

> The effective constraint set at any link MUST be the union of every constraint declared at that
> link and all links above it. A child MAY add constraints; it MUST NOT drop one.

Grow-only, in the lattice sense: union at every step, no removal operator exists. Where two links
declare the same dimension at different strengths (two path globs, two budgets), the effective
value MUST be the **more restrictive** one.

This is what closes the accumulation gap — the case where each individual action is permitted and
the *sequence* is not. A constraint declared once at the root survives every hop below it without
anyone re-declaring it.

### L3 — Answerability is invariant [Normative]

> Every principal MUST carry an accountable human, and that value MUST be inherited unchanged from
> the root of the chain to every leaf.

Authority shrinks (L1) and constraints grow (L2), but answerability does neither. It is carried,
not transformed. An agent cannot be held accountable in any sense that matters; the point of the
field is that a person can.

A chain whose leaf names a different accountable human than its root is **invalid**. That is the
signature of an attempt to launder responsibility across a hop, and it is the one thing this model
exists to make impossible.

### 2.1 Why monotone, specifically

Monotone properties are the ones a stranger can check. "Did authority only ever shrink?" is a
deterministic comparison over the chain — no model, no corpus, no threshold, and therefore no
component in the verification path that a better model could improve. "Is 700 enough to deploy?"
is not checkable by anyone, ever.

Every law above was chosen because violating it is *detectable from the chain alone*. That
constraint, not elegance, is what produced three laws instead of a score.

---

## 3. Record shape (additive, unimplemented)

`RunRecord` gains, all optional:

```jsonc
"principal":  "did:web:acme.com:agents:nightly-sweep",
"onBehalfOf": "did:web:client.example",
"sponsor":    "did:web:acme.com:people:jdoe",
"delegation": [
  { "principal": "did:web:acme.com:people:jdoe",           "grantHash": "sha256:…" },
  { "principal": "did:web:acme.com:agents:orchestrator",   "grantHash": "sha256:…" },
  { "principal": "did:web:acme.com:agents:nightly-sweep",  "grantHash": "sha256:…" }
]
```

- **`did:web` only in v0.** An open, resolvable method requiring nothing but domain control —
  never-list #6 requires the identity layer be checkable with open standards, and a
  vendor-namespaced DID method would make Reelier's own namespace load-bearing. Domain control is
  sufficient proof for v0; richer methods are a later question.
- `delegation` is root-first and MUST include the leaf. A single-element chain (a human acting
  directly) is legal and is the common case.
- `grantHash` commits to the grant document that authorized that link, so a verifier can check L1
  and L2 against what was actually granted rather than what the record claims.
- Per §0.2 of `SPEC.md`, all of these are covered by the record digest automatically — the digest
  input is the whole record, so no signature-coverage change is needed to add them.

**An unverified principal MUST render as a claim, never as a fact,** and the distinction MUST be
visible on any shareable receipt. `did:web` resolution either succeeded or it did not; "did not
resolve" is `unchecked`, which per §4.6.3 is never a pass.

---

## 4. What this does not prove

Stated here rather than discovered later, because the whole point of the model is that it does not
overclaim (never-list #8):

- **Not that the action was correct.** L1–L3 constrain *authority*, not semantics. A fully valid
  chain can authorize a catastrophically wrong write.
- **Not that the human knew.** `sponsor` names who is answerable, not who was watching. A sponsor
  inherited through six hops may have no idea the leaf exists — which is precisely why the
  inheritance is unbroken, and precisely why it must not be read as consent.
- **Not that the key was not stolen.** Compromise of a principal's key produces a perfectly valid
  chain. Revocation is a separate mechanism and is out of scope for v0.
- **Not a trust score.** See §1. A valid chain says nothing about whether this principal is any
  good at its job.

---

## 5. Verification procedure [Normative]

Given a record with a `delegation` chain, a verifier MUST evaluate each independently and report
per-claim, four-state, per `SPEC.md` §4.6.3:

1. **Chain integrity** — every `grantHash` resolves and each link's grant names the next
   principal. Unresolvable → `unchecked`, never a pass.
2. **L1, attenuation** — each link's authority ⊆ its parent's. Any widening → `failed`.
3. **L2, accumulation** — no link drops a constraint present above it. Any drop → `failed`.
4. **L3, answerability** — leaf sponsor equals root sponsor. Mismatch → `failed`.
5. **Principal resolution** — each `did:web` resolves to a key that speaks for it. Unresolvable →
   `unchecked`; the record still verifies for every other claim.

A verifier MUST NOT collapse these into one verdict, and MUST NOT let an `unchecked` link render
the chain as valid.

---

## 6. Open questions

- **Where does the grant live?** `grantHash` implies a resolvable grant document. Committing to a
  hosted grant registry would put Reelier in the resolution path for every verification, which is
  the opposite of an offline-checkable receipt. Leaning toward: grants are repo-local files,
  hashed, with resolution the caller's problem.
- **Is `onBehalfOf` distinct from the chain root?** They coincide in every case examined so far. If
  they always do, the field is redundant and should be deleted before it ships.
- **Budgets as a constraint dimension.** L2's "more restrictive wins" is obvious for path globs and
  underspecified for money and counts. Depends on the budgets vocabulary, whose demand gate has not
  fired.
- **Revocation.** Out of scope for v0 and the largest hole in it. A chain valid at execute time
  must remain checkable after a key is revoked, which means revocation needs a timestamped,
  machine-checkable feed — not a flag flipped in a database.

---

## 7. Prior art, credited

The monotonicity framing is not original here. Microsoft's Agent Governance Toolkit (MIT) arrived
at grow-only restriction inheritance and delegation ceilings independently, and its context
accumulation design notes state the aggregation problem more precisely than any source found
before it. Where this spec differs is §1: that project layers a numeric trust score on top and
gates capabilities on it; this one deliberately stops at the checkable laws.

Never fight the ecosystem's proofs — wrap and join them. A chain expressed here should remain
mappable onto other delegation models rather than requiring anyone to abandon theirs.
