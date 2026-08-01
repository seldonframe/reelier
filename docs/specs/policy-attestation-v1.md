# Policy attestation v1 — Spec

_Drafted 2026-08-01, against `origin/main` @ `5d6d521` (0.29.0); every line
number below was read out of that commit. The seatbelt has been enforcing
since flight-recorder-v1 §1 and has never once appeared in an artifact. This
puts it there: a record states which policy governed the execution it
describes, or states honestly that it does not know._

**One sentence:** a run under a live enforcing policy and a run with no
policy file at all are today byte-identical downstream, and this makes them
distinguishable — on both execution paths, in the four-state vocabulary,
without transmitting a single byte of the policy's content.

---

## 1. Why this is a never-list violation, not a missing feature

The seatbelt loads at wrap start (`loadPolicyForWrap`, `src/policy.ts:588`),
prints its summary to stderr (`summarizePolicyForWrapStart`,
`src/policy.ts:632`), and enforces per call. Then it disappears. The only
artifact that has ever carried anything about it is `TraceRecord`'s
`meta.policyGap` (`src/recorder.ts:47`), which is set on exactly one
condition — the file existed and failed to parse — and is read by exactly one
consumer, `reelier trace`'s renderer (`src/trace.ts:28-29`).

```
$ git grep -n policyGap -- src/
src/cli.ts:944:    policyGap: policyResult.ok ? undefined : policyResult.error,
src/recorder.ts:47,144,170,240,350
src/trace.ts:28,29
```

Not `compile.ts`. Not `skill.ts`. Not `runner.ts`. Not `push.ts`. It dies in
the trace on disk, and no record, no receipt and no reviewer ever sees it.

So consider the two runs an operator most needs to tell apart:

| | policy loaded and enforcing | no `policy.yml` anywhere |
|---|---|---|
| trace `meta` | `{t:"meta", …}` | `{t:"meta", …}` |
| `RunRecord` | no policy field exists | no policy field exists |
| receipt | no policy block exists | no policy block exists |

They are the same bytes. A reader holding the receipt of the first one cannot
distinguish it from the second, and — this is the part that matters — the
absence in the second case reads exactly like the presence in the first,
because there is nothing to read at all.

**That is never-list #1** (`reelier-cloud/docs/company/FOUNDATION.md`): *never
render `absent` or `pending` as a pass.* The failure here is one level below
rendering — the state is not merely rendered wrong, it is not recorded, so
every consumer downstream is structurally incapable of rendering it right. A
receipt that is silent about a control is a receipt whose reader supplies the
missing value, and the value a reader supplies to a trust artifact is
"presumably fine."

The argument for this spec is therefore **not** that observability is good.
It is that Reelier currently ships an artifact whose silence is
indistinguishable from a pass on the one control that bounds every write it
records. That is the exact failure class the product exists to catch, running
inside the product.

### 1.1 And the seatbelt can be dead without anyone knowing

Two live defects make the silence worse than a gap.

**The unreadable-file bug** (`src/policy.ts:591-597`):

```ts
for (const candidate of [project, global]) {
  let source: string;
  try {
    source = await readFile(candidate, "utf8");
  } catch {
    continue; // not found (or unreadable) — try the next candidate, then fall through to "no policy"
  }
```

The bare `catch { continue; }` cannot distinguish ENOENT from EACCES, EISDIR,
or a Windows exclusive lock. A project `policy.yml` that **exists** and cannot
be read is skipped in silence, and the loop proceeds to the global file — or,
if there is none, to `{ ok: true, policy: emptyPolicy() }`, which is
`summarizePolicyForWrapStart`'s "none configured … all calls pass through."
The operator's policy is on disk, unreadable, and the wrap reports **no policy
at all**. Nothing is warned, nothing is recorded, and the fall-through
additionally breaks the documented first-existing-file rule by letting the
global file decide despite an existing project file.

