# Pre-dispatch artifact attestation (v1)

**Status: §§0–8 SHIPPED in 0.30.0, except the `reelier resolve` CLI entry point.**
Slice 1 — the `emit:` grammar, the `args.` namespace, the unsalted artifact digest, the keyed
per-field commitment primitive, `StepRecord.emit`, the approval-hash binding and the coverage gate —
is live: `src/artifact.ts`, `src/skill.ts`, `src/writeback.ts`, `src/approval.ts`, `src/runner.ts`,
normative text in `SPEC.md` §3.2 / §4.1 / §6.1e, covered by `test/artifact.test.ts`,
`test/emit-grammar.test.ts` and `test/emit-record.test.ts`.

Slice 2 — `attest.defer`, the deferred `pending` state with its dispatch-resolved deadline, the
resolution grading, and the second-record builder — is live in `src/defer.ts` plus the runtime branch
in `src/runner.ts`, covered by `test/deferred-probe.test.ts`. `attest.confidence: "pending"` is
reachable for the first time and the closed `method` enum was NOT changed to get there: a deferred
probe is a declared probe that has not run.

**One piece of §8 is not built: the `reelier resolve` command.** Everything it would call exists and
is tested (`pendingAttestations`, `resolveDeferred`, `buildResolutionRecord`); what is missing is the
CLI entry point that reads the ledger, connects a `--wrap`ped server to dispatch the probe, and
appends the record. Until it lands, a `pending` attestation stays pending — which is the honest state,
and is exactly why the design refuses to let `pending` read as a pass.

Three things landed differently from the text below, recorded here rather than left for a reader to
discover:

1. **§7 left the gate predicate implicit; it is now named.** The gate refuses a write whose declared
   projection did not **fully resolve** — RFC 9421 §7.2.1's *Insufficient Coverage* enforced
   mechanically, and a membership test over field names, which is what keeps it inside the charter's
   "equality, membership, or counting — never content inspection" clause.
2. **§5.2's per-field keyed commitments are a primitive, not yet a record field.** `artifactFieldMac`
   ships and is tested; the runner does not yet emit `emit.fields`, because reaching the per-approval
   keystore on this path is its own slice. §5.2 says MAY; today it is "not yet".
3. **An L2 re-dispatch drops the `emit` block** rather than carrying it. The escalation path computes
   no commitment of its own, and a commitment naming the first artifact beside a receipt for the
   second is exactly the overclaim this feature exists to prevent. Absent is honest; stale is not.
   This limit is not stated anywhere below and belongs in §10.

Every code reference was read from `origin/main` @ `5d6d521` (v0.29.0) on 2026-08-01. Line numbers
below are that pin's and have since moved; the named functions and files are current.

Companion to `flight-recorder-v2.md` §2 (what an approval binds), `trust-ladder-v1.md` (what a
receipt proves about bytes) and `principal-delegation-v0.md` (what it proves about authority). This
one is about the class of write where `attest:` has nothing to probe.

---

## 0. The question this answers

`attest:` proves a write happened by comparing world-state before and after it, through a declared
read-back probe (`SPEC.md` §4.1's `attest` row; the shipped example is
`examples/gbrain/gbrain-capture-enrich.skill.md` step 1, `attest:
{"tool":"get_page","args":{"slug":"reelier-demo-page"},"projection":["compiled_truth"]}`).

That construction requires a post-state that can be read back. An entire class of write has none:

> There is no "get the email you just sent."

Sends, settled refunds, fired webhooks, and anything a human has already read leave no resource to
probe. The provider may return an id; the *artifact* — the thing that actually left — is gone. Email
is currently Reelier's weakest substrate, and it is the most-cited scary write in every piece of
field evidence collected.

**The reframe this spec formalises.** For an irreversible external effect, the attestable object is
not the world's post-state — **it is the artifact that left**. You cannot hash the recipient's inbox.
You can hash the exact rendered bytes, the recipient list and the amount, and bind that to the
approval before dispatch. That needs no probe tool at all.

### 0.1 What this is NOT

**This does not move the observation point to an egress proxy.** Everything below sits at the
existing MCP tool boundary and uses shipped primitives. Relocating observation from the MCP transport
to the network egress boundary is the largest architectural decision in the product's life and is
explicitly out of scope for this spec. If an implementation starts requiring network-level
interception, it has gone wrong — stop and re-scope.

---

## 1. Why the shipped primitives do not already cover this

Three facts, each verified, that together define the gap precisely. The gap is narrower than it
first looks, and saying so is the difference between a spec and a pitch.

### 1.1 The approval hash binds the args TEMPLATE, not the filled args

```ts
// src/approval.ts:26-30
/**
 * Approval binds the OPERATION SHAPE: tool + args template ({{placeholders}}
 * intact). Environment binding is the manifest's job …
 */
```

`ApprovalHashInput` is `Pick<Step, "actionTool" | "actionArgs">` plus `attest`/`expect`
(`src/approval.ts:21-24`), and `step.actionArgs` is the raw parsed template. The runner recomputes
over `step.actionArgs` at `src/runner.ts:956` — the template.

