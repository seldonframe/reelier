# Wire contract v1

`wire-contract.v1.json` is a REAL push payload captured from this repo's
own `pushSkill` (the exact POST body `src/push.ts` sends to
`POST {base}/api/v1/runs`). It is byte-identical to reelier-cloud's copy at
`test/fixtures/wire-contract/payload.json` — the two files are the same
bytes living in two repos, and that sameness is the entire cross-repo
contract.

`wire-contract.v1.public-key.pem` is the Ed25519 public key that verifies
the fixture's `signature`.

## Why this exists

The cloud already had a strong test that consumes its copy of this fixture.
The CLI had none, so a CLI-side format drift (a renamed, added, or removed
field in `push.ts`'s POST body) could ship and slip past unnoticed until the
cloud regenerated its fixture from a newer CLI release. `test/wire-contract.test.ts`
in this repo closes that gap: it sha-locks the fixture bytes, pins the exact
top-level field set, and proves this CLI's own `reelier verify` path
(`src/verify.ts`) can consume the fixture end to end and produce a
`"verified"` unaltered-since-push claim.

## Regenerating

If the wire format changes intentionally (a new top-level field, a renamed
one, a different signing scheme, etc.), regenerate **both** repos' fixtures
from the same OSS commit — capture a fresh real push payload here, copy the
identical bytes to reelier-cloud's `test/fixtures/wire-contract/payload.json`,
and update the locked sha256 constant in **both** repos' wire-contract
tests. Do not update just one side; the whole point of this fixture is that
it is the same file in both places.

## Additive record-internal fields do NOT require regeneration

The sha-lock pins the fixture's bytes and the **top-level** POST-body field
set. Optional fields *inside* `record` (SPEC.md §4) are additive by
construction: a consumer must tolerate their absence, and the fixture — a
real captured payload, not an exhaustive schema — simply predates them.
`manifestIgnored`, `mockFailures`, `StepRecord.refs`/`write`/`attest`, and
`manifestChecked` (the positive "manifest declared + preflight passed"
signal, mutually exclusive with `manifestIgnored`) all shipped this way
without touching the fixture. Only a change to what `push.ts` emits at the
top level — or a non-additive record change — triggers the lockstep
regeneration above.

## Shipped in the npm package

`contract/` is listed in `package.json`'s `files` array, so it ships inside
the published `reelier` tarball. This is forward-looking plumbing: it lets
reelier-cloud later import the fixture directly from
`node_modules/reelier/contract/` instead of maintaining its own copy, making
the cross-repo contract fully automatic (today it is still enforced by
convention — the "update the sha in both tests" discipline above).