**The precedent for the fix is fourteen lines up in the same file.**
`resolveStateGateForRun` (`src/policy.ts:376`) was corrected during the S8
review to do exactly the right thing (`src/policy.ts:382-398`):

```ts
if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
return {
  mode: "off",
  warning: `[reelier] policy: ${candidate} exists but could not be read (…) — …`,
};
```

ENOENT continues; anything else warns loudly and **does not fall through**.
`loadPolicyForWrap` never got that fix. S1 mirrors it.

**The fail-open is silent by design and invisible by accident.** A malformed
`policy.yml` degrades the whole file to deny-nothing (flight-recorder-v1 §1,
"fail-open is whole-file, not per-rule"). That is correct — never-list #5,
fail open at the recorder. What is not correct is that the degradation is
announced once, on stderr, at the start of a process that may run for days.
`policyGap` was built to carry it into the trace and stops there.

Fail-open is a decision about *enforcement*. It was never a licence to be
quiet in the *record*. Those are two controls with one job each, and this spec
un-blurs them.

---

## 2. What is recorded

One first-class object, on both paths:

```ts
policy: {
  status: "verified" | "failed" | "unchecked" | "absent";
  digest?: string;                    // "sha256:<64 lowercase hex>"
  sourcePath?: "project" | "global";
  rules?: { deny: number; dryRun: number; toolScoped: number };
  unmatchedRules?: number;
}
```

`status` is the existing four-state vocabulary, used with its existing
meanings and no new ones.

| `status` | condition | `digest` | `sourcePath` | `rules` / `unmatchedRules` |
|---|---|---|---|---|
| `verified` | found, parsed clean, in force | present — sha256 of raw bytes | present | present (wrap path only — §2.4) |
| `failed` | found, malformed → deny-nothing | present — sha256 of raw bytes | present | omitted |
| `unchecked` | exists, could not be read | omitted | present | omitted |
| `absent` | no file at the project or global path | omitted | omitted | omitted |

The whole object is optional. Its absence means the record was written by a
version that predates it — never `absent`, which is a positive statement that
a version capable of looking did look and found nothing. A consumer MUST NOT
collapse the two.

### 2.1 The digest is over raw bytes, and is bound to the read that loaded it

**Raw file bytes, not canonical form**, for two reasons that both matter:

1. **It has to work in the `failed` state.** A file that does not parse has no
   canonical form. A digest defined over the parsed policy would be exactly
   absent in the state where knowing *which* broken file you have is most
   useful — and `failed` is the state that means the seatbelt is dead.
2. **Byte-level defects are the failure class.** The S8 review found a UTF-8
   BOM masking the `state_gate` key while the warning insisted the file
   contained no such key. `stripBom` (`src/policy.ts:349-352`) and the
   carefully reworded "no top-level `state_gate` key was **detected**"
   (`src/policy.ts:418-423`) exist because of it. A canonical digest cannot
   see a BOM. A raw-bytes digest can, and two files that a human reads as
   identical hashing differently is the *signal*, not the noise.

**Stated cost, accepted:** reformatting a policy — reordering keys, changing
indentation, adding a comment, converting line endings — changes the digest
with no change in enforcement. A consumer MUST NOT read a changed digest as a
changed policy. It says the bytes differ, which is all it says, and it says
that reliably.

**The binding rule (normative), and the honesty pin of this whole spec:**

> The digest MUST be computed from the exact byte buffer the active policy was
> parsed from, in the same read that produced it. No writer may re-read the
> path at record-write time. A caller that holds a `Policy` without the bytes
> it came from MUST record `unchecked`, never `verified`.

The naive implementation hashes the file when it builds the record, minutes or
days after wrap start. An operator who edits `policy.yml` mid-session then
gets a record saying `verified` over bytes that never enforced anything — the
in-memory policy is still the old one, and the digest names a file that only
started existing after every call it claims to have governed. That record
would be a fabricated positive claim, which is never-list #1 in its worst
form. §11's mutate-between-load-and-use test exists solely to make that
implementation impossible to ship.