**Consequence, stated exactly.** For a **fully-static** send the template IS the exact args, so the
rendered artifact is *already* bound by the approval hash and nothing here is needed. For a
**templated** send — `- action: send_email {"to":"{{recipient}}","body":"{{draft}}"}` — the approval
covers the shape and the run-time fill supplies the bytes. The artifact that leaves was never
reviewed and is bound to nothing.

That is not a new problem class. It is the one `probeArgs` already solved one level over:

```ts
// src/expect-mac.ts, probeArgsMac doc comment
// P1 forced literal probe args because a `{{var}}` hole in a probe-args template is an
// exfiltration channel … The approval hash cannot close that — it covers the file's TEMPLATE
// text, which a run-time fill leaves untouched. This commitment can: the runner recomputes
// it over the args it is ABOUT to send and compares BEFORE dispatching anything
```

`probeArgsMac` is the precedent, the proof the seam exists, and the shape to follow. This spec
applies the same construction to the *action* args instead of the *probe* args.

### 1.2 Nothing hashes the outgoing payload as an artifact

The only post-fill hash that ships is:

```ts
// src/approval.ts:96-97
/** Per-run identity of an executed write: tool + FILLED args + server. Recorded in the receipt; never enforced against external state (spec non-goal). */
export function computeIdempotencyKey(tool: string, server: string | null, filledArgs: unknown): string
```

It is an opaque whole-args identity. It names no fields, declares no coverage, and is documented as
an identity rather than a claim. A receipt carrying it cannot answer "which recipient?" or "what
amount?" — only "the same call, or a different one".

### 1.3 `exposure: external-visible` already ships, and means nothing yet

`SPEC.md` §3.7 shipped in 0.29.0 with exactly the severity axis the field evidence argues for:

> `external-visible` | The step's effect is observable to an actor OUTSIDE the system — a message
> delivered, a webhook fired, a public record changed — so someone may already have acted on it.

and, in the same section:

> **In this version it changes no gating behaviour.** No exit code, refusal, write gate, escalation
> decision, or check predicate reads `exposure`.

So Reelier can already say *this step is the dangerous kind* and can currently do nothing with the
statement. This spec is what makes the declaration load-bearing.

---

## 2. The field evidence

Two operators, unprompted, describing the same shape. Quoted rather than paraphrased, because the
framing is theirs and not the author's.

**On the mechanism** — u/SherLzp:

> a short hold where the rendered message and recipient are independently checked; anything outside
> the contract becomes a draft

**On the severity axis** — u/nejcar20, arguing that severity should split on whether someone outside
the system has already acted, not on reversibility:

> a file reverts, a record restores, a message that got read is different in kind because the other
> person has already changed what they are doing

The second quote is the argument for §3.7's `exposure` axis and independently arrives at the split
`SPEC.md` §3.6 already draws between the *mechanical* question (can this be repeated safely) and the
*consequential* one. The first names the mechanism: render, check independently, hold if outside the
contract.

**One half of the first quote is honoured and one half is declined.** Reelier can hold, and this
spec specifies the hold. Reelier cannot turn a send into a draft — see §7.2.

---

## 3. Where the commitment sits [Normative]

The load-bearing question is *when* the artifact exists. It does not exist for most of the write
path, and getting this wrong produces a design with nothing to hash.

The `executeStep` order on the run path (`src/runner.ts`, origin/main):

| line | stage | filled args in hand? |
|---|---|---|
| 949–963 | approval-hash gate (recompute over the **template**) | **no** |
| 995 | `filledArgs = fillTemplate(step.actionArgs, bindings, now)` | — |
| 1066 | `probeArgs` commitment gate — compares, refuses to dispatch on mismatch | **yes** |
| 1146–1272 | `stateCheck` (pre-probe observation vs `expect.pre`) | yes |
| 1285–1298 | `state_gate: refuse` — the fail-closed boundary | yes |
| 1303 | `write.dispatchedAt` stamped | yes |
| 1307 | `obs = await tool.run(filledArgs, ctx)` — **dispatch** | yes |

**[Normative]** The artifact commitment MUST be computed after the args are filled and before the
call is dispatched. It MUST NOT be attached to the approval-hash gate, where no rendered artifact
exists yet.

The window between `:995` and `:1307` already holds two pre-dispatch commitment checks
(`probeArgs` at `:1066`, `state_gate` at `:1285`). This is a third resident of an existing room, not
a new floor.

*(Two `fillTemplate` calls also occur inside the gate block at `:968` and `:981` — those are refusal
branches rendering a filled action into an error message, and they return before dispatch. Neither
feeds a hash.)*

### 3.1 Why the MCP tool boundary is sufficient — and exactly when it is not

On the live-proxy path the agent's arguments object reaches the downstream by the same reference it
arrived on, with no rewrite between: `src/recorder.ts:342` destructures
`const { name, arguments: args } = request.params;`, policy evaluation runs at `:381`, and `:406`
calls `route.downstream.call(route.realName, args)`. The rendered payload is in hand at a chokepoint
Reelier already owns, on both paths. **No egress proxy is required.**

