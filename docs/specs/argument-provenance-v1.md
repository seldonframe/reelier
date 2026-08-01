# Argument provenance (v1)

**Status: SLICES 1–3 BUILT (2026-08-01). Path A records provenance; Path B remains DESIGN.**

- **Built — the resolver:** `src/provenance.ts` — the leaf grammar (§6), the source index (§7.3),
  the two-tier resolver (§7.1, §7.2) and the shared name caps. Pure functions, 31 tests.
- **Built — the trace surface (§4.3):** `src/provenance-trace.ts` and
  `reelier trace <file> --provenance`. Read-only, offline, over a trace already on disk. 32 tests
  across `test/provenance-trace.test.ts` and `test/provenance-cli.test.ts`, including the
  zero-touch pin (`reelier trace` without the flag is byte-identical) and the banned-word and
  no-score pins on the renderer.
- **Built — live pre-dispatch provenance:** the wrap maintains a bounded, hash-only index during a
  recording window and writes the additive `t: "prov"` record in §8.1 immediately before a call is
  dispatched. The cap is 4,096 source leaves (§7.7). Nothing gates on it anywhere.
- **NOT built:** `StepRecord.prov` (§8.2) and replay-path fill tracking (§4.1). Provenance is not in a
  run record, receipt or pushed artifact.
- **Also changed:** `src/expect-mac.ts` exports `tagScalar` and `assertNoProtoKeyDeep` (§7.4 — one
  definition, no twin). `assertNoProtoKeyDeep` gained an optional third `who` label defaulting to
  `probeArgsMac`, so every pre-existing message is byte-identical.
- **Implementation amendments:** §4.3, §4.4, §5.3, §5.4, §7.5 and §7.7, recorded below rather than folded in
  silently.

Every code reference was read from `origin/main` @ `5d6d521` (v0.29.0) on 2026-08-01, by
`git cat-file`, not from the working tree — this branch (`feat/policy-attestation`) carries
uncommitted changes to `src/cli.ts`, `src/policy.ts`, `src/recorder.ts` and `src/trace.ts`, and
two of those files are cited here. `src/runner.ts`, `src/skill.ts`, `src/assert.ts`,
`src/escalate.ts` and `src/expect-mac.ts` are byte-identical between the working tree and the pin;
the recorder is not. If the pin is stale, re-verify before building.

Companion to `artifact-attestation-v1.md`, whose hashing primitives, name-list caps and
record-shape discipline this reuses verbatim (§7.4, §8.3) and whose one exposure opt-in it
deliberately declines (§8.4). Where that spec answers **what left**, this one answers **where each
part of it came from**. They address the same object with the same `args.` namespace and compose on
one step.

---

## 0. The question this answers

An agent fills an outbound tool argument with a value it authored, rather than one that came back
from a prior tool response or was supplied as input. Nothing downstream can tell the difference: the
field is populated, the type is right, the call succeeds.

Three production failures from one operator running a voice agent that books paid jobs, five weeks
live. They arrived as three unrelated bug reports.

1. **Required `name` and `phone` filled with the literal string `"not provided"`.** Non-empty, so
   every completeness check passed. The owner got a job with an address he could not find and a
   customer he could not call.
2. **The agent told a customer it already had their phone number.** The only phone number anywhere
   in that conversation was the *company's own*, which the agent had written out itself two messages
   earlier. It read its own output back as customer data.
3. **Given `john@example.com`, it recorded the customer's name as `John`.** Nobody asked it to.

Three failures, one check. None of them needs to know what a customer is, what a name looks like, or
what a valid phone number is. Each is a question about **lineage**: is this outbound value traceable
to something that came back, or to input?

That framing is the whole design. It is also the discipline that keeps this shippable — the moment
the check knows what a phone number looks like, it has become business logic and it is no longer
ours (§1).

### 0.1 The failure class is not only in other people's agents

`resolveL2` (`src/escalate.ts:388-405`) lets the escalation model propose a **replacement `args`
object** for a single re-execution, and `executeStep`'s L2 branch dispatches it
(`src/runner.ts:1613`, `:1646`). The only structural guard on that object is
`findUnboundTemplateVar` (`src/escalate.ts:257`, enforced at `:394-396`), which restricts
`{{placeholder}}` names to already-bound variables. **It says nothing about literals.** A model-
authored literal in an L2 patch is an outbound argument value with no source, which is exactly
failure class 0.

The exposure is narrower than that sounds, and the narrowing is load-bearing:

- A `destructive` step never reaches L2 (`src/runner.ts:1575`).
- An `expect:`-bearing step never reaches L2 (`src/runner.ts:1585`).
- An **approved** write recomputes the approval hash over the L2 candidate template and refuses on
  mismatch before dispatch (`src/runner.ts:1625-1642`), so a model-invented literal fails the hash
  and never goes out.

What remains: an `idempotent-write` step on the legacy flag path (`--allow-writes`/`--yes`, where
`step.approve === undefined` and the block at `:1625` is skipped entirely), and every `read` step.
For those, an L2 patch's literals dispatch unreviewed — and on success `applyWritebackSafely`
(`src/runner.ts:1668`) writes the patched `args` back into the skill file, so a model-authored
template becomes the skill's template for every later run.

This is stated first because a spec about a failure class should say where the class already lives in
its own product. It is also the one place on the replay path where provenance is not trivially known
(§5.1), and therefore the one place a `prov` block on that path earns its bytes.

---

## 1. Explicitly out of scope: the fourth failure

The same operator had the agent **quote below its minimum callout price**, computing from square
metres. That is content correctness and business rules. It is not ours, and no part of this spec may
be built in a way that starts to make it ours.

The authority is `FOUNDATION.md`'s never-list #8 and the boundary statement it carries: proof of
change certifies **scope**, never semantic correctness.
`reelier-cloud/docs/company/2026-07-29-safety-atoms.md` supplies the argument rather than the phrase
— its opening states the residual class exactly:

> The residual class — the in-scope, in-budget, fresh-state, *semantically wrong* write — passes
> every deterministic predicate by construction. Closing it needs judgment; judgment needs a model in
> the path; that forfeits the guarantee that makes everything else trustworthy.