**Digest only, never content.** A `policy.yml` names internal tool names and
destination hosts. It is operational topology, and receipts are publishable
artifacts. Nothing in this spec transmits a rule, a glob, a host, or a
comment — hashes, counts and field names only, which is never-list #7 applied
where it bites.

### 2.2 `sourcePath` is which candidate won, not a filesystem path

`policyPaths` (`src/policy.ts:568-573`) resolves two candidates:
`<cwd>/.reelier/policy.yml` and `<homedir>/.reelier/policy.yml`. The second
one contains the operator's home directory, and on this project's own primary
platform that is `C:\Users\<name>\…`.

So the recorded value is the **candidate identity** — `"project"` or
`"global"` — never the resolved absolute path. It answers the question the
field exists to answer (which of the two documented candidates decided,
which is the whole content of the first-existing-file rule) and carries no
username, no directory layout, and nothing that varies between two machines
running the identical policy.

It is present in `unchecked` as well as `verified`/`failed`: knowing that the
*project* file is the unreadable one is materially different from knowing that
the global one is, and it leaks nothing extra.

_(This is a derivation, not a re-litigation: the field was locked, its
encoding was not. It is called out here so the choice is visible rather than
discovered later in a diff.)_

### 2.3 `rules` and `unmatchedRules` — present versus able to fire

`findUnmatchedToolRules` (`src/policy.ts:675`) and
`formatUnmatchedToolRuleWarnings` (`src/policy.ts:692`) already exist, already
run unconditionally at wrap start, and already compute this — against
`[...routes.keys()]`, the exposed post-collision-rename tool names the proxy
is actually routing (`src/recorder.ts:306-311`). Today the entire output goes
to stderr and is gone.

Carrying the counts upgrades the claim the record can make:

> *a policy was loaded* → *a policy was loaded, and M of its N tool-scoped
> rules match none of the tools that were wrapped*

A rule that matches nothing is not enforcement. It is a typo, or a
collision-rename prefix nobody accounted for (flight-recorder-v1 §1's third
known limit), and it is the difference between a seatbelt that is **present**
and one that is **able to fire**. A receipt that reports the first without the
second is exactly the over-claim never-list #8 forbids.

**Why three counters and not two.** `unmatchedRules` is computed over
tool-scoped rules only — `findUnmatchedToolRules` skips any rule without a
`tool` glob, and correctly so: an `endpoint` rule matches literal URLs in
arguments (flight-recorder-v1 §1) and there is no tool inventory to check it
against. If the denominator were `deny + dryRun`, every endpoint rule would
silently dilute the ratio and understate the dead-rule count. `toolScoped` is
the honest denominator; `deny` and `dryRun` describe the file. "M of N" means
`unmatchedRules` of `rules.toolScoped`, and nothing else may be read as that
ratio.

**Counts, never globs.** `formatUnmatchedToolRuleWarnings` names the offending
glob on stderr, which is right for a local operator staring at their own
terminal and wrong for a publishable record: the glob is the internal tool
name. The record carries the count; the terminal keeps the name. §11 pins
that no rule string can reach a record.

### 2.4 `rules` is present iff the wrap path — and its absence is the claim

`unmatchedRules` requires a live tool inventory. The wrap has one. `reelier
run` does not: it connects downstreams to *execute the skill*, and **there is
no replay-side policy evaluation at all** — flight-recorder-v2 §2 lists it
under non-goals in as many words, and v2's own Non-goals line repeats it.

This forces a distinction the four-state vocabulary alone cannot carry, and
it is the second-easiest thing in this spec to get wrong. The locked table's
`verified` row says *in force*. On the run path, the deny and `dry_run` rules
are **not in force** — nothing on that path evaluates them. The only decision
the file governs during `reelier run` is the state gate (`state_gate: refuse`,
`resolveStateGateForRun` at `src/policy.ts:376`, threaded at
`src/cli.ts:310-322`).