**[Normative]** An implementation MUST NOT claim artifact coverage for a call whose payload it did
not hold. Three shapes defeat the assumption, and all three are real:

1. **Server-side rendering.** A tool taking `{"template_id":"welcome","vars":{…}}` renders the
   message on the provider's side. Reelier holds the template id, never the bytes. `git grep
   template_id origin/main -- src/` returns nothing: this is not merely unhandled, it is nowhere
   considered in code.
2. **Reference-valued fields.** An attachment id, an audience id, a saved-segment id. The artifact is
   the *dereferenced* thing; Reelier holds the pointer.
3. **Two-call composition.** `create_draft` then `send_draft`. The bytes pass through call one and the
   irreversible effect is call two. The recorder retains no prior-call args (`src/recorder.ts:91-98`
   is its complete state), so the two cannot be correlated at the wrap chokepoint even in principle
   with today's data structures.

In all three the honest outcome is a declared-but-unresolved coverage entry (§5.3), never a
silently narrower claim.

---

## 4. Grammar — the `emit:` declaration

A tenth step-level field, machine- or hand-authored, declaring **which parts of the filled action
args constitute the artifact**:

```
- emit: {"projection":["args.to","args.subject","args.body"]}
```

A closed shape (`projection` only in v1; an unknown key is rejected loudly, never silently degraded
to "no emit", exactly as `attest:` is per `SPEC.md` §3.2). `projection` MUST be a non-empty array of
non-empty strings.

**The `args.` namespace.** P1.5's namespaced projection grammar (`header.<name>`, `body.<key>`,
`status.code`, bare = top-level body key) addresses the *response*. The artifact lives in the
*request*, so `emit:` introduces one namespace, `args.<key>`, addressing a top-level key of the
filled action args.

**[Normative]** Every `emit.projection` entry MUST carry the explicit `args.` prefix. There is no bare
form. P1.5 deliberately did not ship a bare `status` namespace because re-pointing an existing
spelling would change what an existing approval binds; a bare form here would invite the same class
of confusion against `body.`, for no gain in an entry that is always request-side.

**Selection semantics are inherited verbatim, not forked.** `emit:` selects top-level scalars only —
strings, numbers, booleans; absent and non-scalar values are dropped, and a missing entry is reported
rather than inferred (§5.3). This is `projectObservationTyped`'s rule (`src/expect-mac.ts`), applied
to a different object. Nested addressing (`args.message.to`) is **not** in v1: it would be a third
selection semantics in a codebase whose own comment records that "the fork was sanctioned for the
ENCODING, never the SELECTION". See §12.

**`emit:` enters the approval hash.** Like `attest`, `expect`, `fields` and `expiresAt`, it joins the
hash input only when present, so an `emit`-less step hashes byte-identically to 0.29.0 (the compat
law, `src/approval.ts:59-80`). Binding it is what makes the coverage list non-forgeable — see §11.1,
where the prior art names editing the coverage list as the specific attack.

### 4.1 Compatibility — this is a hard break for older parsers, and must be stated

`src/skill.ts:538-547` enumerates nine step keys in a regex and throws on any other bulleted line:

```
Unrecognized step field, expected one of intent/action/assert/bind/effect/exposure/approve/attest/expect: …
```

There is no `default:` arm because unknown keys never reach the switch. **A skill carrying `- emit:`
is a parse error on every reelier older than the release that adds it** — not a silently ignored
field. This is a shipped-format break and MUST be released as one (`SPEC.md` §0 versioning policy),
not slipped in as additive.

*(The closure has a hole worth knowing: the throw is gated on `line.startsWith("-")`, so a dash-less
`emit: {…}` inside a step block is silently skipped as prose. No test in the corpus exercises that
shape. It is not a licence to rely on it.)*

---

## 5. The two commitments, deliberately distinct

`flight-recorder-v2.md` §2 established the house pattern of two hashes with one job each and the
distinction stated plainly. This follows it.

### 5.1 `artifactDigest` — unsalted, joinable, third-party recomputable

```
artifactDigest = digestSha256({ artifact: <type-tagged projected map>, tool: <action tool>, v: 1 })
```

`digestSha256` is the existing shared primitive (`src/canonical-json.ts`); nothing new is invented,
and the value is therefore checkable with existing tooling.

**Values are type-tagged**, reusing `tagScalar`'s discipline (`src/expect-mac.ts`): `1`, `"1"` and
`true` MUST produce distinct commitments. A `String(v)` collapse would create a false-MATCH class —
the one direction the scheme must never produce (A6, normative). An own `__proto__` key at any depth
is refused loudly rather than silently dropped, for the same reason.

**This is unsalted, and that requires an explicit argument**, because `attestation-p1-design.md` §8b.2
deliberately sacrificed cross-run hash joins:

> Bare sha256 over a low-entropy projection (`["status"]`, `["active"]`) is trivially reversible from
> a shared, signed record … cross-run hash joins are deliberately sacrificed (revisit only with an
> explicit opt-in if the corpus ever needs them).

**The opt-in, argued.** `artifactDigest` belongs to the `write` block's **unsalted join-key class**,
not the `attest` block's salted change-detection class. `SPEC.md` §4.1 already draws that line for
`write.approvalHash`:

> **Unlike `attest`'s salted commitments below, this value is an UNSALTED `sha256` over the operation
> shape and is deliberately a stable correlator across runs and across tenants — that is its purpose
> (it is the join key of an expectation↔outcome pair). … No new exposure class: `idempotencyKey` in
> the same block is already an unsalted hash over the FILLED args, which is strictly more revealing.
> Do not read §4.1's "cross-run hash joins are deliberately impossible" as covering this field; that
> sentence governs `attest` only.**

`artifactDigest` is an unsalted hash over a **subset** of the filled args. `idempotencyKey` — shipped,
in the same block, on the same steps — is an unsalted hash over **all** of them. The new field is
therefore strictly less revealing than what already ships beside it, and introduces no exposure class
the record does not already carry. That is the whole opt-in argument, and it does not generalise: it
holds *because* `idempotencyKey` is already there.

**The residual hazard is real and MUST be documented in operator-facing copy.** A digest over a
low-entropy projection — `["args.to"]` alone, or `["args.amount"]` alone — is a confirmation oracle
for exactly that value against a candidate list. The countermeasure is the projection itself, and it
is the same one §6.1c already teaches for `expect:`: project the **named content fields** you actually
approved. `SPEC.md` §6.1c's three field classes transfer to `emit:` unchanged, and its middle class
names these fields explicitly — "the body text you reviewed, the recipient, the amount, the target
slug".

### 5.2 Per-field commitments — keyed, diagnosis only

Where a step already carries `expect:` (and therefore a per-approval key in
`~/.reelier/expect-keys.json`), `emit:` MAY additionally record one `hmac-sha256` per projected field
under **that same key**, domain-separated from the three existing MACs by canonical-JSON input shape:
`{artifact, field, tool, v, value}` versus `{args, probe, v}` / `{probe, projection, v}` /
`{field, probe, v, value}`. No constructible collision — the key sets differ regardless.

**[Normative]** Per-field artifact commitments MUST be keyed, never bare. A per-field *unsalted*
digest over `args.to` is a straight dictionary attack on a recipient address; the whole-artifact
digest's exposure argument in §5.1 rests on the composite, and does not extend to its parts.

Per-field commitments are **diagnosis only**: they let a report name *which* field of an artifact
differs, names never values. `artifactDigest` remains the only identity.

### 5.3 Unresolved coverage is a first-class outcome

A declared entry that the filled args did not carry, or carried non-scalar, is **not** dropped in
silence. It is reported by name in `emit.unresolved`, and it is the mechanism by which §3.1's three
defeating shapes stay visible: a `template_id`-rendered send declaring `args.body` reports
`args.body` unresolved, forever, instead of publishing a digest that quietly covers less than the
operator believes.

Names only, capped exactly as `absentFields` is (`ABSENT_FIELDS_MAX = 32`,
`ABSENT_FIELD_NAME_MAX = 120`, `src/expect-mac.ts`) — one definition, so the two surfaces cannot
disagree about what a wide projection looks like.

---

## 6. Record shape (additive, unimplemented)

`StepRecord` (`SPEC.md` §4.1) gains one optional block:

```jsonc
"emit": {
  "artifactDigest": "sha256:…",         // §5.1 — unsalted, recomputable
  "projection":     ["args.to", "args.subject", "args.body"],
  "resolved":       ["args.to", "args.subject", "args.body"],
  "unresolved":     ["args.attachment_id"], // §5.3 — omitted when empty, never []
  "fields":         { "args.to": "hmac-sha256:…" },  // §5.2, only on expect-bearing steps
  "approvalHash":   "sha256:…",         // the join back to the authorization
  "at":             "2026-08-01T09:12:44.001Z"
}
```

**[Normative]**

- `emit` is present **iff** the step declared `emit:` **and** the call actually dispatched. A refused,
  skipped or mocked step never carries one — the same rule `write` and `attest` already follow. A
  commitment on a call that never went out would assert an emission that did not happen.
- `projection` is the **declared** list, verbatim and ordered. `resolved` and `unresolved` partition
  it. Carrying all three is what makes the record self-describing rather than merely digested (§11).
- `approvalHash` duplicates `write.approvalHash` deliberately, so the emission claim is readable
  without joining across blocks. It is absent exactly when `write.approved` is `false`, for the same
  reason the `write` row gives: a flag dispatch has no authorization to point at.
- No artifact **values** appear in a record, ever — hashes, counts and field names only
  (never-list #7).

**Signing needs no change.** `SPEC.md` §0.2 [Normative]: the record digest is computed over the
complete `RunRecord`, so every additive field is covered by the digest — and by any signature and
timestamp over it — from the moment it exists. **This spec proposes no new signing key, no new signed
object, and no Reelier signature over an outbound artifact.** Key-role separation stays as pinned:
the expect key signs nothing and appears in nothing.

---

## 7. The gate [Normative]

### 7.1 What may be checked

Any pre-dispatch refusal inherits the adjudicated charter line for gates
(`reelier-cloud/docs/company/2026-07-29-safety-atoms.md`), all four clauses conjunctive:

> Reelier may refuse an outcome only when (a) the input is Reelier's own signed artifact, (b) the
> comparison is **equality, membership, or counting — never content inspection**, (c) it fires only
> on the boundary class (out-of-scope, sensitive-path, over-budget, drifted-state), never per-action,
> and (d) fail-closed is explicit per-repo opt-in while the recorder stays fail-open unconditionally.

Clause (b) is the whole ceiling on u/SherLzp's "independently checked". Digest equality: permitted.
Recipient membership: permitted. Amount range: permitted. *Is this message appropriate to send*: never
— that is content inspection, it needs judgment, judgment needs a model in the path, and that forfeits
the guarantee everything else rests on (never-list #8 is architecture, not modesty).

Clause (d) means the gate reuses `state_gate: refuse` — the existing per-repo opt-in in
`.reelier/policy.yml` (`src/policy.ts:200`, only supported value `refuse`) — and mints no
per-invocation flag. In recorder mode an artifact finding is **stamped and the write still
dispatches**; refusal is the opted-in repo's behaviour only. Two controls, one job each
(never-list #5).

**Scope note, from the code.** `state_gate` today gates only `expect:`-bearing steps, because
`stateCheck` is assigned exclusively inside `if (isWrite && step.expect !== undefined)`
(`src/runner.ts:1145-1146`). Extending it to `emit:`-bearing steps is a deliberate widening with its
own evidence bar, and is the single largest implementation decision in this spec.

### 7.2 Refuse, never downgrade

u/SherLzp's "anything outside the contract becomes a draft" is **not implementable and MUST NOT be
claimed.** Turning a send into a draft requires knowing that `send_email` has a `create_draft`
sibling and which of its arguments carry over — per-server semantic knowledge Reelier does not have
and does not want. Nothing in `src/` substitutes or rewrites tool arguments: `dry_run` returns a
synthetic result and dispatches nothing (`src/recorder.ts:386-400`); it does not substitute args.

**[Normative]** The gate's only outputs are *dispatch* and *refuse*. A refusal leaves the draft-vs-send
decision with the operator, where the substrate knowledge lives.

### 7.3 The word the check semantics may not use

The comparison is check-then-act, not compare-and-swap at the resource. Between the commitment and
`tool.run` the args object is not re-derived, but nothing outside the process is held. **No artifact —
spec, CLI, receipt, site — may describe this check as "atomic", "CAS", or "guaranteed".** It commits
to what Reelier was about to send, and it says so.

---

## 8. Slice 2 — the deferred probe

Most sends *do* produce a post-state, just late: a provider message-id, a provider event API, a
bounce or delivery webhook. Slice 1 attests the emission; slice 2 resolves the outcome when the
provider's record appears. It also covers settled refunds, which have the same late-post-state shape.

### 8.1 `pending` already exists in the wire format, and is reachable by nothing

```ts
// src/runner.ts:177
confidence: "exact" | "partial" | "pending" | "absent";
```

`attestation-p1-design.md` reserved it on purpose — "`pending` becomes reachable only in future
live-proxy work, but stays in the enum now so the wire format never changes." An exhaustive grep of
`confidence: ` across `origin/main src/` finds six assignments, all `absent`/`partial`/`exact`. A
deferred probe is the first thing to reach the reserved value.

**[Normative]** A deferred probe MUST reach `pending` and MUST NOT change the enum.
`absent` and `pending` MUST NOT render as a pass on any surface — CLI, receipt page, `/json`, badge
(never-list #1). This is the single most important property in the product and a deferred probe is
the first mechanism that can produce a long-lived unresolved state, so it is where the rule gets its
hardest test.

### 8.2 Resolution must be a second record, not an amendment

Three independent blockers, each verified, and the design follows from them rather than around them:

1. **No id.** Run records are appended one JSON line each (`src/runner.ts:1936-1940`) and `RunRecord`
   carries no id field. There is nothing to resolve back to.
2. **No write path.** `.reelier/runs/<skill>.jsonl` has exactly one writer and it is an `appendFile`;
   `diff`, `bench`, `baseline` and `cost` are strictly read-only. The cloud exposes only `POST
   /api/v1/runs` — no PATCH, no PUT — and rows are hash-chained per tenant, so an in-place edit is a
   detectable chain break.
3. **No salt.** The attest salt is per-run, in-memory, never recorded. A later-computed `post` hash is
   not comparable to the original `pre` even if it could be written.

**[Normative]** A deferred resolution MUST be a new record joined to the original by
`write.approvalHash` and `emit.artifactDigest`, never an amendment of a pushed receipt. It publishes
its own independent observation — which proves post-state at resolution time, **not** a delta across
the write — and MUST be graded accordingly rather than flattened into `exact`.

The cloud already ships this exact shape for a different deadline: the stale sweep resolves a pending
condition by inserting a `drift_alerts` row that FK-references the run record, deduplicated by query
rather than by mutating anything. The second-record pattern is load-bearing and precedented, not new.

A consequence to state before anyone discovers it: `reelier push` advances a monotonic cursor over the
jsonl, so an appended resolution record reaches the cloud on the next push with no push-side change —
but nothing in the cloud today links a later receipt back to an earlier one, so **the original receipt
at `/r/<id>` stays `pending` forever**. Rendering the join is cloud work this spec does not do.

### 8.3 The deadline

Reuse `expect.expiresAt`'s convention exactly: `reelier approve --expires` resolves a duration against
approve time and stamps an **absolute ISO-8601 instant**, because a stored relative duration would
silently re-arm every time the file is read — the opposite of expiring. `parseDuration`
(`src/duration.ts`) accepts `<positive integer><m|h|d>` up to `365d`; sub-minute and combined forms
are not expressible and a resolution deadline inherits that limit.

**[Normative]** A deadline that elapses with no resolution moves the attestation from `pending` to
`absent` with a reason naming the elapsed deadline. It MUST NOT remain `pending` indefinitely: a state
that never resolves and never expires stops being read, and a state nobody reads is one an operator has
learned to ignore. `absent` here claims only that Reelier stopped waiting — never that the send failed.

**Do not put a resolver on an unattended renewal loop.** `SPEC.md` §6.1c's rule against scheduled
`approve --all --probe --expires` applies with full force: a deadline renewed by a machine is not a
deadline.

### 8.4 What the provider record is joined by

`StepRecord.refs` (0.20.0+, trust-ladder §3) already captures provider-issued request-id references,
allowlist-only, never scraped or fabricated — a message-id lands here today. It is the natural handle
for a deferred probe, with the caveat the spec already attaches to it carried forward unchanged:

> the verifier does not contact the provider, so a consumer MUST NOT read the presence of a ref as the
> provider having confirmed anything.

**The CLI has no host for this.** There is no webhook receiver, no inbound HTTP surface, no daemon and
no `watch`; `reelier serve` and `reelier mcp` are both stdio. The only scheduled surface the CLI
produces is the GitHub Actions workflow `reelier ci` scaffolds (`cron: "23 7 * * *"`). A resolver is
therefore a **polling command an operator or CI runs**, not a listener — an honest constraint, and the
reason a webhook-driven design is not specced here.

---

## 9. AP2 shape-compatibility [Normative]

The adjudicated rule, quoted from its actual home
(`reelier-cloud/docs/company/commerce-attestation-v1.md` §5):

> Two hard protocol facts shape this: AP2 verifiers **MUST treat unknown constraint types as failing**
> — so Reelier never mints custom constraint types; our vocabulary compiles to theirs or stays on our
> side of the gate.

*Sourcing note, because it matters for a spec: the framing "structurally identical to AP2's
signed-intent-before-execution / shape it so AP2 is a thin wrapper" is from the task brief, not from
any adjudicated document. The adjudicated text supports the never-mint half above and the general
wrap-never-re-declare posture (§1.2: "The verticals' proofs are wrapped as evidence, never
re-litigated"). The stronger framing is treated here as a design instruction, correctly, but is not
cited as prior adjudication.*

**What this spec does to stay shape-compatible:**

1. `emit:` declares **what will be emitted**, before emission, bound to an authorization
   (`approvalHash`) — the same structural object AP2's signed intent is.
2. **No constraint vocabulary is minted.** v1 has none. The `emit` shape reserves no `constraints`
   key, because a reserved key with no defined types is an invitation to invent some. Constraints
   arrive, if ever, in the separate commerce spec, compiling to AP2's closed set —
   `payment.amount_range`, `payment.budget`, `checkout.allowed_merchants`,
   `payment.allowed_payment_instruments`, `payment.allowed_pisps`, `payment.agent_recurrence`,
   `checkout.line_items`, `payment.reference`, `payment.execution_date`.
3. **[Normative]** Any future consumer that encounters a constraint type it does not know MUST fail
   closed, never ignore it. That is AP2's own rule and the reason minting is forbidden.
4. **Canonicalisation is a known divergence, flagged now.** Reelier's `canonicalJson` is **not** JCS
   (RFC 8785) for integer-like keys — `SPEC.md` §0.3 [Normative for consumers]. AP2's
   `merchant_authorization` is a detached JWS over the **JCS-canonicalized** checkout. A wrapper MUST
   implement JCS for recomputing counterparty artifacts and MUST NOT substitute `canonicalJson`; they
   differ, and substituting would produce false mismatches. Likewise RFC 9530 `Content-Digest` is over
   **raw body bytes**, never re-serialized JSON.

**No commerce integration is built here.** Shape-compatible, not implemented.

---

## 10. What this cannot do

Stated here rather than discovered later, because a primitive that attests emissions is exactly the
one someone will read as attesting outcomes (never-list #8).

- **It never proves what the recipient did.** Not that the message was delivered, not that it was
  opened, not that anyone acted on it. `exposure: external-visible` says someone **may** have acted —
  it states no evidence that anyone in fact read or acted on anything, and this spec adds none. Slice
  2 can add a *provider's* record of delivery, which is the provider's claim, wrapped and labelled as
  such, never Reelier's observation.
- **It never proves the content was correct.** A perfectly attested artifact can be the wrong price to
  the wrong customer in the wrong language. Content correctness is out of scope by charter: proof of
  change certifies **scope**, never **semantic correctness**, and a receipt is necessary for trust,
  not sufficient for safety (`FOUNDATION.md`, never-list #8 and the boundary statement at §"The
  secret"). The residual class — the in-scope, in-budget, fresh-state, semantically wrong write —
  passes every deterministic predicate by construction; closing it needs judgment, judgment needs a
  model in the path, and that forfeits the guarantee that makes everything else trustworthy.
  *(Note for anyone re-checking the citation: `2026-07-29-safety-atoms.md` does not contain the phrase
  "content correctness". The authority is `FOUNDATION.md`; safety-atoms supplies the residual-class
  argument.)*
- **It never proves the artifact was the only one.** Nothing proves all writes were receipted — that is
  the completeness atom, named and unbuilt. An unreceipted send is invisible here as everywhere.
- **It cannot see a payload it did not hold.** §3.1's three shapes — server-side rendering, reference
  fields, two-call composition. `emit.unresolved` makes the blindness visible; it does not remove it.
- **It cannot cap or count recipients.** Recipient caps are blast-radius topology, and topology is
  explicitly not Reelier's atom (owner: platform/infra). A per-run recipient cap MUST NOT be presented
  as an existing or owned control.
- **It cannot downgrade a send to a draft.** §7.2.
- **A `pending` deferred probe proves nothing at all.** It is a state, not a result, and it is never a
  pass.

---

## 11. Prior art, credited

**RFC 9421 (HTTP Message Signatures)** is the closest existing answer to "sign what was emitted", and
the reusable idea is sharper than "hash the body".

### 11.1 The three-part pattern

RFC 9421 splits a signature across two headers: `Signature-Input` carries an **ordered set** of covered
component identifiers in the clear, `Signature` carries only the bytes. The list is a deterministic
reconstruction recipe, not an inventory — "Within a single list of covered components, each component
identifier MUST occur only once. … Once this order is chosen, it cannot be changed." Each identifier
carries parameters (`sf`, `key`, `bs`, `req`, `tr`) declaring **how** the value was canonicalised, so
the list self-describes each covered value's derivation.

Critically, the list is itself signed: `@signature-params` is REQUIRED as the last line of the
signature base and MUST NOT appear inside the covered set. That is what makes the declaration
tamper-evident rather than advisory.

**And the part most re-implementations drop.** §7.2.1 is titled *Insufficient Coverage*: without an
independent, application-owned statement of what MUST have been covered, an attacker signs a trivial
covered set and the signature still cryptographically verifies while protecting nothing. §3.2 step 4
requires the verifier to check the covered list against application requirements **before** believing
the crypto.

So the pattern is three parts, and this spec takes all three:

| RFC 9421 | here |
|---|---|
| ordered, self-describing covered-components list | `emit.projection`, verbatim and ordered, plus `resolved`/`unresolved` (§6) |
| list bound into the signature so it cannot be edited after the fact | `emit:` enters the approval hash (§4); the record digest covers the block (§6) |
| verifier-side statement of what MUST have been covered | **the open question of this spec** — see §12 |

The Reelier translation of *Insufficient Coverage* is exact: a green artifact claim with no independent
expectation of what it should have covered is the same lie as rendering `absent` as a pass.

RFC 9421 also does not sign the body — it signs a header carrying a digest of it (RFC 9530), which is
precisely "hash the rendered artifact and bind the hash". RFC 9530's security considerations add the
warning this spec inherits: a signature protecting the digest but not the representation metadata
(content type, encoding) leaves a gap, so binding an artifact hash means binding its interpretation
context too.

### 11.2 What does not transfer

- **No JSON canonicalisation.** RFC 9421 gives none; `sf` only helps for values that are already RFC
  8941 Structured Fields. Key ordering, escaping and number formatting are RFC 8785 territory — a
  separate problem the RFC does not solve (and where Reelier has its own known divergence, §9 item 4).
- **The derived-component contents.** All nine (`@method`, `@target-uri`, `@authority`, `@status`, …)
  are HTTP-wire facts; an MCP tool boundary has no method or authority. What transfers is the
  *pattern* — a reserved, registry-governed namespace for message facts that are not fields.
- **`created` / `expires` / `nonce`.** Anti-replay controls for a live request verified in the moment.
  A receipt is verified later, possibly years later, where a freshness window is meaningless or
  actively harmful.
- **Post-state, entirely.** RFC 9421 has no concept of read-back or proof of change. The prior art
  covers the emission half of a receipt only — which is exactly the half this spec is about.

Worth stealing later: the `req` parameter binds a component of a response signature to the value from
the request that triggered it. That is tool-result-bound-to-tool-call, and Reelier has no equivalent.

### 11.3 Implementation licences — verified, with gaps named

Fetched from each repository's licence file on 2026-08-01. Nothing here is recalled.

| language | library | licence | licence file fetched |
|---|---|---|---|
| Go | `yaronf/httpsign` | Apache-2.0 | `raw.githubusercontent.com/yaronf/httpsign/main/LICENSE` |
| Go (alt) | `common-fate/httpsig` | MIT | `.../common-fate/httpsig/main/LICENCE` (British spelling; `LICENSE` 404s) |
| Python | `pyauth/http-message-signatures` | Apache-2.0 | `.../pyauth/http-message-signatures/main/LICENSE` |
| Java | `authlete/http-message-signatures` | Apache-2.0 | `.../authlete/http-message-signatures/main/LICENSE` |
| Rust | `junkurihara/httpsig-rs` | MIT | `.../junkurihara/httpsig-rs/main/LICENSE` |
| .NET | `Unisys/NSign` | MIT | `.../Unisys/NSign/main/LICENSE` |

All six permissive, none copyleft. Apache-2.0 carries a patent grant and NOTICE obligations MIT does
not. **Named gaps:** crates.io and nuget.org could not be fetched, so the *package-metadata* licence
fields for the Rust and .NET entries are **UNVERIFIED** — only the repo files were read, and repo
licence and package metadata are not the same artifact. "Most prominent per language" is a judgement
from search prominence, not download metrics; for Go there are at least three plausible leaders with
**differing** licences, so "the Go one is Apache" is not a safe blanket statement. No JavaScript
implementation was checked. Correctness and maintenance of all six are unassessed — a verified licence
says nothing about whether a library implements the spec.

---

## 12. Open questions

- **What is the independent coverage expectation?** §11.1's third part is unanswered. Today `emit:`
  declares its own coverage and binds it into the approval hash, which stops *later* editing but not
  an approver stamping a deliberately thin projection on day one. A repo-level "sends MUST cover
  recipient and body" rule would close it and would live in `.reelier/policy.yml` beside
  `state_gate` — but that is a policy vocabulary, and policy vocabularies are where custom constraint
  types get minted by accident (§9). Unresolved, and the most important gap in this spec.
- **Does `state_gate` widen to `emit:`-bearing steps?** §7.1. Today it gates `expect:`-bearing steps
  only. Widening is the largest implementation decision here and deserves its own evidence bar.
- **Nested artifact addressing.** §4 ships top-level only. Real send tools nest (`{"message":{"to":…}}`),
  so the limit will bite early — but a path grammar would be a third selection semantics, and the
  existing two are pinned to each other by drift tests. Possibly the honest answer is a fourth
  namespace with explicitly different rules, rather than quietly extending `args.`.
- **Should `emit:` be inferable from `exposure: external-visible`?** A step declared external-visible
  with no `emit:` is a knowable gap. Rendering it as one is cheap; *requiring* `emit:` there is a
  behaviour change with its own bar.
- **Does the artifact digest belong in `write` rather than in its own block?** It is a join key of the
  same class. Kept separate here because `write` is present on every dispatched write and `emit` only
  on declared ones, and collapsing them would make `write`'s shape conditional on a declaration.
- **What grades a slice-2 resolution?** `partial` is the obvious answer (post-state at resolution time,
  no delta across the write), but `attest.method` is a closed two-value enum
  (`response-derived` | `declared-probe`) and a third value is a wire change requiring a spec
  amendment.

---

## 13. Non-goals (v1)

Egress-boundary observation · any commerce integration · a constraint vocabulary of any kind · Reelier
signing outbound artifacts · a new signing key or signed object · downgrade-to-draft or any argument
substitution · recipient caps or count budgets · content inspection of any artifact field · a webhook
receiver, daemon or long-lived process in the CLI · cloud rendering of the pending→resolved join
(§8.2) · nested artifact addressing (§12) · amending a pushed receipt.

---

## 14. Verify

**Unit** — `emit`-less steps hash byte-identically to 0.29.0, pinned against a literal captured digest
exactly as `test/expect-probe-args.test.ts` pins `probeArgs`; type-tag distinctness (`1` / `"1"` /
`true` commit differently); `__proto__` at any depth refused; `args.` prefix required and bare entries
rejected; `projection` = `resolved` ⊎ `unresolved` on every path; caps applied to both name lists;
per-field MACs domain-separated from the three existing MAC shapes; hand-editing `emit:` produces an
approval mismatch end-to-end through `runSkill`, not merely at the hash function.

**e2e** — a fixture send tool with a templated body: approve → run → record carries `emit` with a
digest recomputable by hand from the filled args; edit the template → replay fails closed naming the
step; a fixture tool taking `template_id` reports `args.body` in `unresolved` and still publishes a
digest over what it *did* hold; under `state_gate: refuse` an artifact refusal produces **no `write`
block and no `attest`** — the proof the call never went out; a refused, skipped or mocked step carries
no `emit` block.

**Honesty** — a test-pinned ban on "atomic"/"CAS"/"guaranteed" describing the check (§7.3), following
the `test/priors-render.test.ts` precedent for banned words on a surface; and a renderer test that
`pending` and `absent` never render as a pass.