*(Citation note, carried forward from `artifact-attestation-v1.md` §10: the phrase "content
correctness" does not appear in `2026-07-29-safety-atoms.md`. Do not cite it for the phrase.)*

### 1.1 The trapdoor, named before anyone opens it

Out-of-scope statements are cheap. This one has a specific mechanism by which it will be violated,
and naming the mechanism is the only part of §1 that does any work.

A price computed from square metres is a **transformation of a grounded input**: the area came from
somewhere real, and the price is arithmetic over it. Under §7 that price resolves `authored`,
because arithmetic is not a value-preserving normalization. An operator who wants fewer `authored`
rows will ask for an arithmetic transformation tier — `value == 2.5 × source` — and the moment that
tier exists, the resolver holds a per-field arithmetic relationship between a tool argument and a
prior response. From there, "the multiplier must be ≥ the minimum callout rate" is a two-line
change, and Reelier is validating prices.

**[Normative]** The transformation tier is a **closed, enumerated list of value-preserving
normalizations** (§7.2). Arithmetic, unit conversion, formatting derivation, field splitting, and
substring extraction are excluded — not because they are hard, but because each one is a door into
§1. A future tier may be added only by naming which door it opens and why it stays shut.

---

## 2. What the record is allowed to say [Normative]

Three states, one per addressed argument value. Each is a **fact about lineage**, never a verdict
about the value.

| state | means |
|---|---|
| `grounded` | the value was found in a source this run holds (§5), at a named coordinate |
| `authored` | this run held a usable, complete source set for that lookup, and the value is not in it |
| `unresolved` | this run could not establish either — the source set was incomplete, unreadable, or unaddressable at that point |

`authored` is a **positive negative**: we looked at everything we hold and it is not there.
`unresolved` is the absence of a measurement. Collapsing the two is the single most likely
implementation error, and it is the same distinction `projectionMisses` already draws between
`absent` and `unprojectable` (`src/expect-mac.ts:234-279`) for exactly the same reason — a consumer
that infers absence from a missing key asserts a fact the raw observation can disprove.

**Ungrounded is not wrong.** An agent legitimately authors values all day: a summary, a subject line,
a generated slug, a natural-language query, an idempotency nonce. On a well-behaved run most string
arguments will be `authored`, and that is the correct reading of a correct run.

**[Normative] The four rules this surface lives under.**

1. **No verdict vocabulary.** "fabricated", "hallucinated", "ungrounded" (as a pejorative),
   "suspicious", "unsafe", "invalid", "violation" and their neighbours are forbidden on every
   surface that renders this — CLI, receipt page, `/json`, badge. The precedent and the enforcement
   shape are `test/priors-render.test.ts`'s test-pinned banned-word list. `authored` is the word,
   and `authored` is not an accusation.
2. **No score.** No confidence percentage, no grounding ratio, no per-run "provenance coverage"
   number. Never-list #3 forbids blocking from a learned score; a number on this surface is how a
   score gets built by someone who never read the never-list. Counts of each state are permissible
   (they are counting, not scoring); a ratio of them is not.
3. **`unresolved` renders as neither a pass nor a fail** (never-list #1). It is the same state class
   as `absent`/`pending`, and it gets the same treatment: shown as itself, muted, never green, never
   red.
4. **Nothing here changes an outcome or an exit code in v1.** `reelier run` returns exactly what it
   would have returned; the wrap dispatches exactly what it would have dispatched. This is a
   recorder. The gate question is §10, and it is not answered here.

---

## 3. This is `bind` inverted — and the inversion is not symmetric

The reason Reelier can do this is that the response history already exists. On the wrap path every
tool result is written to the trace (`TraceRecord` `t: "result"`, `src/recorder.ts:66-79`); on the
replay path every step's response becomes an `Observation` that asserts and binds already read
(`src/runner.ts:726-756`). The check is therefore "is this outbound value traceable to something
that came back?" — which is `bind`/`{{var}}` run backwards.

### 3.1 How `bind` resolves today, verified

`evalBind` (`src/assert.ts:221-254`) accepts exactly two forms and nothing else:

```
<name> = json.<dotpath>          # JSON.parse(obs.body), then resolveDotPath
<name> = body match /<regex>/    # capture group 1, or failure
```

Both are evaluated against **one** observation — the step's own — inside `evaluateAssertsAndBinds`
(`src/runner.ts:744-755`). Successful binds land in a step-local map and are merged into the shared
`bindings` map only when the step's outcome is a deterministic success (`Object.assign(bindings,
exec.binds)`, `src/runner.ts:1816`; the reasoning is the comment at `:881-888`). The shared map is
seeded from the run's `--var`s (`src/runner.ts:1704`). `fillTemplate` (`:442-484`) then substitutes
`{{name}}` into a later step's argument template.

### 3.2 Four asymmetries the inverse has to survive

**1. Forward is declared; backward is searched.** `bind` names the dotpath, so resolution is a
lookup. The inverse has nothing declared: no author wrote down where the value should have come from,
so the resolver must search the corpus for a coordinate that would have produced it. Search over a
corpus is a different reliability class from evaluating a declared path, and every honesty rule in
§2 exists because of that difference.

**2. Forward reads one observation; backward reads all of them.** `evalBind` gets `obs`. The
resolver gets every prior response in the run. Scope is the run, not the step.

**3. `fillTemplate` stringifies, and that collides with the type-tagging rule.** At
`src/runner.ts:470`:

```ts
return typeof v === "string" ? v : JSON.stringify(v);
```

A bound number `42` reaches the wire as the **string** `"42"`. Meanwhile `tagScalar`
(`src/expect-mac.ts:82-86`) exists precisely so that `1`, `"1"` and `true` commit differently —
amendment A6's false-MATCH rule.

**[Normative]** Both hold, and they do not conflict, because they answer different questions. Any
*commitment* this design records stays type-tagged (`tagScalar`, unchanged). *Matching* compares an
outbound string against a source scalar's raw form **and** its `JSON.stringify` form, because the
shipped runner provably performs that conversion. This is a sanctioned tier-1 equality with code
behind it (§7.1), not a transformation (§7.2), and it is the only place the two encodings meet.

**4. Bind names are constrained; argument paths are not.** `evalBind`'s name grammar is
`[a-zA-Z_][a-zA-Z0-9_]*` and `parseSkill` reserves the computed-date spellings
(`src/skill.ts:570-579`). Outbound arguments have no such grammar — they are arbitrary nested JSON
authored by whatever produced the call. §6 is the consequence.

---

## 4. The two paths differ here more than anywhere else in the product

`CLAUDE.md` §2's two execution paths are usually a distinction about *controls*. For argument
provenance they are a distinction about *whether the question is even open*, and a design that
treats them alike will ship a feature that is free and useless on one path and expensive and
load-bearing on the other.

| | **A. Live proxy** (`reelier mcp --wrap`) | **B. Recorded replay** (`reelier run <skill>`) |
|---|---|---|
| Who authors the args | the agent, freely | the skill file's template, plus fills |
| How provenance is obtained | **searched** against a retained response corpus | **known by construction** from the fill |
| Cost | the wrap becomes stateful (§4.2) | bookkeeping on an existing code path |
| Signal | the whole point | near-zero, with one exception (§0.1, §4.1) |

### 4.1 Path B: known by construction, and almost vacuous

On the replay path there is no search to do. Every filled value has exactly one origin, and
`fillTemplate` is standing at the point where that origin is in scope:

| origin | source class | how it is known |
|---|---|---|
| `{{name}}` filled from a step `bind:` | prior tool response | the bind line names the step and dotpath |
| `{{name}}` filled from a `--var` | operator input at run time | seeded at `src/runner.ts:1704` |
| `{{today}}` / `{{today±Nd}}` | declared computed date | `resolveComputedDateVar`, `src/runner.ts:416-430` |
| a literal in the args template | the approval | `ApprovalHashInput` binds the template (`src/approval.ts:21-30`) |

All four are `grounded`. A template literal is grounded **to the approval**, not to the world: a
human read those bytes and stamped a hash over them, which is the prior art's "trusted constant"
(§11) with a shipped mechanism behind it. That is the honest reading and it is also why path B is
nearly vacuous — *replay exists to remove the agent's authorship of arguments*, so finding that no
argument was agent-authored is a tautology, not a measurement.

The exception is §0.1. An L2-patched `args` object introduces model-authored literals into a
template at run time, and `StepRecord` already knows when that happened (`level`, `llm`,
`why.change`). So on path B the `prov` block's real job is one distinction: **an approved literal
versus an L1/L2-patched literal.** That is worth recording and it is cheap. It is not the bug-catcher
the field ask is about.

**[Normative]** Path B provenance MUST be derived from the fill, never from a search. Searching a
corpus for a value whose origin is known is how a known-`grounded` value gets re-classified
`authored` by a corpus gap, which would be a fabricated finding on the deterministic path.

### 4.2 Path A: searched, and the wrap becomes stateful

This is where the failure class lives, and where every real constraint is.

**The chokepoint exists.** `src/recorder.ts:342` destructures `const { name, arguments: args } =
request.params;` and `:406` calls `route.downstream.call(route.realName, args)` — the outbound
argument object is in hand, by the same reference, before dispatch. The response comes back at the
same site. No egress proxy is required, exactly as `artifact-attestation-v1.md` §3.1 establishes for
the artifact digest.

**Four things defeat a naive implementation. All four are properties of shipped code.**

1. **The trace is written only while recording.** Every capture call in `buildProxyServer` is gated
   on `recorder.isRecording` (`src/recorder.ts:375`, `:386`, `:395`, `:402`, `:412`). A wrap session
   outside a `reelier_start_recording` / `reelier_stop_recording` window proxies everything and
   records nothing — so there is no corpus. **[Normative]** A provenance resolver MUST NOT infer
   `authored` from an empty corpus it did not establish was complete. Outside a recording window,
   every value is `unresolved`, and the reason names the window.
2. **What reaches disk is redacted.** `recordCall` and `recordResult` write `redact(args)` and
   `redact(body)` (`src/recorder.ts:190`, `:194-196`). `redact` rewrites `sk-…` and `Bearer …`
   substrings and any `REELIER_REDACT`-named env value of length ≥ 6 (`src/redact.ts`). Matching an
   outbound value against the **trace file** therefore matches against rewritten bytes: a redacted
   response field will never equal the unredacted argument that came from it, producing `authored`
   on a value that was in fact grounded — a false finding, in the one direction §2 cannot afford.
   **[Normative]** The corpus is the in-process, pre-redaction values. `redact`'s own module comment
   states the boundary this relies on: it is "[n]ever applied to the live passthrough path".
3. **The recorder retains nothing.** `Recorder`'s complete state is seven fields
   (`src/recorder.ts:91-98`); prior calls and prior responses are written and dropped. Holding a
   response history for the life of a wrap session is a real change: **the wrap becomes a store of
   everything the agent read.** That is the largest implementation decision in this spec, and §7.3
   is the design that makes it bounded and value-free.
4. **The recorder is documented as non-interpreting.** Its module comment
   (`src/recorder.ts:1-6`) reads: "No interpretation happens here — that's the (not-yet-built)
   compiler's job." A provenance state is computed, so this invariant has to be addressed rather
   than stepped over. **The line this spec draws: the recorder may record what it measured; it may
   not record what it inferred.** `ms` and `ok` are measurements it already records. Byte equality
   against a retained value is the same class of fact. Effect classification and step synthesis are
   inferences, and they stay in the compiler. §8.1 keeps the existing `t: "call"` and `t: "result"`
   records byte-identical regardless, so a consumer that disagrees with this line can drop the new
   record type and lose nothing it had.

### 4.3 Implementation amendment — the trace IS the corpus

*Added 2026-08-01 during the slice-2 build. This spec framed the choice as "path B (cheap, vacuous)
versus path A (valuable, expensive)". There is a third option it missed, and it dominates both as a
first surface.*

§4.2's cost is retention: the wrap would have to hold a response corpus for the life of a session,
which is a standing change to what a `reelier mcp --wrap` process is. But **a trace already is that
corpus** — ordered, complete for its window, and on disk. Analysing it after the fact needs no
retention at all.

`reelier trace <file> --provenance` therefore ships first. It costs nothing architecturally: the
wrap is byte-for-byte unchanged, no record is added to the live path, and §4.2's four constraints
mostly evaporate — items 1 and 3 disappear (a trace that does not exist makes no claim, and nothing
is retained), item 4 disappears (no new record type, so the recorder's non-interpreting contract is
untouched — the analysis is a separate read-side module).

**Item 2 does not evaporate, and it is the honest cost of the trade.** The trace on disk is
redacted, so this path resolves against bytes the redactor may have rewritten. Handled by making
redaction visible rather than by ignoring it:

- A redacted **source** leaf is masked out of the index and marks its source partly unheld — a gap,
  so `authored` is unearned for that call (§5.3). Its unredacted siblings still ground normally.
- A redacted **argument** resolves `unresolved` with reason `redacted-argument`.
- **Neither side may ever match the other.** Both sides pass through the same redactor, so two
  unrelated secrets both read `«redacted»`. Matching them would be a false `grounded` — the one
  direction this must never produce. Pinned in `test/provenance-trace.test.ts`.

The remaining limits are real and are not defects: this surface is after the fact (v1 gates nothing
anyway), and it sees only what was recorded. Slice 3 subsequently built §4.2's pre-dispatch record;
the offline surface remains useful for old traces and independent recomputation.

### 4.4 Implementation amendment — the live index is bounded and hash-only

*Added 2026-08-01 during the slice-3 build, after the offline surface established the resolver over
real traces.*

Path A now computes the same fact before dispatch. State exists only inside an active recording
window, resets on every `start`, and dies with the process. It retains SHA-256 digests and source
coordinates, never response values. `call` and `result` remain byte-identical; the computed fact is
the separate `prov` record §8.1 specified.

This does not create a gate. Resolution cannot refuse, delay or alter a downstream call, and policy
denials/dry-runs produce no `prov` because nothing went out. Only a successful, real downstream
result enters the source index. A failed result and Reelier's synthetic denial/dry-run bodies are
not sources and are not gaps (§5.4).

The pure resolver still refuses values it cannot hash faithfully (for example an own `__proto__`
key). At the live boundary that exception is caught: the call records
`unresolved: [{"path":"args","reason":"measurement-failed"}]` and dispatches unchanged. A
successful response that cannot be indexed becomes `source-unaddressable: #N` for later calls.
This asymmetry is deliberate: loud refusal is correct inside a hashing primitive; fail-open with a
visible gap is mandatory at the recorder boundary.

The memory decision §13 left open is closed by §7.7's hard cap. Saturation weakens later misses to
`unresolved`; it can never manufacture `authored`. Retained matches remain `grounded` because the
positive equality was still established.

---

## 5. Sources — the closed list [Normative]

A **source** is a place a value may be traced to. The list is closed. Adding to it is a spec
amendment, because every addition is a new way for an ungrounded value to be laundered into
`grounded`.

**Path A (live proxy):**

- **S1. A prior tool response in this run**, from a `t: "result"` record with `ok: true`, `denied`
  absent, and `dryRun` absent.

**Path B (replay), additionally:**

- **S2. A prior step's `Observation`** — the same class as S1, reached through
  `mcpResultToObservation` (`src/mcp-tool.ts:61-74`).
- **S3. A run `--var`.** This is "prior user input" in the prior art's sense, and it is the only
  channel through which human-supplied input reaches Reelier as data.
- **S4. The approved args template.** A literal a human stamped an approval hash over.
- **S5. A computed date var.** `{{today}}` / `{{today±Nd}}`, resolved deterministically from the
  run's single `now` snapshot.

### 5.1 What is NOT a source, and why each exclusion matters

**Prior call *arguments* are never a source.** Only responses. This is the rule that closes failure
class 2. If an agent authors a value in call 1 and reuses it in call 5, matching call 5's argument
against call 1's argument would report `grounded` — laundering an authored value through Reelier's
own record and stamping it. The agent reading back a phone number it wrote itself is precisely this
shape. **Sources are things that came back, never things that went out.**

**A denied call's error body is never a source.** `recordDenied` writes Reelier's own message
(`blocked by reelier policy: …`, `src/recorder.ts:384-390`). Grounding an outbound value in the
proxy's refusal text would make Reelier the origin of the value.

**A `dry_run` synthetic body is never a source.** `recordDryRun` writes
`[DRY-RUN] <tool> — matched policy rule …` (`src/recorder.ts:393-400`), fabricated by the wrap so a
dry-run step never reads as a real one. Same reason, and it is the same never-lies rule the field's
own doc comment states.

**A mocked step's observation is never a source** (`--fail N`), for the reason
`run-shape-priors.md` §4 already gives about mock runs: an injected result is a local recovery test,
not an observation of anything.

**The agent's own text is never a source** — its messages, its reasoning, its tool-call rationale.
On the wrap path this is automatic, because none of it is MCP traffic and Reelier never sees it. It
is stated anyway, because the obvious "improvement" is to make Reelier see it, and that is refused
in §5.2.

### 5.2 The refused source, and the wave-3 adjudication this settles

`reelier-cloud/docs/company/plans/2026-07-30-wave3-close-the-loop-spec.md` §1 item 9 records this
gap from field signal (u/nejcar20, 2026-07-30) and explicitly defers it pending adjudication:

> the honest first question is whether this is a recorder feature or a "believed inputs" claim we
> cannot verify (a model's stated grounding is a summary, and never-list #4 forbids trusting one).
> Adjudicate before designing.

**Adjudicated here: recorder feature, and the "believed inputs" half is refused.**

The obvious way to make the check strong for a conversational agent is a control tool — a
`reelier_input` sibling of `reelier_note` — through which the agent registers what the human said,
so that spoken values become a source. It must not be built. Whatever the agent puts in that channel
is the agent's own account of its inputs, which is a summary; never-list #4 forbids treating one as
evidence, and a laundering channel is strictly worse than a blind spot because it converts every
authored value into a `grounded` one on the agent's say-so.

What is left is mechanical, and that is the whole feature: an outbound value either byte-matches
something in a corpus Reelier itself captured, or it does not. Reelier records **what a value can be
traced to**, never **what the agent believed**. The gap between those two is real, it is stated in
§9, and it is not closed by asking the agent.

### 5.3 Implementation amendment — a gap anywhere forbids `authored` everywhere

*Added 2026-08-01 during the slice-1 build, because the spec implied this and never stated it, and
an implementer could have read §6.1 as scoping the degradation to the leaves of the unaddressable
source alone.*

That reading is not available. A miss is a statement about the **whole** source set — the value was
not found *anywhere* — so a single unaddressable source makes every miss in that call unearned. And
it cannot be scoped, because a miss by definition has no coordinate: there is no way to say which
source a value that matched nothing "would have" come from.

**[Normative]** One rule, and the implementation is exactly these three lines:

| | |
|---|---|
| hit | `grounded` — always; a gap elsewhere cannot unfind a match |
| miss, no gaps | `authored` — the absence was established |
| miss, any gap | `unresolved` — the absence was not established, and the reason names the gaps |

The second row is the only place `authored` is ever produced, which is the property to check a build
against. The first row is deliberately unconditional: a positive match is evidence standing on its
own, and letting an unrelated gap downgrade it would discard a fact Reelier actually holds.

### 5.4 Implementation amendment — a NON-SOURCE is not a GAP

*Added 2026-08-01 during the slice-2 build, after the tests and the implementation disagreed about
it. The tests were wrong; the reasoning below is why.*

§5.1 says a denied call, a dry-run call, a failed call and a mocked step are never sources. It does
not say whether they are **gaps** — and the two produce opposite outcomes for every miss in the
call, so the omission was load-bearing.

**[Normative] They are non-sources, not gaps. A miss beside one is `authored`.**

The distinction is what `authored` claims: the run held a **complete** source set and the value is
not in it. A denied call produced *no observation at all*, so nothing is missing from the corpus —
the corpus is complete with respect to what came back. An unaddressable response is the opposite
case: data *did* come back and could not be read, which is a genuine hole.

The practical argument points the same way and is decisive. Denials, dry-runs and failures are
ordinary in a healthy run. If any of them created a gap, a repo with one `deny` rule in its
`policy.yml` would report `unresolved` for every value forever — and a surface an operator has
learned to ignore is strictly worse than no surface, which is `run-shape-priors.md` §1's law.

Pinned by a test that asserts both halves against each other rather than either alone
(`test/provenance-trace.test.ts`, "a NON-SOURCE and a GAP are different"), because each half passes
on its own under the wrong rule.

---

## 6. Addressing — the `args.` leaf grammar

`emit:` (`artifact-attestation-v1.md` §4) introduced `args.<key>` for top-level scalars of the
filled action args. Provenance cannot stop at top level: real write tools nest
(`{"customer":{"phone":…}}`, `{"items":[{"sku":…}]}`), and a check that silently skips nested leaves
reports full coverage over a fraction of the payload — `run-shape-priors.md` §8's "nobody mistakes
silence for evidence" applies directly.

**[Normative]**

- Provenance addresses **every scalar leaf** of the outbound argument object, reached by a path of
  object keys and array indices: `args.customer.phone`, `args.items[0].sku`.
- This is a **fourth projection namespace with explicitly different rules**, not an extension of
  `body.`/`header.`/`status.code`, and not a widening of `emit:`'s `args.`.
  `artifact-attestation-v1.md` §12 anticipates exactly this and names it the likely honest answer.
  Its selection semantics MUST be pinned against the existing three by drift tests, in the same
  shape as `projectObservationTyped`'s pin to `projectObservation` — the fork is sanctioned for the
  ADDRESSING, never for the scalar rules.
- Paths are **emitted, never authored**. No operator writes one into a skill file in v1, so no
  parser accepts one and the grammar carries none of the risk a hand-authored path grammar carries.
  If §10's declaration ever ships, the grammar becomes an input and needs its own bar.
- Non-scalar leaves (objects, arrays, `null`) are not addressed — they are containers, and their
  scalars are addressed individually. An argument whose value is an object with no scalar leaves
  contributes nothing rather than an `unresolved` entry for the container.
- Name lists are capped at `ABSENT_FIELDS_MAX` (32) entries of `ABSENT_FIELD_NAME_MAX` (120)
  characters (`src/expect-mac.ts:202-203`) — one definition, so a wide argument object and a wide
  projection look the same to an operator. **[Normative]** When the cap truncates, the record says so
  and the count is stated; a truncated list rendered as a complete one is the silent-cap failure
  `run-shape-priors.md` §8's "no silent caps" rule bans.

### 6.1 The corpus is shaped differently on the two paths

On path A the corpus entry is the raw `McpCallResult` — a content array, addressable per item.

On path B it is an `Observation`, whose `body` is **every text content item concatenated with
`"\n"`** (`src/mcp-tool.ts:61-74`). The module comment already records the consequence: with more
than one text block, `json.*` cannot parse the concatenation. So a multi-block response has **no
addressable leaves at all**, and every value that came from it is `unresolved` — never `authored`.
This is the concrete case §2's third state exists for, and it is the same rule
`projectionMisses` applies to a body that did not parse: it establishes nothing about any field.

---

## 7. The resolver [Normative]

Two tiers. There is no third, and there is no ranking between them.

### 7.1 Tier 1 — exact

An outbound scalar resolves `grounded` iff, for some source (§5), there is a leaf whose value is
equal to it under one of exactly two comparisons:

1. **Identical scalar**, type included: `tagScalar(outbound) === tagScalar(source)`.
2. **The runner's own stringification**: `outbound === JSON.stringify(source)` where `source` is a
   non-string scalar. This exists solely because `src/runner.ts:470` performs that conversion on
   every non-string binding, so refusing it would report `authored` on values Reelier itself
   converted. It is one-directional and it is closed: no other stringification is sanctioned.

The recorded coordinate is the source's identity plus its leaf path — on path A, the `t: "call"`
index `i` and the response path; on path B, the step number and the path. Names and indices only.

### 7.2 Tier 2 — normalization, closed and unranked

An outbound scalar also resolves `grounded` if it equals a source leaf after one normalization drawn
from a **closed enumerated list**, where each entry preserves the *whole* value:

| normalization | preserves |
|---|---|
| leading/trailing whitespace trim | the value |
| Unicode NFC | the value |
| ASCII case folding | the value, modulo case |
| numeric string ↔ number (`"42"` ↔ `42`) | the value |
| boolean ↔ `"true"`/`"false"` | the value |

**[Normative] Membership in this list is boolean and carries no confidence, no weight, and no
score.** A value is grounded or it is not. This is the architectural answer to "the transformation
tier is where false confidence enters": there is nothing to tune, so there is no threshold, so there
is nothing for never-list #3 to bite on. A tier that produced a similarity number would need a
cutoff, a cutoff is a score, and a score on a gate path is forbidden — so the number is never
computed.

**[Normative] What is deliberately NOT a normalization**, each because it changes what the value
denotes:

- substring extraction, including local-part-of-email, first-token-of-name, domain-of-URL
- field splitting or joining (`"John Smith"` → `"John"`)
- format re-derivation (a phone number re-punctuated, a date re-formatted)
- arithmetic or unit conversion of any kind (§1.1)
- translation, transliteration, summarization, or any rewrite

**Failure 3 is exactly this rule.** Given `email` `grounded` to `crm.get_contact.email`, the value
`John` is a substring of a source leaf. Under a generous tier it resolves `grounded` and Reelier has
stamped a name the agent invented as traceable — false confidence, manufactured by the check itself.
Under this rule it resolves `authored`, which is the true statement: `John` is not
`john@example.com`, and the inference that an email's local part is a person's given name is a
semantic claim Reelier has no standing to make.

**No `derived` fourth state.** It was considered and rejected: a state between `grounded` and
`authored` reads as a partial pass, partial passes get rendered green-ish, and a graded ladder is
one product decision away from a score. Three states, no gradient.

### 7.3 The index — hashes, not values

The corpus must not be a plaintext store of every response the agent read. It does not have to be.

Build, per retained response, an index from `digestSha256(tagScalar(leafValue))` to the leaf's
coordinate, plus one entry per tier-2 normal form of that leaf (bounded fan-out, at most one entry
per row of §7.2's table). Resolving an outbound scalar is then a hash of the value and a lookup.
Memory is bounded by leaf count × (digest + path string), the values themselves are never retained,
and the index dies with the process.

**[Normative]** The index is in-process and ephemeral. It is never written to disk, never pushed,
never included in a trace or a run record. An unsalted digest index over low-entropy scalars is a
confirmation oracle for exactly those scalars; it is acceptable here only because it never leaves the
process that computed it, and that property is the entire argument. `digestSha256`/`canonicalJson`
(`src/canonical-json.ts:36-54`) are the existing primitives; nothing new is invented.

**Bounding the retention is required, not optional.** A long-lived wrap session must have a stated
cap on retained responses, and when the cap evicts, values that would have matched an evicted
response resolve **`unresolved`** with a reason naming the eviction — never `authored`. An eviction
that silently produced `authored` would make the check less honest the longer it ran.

### 7.4 What is shared with `artifact-attestation-v1.md`

Not re-derived here: `digestSha256`/`canonicalJson` (§7.3), `tagScalar`'s A6 type-tagging discipline
and the false-MATCH prohibition (§3.2, §7.1), the recursive own-`__proto__` refusal
(`assertNoProtoKeyDeep`, `src/expect-mac.ts:357`) applied to outbound argument objects, the
`ABSENT_FIELDS_MAX` / `ABSENT_FIELD_NAME_MAX` caps (§6), and the `args.` namespace prefix (§6).

### 7.5 Implementation amendment — normalizations do not compose

*Added 2026-08-01 during the slice-1 build. §11 says single-hop about PACT's provenance chains; §7.2
never said it about its own list, and "a closed list of five" reads equally well as "any composition
of the five" — which is 2⁵ behaviours, not five.*

**[Normative]** Each normal form applies **exactly one** entry from §7.2's list. They never chain.

The visible consequence: `" ACME "` does not reach `"acme"`, because that needs trim *and*
case-fold, so a value spelled that way resolves `authored`. That is the intended cost. Composition
is how a transformation stops being value-preserving one hop at a time — trim, then fold, then
numeric coercion is already a small parser — and each additional hop widens the set of source values
a given outbound value can be laundered from. Over-reporting `authored` is the safe direction;
over-reporting `grounded` is the direction that stamps an invented value as traceable.

Pinned in `test/provenance.test.ts` ("normalizations do not compose — one hop only") so a future
implementer who finds the strictness annoying has to delete a test that explains itself.

### 7.6 How `emit:` and `prov` compose

On a step carrying both, the two blocks compose without either interpreting the other:
`emit.artifactDigest` says *these bytes left*; `prov` says *this path in them was grounded to that
response, and that path was authored*. Same paths, same run, two independent facts. Neither is
evidence for the other, and a renderer MUST NOT combine them into a single claim.

### 7.7 Implementation amendment — 4,096 source leaves, then honest saturation

*Added 2026-08-01 during the slice-3 build. §7.3 required a cap but deliberately left its unit and
number open; implementation cannot make the wrap stateful without closing both.*

`LIVE_PROVENANCE_LEAF_CAP` is **4,096 scalar source leaves per recording window**. A leaf, rather
than a response, is the unit because it directly bounds the number of retained digest/path entries;
one huge response cannot defeat the cap. Normal forms do not consume additional leaf budget: their
fan-out is already bounded by §7.2's closed list.

When the 4,097th leaf is observed, the index stops accepting new leaves and sets a permanent
`saturated` marker for that recording window. It does not evict earlier hashes. From that instant:

- a hit against a retained hash remains `grounded`;
- every miss is `unresolved` with `source-index-cap: 4096 leaves`;
- `authored` is never emitted for a miss again in that window.

The number is a memory ceiling, not a learned threshold and not a statement that 4,096 is a
statistically meaningful session size. Changing it changes resource use, never a pass/fail boundary.

---

## 8. Record shape (additive; Path A implemented, Path B unimplemented)

### 8.1 Path A — a separate record type

**[Normative]** `t: "call"` and `t: "result"` stay byte-identical. Provenance lands in a new
`TraceRecord` variant joined to the call by `i`:

```jsonc
{
  "t": "prov", "seq": 41, "i": 7,
  "resolved":   [{ "path": "args.customer.phone", "from": { "call": 3, "at": "body.phone" } }],
  "authored":   ["args.customer.name"],
  "unresolved": [{ "path": "args.notes", "reason": "not-recording" }],
  "truncated":  { "authored": 4 }   // omitted when nothing was capped (§6)
}
```

A separate record rather than a field on `t: "call"`, for two reasons. It preserves the trace's
existing bytes for every consumer (I-11, additive only). And it keeps a computed record separable
from a captured one, which is the concrete form §4.2's measured-vs-inferred line takes: a consumer
that wants the lossless trace the module comment promises can drop `t: "prov"` and have exactly the
file it had before.

### 8.2 Path B — one optional `StepRecord` block

`StepRecord` (`SPEC.md` §4.1) gains one optional block, present iff the step dispatched:

```jsonc
"prov": {
  "resolved":   [{ "path": "args.slug", "from": { "step": 2, "at": "body.slug" } },
                 { "path": "args.title", "from": { "kind": "approved-literal" } }],
  "authored":   ["args.summary"],
  "unresolved": []                     // omitted when empty, never []
}
```

**[Normative]**

- `prov` is present **iff** the step's tool call actually dispatched — never on a refused, skipped or
  mocked step. Same rule `write` and `attest` already follow (`SPEC.md` §4.1), same reason: a
  provenance claim on a call that never went out describes arguments that never left.
- The three lists partition the addressed leaves. A record that does not partition is malformed.
- `from.kind` names the source class (`response` / `var` / `approved-literal` / `computed-date` /
  `l2-patched-literal`). **`l2-patched-literal` is `authored`, not `grounded`** — §0.1 is the reason
  the class exists, and putting a model-authored literal in `resolved` under any label would be the
  laundering §5.1 exists to prevent. It is carried as an `authored` entry's origin, so the record
  says *which kind of authorship*, and says it in the honest column.
- `StepRecord` carries no tool name (`run-shape-priors.md` §2.1), so `prov` names paths only and
  joins to its step positionally, exactly as `write` and `attest` do.

### 8.3 No values, and no unsalted per-value commitment

**[Normative]** No argument value appears in any record — paths, states, coordinates and counts only
(never-list #7).

**[Normative]** No unsalted per-value digest is recorded either. This is a deliberate departure from
`artifact-attestation-v1.md` §5.1, which opts `artifactDigest` into the unsalted join-key class. That
opt-in was argued from `idempotencyKey` already sitting in the same block as an unsalted hash over
*all* the filled args, making a digest over a subset strictly less revealing — and that spec states
in the same paragraph that the argument "does not generalise: it holds *because* `idempotencyKey` is
already there."

It does not hold here. Path A has no `write` block and no `idempotencyKey`; a per-leaf unsalted
digest of `args.customer.phone` published in a trace is a straight dictionary attack over a ten-digit
space, which is not an exposure the record already carries. If per-value commitments are ever needed
for diagnosis, they are **keyed**, under the `expect` keystore key, domain-separated by canonical-JSON
input shape from the three shipped MACs (`{probe, projection, v}`, `{field, probe, v, value}`,
`{args, probe, v}`) — the `expectFieldMac` discipline (`src/expect-mac.ts:312-322`), unchanged.

**Signing needs no change.** `SPEC.md` §0.2 [Normative]: the record digest is computed over the
complete `RunRecord`, so an additive block is covered by the digest — and by any signature over it —
from the moment it exists. No new key, no new signed object.

---

## 9. The honesty boundary

The required section. Everything above is mechanism; this is what the mechanism is allowed to mean.

### 9.1 `authored` means "not traceable here", not "made up"

The precise statement, which every surface must be able to survive being read literally:

> **`authored`: this value is not present in any source this run holds.**

That is all. It does not say the agent invented it. It does not say it is wrong. It does not say a
human did not supply it. An agent that writes a perfect subject line and an agent that types
`"not provided"` into a required field produce the same state, because from a lineage standpoint they
did the same thing.

### 9.2 The conversation is not a source, and this is the limit that matters

Reelier sees MCP traffic (`CLAUDE.md` §7.2). A human speaking to a voice agent, or typing into a
chat, is not MCP traffic. **So a value the customer actually said, faithfully transcribed by the
agent, resolves `authored` — identically to a value the agent invented.**

Stated as an operator would need it, for the operator whose failures opened this spec:

- **Failure 1 (`"not provided"`)** — `authored`. So is a real spoken name. **Provenance alone does
  not distinguish them.**
- **Failure 2 (the company's own phone read back)** — `authored`. So is a real spoken phone.
  Provenance does not distinguish them *for that field*. What it does close is the general laundering
  route: §5.1 makes it structurally impossible for a value the agent emitted earlier to be reported
  as grounded, on any path, ever.
- **Failure 3 (`John` from `john@example.com`)** — **caught cleanly, whenever the email came from a
  tool response.** `args.email` resolves `grounded` to the contact lookup; `args.name` resolves
  `authored`, and §7.2 is what keeps it there instead of laundering it through a substring tier.

So for a pure conversational agent whose inputs never pass through a tool, this check reports
"everything authored" and tells the operator nothing. **The check is exactly as strong as the
fraction of the agent's inputs that arrive as tool responses.** That is not a defect to be fixed
later; it is the shape of the observation point, and `CLAUDE.md` §7.2's rule applies unchanged —
whether Reelier helps a given stack is an empirical question about that stack.

**What changes it, and it is the operator's lever rather than ours:** route the inputs through
tools. A transcript tool, a CRM lookup, a form webhook — anything that makes a customer-supplied
value arrive as a response makes every downstream use of it checkable. That is a real recommendation
with a real cost, and it is the honest answer instead of a control tool the agent fills in itself
(§5.2).

### 9.3 What it is never allowed to become

- Never a verdict. `authored` is not a failure, `grounded` is not a pass, `unresolved` is neither
  (§2).
- Never a score (never-list #3).
- Never evidence of correctness. A fully `grounded` argument set can be the wrong customer's real
  phone number, pulled from the wrong record. Grounding certifies **lineage**, never **fit**, and it
  is a strictly weaker claim than the scope claim a receipt already makes (never-list #8).
- Never a claim about intent. Atom 1 (live intent) belongs to the principal and the host harness
  (`2026-07-29-safety-atoms.md`), and this changes nothing about that. It is worth naming that atom
  1's catastrophe — OpenClaw reading a recent-contacts list *as* intent — rhymes with failure 2, and
  is still not the same question: this spec can say a value came from a contacts list, and cannot say
  anything at all about whether reading it as intent was right.

---

## 10. The gate — not in v1, and the charter conflict is real

v1 gates nothing (§2, rule 4). The reason is not caution; it is that the adjudicated gate charter
(`2026-07-29-safety-atoms.md`) has a clause this check does not obviously satisfy, and papering over
it would be worse than deferring:

> Reelier may refuse an outcome only when (a) the input is Reelier's own signed artifact, (b) the
> comparison is **equality, membership, or counting — never content inspection**, (c) it fires only
> on the boundary class (out-of-scope, sensitive-path, over-budget, drifted-state), **never
> per-action**, and (d) fail-closed is explicit per-repo opt-in while the recorder stays fail-open
> unconditionally.

- **(b) is satisfied comfortably.** Byte equality against a retained value, and membership of a
  declared field set. No content inspection anywhere — the resolver never looks at what a value
  *means*.
- **(a) is not satisfied on path A.** The corpus is Reelier's own capture but it is not a signed
  artifact; there is no run record and no signature in a wrap session at all.
- **(c) is the real conflict.** An argument-level check is **per-argument**, which is more per-action
  than per-action. A gate that refuses a call because one leaf was `authored` fires on exactly the
  cadence clause (c) forbids. Framing it as a boundary class — "declared-required fields on
  declared write tools" — narrows it but does not change the cadence; it is honest to call this
  unresolved rather than solved.
- **(d) has no home on path A.** `Policy.stateGate` is a **run-path** control: `src/policy.ts:653`
  states it plainly — "enforced by `reelier run` at dispatch time (the wrap itself never gates on
  pre-state)". And `DenyRule` matches on `tool`/`endpoint` only (`src/policy.ts:34-39`), with no
  argument vocabulary whatsoever. A provenance gate on the wrap needs a new policy key *and* a new
  rule vocabulary — and `artifact-attestation-v1.md` §12 names policy vocabularies as precisely where
  custom constraint types get minted by accident.

**The slice-2 shape, specified so it is not invented ad hoc later.** The useful control is not
Reelier judging a value; it is the **operator declaring that a field must have come from somewhere**:

```
# .reelier/policy.yml — DESIGN ONLY, not parsed by anything today
require_grounded:
  - tool: booking.create_job
    args: ["args.customer.phone", "args.customer.name"]
```

That converts "the agent must have obtained this from a real source" into a mechanical per-field
requirement the operator owns. It is a membership comparison (clause b), it is opt-in per repo
(clause d), and it is the only shape in which failure 1 becomes catchable: a booking flow that
*requires* the phone to be grounded forces a lookup or confirmation step to exist, and
`"not provided"` then fails a requirement the operator wrote rather than a judgment Reelier made.

**[Normative] Even as a declaration, v1 records and does not refuse.** A declared-required field that
resolves `authored` is recorded as a stated fact — declaration versus measurement, the same shape
`expect:` already has — and it changes no exit code until clause (c) is adjudicated on its own
evidence bar.

---

## 11. Prior art, credited

**arXiv 2605.11039 — "The Granularity Mismatch in Agent Security: Argument-Level Provenance Solves
Enforcement and Isolates the LLM Reasoning Bottleneck"** (Fan, Li, Tian, Wang, Li, Wang).
<https://arxiv.org/abs/2605.11039>. Fetched and read on 2026-08-01; the title, authorship and
abstract are verified, and the extraction below is from a model-summarised read of the PDF rather
than a full human read — treat the tier list as directionally verified and the theorem content as
unread.

It proposes **PACT** (Provenance-Aware Capability Contracts): a runtime monitor that assigns semantic
roles to tool arguments, tracks value provenance across replanning steps, and checks whether each
argument's origin satisfies a role-specific trust contract. Its hierarchy of acceptable origins is
the same four this spec starts from — direct user input, trusted constants, prior tool outputs, and
transformations of those. It maintains provenance chains rather than point matches.

**What transfers.** The granularity claim, which is the paper's actual contribution and the reason
this spec exists at the argument level rather than the call level: a tool-call-level allow/deny
cannot express "this tool is fine, but *this argument* must not carry model-authored content".
Also its placement of the LLM **outside** the enforcement path — the model generates, a separate
deterministic layer validates. That is never-list #8 arrived at independently, from a security
premise rather than a trust one, and it is the strongest external confirmation the architecture has.
The paper's own acknowledgement that derived-value chains create false positives when intermediate
steps are misclassified as trusted is the same hazard §7.2 answers, and it is why the answer is a
closed list rather than a tuned one.

**What does not transfer.**

- **Semantic roles.** PACT's contracts are per-argument *role* declarations, which means someone
  decides that this field is a recipient and that one is a body. Reelier does not have and does not
  want per-server semantic knowledge (`artifact-attestation-v1.md` §7.2 refuses the same thing for a
  different reason). §10's `require_grounded` is the role-free residue: a field either must be
  traceable or need not be, with no statement about what it is.
- **Provenance chains.** PACT tracks multi-hop derivation. This spec is deliberately single-hop:
  a chain is where a transformation tier compounds, and a compounded transformation is
  indistinguishable from a computation (§1.1).
- **Perfect-security claims.** The paper reports perfect security and utility on diagnostic tests.
  Nothing of that kind is claimed here, measured here, or transferable — §9 is the claim, and it is
  much smaller.
- **A shipping implementation.** None was found, and the fetched sections do not confirm working
  code — the paper presents a formal framework with theorems. So the design space is open and the
  prior art is a design, not a dependency.

**The `fabricating_tool_parameters` eval dimension**, defined as *"a tool call with parameters that
were not grounded in user-provided information or prior tool results"*. Supplied by the task brief;
a targeted search on 2026-08-01 did not surface the exact named dimension, so it is cited **as
supplied and unattributed** rather than pinned to a source. The definition is worth keeping verbatim
regardless, because it is the same predicate as §5's source list — evidence that the failure class is
independently recognised as measurable, which is a different and weaker claim than evidence that
anyone measures it this way.

**The field ask this answers**, verbatim (u/nejcar20, 2026-07-30):

> what would get me to hand over more is not a better model either, it is knowing what each action
> was grounded in when it went out. same reason you trust exit codes over summaries.

The second sentence is the design constraint, not decoration: an exit code is trusted because it is a
mechanical fact with no narrator. §5.2 refuses the narrator, and §2 refuses the verdict, which is
what keeps the answer in the same class as the thing being compared to.

---

## 12. What this cannot do

- **It cannot see the conversation** (§9.2), so a spoken value and an invented one are the same state.
- **It cannot prove a grounded value is the right one.** Right lineage, wrong record is a fully
  `grounded` disaster.
- **It cannot prove an authored value is wrong.** Most authored values are correct and intended.
- **It cannot see a payload it did not hold** — `artifact-attestation-v1.md` §3.1's three shapes
  (server-side rendering, reference-valued fields, two-call composition) defeat provenance for the
  same reason they defeat the artifact digest: the bytes never passed the chokepoint.
- **It cannot resolve anything outside a recording window** on the wrap path (§4.2), or from a
  multi-block response on the replay path (§6.1). Both are `unresolved`, permanently.
- **It cannot prove the source list is complete.** Completeness attestation remains named and
  unbuilt: receipts prove what receipted calls did, and nothing proves all calls were receipted.
- **It cannot validate a value against a business rule** (§1), and the tier that would let it is
  deliberately absent (§1.1).
- **It cannot survive a corpus it does not hold.** Eviction, redaction and a stopped recorder all
  produce `unresolved`, and the honest cost of that is that a long, busy wrap session resolves less
  than a short one.

---

## 13. Open questions

- **Does clause (c) admit a per-argument gate at all?** §10. If the answer is no, `require_grounded`
  is a recorder declaration forever, which is a defensible outcome and should be stated as one rather
  than left ambiguous.
- **Should path B record `prov` at all?** §4.1 says it is nearly vacuous outside the L2 case. The
  case for recording it anyway is that a receipt reader should not have to know which path produced
  the record to know what it claims; the case against is bytes for a tautology.
- **Does `require_grounded` belong in `.reelier/policy.yml` or in the skill file?** Policy is
  per-repo and survives skill edits; the skill file is where `emit:`/`expect:`/`approve:` already
  live and where the approval hash could bind it. Splitting related declarations across two homes is
  its own cost.
- **Does an `authored` count belong on `RunFootprint`?** It is a per-run integer and would slot into
  `run-shape-priors.md` §2's signal table cleanly. But §2.4's rule is that a counter earns a row only
  if it can be non-zero on a record §4 keeps, and "most string args are authored" means the counter
  would be large and uninformative on every healthy run — a deviation surface that speaks constantly
  is the one thing that spec forbids.

---

## 14. Non-goals (v1)

Any gate, refusal, or exit-code change · a confidence score, ratio, or grounding percentage · a
fourth `derived` state · multi-hop provenance chains · arithmetic, unit, format, or substring
transformation tiers · semantic role declarations · an agent-facing input-registration tool (§5.2) ·
reading the human conversation by any means · egress-boundary observation · validating any value
against any business rule · persisting the resolver index · unsalted per-value digests in any record ·
operator-authored argument path grammar · cloud rendering of `prov` · amending a pushed receipt.

---

## 15. Verify

**Unit** — `prov`-less runs produce byte-identical records to 0.29.0, pinned against a literal
captured digest, as `test/expect-probe-args.test.ts` pins `probeArgs`; the three lists partition the
addressed leaves on every path; type-tagged equality (`1` / `"1"` / `true` resolve independently) and
the one sanctioned `JSON.stringify` comparison (§7.1) both pinned, with a test asserting that no
*other* stringification matches; the tier-2 list asserted **verbatim** as a closed set, in the shape
`test/priors.test.ts` uses to pin its metric list, so adding a tier requires editing a test that says
why; `John` / `john@example.com` resolves `authored` and is pinned as a named regression; own
`__proto__` at any depth of an outbound args object refused loudly; caps applied and truncation
stated (§6).

**Source-list** — one test per exclusion in §5.1, each asserting `authored`/`unresolved` and never
`grounded`: a value matching a prior **call's args**; a value matching a `denied` body; a value
matching a `dryRun` body; a value matching a mocked step's observation. These four are the laundering
surface, and each is a one-line implementation slip away from being open.

**Path** — a wrap session with no recording window resolves everything `unresolved` with the
window reason, never `authored`; a wrap session whose corpus was evicted reports the eviction reason;
a multi-block MCP response yields `unresolved` for every value that came from it; a redacted response
field does **not** produce a false `authored` on the value it grounded (the §4.2 item 2 regression,
which is the failure a disk-reading implementation ships by default).

**Replay** — a `{{var}}` filled from a step `bind:` records `from.step` and the dotpath; a `--var`
fill records `kind: "var"`; a template literal records `kind: "approved-literal"`; an **L2-patched
literal records as `authored` with `kind: "l2-patched-literal"`** and appears in no `resolved` list
(§0.1, §8.2); a refused, skipped or mocked step carries no `prov` block at all.

**Honesty** — a test-pinned banned-word list on every rendering surface ("fabricated",
"hallucinated", "suspicious", "unsafe", "invalid", "violation"), following
`test/priors-render.test.ts`; a renderer test that `unresolved` renders as neither a pass nor a fail
and `authored` never renders as a fail; a test asserting no ratio, percentage or score appears in any
rendered provenance output; and a test that a run whose every argument is `authored` exits exactly as
it would have without this feature (§2, rule 4).