So:

- **Wrap path** (`TraceRecord.meta.policy`): `rules` and `unmatchedRules`
  present on `verified`. Rule-level enforcement was live and its coverage was
  measured.
- **Run path** (`RunRecord.policy`): both **omitted**, always. There was no
  tool-inventory match to perform because there was no rule-level enforcement
  to have coverage of.

Their absence on a run record is not a gap; it is the statement. A record with
`status: "verified"` and no `rules` says *this file was found and parsed clean
and governed the state gate for this run* — and says nothing about deny rules,
because nothing happened that it could say.

**Reading rule (normative).** A consumer MUST NOT read
`RunRecord.policy.status: "verified"` as evidence that any deny or `dry_run`
rule blocked, intercepted, or evaluated anything during that replay. On the
run path the file governs the state gate alone.

### 2.5 What each status means on the run path specifically

`resolveStateGateForRun` already performs the traversal S1 gives
`loadPolicyForWrap`, so the mapping is direct:

| resolution | `RunRecord.policy.status` |
|---|---|
| no file at either candidate | `absent` |
| `mode: "off"` with the unreadable-file `warning` | `unchecked` |
| parsed clean (with or without the key) | `verified` |
| malformed, no `state_gate` key detected | `failed` |
| `mode: "refuse-run"` — declares `state_gate`, malformed | *no record exists* |

The last row is not an omission. `cmdRun` returns 1 at `src/cli.ts:318`,
before step 1, so no `RunRecord` is ever written — a malformed opt-in fails
closed and the absence of a receipt is the correct artifact. Consequently
`failed` on a **run** record can only ever be the keyless-malformed case,
while `failed` on a **trace** meta covers every malformed file. The two are
the same word for the same condition and reach the record through different
gates; nothing needs reconciling, but a consumer counting `failed` across both
paths should know it is not counting the same population.

### 2.6 The two loaders stay two loaders

After S1, `loadPolicyForWrap` and `resolveStateGateForRun` traverse the two
candidates by an identical rule. They are still not merged, for the same
reason `deriveFootprint` and `recordTotals` are not merged
(`docs/specs/run-shape-priors.md` §2): they answer different questions —
"what rules do I enforce for the next N tool calls?" versus "did this repo opt
into the state gate?" — and their return types encode different decisions
(`PolicyLoadResult` at `src/policy.ts:575`, `StateGateResolution` at
`src/policy.ts:371`). What they must share is the traversal rule, and S1 makes
that true. Each keeps a comment saying why it is not a duplicate of the other.

---

## 3. The trap: a record reports the policy of the run it describes

This is the single thing most likely to be specced wrong, so it is stated as
law before any mechanics.

Record a skill under policy X. Compile it. Ship it. Six weeks later someone
replays it in a repo whose `policy.yml` is Y — or which has none.

> **A `RunRecord` is evidence about one execution. It reports the policy in
> force at *that* execution, always. Never the one that was in force when the
> skill was recorded.**

Inheriting the recording-time policy would fabricate a claim about the present
out of the past: a receipt asserting a seatbelt that was fastened on a
different machine, on a different day, for a different set of calls. It would
be a positive, plausible, checkable-looking claim that is false, which is the
worst thing a trust artifact can contain.

The mechanical consequence is absolute and easy to state:

> **`policy` MUST NOT propagate through a compiled skill. The skill file gets
> no policy field, in no version, under no flag.**

Not in frontmatter, not per step, not in the manifest. The manifest binds the
*tools* a skill needs (flight-recorder-v2 §1) because tool identity is a
property of the skill; the policy is a property of the **environment the skill
runs in**, and environments are not distributable. A skill carrying a policy
field would be a skill asserting something about a machine it has never seen.

So the two records are independent measurements of the same kind of thing, at
two different times:

- `TraceRecord.meta.policy` — the policy governing **this recording session**.
- `RunRecord.policy` — the policy governing **this replay**.

