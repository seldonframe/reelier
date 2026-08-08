# Path C's first user-facing command — `reelier authority validate | verify | conformance`

> **Status: plan, nothing built.** Written against `origin/main` @ `bd44bf8` (the commit that merged
> #85), 2026-08-08. Every "is built" / "is missing" claim below was read off that tree with a
> command, not from memory. Owner-scoped on 2026-08-08 to the **pure offline trio**; `sign` and
> `serve` are deferred and §6 says why.

## 1. The problem, stated as it actually is

Path C shipped its kernel and has **no way for a user to reach it**. Measured on `bd44bf8`:

```
grep -c "authority" src/cli.ts     ->  0
```

`src/cli.ts` does not import the authority module. Nineteen modules under `src/authority/` are
built, tested, and merged into `main`, and not one line of them is reachable from the CLI. Until
that changes, every Path C capability claim is a claim about code no user can run.

This plan closes that with the smallest honest slice.

## 2. Grounding — measured on `bd44bf8`, not assumed

Task 4 is already specified in `.superpowers/sdd/universal-compiled-authority.md:110-135`
("Sealed HTTPS driver, credential broker, host server, REST/MCP ingress, and CLI"). This plan does
not redefine it; it **carves** it. The SDD's CLI requirement is one line:

> Add `reelier authority validate|sign|serve|verify|conformance` commands.

**All seven Task 4 files are missing:**

```
MISSING src/authority/drivers/json-https.ts
MISSING src/authority/host/config.ts
MISSING src/authority/host/secret-resolver.ts
MISSING src/authority/host/server.ts
MISSING src/authority/ingress/mcp.ts
MISSING src/authority/ingress/http.ts
MISSING src/authority/cli.ts
```

**But the five subcommands do not share a dependency footprint**, and that asymmetry is the whole
basis for this plan:

| subcommand | needs | status |
|---|---|---|
| `validate` | `wire.ts` | **built** |
| `verify` | `wire.ts`, `crypto.ts`, `trust.ts` | **built** |
| `conformance` | `wire.ts` + fixtures | **built** (fixture corpus is thin — §7) |
| `sign` | `keys.ts` + a private-key source | built, but adds a key-handling surface |
| `serve` | driver + secret-resolver + host server + both ingress transports | **4 missing files** |

`validate`, `verify` and `conformance` are **pure functions over bytes**: no network, no
credentials, no server, no new attack surface. They are shippable today. `serve` is not.

Two more facts the implementation depends on:

- The document kind list is **closed and already exported** — `authorityKinds` in
  `src/authority/types.ts:1`, 11 kinds: `principal`, `delegation-grant`, `source-bundle`,
  `outcome-contract`, `outcome-request`, `transport-effect`, `compiled-capability`,
  `decision-context`, `gate-event`, `authority-receipt`, `pack-manifest`. `validate` can enumerate
  them without adding ABI.
- `parseAuthorityWire<K>(kind, value)` (`src/authority/wire.ts:48`) is the entire engine for
  `validate`. It already throws on unknown kinds, additional properties, and missing required
  fields — the trio is a CLI skin over behaviour that is already pinned by `wire.test.ts` (29/29).

## 3. The command surface

```
reelier authority validate <file...> [--kind <kind>] [--json]
reelier authority verify   <file...> --trust-roots <file> [--json]
reelier authority conformance [--json]
```

Dispatch: one `case "authority"` in `src/cli.ts`'s switch, delegating to a new
`src/authority/cli.ts` that owns subcommand parsing. This matches the SDD's file list exactly
("`src/authority/cli.ts`, modify `src/cli.ts`") and keeps Path C's surface out of the Path A/B
dispatch body.

**Namespacing is load-bearing, not cosmetic.** `reelier verify` and `reelier serve` already exist
as Path B commands (measured: 29 cases in the dispatch switch on `bd44bf8`). `reelier authority
verify` must never be confused with `reelier verify`, which verifies a *run receipt*, not a wire
document. The `authority` prefix is what keeps them apart; do not flatten it for convenience.

### Exit codes and four-state honesty

This is the part to get right, because it is where brand invariant #1 lives.

- `0` — every input parsed and, for `verify`, carried a signature that verified against a supplied
  trust root.
- `1` — any input failed. Precedent: `reelier policy check` "is strict and exits 1".
- **A document that is merely *unsigned*, or signed by a root not in the supplied set, is NOT a
  pass.** `verify` must report it as `unverified`/`absent` and exit non-zero. Rendering "no
  signature present" as success would be the exact failure mode invariant #1 exists to prevent.
- `validate` answers "is this well-formed under the closed v1 schema", and **must not** be
  described in output or docs as answering "is this authorised" or "is this safe". Same discipline
  as `verified` never meaning `safe`.

## 4. Slices

Each slice follows the `reelier-slice` loop: baseline, RED, independent RED review, smallest
change, focused tests, two-sided gate, broader `npm test`, independent GREEN review.

**Slice 1 — `authority validate`.** `src/authority/cli.ts` with subcommand parsing plus `validate`;
one `case "authority"` in `src/cli.ts`. Kind inferred from the document's own `v` field, with
`--kind` as an override, and an explicit error when neither resolves. Accept multiple files;
report per-file; exit 1 if any failed.
*Acceptance:* a valid fixture exits 0; a document with an additional property, a missing required
field, and an unknown kind each exit 1 with a message naming the file and the reason; `--json`
emits one machine-readable record per input.

**Slice 2 — `authority verify`.** Adds trust-root loading and `verifyTrustedAuthority`
(`src/authority/trust.ts:61`).
*Acceptance:* a correctly-signed document against a matching root exits 0; **an unsigned document
and a document signed by an unlisted root both exit non-zero and are reported as unverified, never
as passes**; a tampered body exits 1.

**Slice 3 — `authority conformance`.** Runs the committed vector corpus and reports pass/fail per
vector. See §7 — this slice is gated on the corpus question, not on code.

**Slice 4 — surface bookkeeping, in the same commit as slice 1.** Adding a command changes counts
that are pinned elsewhere; on this repo those pins bite:
- README tests badge — canonical platform is **Linux** (`badge-check.mjs` `CANONICAL_PLATFORM`),
  and CI fails the ubuntu leg on a mismatch. Any new test changes it. Take the number from CI's
  ubuntu leg; a local Windows run cannot confirm it.
- `CLAUDE.md` §3 says "28 on `main`". Measured on `bd44bf8` the dispatch switch has **29** (`bridge`
  arrived with the plugin work). It is already stale, and `authority` makes it 30.
- `package.json` exports, `README.md`, `integrations/README.md` per the SDD's file list.

## 5. What must not move

- **The fault-point registry is FROZEN at 84 emitted / 58 declared.** The trio is pure and emits no
  fault points; if an implementation finds itself adding one, that is a design error, and a
  registry change is an **owner ABI decision** — measure the complete list, present it, stop.
- **Paths A/B behaviour and fixtures stay byte-identical.** The SDD makes this an acceptance
  criterion. The `authority` namespace exists so this is structurally true rather than merely
  intended.
- No new public export beyond what the SDD names (`reelier/authority/pack`, `.../host`), and those
  belong to a later slice, not this one.

## 6. Deliberately out of scope, with reasons

- **`authority sign`** — `keys.ts` is built, so this is tempting and cheap-looking. It brings
  private-key handling into the CLI, which is a security surface deserving its own threat review
  and its own slice. Not smuggled in beside a read-only trio.
- **`authority serve`** — needs four missing files and the entire credential/network surface: DNS
  and private-IP checks, redirect refusal, header-injection refusal, wrong-account credential
  refusal, and non-disclosure of credentials in agent output. That is Task 4's real bulk and its
  real risk. It should not be co-designed with a byte validator.

Shipping the trio does **not** make Path C usable end to end, and no doc, README line, or commit
message produced by this plan may imply otherwise. It makes Path C *reachable* and gives an
operator something honest to run against documents they already hold.

## 7. Open questions — answer before slice 3, not during

1. **The conformance corpus is one file.** `test/fixtures/authority/v1/` contains exactly
   `outcome-request.json`. A `conformance` command over a single positive vector is close to
   vacuous, and worse, it would *read* as coverage. Either the corpus is extended (which vectors,
   and are negative vectors in scope?) or slice 3 is dropped until it is. **Do not ship a
   conformance command that passes because it barely checks anything.**
2. **Does `validate` read stdin?** Piping is the natural agent-facing shape; the SDD does not say.
3. **`--json` schema stability.** If it is to be consumed by anything, it is an interface. Decide
   whether it is covered by the ABI freeze or explicitly unstable, and say which in `--help`.

## 8. Risks this repo has actually hit

Not hypotheticals — each cost a slice on the branch that just merged.

- **Local green is not green.** The EACCES fail-fast passed the full local suite, a deterministic
  pin and an adversarial review, then failed CI's windows leg because a property measured with one
  holder did not hold at 100-way contention. Run both legs before believing anything.
- **A badge is not a measurement.** `main` sat red for a day on a stale badge that a plan then used
  as an arithmetic base. Take counts from a CI run, never from the README.
- **Truncated output reads like clean output.** A `| tail -20` hid four added modules and produced a
  confidently wrong audit conclusion. Prefer `--name-status` and unbounded output when the answer
  is "did anything appear".
- **`npm test | tee` reports `tee`'s exit code.** Read the `# fail` count, not `$?`.