Neither is derived from the other. `compile` reads the trace, and passes
nothing about policy into the skill it writes.

### 3.1 Superseding `policyGap`

`policyGap` is a strictly weaker predecessor: one condition of four, a prose
string rather than a state, no digest, no source, no counts. It is superseded,
in three parts.

- **Stop emitting it.** Once `meta.policy` ships (S2), no writer sets
  `policyGap`. `src/cli.ts:944` and the `startRecording` parameter chain
  (`src/recorder.ts:144,170,240,350`) carry the new object instead.
- **Keep parsing it, forever.** Traces on operators' disks predate this. A
  reader encountering `meta.policyGap` and no `meta.policy` normalizes it to
  `{ status: "failed" }` — the condition `policyGap` was set on is exactly the
  `failed` condition, so the mapping is total and lossless in the only
  direction it needs to be.
- **Never write both.** A writer emits `policy` or (historically) `policyGap`,
  never the two together. A reader that finds both MUST prefer `policy`.

**A legacy-mapped `failed` carries no `digest`.** Nothing hashed the file at
record time, and re-deriving one now is impossible — the file has moved on, or
is gone. The digest is therefore optional even in `failed`, for legacy records
only, and:

> A consumer MUST NOT read a missing `digest` on a `failed` record as "no file
> was found." `absent` is the state that means no file. A missing digest on
> `failed` means the record predates digests.

The normalization is a **read-side** operation in the trace reader. Its output
is used for rendering and diagnostics at compile time and is never written
into the skill — §3's law does not acquire an exception for old traces.

---

## 4. Compatibility

Non-negotiable, and each item has a pin in §11.

- **`policy` is optional on both structures.** A record without it stays
  valid, parses without warning, and verifies. `reelier verify` MUST NOT
  require the field, gate on it, or change a verdict because of it. Verifying
  a receipt is a question about the record's integrity; the policy block is
  evidence carried inside a record, not a term of that question.
- **Additive per SPEC §0.** Trace records tolerate unrecognized fields within
  a known `t` (§0's forward-compatibility rule); the run-record shape gets a
  minor bump, the same treatment `refs` (0.20.0) and `stateCheck` (0.25.0)
  received.
- **`SPEC.md` is updated in the same commit.** The spec-conformance test
  (`test/spec-record-shape.test.ts`, commit `ca3258d`) lints the TypeScript
  types against §4.1/§4.2 and fails when a record field ships undocumented.
  `RunRecord.policy` and its nested keys go in §4.2 in the commit that adds
  the field — not the one after.
- **Also document the trace side, which the guard does not cover.** That test
  reads `StepRecord`/`RunRecord` only, and §2.2's `TraceRecord` table already
  omits `policyGap`, `toolManifest` and `manifestGap` — three fields that
  shipped into the meta record without documentation and stayed undocumented
  because nothing was watching. `meta.policy` goes into §2.2 in the same
  commit as S2. Extending the guard to `TraceRecord` is out of scope here and
  is named in §12 rather than left implicit.
- **Pre-policy receipts render byte-identically in cloud.** A receipt whose
  record carries no `policy` produces the same page and the same `/md` bytes
  as before S5. This property has been pinned twice already —
  `test/receipt-md.test.ts:23` (pre-attest, pinned literal) and `:186`
  (pre-intent) — and this is the third.

---

## 5. Cloud rendering (S5)

Seams: `src/lib/ingest.ts` persists the block, `src/app/r/[token]/page.tsx`
renders it, `src/app/r/[token]/md/route.ts` is the `/md` twin. The ladder
copy in `src/lib/receipt-ladder.ts` is the tonal precedent — it already
carries the reasoning about a field whose absence conflates two conditions
(`manifestIgnored`, `src/lib/receipt-ladder.ts:20-33`).

**`verified` renders neutral. Never a green badge.** Same never-list #8
adjacency reasoning that stripped the green badge from the principal block: a
green mark next to a policy line is read as "this run was safe," and what the
line supports is "a policy file was loaded and its rules named real tools."
The distance between those two readings is the entire product. Neutral
type, no color semantics, no check mark.

**`absent` renders unalarming.** Most operators have no `policy.yml`, and that
is a legitimate configuration, not a deficiency — the recorder is useful with
no seatbelt at all. A warning icon on the majority state trains every reader
to ignore the field, and a field readers ignore cannot carry the `failed`
signal when it matters.

> Overstating in the alarm direction is the same sin as understating. Both
> make the receipt say something the evidence does not.

The copy states the fact and stops: no policy file was found at either
candidate path. Not "unprotected," not "no policy configured ⚠", not a nudge
to add one.

**`failed` and `unchecked` are findings, and are not the same finding.**
`failed` — a file was found, it did not parse, enforcement degraded to
deny-nothing for that session. `unchecked` — a file exists and could not be
read, so what it declared is unknown. The second is strictly weaker and must
never be rendered as the first: `failed` names a known-dead seatbelt,
`unchecked` names an unknown one, and collapsing them would render an unknown
as a negative in the same way the current silence renders an unknown as a
pass.

**`unmatchedRules > 0` is a finding even when `status` is `verified`.** That is
the entire reason the counts are in the record. The row reads as the fact —
`3 of 12 tool rules matched none of the wrapped tools` — and never as a
verdict; a rule matching nothing may be a typo, a collision-rename prefix, or
an operator deliberately carrying a rule for a server that was not wrapped
this session. It is reported, not diagnosed.

**Forbidden on this surface, test-pinned** (`docs/specs/run-shape-priors.md`
§1 establishes the pattern): "protected", "secure", "safe", "compliant",
"enforced" as a standalone claim, and any construction where "verified" sits
adjacent to a word about outcomes rather than about the file.

---

## 6. The charter question, argued

Adding a positive claim to a record is arguably a new attested assertion, and
this project's own precedent is that expiring approvals (0.29.0) required a
charter amendment *before* build. The question is whether this needs one too.
It is argued here rather than assumed, and the founder's read is tested rather
than adopted.

**The case that it does not.** Three properties, and all three hold:

1. **It grants no permission.** No call that was denied becomes allowed, no
   write that was refused becomes dispatched, no flag changes meaning.
2. **It changes no gate decision.** Nothing reads `policy.status`. Not the
   wrap's per-call evaluation, not the write gate, not the state gate, not an
   exit code, not `reelier verify`, not a check predicate. The field is inert
   by construction — the same discipline `exposure` (0.29.0, SPEC §3.7) ships
   under: recorded, rendered, gating-inert.
3. **It makes an existing decision's precondition visible.** The policy was
   always loaded and always in force. The record simply stops omitting which
   one.

Contrast the expiring-approval precedent precisely, because the contrast is
the argument. `expiresAt` changed **when an approval stops being valid** — it
altered the semantics of an existing authorization, could turn a write that
would have dispatched into one that does not, and introduced a new way for a
grant to end. That is new authority, and new authority is what a charter
governs. This adds no authority; it removes an omission. A charter that
required an amendment to stop under-reporting would be a charter that
protects silence.

**The honest counter, which is not weak.** `status: "verified"` is a positive
claim, printed on an artifact whose entire value is that its positive claims
are true, and people will rely on it. If it can ever be wrong — if a record
can say `verified` about a policy that was not the one in force — then this
does not merely fail, it fails as a **fabricated positive**, which is
never-list #1 in its worst form and strictly worse than the silence it
replaces. Silence under-informs. A false `verified` misinforms, and the reader
has no way to catch it.

That counter is not answered by intent. It is answered by making the
failure mode unreachable:

- **§2.1's binding rule** makes `verified` mean "these exact bytes, hashed in
  the same read that parsed them, are the policy that was in force" — a claim
  about a buffer the process holds, not about a path that other processes can
  change underneath it.
- **The degradation is specified in the safe direction**: a caller that cannot
  bind the digest to the loaded bytes records `unchecked`. `verified` is never
  a fallback, a default, or an inference. It is earned or it is not claimed.
- **§11.6 pins it adversarially**: mutate the policy file between load and use,
  and prove `verified` becomes unclaimable — the record either names the loaded
  bytes or degrades, and never names the mutated file.

**Conclusion.** No charter amendment. This is an honesty fix inside the
existing charter, and the reason it is safe to say so is the pin, not the
argument. If §11.6 cannot be made to pass, this spec is wrong and the field
does not ship.

---

## 7. The limit, stated before anyone oversells it

What this proves, exactly and only:

> A policy file was found at a named candidate, its bytes hash to this digest,
> it parsed (or did not), and — on the wrap path — its tool-scoped rules named
> tools that were actually wrapped.

What it does **not** prove, each of which someone will eventually assume:

- **It does not prove a rule fired.** `verified` with 12 rules and 0 unmatched
  says twelve rules were live and every one of them named a real tool. Whether
  any call ever matched one is a different question, answered by the trace's
  `denied`/`dryRun` result records, not by this field.
- **It does not prove the rules were correct.** A well-formed policy that
  denies nothing anyone would ever call is `verified`. Content correctness is
  out of scope by charter.
- **It does not prove all writes went through the wrap.** A direct HTTP call
  inside the operator's own service never touches an MCP tool and is invisible
  to the proxy. **That is the completeness atom — named and unbuilt.** Receipts
  prove what receipted writes did; nothing here proves all writes were
  receipted, and this field must never be cited as though it did.
- **It does not prove the policy was in force for the whole session.** It
  names the bytes loaded at wrap start. Nothing re-reads the file, so a policy
  edited mid-session leaves the loaded one enforcing — which is the correct
  behavior and is exactly what the digest reports.

---

## 8. Slices

Each ships independently and leaves the tree honest.

**S1 — the unreadable-file fix + `unchecked`.** ~0.5 day.
Mirror `resolveStateGateForRun` in `loadPolicyForWrap`: continue on ENOENT
only, warn loudly on anything else, do not fall through. `PolicyLoadResult`
gains a third variant for the unreadable case, and
`summarizePolicyForWrapStart` gains its line. **Standalone — fixes a live bug,
records nothing, ships first**, and can merge on its own if everything below
is deferred.

**S2 — wrap path + legacy mapping.** ~1 day.
`TraceRecord.meta.policy` (`src/recorder.ts:25-63`), threaded from
`src/cli.ts:944` in place of `policyGap`. Digest computed in
`loadPolicyForWrap` from the buffer it already read (§2.1's binding rule).
Reader-side `policyGap` → `{status:"failed"}` normalization. `src/trace.ts`
renders the new block. SPEC §2.2 updated in this commit.

**S3 — run path + `RunRecord` + `SPEC.md`.** ~1 day.
`RunRecord.policy` (`src/runner.ts:245`) from the `resolveStateGateForRun`
result `cmdRun` already holds (`src/cli.ts:310`), per §2.5's mapping, with
`rules`/`unmatchedRules` omitted per §2.4. SPEC §4.2 + the conformance table.
The spec-record-shape guard must be green in this commit, not the next.

**S4 — `unmatchedRules` on the wrap path.** ~0.5 day.
Counts from the `findUnmatchedToolRules` call that already runs at
`src/recorder.ts:309`. Counts only — the globs stay on stderr. (Titled "on
both paths" in the brief; §2.4 shows the run path has no inventory to match
against, so this is wrap-only by construction and the run path's omission is
S3's business.)

**S5 — cloud render + `/md` twin.** ~1 day, `reelier-cloud`.
Ingest, page, `/md`, per §5's rendering rules, with the third byte-identical
compat pin and the forbidden-word lint.

Order is S1 → S2 → S3 → S4 → S5. S1 is independent of all of them; S4 depends
on S2; S5 depends on whichever of S2/S3 has landed and degrades to rendering
whichever block exists.

---

## 9. Non-goals

Replay-side policy evaluation (flight-recorder-v2 non-goal, unchanged) ·
policy **content** in any record, receipt, or wire payload · any policy field
in a skill file (§3, law) · a remote policy control-plane · per-rule fail-open
· any consumer that gates, exits non-zero, or changes a verdict on
`policy.status` · completeness attestation (§7) · extending the
spec-record-shape guard to `TraceRecord` (real, worth doing, its own change).

---

## 10. Test matrix

Required coverage. Rows 2, 3 and 6 are the ones that catch the specific
defects this spec exists for.

| # | Case | Asserts |
|---|---|---|
| 1 | **All four states**, wrap path | clean file → `verified` + digest + `sourcePath` + counts; malformed → `failed` + digest, no counts; unreadable → `unchecked`, no digest; neither candidate → `absent`, digest and `sourcePath` both omitted |
| 2 | **Unreadable file specifically** | project file unreadable + global file present → `unchecked` naming `"project"`, **and the global policy is NOT loaded** (the fall-through bug, pinned as fixed); one stderr WARN; the wrap still starts (never-list #5 — fail open at the recorder) |
| 3 | **BOM'd policy file** (S8 regression class) | a file identical to a clean one except for a leading U+FEFF produces a **different digest**; whatever `status` the strict parser yields is recorded faithfully; no code path silently normalizes the BOM out of the hashed bytes |
| 4 | **Old record, no `policy`** | a pre-S3 `RunRecord` parses, verifies, and pushes unchanged; `reelier verify` never consults the field; the missing field is never rendered or reported as `absent` |
| 5 | **Old trace with `policyGap`** | compiles with the meta normalized to `status: "failed"`; **`digest` absent** and not fabricated; the compiled skill contains **no policy field of any kind** (§3's law, asserted on the serialized bytes) |
| 6 | **Mutate between load and use** (the honesty pin) | load a valid policy → overwrite the file on disk with different bytes → write the record → the digest equals the **loaded** bytes, never the on-disk bytes; and a caller constructed without the source buffer records `unchecked`, never `verified` |
| 7 | **Run-path shape** | `RunRecord.policy` never carries `rules`/`unmatchedRules`; a `refuse-run` resolution writes **no record at all** (§2.5's last row) |
| 8 | **No content leak** | over every state, and over a policy whose globs and endpoint hosts are distinctive sentinels, no rule string, glob, host, path fragment, or home-directory component appears anywhere in the serialized trace, record, or push payload; `sourcePath` ∈ `{"project","global"}` |
| 9 | **`unmatchedRules` arithmetic** | a policy mixing tool and endpoint rules reports `toolScoped` excluding the endpoint rules; collision-renamed tools counted against the exposed names (`[...routes.keys()]`), matching what `findUnmatchedToolRules` already does; `unmatchedRules ≤ rules.toolScoped` always |
| 10 | **Spec conformance** | `test/spec-record-shape.test.ts` green in the same commit that adds `RunRecord.policy` |
| 11 | **Cloud byte-identity** | a pre-policy receipt renders byte-identically on the page and at `/md` (third pinning, after `test/receipt-md.test.ts:23` and `:186`) |
| 12 | **Cloud copy** | `verified` emits no green-badge markup and no forbidden word (§5); `absent` emits no alarm affordance; `unmatchedRules > 0` renders a finding on a `verified` receipt |

**Fixture note for row 2, platform-specific and load-bearing.** `chmod` is a
no-op for this purpose on Windows, which is this project's primary platform, so
a permissions-based unreadable fixture silently degrades to "readable" and the
test passes without testing anything. Use a **directory at the policy path**
(EISDIR) as the portable fixture — it is a genuine non-ENOENT read error on
every platform CI runs on — and add the EACCES variant guarded to POSIX. A
green row 2 that never produced a read error would re-open the exact bug S1
closes.
