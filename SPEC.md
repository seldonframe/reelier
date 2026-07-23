# Reelier Format Specification

This document specifies Reelier's on-disk and on-wire formats precisely
enough that a third party can emit and consume them without reading
Reelier's source. It is derived directly from the parser/runner
implementation (`src/*.ts`) and the test suite (`test/*.ts`) as of package
version **0.4.0**. Where the README and the code disagree, **the code wins**
and the disagreement is noted inline.

Key words MUST / MUST NOT / SHOULD / SHOULD NOT / MAY are used as in
RFC 2119.

## 0. Versioning & compatibility policy

- The **npm package's semver governs format changes**. This is the only
  version anything here carries — none of the four formats below (trace,
  SKILL.md, run-record, MCP proxy contract) has its own independent version
  field.
- **Record-shape changes bump the package's minor version.** Precedent: the
  0.2.0 release added `StepRecord.escalationAttempted` and split
  `RunRecord.totals` into honest `passed`/`unchecked`/`skipped`/`failed`
  counts, both additive/corrective changes, without a major bump. The
  concrete rule this establishes, and that this spec makes normative: **a
  consumer reading a run-record MUST derive any total or rollup value from
  the per-step `steps[].outcome` array when the newer total fields
  (`totals.unchecked`, `totals.skipped`) are absent**, rather than trusting
  an older `totals.passed`, which conflated `"passed"` and `"unchecked"`
  before 0.2.0 (see §4.3). This is exactly what `reelier bench`
  (`src/cli.ts`) does, and it is how a mixed history of pre- and post-0.2.0
  run records stays readable without migration.
- **New template-fill forms bump the package's minor version too.** 0.3.0
  adds the computed date vars `{{today}}` / `{{today-Nd}}` / `{{today+Nd}}`
  (§6.1a) to `fillTemplate` — a `{{name}}` hole that previously always meant
  "look `name` up in `bindings`" now has three reserved forms that resolve
  differently instead. This can't silently break a 0.2.x skill (those exact
  strings were never legal `bind` names to begin with — see §3.5's
  identifier grammar), but a 0.3.0+ consumer reading ANY skill, regardless
  of which version produced it, MUST resolve `{{today}}`/`{{today±Nd}}` as
  computed vars rather than a bindings lookup — this is `fillTemplate`-time
  behavior, not something recorded in the skill file itself.
- **A new CLI surface bumps the minor version too.** 0.4.0 adds `reelier
  push` (§8) and its own local state file (`.reelier/push-state.json`) —
  additive, no existing format changed, hence a minor bump rather than
  major.
- **Structures are explicitly open or closed:**
  - **Trace records** (`TraceRecord`, §2) are a **closed, discriminated
    union** over `t`. A parser MUST reject a line whose `t` is not one of
    `meta` / `note` / `call` / `result`. Within a known record type, a
    parser SHOULD tolerate additional, unrecognized fields (forward
    compatibility for additive record fields in a future minor) but MUST
    treat every field documented in §2 as required and typed as specified.
  - **SKILL.md step fields** are a **closed** set of five bullet keys
    (`intent`/`action`/`assert`/`bind`/`effect`, §3.2). `parseSkill` rejects
    any other `- <key>: ...` bullet inside a step block outright (an
    "Unrecognized step field" `SkillParseError` — `src/skill.ts:205-216`);
    this is intentionally closed, not open-for-extension, because the field
    set is small enough that a typo should be caught, not silently ignored.
  - **Non-step sections** of a SKILL.md file (preamble, `## Open
    questions`, `## Changelog`, any other `##` section) are **open,
    free-form prose** — a parser MUST preserve them verbatim (byte content,
    not necessarily byte-identical formatting) and MUST NOT reject a file
    for containing an unrecognized section.
  - **`RunRecord`/`StepRecord`** (§4) are open for **additive** fields
    (e.g. `escalationAttempted` was added in 0.2.0 without breaking older
    readers) but a parser MUST reject a record missing any field this spec
    marks required for its declared version.
- **Malformed input MUST be rejected loudly.** Every parser in this
  codebase (`parseSkill`, `evalAssert`, `evalBind`) throws a typed error
  (`SkillParseError`, `AssertParseError`, `BindParseError`) naming what and,
  where applicable, which step/line, rather than silently skipping or
  coercing bad input. A conformant third-party implementation MUST do the
  same — never silently drop a step, a call/result record, or an assert/bind
  line that fails to parse.

---

## 1. The five atoms

Every SKILL.md step is composed of exactly five kinds of information (not
all five are separate fields — `action` bundles a tool name and its args):

| Atom | Carries |
| --- | --- |
| intent | Natural-language sentence: what the step is for |
| action | A tool name + a JSON args template (`{{var}}` holes allowed) |
| assert | Zero or more predicates over the observation the tool returned |
| bind | Zero or more extractions from the observation, feeding later steps |
| effect | Exactly one of `read` \| `idempotent-write` \| `destructive` |

---

## 2. Trace format (JSONL)

Source of truth: `src/recorder.ts` (`TraceRecord` union, `Recorder` class),
`src/trace.ts` (reader), `test/recorder.test.ts`, `test/proxy-e2e.test.ts`.

A trace is a UTF-8 text file, one JSON object per physical line (`.jsonl`),
written by `reelier mcp`'s recording proxy to
`.reelier/traces/<name>-<n>.jsonl` (`<n>` auto-increments so an existing
trace file is never overwritten — `Recorder.nextTracePath`,
`src/recorder.ts:62-78`). A reader (`parseTraceLines`, `src/trace.ts:11-19`)
MUST split on `\r\n` or `\n`, skip blank/whitespace-only lines, and
`JSON.parse` every remaining line as one record.

### 2.1 Ordering rules (normative)

- Every record carries a file-scoped, **monotonic** integer `seq`, assigned
  by a single incrementing counter (`Recorder.nextSeq`, starting at 0 for
  the trace's one `meta` record) — never reused, never skipped, across every
  record type together (not per-type).
- **Order in the file IS the association.** There is no other index or
  foreign key structure; a record's position (and its `seq`) relative to
  its neighbors is the only way to reconstruct "what happened around this
  call." Writes are serialized through a promise chain
  (`Recorder.writeQueue`) specifically so concurrent tool calls can never
  interleave out of `seq` order.
- The **`meta` record MUST be first** (`seq: 0`). `Recorder.start` writes it
  immediately upon `reelier_start_recording` and nothing else is written
  before it.
- `call` and `result` records additionally share a **call-index `i`**,
  independent of `seq`, monotonic from 0, incremented once per call
  (`Recorder.callIndex`). **A `call` record's `i` is emitted before the
  matching `result` record's `i`** — the pairing rule a compiler or replay
  reader MUST use: the result at call-index `i` observationally continues
  the call at the same `i`, regardless of what other `note`/`call`/`result`
  records fall between them (only possible today when multiple tool calls
  are in flight concurrently, since each `call`→`result` normally happens
  back-to-back per `CallToolRequestSchema` handler invocation —
  `src/recorder.ts:184-234`).
- `note` records carry no `i` — a note is trace-global narration, not
  attached to a call index. The compiler associates the immediately
  preceding run of `note`s with the next `call` (see §6 below and
  `src/compile.ts:193-201`).

### 2.2 Record types

```ts
type TraceRecord =
  | { t: "meta";   seq: number; name: string; startedAt: string; wrapped: string[];
      toolAnnotations?: Record<string, { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean }> }
  | { t: "note";   seq: number; ts: string; text: string }
  | { t: "call";   seq: number; i: number; ts: string; tool: string; args: unknown }
  | { t: "result"; seq: number; i: number; ok: boolean; ms: number; body: unknown };
```

| Field | Type | Meaning |
| --- | --- | --- |
| `t` | `"meta" \| "note" \| "call" \| "result"` | Discriminator. Closed set — see §0. |
| `seq` | integer ≥ 0 | File-scoped monotonic sequence number (§2.1). |
| `name` (meta) | string | The trace's own name, as given to `reelier_start_recording`. |
| `startedAt` (meta) | ISO-8601 string | Recording start time (`new Date().toISOString()`). |
| `wrapped` (meta) | string[] | Downstream server names wrapped for this recording, in `--wrap` order. |
| `toolAnnotations` (meta, optional, 0.13.0+) | `Record<string, {readOnlyHint?, destructiveHint?, idempotentHint?}>` | MCP `tools/list` annotation hints per **exposed** tool name (post collision-prefixing, matching `call.tool`), captured once at recording start (`collectToolAnnotations`, `src/recorder.ts`). A writer MUST include only hints the downstream actually declared (never fabricated defaults) and SHOULD omit the field entirely when no wrapped tool declares any of the three — so annotation-free traces are byte-identical to pre-0.13.0 ones. Additive per §0's forward-compatibility rule; a pre-0.13.0 reader tolerates and ignores it. Consumers treat these as **hints, not security**: the compiler's effect classifier (`classifyEffect`, `src/effect-verbs.ts`) applies a strict trust ladder — `destructiveHint: true` always wins; **no annotation ever downgrades a verb-list match** (not the destructive tier, and not an idempotent-write verb either — `create_note` + `readOnlyHint: true` stays `idempotent-write`); a hint may only tighten a read verb-match (`idempotentHint`) or refine a tool whose verbs the lists don't recognize — and replay write-gating (§3.6) still applies to everything classified `idempotent-write` or worse. |
| `ts` (note/call) | ISO-8601 string | Timestamp the record was written. |
| `text` (note) | string | Free-text narration passed to `reelier_note`. |
| `i` (call/result) | integer ≥ 0 | Call index; shared between a `call` and its `result` (§2.1). |
| `tool` (call) | string | The **exposed** tool name (post collision-prefixing — §5.3), never the raw downstream name. |
| `args` (call) | JSON value | The tool call's arguments, **after redaction** (§2.3). |
| `ok` (result) | boolean | `true` unless the downstream call raised, or its MCP result set `isError: true`. |
| `ms` (result) | integer ≥ 0 | Wall-clock duration of the call, in milliseconds. |
| `body` (result) | JSON value | The full MCP `CallToolResult`-shaped return value (`{content: [...], isError?}`), **after redaction** — not just the tool's payload. |

**Control-tool calls are never traced.** `reelier_start_recording`,
`reelier_note`, and `reelier_stop_recording` themselves never produce
`call`/`result` records — only tools proxied from a `--wrap`'d downstream
do (`src/recorder.ts:184-234`).

### 2.3 Redaction (writer-side SHOULD)

Applied only at trace-write time, on both `args` and `body` — **never** on
the live passthrough result actually returned to the calling agent
(`src/redact.ts:1-8`; `src/recorder.ts:230-233` calls `recordResult` with
the already-dispatched `result`, unaffected by what `redact()` later
strips for storage). A trace writer SHOULD redact, at minimum, the
patterns Reelier's own `redact()` implements:

1. Any configured named-secret value: for each name in a comma-separated
   `REELIER_REDACT` env var, every occurrence of that env var's *value*
   (only if ≥ 6 chars) inside a string is replaced with
   `«redacted:<NAME>»`.
2. **Always, unconditionally**: `sk-`-prefixed tokens matching
   `/sk-[A-Za-z0-9_-]{10,}/g`, and `Bearer <token>` headers matching
   `/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/g`, both replaced with `«redacted»`.
3. **Always, unconditionally**: a 32+-char hex string (`/^[A-Fa-f0-9]{32,}$/`)
   sitting in a JSON key whose name matches
   `/token|secret|key|password|authorization/i` is replaced with
   `«redacted»`.

This is a conservative, known-incomplete pattern set (documented as such
in `src/redact.ts:1-8` and the README's "Redaction" section) — it will
miss base64-encoded keys, secrets embedded mid-string in an unnamed field,
and non-hex tokens under 32 chars. A conformant writer MAY implement a
stricter or different redaction policy, but MUST NOT claim conformance
with *this* reference pattern set unless it implements all three rules
above. A trace file MUST be treated as potentially sensitive regardless of
which redaction policy produced it.

### 2.4 Size-limit conventions: two profiles

Reelier's own proxy (`src/recorder.ts`) is, as of 0.2.0, **uncapped**:
there is no body-length truncation and no per-trace record-count limit
anywhere in `Recorder.write`/`recordCall`/`recordResult`. A trace grows for
as long as recording stays on; this is the format's *default* profile —
call it the **proxy profile**.

A consuming system MAY impose its own storage-driven caps without
violating this spec, since §0 declares trace records open for additive
fields and this section does not mandate a maximum size. One such
consumer, an independent Reelier-format replay recorder that
implements this exact `TraceRecord` shape rather than
depending on this package), defines a second profile:

- **`TRACE_BODY_MAX_CHARS = 20_000`** — a `result.body` whose serialized
  JSON exceeds 20,000 chars is stored as `{__truncated: true, preview:
  <first 20k chars>, originalLength: <n>}` instead of the raw value
  (`capTraceBody`), so a compiler reading it later can tell truncation
  happened rather than silently seeing a partial JSON value.
- **`TRACE_MAX_RECORDS = 200`** — once a trace hits 200 records, further
  records are silently dropped by that consumer's recorder (documented as
  the consumer's own responsibility, not enforced by the shaping functions
  in `trace-format.ts` themselves).

Call this the **SF profile**. It is a *storage-layer* convention on top of
the same wire format, not a different format — every record it writes is a
valid record under §2.2. A parser conformant with this spec MUST accept
both profiles: it MUST NOT assume a `result.body` is untruncated, and MUST
NOT assume a trace has fewer than 200 records. A `body` object of the
literal shape `{__truncated: true, preview: string, originalLength:
number}` is not currently a reserved/typed construct in the *proxy*
profile — a reader MAY special-case it, but MUST first fall back to
treating it as an ordinary JSON value if it doesn't recognize the marker,
since the proxy profile never produces it.

### 2.5 Example

```jsonc
{"t":"meta","seq":0,"name":"weekly-bookings","startedAt":"2026-07-18T14:02:00.000Z","wrapped":["caldiy"]}
{"t":"note","seq":1,"ts":"2026-07-18T14:02:01.100Z","text":"I'm about to pull this week's bookings"}
{"t":"call","seq":2,"i":0,"ts":"2026-07-18T14:02:01.200Z","tool":"list_bookings","args":{"from":"2026-07-14"}}
{"t":"result","seq":3,"i":0,"ok":true,"ms":142,"body":{"content":[{"type":"text","text":"{\"bookings\":[...]}"}]}}
```

---

## 3. SKILL.md format

Source of truth: `src/skill.ts` (`parseSkill`), `src/writeback.ts`
(`serializeSkill`, the faithful inverse), `test/skill.test.ts`.

### 3.1 Frontmatter (required)

A SKILL.md file MUST begin with a `---`-fenced frontmatter block
(`splitFrontmatter`, `src/skill.ts:58-76`):

- Line 1 MUST be exactly `---` (after trimming). Its absence is rejected:
  `"SKILL.md must start with a '---' frontmatter fence"`.
- The fence MUST be closed by another line that is exactly `---`; an
  unclosed fence is rejected: `"Frontmatter fence '---' was never closed"`.
- Between the fences, each non-blank line MUST match `key: value` (flat,
  no nesting, no YAML types beyond strings —
  `/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/`); any other shape is rejected
  as `"Malformed frontmatter line: ..."`.
- Exactly two keys are **required**: `name` and `description`. Missing
  either is rejected (`"Frontmatter is missing required field 'name'"` /
  `'description'`). Extra keys are parsed but silently unused by
  `parseSkill`'s return type — the parser does not reject unrecognized
  frontmatter keys (an open field set, unlike step bullets — see §0).
- A third, optional key, `manifest` (flight-recorder-v2, 0.19.0+), carries a
  one-line canonical-JSON `SkillManifest`: `{"v":1,"tools":[{"name":
  "<exposed-tool-name>","server":"<downstream-name>","digest":"sha256:<64
  hex>"}]}` — a schema digest per tool the skill's steps actually use,
  written by `reelier manifest <skill.md> --wrap ...` (§below). Present iff
  the skill has been stamped; absent for every pre-0.19.0 skill and for any
  skill never stamped. Malformed shape (wrong `v`, non-array `tools`, a
  tool missing `name`/`digest`, a `digest` not matching `sha256:[0-9a-f]
  {64}`) is rejected loudly (`SkillParseError`) rather than silently
  dropped.

### 3.2 Body: preamble, `## Steps`, step blocks, trailing sections

After the frontmatter, the body is split on **step headers** matching
`/^###\s+Step\s+(\d+)\s*[—-]\s*(.+)$/` (`STEP_HEADER_RE`) — i.e. exactly
`### Step <N> — <Title>` or `### Step <N> - <Title>` (em dash or hyphen,
either works). Everything before the first step header is the **preamble**
(title, `Inputs:` line, the `## Steps` heading itself, any prose) and is
preserved **verbatim** — `parseSkill` does not parse or validate it in any
way.

Step headers MUST be numbered **sequentially from 1**, in file order. A
gap or out-of-order number is rejected: `"Expected step <expectedN> but
found step <n> — steps must be numbered sequentially from 1"`. At least one
step header MUST be present, or the whole file is rejected: `"No '###
Step N — Title' headers found in skill body"`.

A step's field block runs from its header to the **next** step header or
the next level-2 (`##`, not `###`) section heading (`SECTION_HEADER_RE =
/^##(?!#)\s+/`), whichever comes first — a `## Open questions` or `##
Changelog` heading closes out the preceding step's block early, so
trailing sections are never swallowed into the last step.

Within a step's block, every non-blank line is either:

- a **bullet** matching `/^-\s*(intent|action|assert|bind|effect|approve)\s*:\s*(.*)$/`, or
- an **ignored prose line** (any non-blank line not starting with `-`), or
- **rejected** if it starts with `-` but the key isn't one of the six
  above: `"Unrecognized step field, expected one of
  intent/action/assert/bind/effect/approve: ..."`.

This makes the **six bullet keys a closed set** (§0) but tolerates
free-form prose commentary inside a step block, as long as it doesn't
start with a hyphen.

**Field requiredness and cardinality** (exactly as enforced by `parseSkill`,
`src/skill.ts:218-263`):

| Field | Required? | Cardinality | Duplicate → |
| --- | --- | --- | --- |
| `intent` | **Yes** — `"Step is missing required 'intent' field"` | exactly 1 | `"Duplicate 'intent' field in step"` |
| `action` | **Yes** — `"Step is missing required 'action' field"` | exactly 1 | `"Duplicate 'action' field in step"` |
| `assert` | No | 0 or more | (repeatable — each bullet appends) |
| `bind` | No | 0 or more | (repeatable — each bullet appends) |
| `effect` | **Yes** — `"Step is missing required 'effect' field"` | exactly 1 | `"Duplicate 'effect' field in step"` |
| `approve` | No (flight-recorder-v2, 0.19.0+) | 0 or 1 | `"Duplicate 'approve' field in step"` |

`assert` and `bind` are the only repeatable fields; every `- assert: ...`
or `- bind: ...` bullet in the block is collected in file order.

`approve: sha256:<64 hex>` (§6.1a) hash-binds a write/destructive step's
tool + argument template — a value not matching `sha256:[0-9a-f]{64}`
exactly is rejected at parse time, not silently accepted. Written by
`reelier approve <skill.md> [--all]`, never by hand.

After the last step's field block, everything remaining in the body is the
**trailing** section (`## Open questions`, `## Changelog`, anything else)
and, like the preamble, is preserved **verbatim** by the parser and by
`serializeSkill`'s round-trip.

### 3.3 The `action` line grammar

`- action: <tool> <json-args>` (`parseAction`, `src/skill.ts:105-128`):

- Split on the **first space** in the rest of the line. Everything before
  it is the tool name; everything after is parsed as JSON.
- No space at all → rejected: `"Malformed action line, expected '<tool>
  <json-args>', got: ..."`.
- Empty tool name (e.g. a line starting with a space) → rejected: `"Action
  line is missing a tool name"`.
- The remainder MUST be valid JSON (any JSON value — object, array,
  string, etc., though every example in this codebase uses an object) →
  invalid JSON is rejected: `"Action args are not valid JSON: <parse
  error>"`.
- String leaves inside the parsed JSON MAY contain `{{var}}` template
  holes (see §6.1 for exact substitution semantics: any string value, at
  any nesting depth inside an object or array, is a legal template hole
  site — object *keys* and non-string scalars are not, since `fillTemplate`
  only descends into string values, array elements, and object values).

### 3.4 Assert mini-language (exact grammar)

Source of truth: `evalAssert`, `src/assert.ts:55-150`; every form is tried
in the order listed and the **first regex match wins** — an unrecognized
line (matching none) throws `AssertParseError`:
`"Unrecognized assert expression: ..."`.

| Form | Regex (informative) | Semantics |
| --- | --- | --- |
| `status == <int>` | `^status\s*(==\|!=)\s*(\d+)$` | `obs.status === expected` |
| `status != <int>` | (same) | `obs.status !== expected` |
| `body contains "<text>"` | `^body\s+(not\s+contains\|contains)\s+"([^\r\n]*)"$` | `obs.body.includes(text)` |
| `body not contains "<text>"` | (same) | `!obs.body.includes(text)` |
| `json.<dotpath> is array` | `^json\.([a-zA-Z0-9_.]+)\s+is\s+(array\|set\|number\|string\|boolean\|null)$` | `Array.isArray(resolve(dotpath))` |
| `json.<dotpath> is set` | (same) | `resolve(dotpath) !== undefined && !== null` |
| `json.<dotpath> is number\|string\|boolean\|null` (0.11.0+) | (same) | `typeof`/`=== null` **type** assertion on the resolved value |
| `json.<dotpath> matches /<regex>/` (0.11.0+) | `^json\.([a-zA-Z0-9_.]+)\s+matches\s+\/(.*)\/$` | resolved value is a `string` and `new RegExp(pattern).test(value)` — a **value pattern** check |
| `json.<dotpath> length > <int>` | `^json\.([a-zA-Z0-9_.]+)\s+length\s*(>=\|<=\|>\|<)\s*(\d+)$` | `.length` of an array or string at the path, compared (`>=`/`<=` added 0.11.0) |
| `json.<dotpath> length < <int>` | (same) | (same, `<`/`>=`/`<=`) |
| `json.<dotpath> == <json-scalar>` | `^json\.([a-zA-Z0-9_.]+)\s*(==\|!=\|>=\|<=\|>\|<)\s*(.+)$` | strict `===`/`!==` against `JSON.parse(rawScalar)` |
| `json.<dotpath> != <json-scalar>` | (same) | strict `!==` |
| `json.<dotpath> >\|<\|>=\|<= <json-scalar>` | (same) | numeric comparison — only true if both sides are `typeof === "number"` (`>=`/`<=` added 0.11.0) |

`<dotpath>` is `a.b.c` or `a.0.b`-style (numeric segments index arrays),
matched by `[a-zA-Z0-9_.]+` and resolved by `resolveDotPath`
(`src/assert.ts:39-48`): walks the parsed JSON body one segment at a time,
returning `undefined` the moment it hits `null`/`undefined`/a non-object.
Every `json.*` form requires the observation's `body` to be valid JSON —
if `JSON.parse(obs.body)` throws, the assert itself throws
`AssertParseError` (`"Assertion needs JSON body but body is not valid
JSON: ..."`), which the runner treats as a step failure, not a parse-time
rejection of the skill file.

**Single-physical-line constraint (normative, security-relevant).** A
`body contains "<text>"` assert's quoted text MUST NOT contain a raw
`\n` or `\r` — the regex is anchored with `[^\r\n]*`, not `.*`. This is
deliberate defense-in-depth against a newline-injection class of bug: an
assert/bind line is the SKILL.md grammar's atomic unit (one physical line
per `- assert:`/`- bind:` bullet, §3.2), and `serializeSkill`/
`renderStepBlock` write each assert/bind back as one literal line. An
embedded newline in an assert's text — most realistically arriving via an
LLM-proposed escalation patch (§7) — would silently split into two bogus
physical lines on write-back, or worse, accidentally produce a line that
parses as a spurious `### Step N` header and bricks the file for every
future `parseSkill` call. `src/escalate.ts`'s patch validator
(`containsNewline`, `src/escalate.ts:224-226`) additionally rejects any
LLM-proposed assert/bind line containing `\n`/`\r` **before** it reaches
this regex at all — two independent layers guarding the same invariant,
not just one.

### 3.5 Bind mini-language (exact grammar)

Source of truth: `evalBind`, `src/assert.ts:161-194`. Unrecognized input
throws `BindParseError`: `"Unrecognized bind expression: ..."`.

| Form | Regex (informative) | Semantics |
| --- | --- | --- |
| `<name> = json.<dotpath>` | `^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*json\.([a-zA-Z0-9_.]+)$` | Binds `name` to `resolveDotPath(json, dotpath)`. `undefined` → `{ok: false}` (a divergence: `"bind <name> = json.<dotpath> failed: path not found"`), never a thrown parse error. |
| `<name> = body match /<regex>/` | `^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*body\s+match\s+\/(.*)\/$` | Compiles `<regex>` (via `new RegExp`; an invalid pattern throws `BindParseError`: `"Invalid regex in bind: ..."`), matches against `obs.body`, binds `name` to **capture group 1**. No match, or a match with no group-1, → `{ok: false}`: `"bind <name> = body match /<pattern>/ failed: no capture-group match"`. |

`<name>` MUST be a valid identifier (`[a-zA-Z_][a-zA-Z0-9_]*`). A `json.*`
bind requires a valid-JSON body identically to the assert form above.

**Reserved names (0.3.0+, normative).** `today` and any name matching
`today[+-]<digits>d` (e.g. `today-7d`, `today+30d`) are reserved for the
runner's computed date template vars (§6.1a) and MUST NOT be used as a bind
`<name>`. `parseSkill` enforces this at **parse time**, not at `evalBind`
time — a `- bind: today = json.date` (or `today-7d = ...`, even though that
particular string isn't a valid bind identifier to begin with) is rejected
immediately with `SkillParseError`: `"Bind name '<name>' is reserved for the
computed date template vars ({{today}}, {{today-Nd}}, {{today+Nd}}) and
cannot be used as a bind name"` (`src/skill.ts`). This is deliberately
stricter/earlier than waiting for the name to reach `evalBind`'s identifier
grammar, so a skill author gets one clear error naming the actual conflict
rather than a generic "unrecognized bind expression" — or worse, a bind
that silently shadows the reserved computed var only when its right-hand
side happens to also be a valid `json.<dotpath>`/`body match` form.

### 3.6 The `effect` enum (exact, closed)

`effect` MUST be exactly one of the three literals below (`EFFECTS`,
`src/skill.ts:51`); anything else is rejected at parse time: `"Invalid
effect <value> — must be one of read, idempotent-write, destructive"`.

| Value | Meaning | Destructive-gating contract |
| --- | --- | --- |
| `read` | No side effects. | Always executed. |
| `idempotent-write` | A write safe to repeat (create-if-absent, upsert, etc.). | **Read-only by default (0.10.0+):** refused unless the run was invoked with `--allow-writes` (or `--yes`, which implies it) — so replaying a skill never silently re-fires its writes. The runner records an honest failed step (`"Refusing to execute a write step … replay is read-only by default"`) instead of calling the tool. Gated on the **effective** effect (`step.effect ?? tool.effect`), so a POST-that-reads marked `effect: read` is never held back. |
| `destructive` | Non-idempotent or irreversible (delete, charge, send, etc.). | Refused unless the run was invoked with `--yes`/`allowDestructive: true` — the runner prints the filled action instead of calling the tool (`executeStep`, `src/runner.ts:166-179`). **Never** re-executed by the escalation ladder's Level 2 (§7.3) regardless of `--yes` — that check is independent of `allowDestructive` and happens before L2 is even invoked (`level3Message`, `src/runner.ts:267-273`; `attemptEscalation`, `src/runner.ts:348-351`). |

The gating contract above is the **legacy** path — still exactly what
happens for any write/destructive step with no `approve:` field. A step
that carries `approve:` is gated differently (§6.1b, flight-recorder-v2,
0.19.0+): the hash-bound approval is the FINAL word, and no flag
(`--allow-writes`, `--yes`) overrides a mismatch.

### 3.7 Non-Steps sections and the Changelog write-back convention

- **Preamble and trailing content are preserved verbatim** (§3.2) —
  `serializeSkill` is the faithful inverse of `parseSkill`: it re-emits the
  parsed `preamble` and `trailing` strings byte-for-byte, and only
  re-renders step blocks canonically (via `renderStepBlock`,
  `src/writeback.ts:13-23`). Round-tripping `parse → serialize → parse` is
  therefore idempotent from the second pass onward, though not necessarily
  byte-identical to *hand-formatted* input on the first pass (e.g.
  `JSON.stringify` spacing on the action line may differ from what a human
  originally typed).
- A `## Open questions` section is conventional (produced by `reelier
  compile`, §6) but not required or specially parsed — it is ordinary
  trailing content as far as `parseSkill` is concerned.
- A `## Changelog` section is where **write-back** (§7.5) appends one line
  per successful heal:
  `- <ISO-date> — L<level> heal, step <n> (<title>): <one-sentence reason,
  flattened to one line and truncated at 300 chars>`. If the section
  doesn't exist yet, `appendChangelogLine` (`src/writeback.ts:66-94`)
  creates it at the end of `trailing`; if it exists, the new line is
  inserted directly after the last existing bullet (skipping back over
  trailing blank lines) and before the next `##` section or EOF. This
  convention is enforced by the write-back code path, not by `parseSkill` —
  a `## Changelog` section with non-heal-shaped bullets is legal and
  untouched.

### 3.8 Example

```markdown
---
name: sf-post-deploy-smoke
description: Post-deploy smoke sweep of seldonframe.com core routes
---

# SF post-deploy smoke sweep

Inputs: (none for this skill)

## Steps

### Step 1 — Homepage is up and branded
- intent: Confirm the marketing homepage serves and carries the brand sentinel
- action: http.get {"url": "https://www.seldonframe.com/"}
- assert: status == 200
- assert: body contains "SeldonFrame"
- effect: read

## Open questions

- (none)

## Changelog

- 2026-07-17 — compiled from smoke-1.jsonl (1 calls, 1 steps)
```

---

## 4. Run-record format (0.2.0)

Source of truth: `src/runner.ts` (`RunRecord`, `StepRecord`, `runSkill`),
`test/runner.test.ts`, `test/runner-escalate.test.ts`, `test/bench-cli.test.ts`.

Every `reelier run` invocation (unless `--dry-run`) appends exactly one
JSON line to `.reelier/runs/<skill-name>.jsonl`.

### 4.1 `StepRecord`

```ts
interface StepRecord {
  n: number;
  title: string;
  level: 0 | 1 | 2;
  outcome: "passed" | "failed" | "unchecked" | "skipped";
  ms: number;
  failures: string[];
  llm?: { inputTokens: number; outputTokens: number; model?: string };
  escalationAttempted?: 0 | 1 | 2;
  why?: { trigger?: string; change?: string };
  write?: {
    idempotencyKey: string;
    approved: boolean;
    resource?: { id?: string; version?: string };
    duplicateOf?: number;
  };
  mocked?: true;
}
```

| Field | Semantics |
| --- | --- |
| `n`, `title` | Copied from the step. |
| `outcome` | `"passed"` — ran, had ≥1 assertion, all held. `"unchecked"` — ran, had zero assertions (honest-success rule, §4.3). `"failed"` — an assertion or bind failed, a tool errored, a template var was unbound, or an unknown tool/destructive-without-`--yes` refusal occurred, **and** it did not heal via escalation. `"skipped"` — an earlier step diverged and the run stopped before this step was attempted. |
| `level` | `0` = ran deterministically **or** never healed (including "escalation was attempted but didn't hold" — see the distinction below). `1`/`2` = **healed** at that escalation level. |
| `failures` | Human-readable failure messages accumulated for this step; empty iff `outcome` is `"passed"`/`"unchecked"`. On a healed step, `failures` is reset to `[]`. |
| `llm` | Present **iff** escalation ran for this step at all (any level, success or failure) — summed input/output tokens across every attempt on this step. Absent, not `{inputTokens:0,...}`, when escalation never ran. `llm.model` (0.17.0+, the $ meter — flight-recorder-v1 §2) is the model of the **highest escalation level actually invoked** on this step (L2's model if L2 ran, else L1's) — a step that tried L1 then L2 with two different models has its summed tokens priced entirely at the L2 rate by `reelier cost`. Absent when the caller never passed `--llm-model`/`--llm-l2-model` and the runner's own default also went unresolved (never happens in practice — the runner always has a default), or on any pre-0.17.0 record. |
| `escalationAttempted` | The **highest level TRIED**, present iff L1 was invoked at all. **Distinct from `level`**: a step can have `escalationAttempted: 2` and `level: 0` simultaneously — it burned L1 and L2 tokens and still never healed. `level` only ever reflects the level that *healed* it. |
| `why` (0.8.0+) | Present **only** when this step's behavior changed: `trigger` = the load-bearing divergence (the first failure, verbatim from the real assertion/tool result) on a `"failed"` step; `change` = what the successful L1/L2 patch changed (`"L1: <reason>"` / `"L2: <reason>"`, the escalation's own reason) on a healed step. Absent on an unchanged step. **Never fabricated** — a producer MUST populate it only from observed engine data, never from generated narrative. |
| `write` (0.19.0+, §6.1c) | Present **iff** this step's tool call actually dispatched a write-effect (`idempotent-write`/`destructive`) call — never for a refused, skipped, or mocked step. `approved` is `true` iff dispatched via a matching `Step.approve` hash, `false` via the legacy `--allow-writes`/`--yes` flags. `resource` is a best-effort, honestly-labeled extraction from the response body; absent, never fabricated, when nothing was found. `duplicateOf` is the step number of an earlier step in the SAME run that wrote the identical `idempotencyKey`. |
| `mocked` (0.19.0+, §6.1d) | `true` iff this step's observation was a synthetic injected failure (`--fail N[=status]`) rather than a real tool dispatch. Absent for every real step. |

### 4.2 `RunRecord`

```ts
interface RunRecord {
  skill: string;
  startedAt: string;
  finishedAt: string;
  passed: boolean;
  skillContentSha256?: string;
  manifestIgnored?: true;
  mockFailures?: number[];
  steps: StepRecord[];
  totals: {
    steps: number;
    passed: number;
    unchecked: number;
    skipped: number;
    failed: number;
    ms: number;
    llmInputTokens: number;
    llmOutputTokens: number;
  };
}
```

`passed` is `true` iff zero steps have `outcome === "failed"` — an
`"unchecked"` step does **not** make the run fail, but it also does not
count toward `totals.passed`.

`manifestIgnored` (0.19.0+, §6.1b) is `true` iff this run's manifest
preflight was explicitly bypassed via `--ignore-manifest` — absent on every
run that had no manifest to check, or whose preflight ran normally.

`mockFailures` (0.19.0+, §6.1d) is the sorted list of step numbers that had
an injected failure (`--fail N[=status]`) this run — present only when
non-empty. A record carrying this field is a local recovery test, never a
real receipt: `reelier push` (§8) refuses to push it, unconditionally.

### 4.3 Totals honesty rule (normative)

`totals.passed` MUST count **only** steps whose `outcome` is exactly
`"passed"` — it MUST NOT include `"unchecked"` steps. This is the 0.2.0
"totals honesty" fix: before it, `totals.passed` silently rolled up
`"passed" OR "unchecked"` together, which meant a step with zero
assertions (proving nothing) could inflate an apparent pass count. Stated
as a consumer-facing rule: **a consumer MUST NOT present an `"unchecked"`
step, or a `totals.unchecked` count, as evidence of a passing check** —
`"unchecked"` means "ran without incident," not "verified." This mirrors
`executeStep`'s own honest-success rule at evaluation time (`src/runner.ts:225-229`):
a step with `step.asserts.length === 0` is `"unchecked"`, never `"passed"`,
even if its tool call succeeded outright.

### 4.4 Legacy-derivation rule (normative)

Run records written **before** 0.2.0 have no `totals.unchecked`, no
`totals.skipped`, and their `totals.passed` used the old (dishonest)
passed-OR-unchecked rollup — but every record's **per-step** `outcome`
values were always correct, regardless of package version. Therefore:

> A consumer reading a run-record file MUST check for the presence of
> `totals.unchecked` (or, equivalently, `totals.skipped`). If **absent**,
> the consumer MUST derive `passed`/`unchecked`/`skipped`/`failed` counts
> by filtering `steps[].outcome` directly, and MUST NOT trust that
> record's own `totals.passed` field. If **present**, the record is 0.2.0+
> shaped and its `totals` fields may be trusted as-is.

This is exactly the fallback `reelier bench` (`src/cli.ts`) implements, and
it is what makes a mixed pre-/post-0.2.0 run-record history safely
readable without a migration step — old records never need to be rewritten.

### 4.5 Example

```jsonc
{
  "skill": "my-skill",
  "startedAt": "2026-07-18T14:00:00.000Z",
  "finishedAt": "2026-07-18T14:00:01.230Z",
  "passed": true,
  "steps": [
    { "n": 1, "title": "List bookings", "level": 0, "outcome": "passed",
      "ms": 123, "failures": [] }
  ],
  "totals": {
    "steps": 1, "passed": 1, "unchecked": 0, "skipped": 0, "failed": 0,
    "ms": 123, "llmInputTokens": 0, "llmOutputTokens": 0
  }
}
```

---

## 5. MCP proxy contract

Source of truth: `src/recorder.ts` (`buildProxyServer`), `src/mcp-client.ts`
(`buildToolRoutes`), `test/proxy-e2e.test.ts`, `test/recorder.test.ts`.

`reelier mcp --wrap "<downstream command>" [--wrap "..."] [--trace-dir
<dir>]` starts an MCP server on stdio that re-exposes every `--wrap`'d
downstream server's tools, plus three control tools.

### 5.1 The three control tools

| Tool | Input schema | Behavior |
| --- | --- | --- |
| `reelier_start_recording` | `{ name: string }` (required) | Begins a new trace at `.reelier/traces/<name>-<n>.jsonl`. If already recording, returns (not throws — an MCP tool-result with plain text, not `isError`) a message naming the currently-recording trace and instructing the caller to stop it first — recordings never nest or silently overwrite. |
| `reelier_note` | `{ text: string }` (required) | Appends a `note` record if currently recording; a friendly no-op message (not an error) if not recording. |
| `reelier_stop_recording` | `{}` | Ends the current recording, flushes pending writes, returns the trace path and total call count. A friendly no-op message if not currently recording. |

All three tools validate their required string argument and return
`{...textResult(...), isError: true}` if it's missing or not a string —
this is the one case where a control tool sets `isError`.

### 5.2 Passthrough guarantees (normative)

- **1:1 exposure**: every downstream tool is exposed under its own name
  (subject to collision-prefixing, §5.3), with its original `description`
  and `inputSchema` copied through unmodified (`ListToolsRequestSchema`
  handler, `src/recorder.ts:158-182`).
- **The live path is never redacted or modified.** `redact()` is applied
  only to the copy written into the trace record (`recordCall`/
  `recordResult`, `src/recorder.ts:108-117`); the `result` object returned
  to the calling agent from `CallToolRequestSchema` is the **exact** object
  `route.downstream.call(...)` produced (or an error-shaped stand-in on a
  thrown exception), never passed through `redact()` at all
  (`src/recorder.ts:184-234`). A conformant proxy implementation MUST
  preserve this separation — redaction is a trace-write-time concern only,
  and MUST NOT alter what the calling agent actually receives.
- **Calls made while not recording pass through unlogged** — `isRecording`
  gates whether `recordCall`/`recordResult` are invoked at all
  (`src/recorder.ts:218-219, 230-231`); the downstream call itself always
  happens regardless of recording state.
- Timing (`ms`) is measured around the downstream `.call(...)` only, not
  including proxy-side bookkeeping.

### 5.3 Collision-prefixing rule

`buildToolRoutes` (`src/mcp-client.ts:150-165`) is the **single source of
truth for name resolution**, shared identically by the recording proxy
(exposure) and the runner's `--wrap` mode (replay lookup — §6 below), so a
name recorded by `reelier mcp` always resolves to the same tool on replay.
Downstreams are processed in `--wrap` order (0-indexed):

- A tool's name is exposed as-is **unless** a tool of the same name was
  already registered by an earlier downstream.
- On collision, the **later** downstream's tool is exposed as
  `<downstreamIndex>_<name>` (0-based index into the `--wrap` list, not
  the earlier downstream's index), and a warning is logged to stderr:
  `[reelier] tool name collision: '<name>' from downstream <idx>
  (<downstream.name>) exposed as '<prefixed>'`.
- The **first** downstream to register a given name always keeps the
  unprefixed name — only later collisions get prefixed.

---

## 6. Runner semantics (normative summary)

Source of truth: `src/runner.ts` (`runSkill`, `executeStep`,
`attemptEscalation`), `src/compile.ts` (dataflow recovery),
`test/runner.test.ts`, `test/runner-escalate.test.ts`, `test/compile.test.ts`.

### 6.1 The L0 loop

For each step, in file order, unless an earlier step has already diverged
(in which case this step is recorded `"skipped"` and nothing is executed):

1. **Fill** `{{var}}` template holes in `step.actionArgs` against the
   accumulated `bindings` map (`fillTemplate`, `src/runner.ts:101-122`) —
   recursively over string leaves of arrays/objects. A `{{name}}` whose
   `name` is not yet in `bindings` throws `"Unbound template variable
   {{name}}"` — this is itself a divergence (see below), not a parse-time
   error.
2. If `step.effect === "destructive"` and `allowDestructive` is false, the
   step is refused (`"failed"`) without calling the tool at all — the
   filled action is reported in the failure message so the operator can
   see exactly what would have run.
3. Otherwise, **execute**: look up `step.actionTool` in the tool registry
   (unknown tool → `"failed"`), call `tool.run(filledArgs, ctx)` to
   produce an `Observation` (any thrown error → `"failed"`).
4. **Evaluate every `assert` line** against the observation (`evalAssert`)
   and **every `bind` line** (`evalBind`), collecting binds into a
   step-local map. Any assert failure or bind failure appends to
   `failures` but does not stop evaluating the rest of the step's asserts/
   binds (all are evaluated, not short-circuited).
5. Outcome: `"failed"` if `failures.length > 0`; else `"unchecked"` if
   `step.asserts.length === 0`; else `"passed"`.
6. **Only on `"passed"`/`"unchecked"`** are this step's locally-collected
   binds merged into the shared `bindings` map used by later steps
   (`Object.assign(bindings, exec.binds)`, `src/runner.ts:439-442`) — never
   on `"failed"`, even if some binds evaluated successfully before a later
   assert or bind failed in the same step. This prevents a step that fails
   partway through from polluting shared state with values from a run that
   never actually held.

### 6.1a Computed date template vars (0.3.0+)

Source of truth: `fillTemplate`, `src/runner.ts` (the `resolveComputedDateVar`
helper and the regex it's threaded through). Step 1 of the L0 loop (§6.1)
fills `{{var}}` holes; exactly two computed forms are resolved
**deterministically from a clock, never from `bindings`**, before an
ordinary bindings lookup is even attempted:

| Form | Resolves to |
| --- | --- |
| `{{today}}` | The current UTC calendar date, `YYYY-MM-DD`. |
| `{{today-Nd}}` | The UTC calendar date `N` days before `{{today}}`. |
| `{{today+Nd}}` | The UTC calendar date `N` days after `{{today}}`. |

`N` MUST be an integer in `1..365` (inclusive on both ends — use `{{today}}`
itself for `N = 0`). A `{{today±Nd}}` hole whose `N` is out of that range is
a divergence: `fillTemplate` throws `"Computed date var {{today±Nd}} has an
offset of <N> days — only 1-365 is supported"`, exactly like an unresolved
`{{var}}` (§6.2 lists this as one of the divergence triggers). No other
computed form exists — no times, no formats, no locales; a future need for
those is a new, separately-versioned form, not a silent extension of this
one.

**These are reserved names, not an escape hatch inside `bindings`.** A
skill's own `bind`s can never produce a variable named `today` or
`today±Nd` — `parseSkill` rejects that at parse time (§3.5). This makes
`{{today}}`/`{{today±Nd}}` resolution unconditional: `fillTemplate` never
needs to disambiguate "is this the computed var or a user bind that happens
to share its name," because that collision is structurally prevented one
layer up.

**Determinism and the clock (normative).** `{{today}}`/`{{today±Nd}}`
introduce a **deliberate, by-design** run-time-dependent value — the whole
point is that the same skill resolves a different date on a different day.
This is the one place reelier intentionally departs from pure deterministic
replay. To keep it from being *needlessly* nondeterministic (e.g. a run
straddling a UTC midnight boundary resolving `{{today}}` differently for
step 3 than for step 1), `fillTemplate` takes an optional `now` parameter
(epoch ms, default `Date.now()`), and `runSkill` computes exactly **one**
`now` snapshot per run and threads it through every `fillTemplate` call made
during that run (`executeStep`, the destructive-refusal preview, and the L2
patched-args fill in `attemptEscalation` all share it) — so a run's computed
dates are internally consistent even if the run takes several seconds.
`dryRunSkill` takes the same optional `now` for the same reason. This clock
parameter is an internal injection seam for reproducible tests, not a
documented CLI flag — the CLI itself always defaults to the real clock.

### 6.1b Manifest preflight (`reelier manifest`, flight-recorder-v2, 0.19.0+)

Source of truth: `src/manifest.ts` (`buildManifestForSkill`,
`preflightManifest`), `src/cli.ts` (`cmdManifest`, `cmdRun`),
`test/manifest.test.ts`, `test/manifest-cli.test.ts`.

- `reelier manifest <skill.md> --wrap "<command>"` connects the given
  downstream(s), resolves tool routes the same way replay does
  (`buildToolRoutes`, §5.3), and stamps `skill.manifest` (§3.1) with one
  entry per tool the skill's steps actually use — `digest = sha256(canonical
  JSON of the tool's inputSchema)`. Printed per-tool as `unchanged` /
  `updated` / `added` / `removed` against whatever manifest was already
  stamped. No `--wrap` given is a usage error, exit 1.
- `reelier run <skill.md> --wrap ...` runs the preflight **before step 1
  executes** whenever `skill.manifest` is present: `ok` → proceed silently;
  any missing tool or schema mismatch → `MANIFEST DRIFT — refusing to
  replay (fail closed)` printed per drifted tool, exit 1, and the fake/real
  downstream's `call` is never invoked. A manifest present with no `--wrap`
  at all is also a hard refusal (nothing to preflight against). A skill
  with no manifest gets an advisory note only and runs normally — every
  pre-0.19.0 skill is unaffected.
- `--ignore-manifest` is the explicit break-glass override: skips the
  preflight, prints a `WARNING: --ignore-manifest` line, and stamps
  `RunRecord.manifestIgnored: true` (§4.2) — never a silent bypass.

### 6.1c Per-step write approval (`reelier approve`, flight-recorder-v2, 0.19.0+)

Source of truth: `src/approval.ts` (`computeApprovalHash`,
`computeIdempotencyKey`), `src/runner.ts` (`executeStep`'s write-gate
block), `src/cli.ts` (`cmdApprove`), `test/approval.test.ts`,
`test/runner.test.ts`.

For a write/destructive step (§3.6) whose `effect` is the **effective**
effect (`step.effect ?? tool.effect`):

- **No `approve:` field** — unchanged legacy behavior (§3.6's table):
  gated on `--allow-writes`/`--yes`.
- **`approve:` present** — this is the FINAL boundary, and it replaces the
  legacy flags entirely for this step:
  - `step.approve === computeApprovalHash(step)` (a hash over the step's
    tool name + argument *template*, `{{placeholders}}` intact — never the
    filled args, and never including the server, so `reelier approve` can
    run fully offline) → the step executes with **no flag needed at all**,
    even a `destructive` one.
  - Any mismatch (the step's tool or args changed since it was approved) →
    `"failed"` with `"Approval mismatch on write step … Re-review and
    re-approve: reelier approve <skill.md>"` — **no flag overrides this**,
    including `--allow-writes` and `--yes` together. The tool is never
    called.
- `reelier approve <skill.md> [--all]` walks every write/destructive step,
  shows its current state (`unapproved` / `approved (current)` / `approved
  (STALE — args changed)`), and on confirmation (or unconditionally under
  `--all`) stamps `step.approve = computeApprovalHash(step)`, serializes,
  and appends one `## Changelog` line (§3.7).

**Write receipts.** Whenever a write/destructive step's tool call actually
dispatches (approved-hash path or legacy-flag path alike), `StepRecord`
(§4.1) gains a `write` block: `idempotencyKey` (`computeIdempotencyKey(tool,
tool.server ?? null, filledArgs)` — the tool + the FILLED args + the
downstream server, never enforced against external state), `approved`
(`true` iff executed via a matching approval hash, `false` via the legacy
flags), an optional best-effort `resource` (`id`/`version`, extracted from
a JSON response body's `id`/`_id` and `version`/`etag`/`revision`/`sha`
fields when present — honestly omitted, never guessed, otherwise), and an
optional `duplicateOf` (the step number of an earlier step in the SAME run
that wrote the identical `idempotencyKey` — recorded, not failed). A step
that never dispatched (refused, skipped, or mocked — §6.1d) never gets a
`write` block.

### 6.1d Mocked-failure replay (`--fail N[=status]`, flight-recorder-v2, 0.19.0+)

Source of truth: `src/runner.ts` (`executeStep`'s mock branch, immediately
after the unknown-tool check and before the write-gate block), `src/cli.ts`
(`cmdRun`'s `--fail` parsing), `test/runner.test.ts`.

`reelier run <skill.md> --fail N[=status]` (repeatable; `N` alone defaults
to injected status `500`) replaces step `N`'s real tool dispatch with a
synthetic `Observation {status, headers: {}, body: "reelier: injected
failure (--fail N)"}` — the step's `{{var}}` template is still filled first
(a template error is a real divergence and surfaces normally), but no tool
call happens: the write/approval gate (§6.1c) is never consulted, so a
write step can be recovery-tested with no `--allow-writes` and no
`approve:`. The synthetic observation flows into the same assert/bind
evaluation (§6.1) and, on divergence, the SAME escalation ladder (§6.3) a
real failure would hit — a mocked step CAN heal at L1/L2 exactly like a
real one, and L2's re-execution (if reached) calls the real tool. A mocked
step's `StepRecord` (§4.1) carries `mocked: true` and never a `write`
block, even if L2 healed it with a genuine write. `RunRecord.mockFailures`
(§4.2) is the sorted list of step numbers that had an injection this run,
present only when non-empty. `reelier push` (§8) refuses to push any record
carrying `mockFailures` — a mock run is a local recovery test, never a real
receipt, and there is no override.

### 6.2 Divergence (definition)

A step **diverges** iff its `"failed"` outcome arises from any of:

- an `assert` line evaluating false,
- a `bind` line failing to extract (path not found / regex didn't match),
- an unresolved `{{var}}` template hole, or a `{{today±Nd}}` computed date
  var whose offset is out of the supported 1-365 range (§6.1a),
- a tool execution error, an unknown tool name, or a destructive-refusal.

Divergence is what triggers escalation (§6.3) when `--max-level ≥ 1`; at
`--max-level 0` (the default) divergence simply ends the run — every
remaining step is recorded `"skipped"`, and no LLM client is ever
constructed or called (`runSkill`, `src/runner.ts:412-478`; the `LlmClient`
type is only ever touched inside `attemptEscalation`, which itself early-
returns before touching `options.llm` when `maxLevel < 1`).

### 6.3 The escalation ladder

Only reachable when a step's outcome is `"failed"` **and** its `observation`
was captured (i.e. the tool actually ran — a destructive-refusal or an
unbound-template failure has no observation and cannot escalate).

- **L0** (always on) — no escalation; described above.
- **L1** — `resolveL1` (`src/escalate.ts:331-357`) sends the step text, the
  failure messages, and a bounded summary of the **already-captured**
  observation (status, body truncated to ~2000 chars, up to 40 sampled
  `json.<path>` leaves) to the LLM, asking it to propose a patched
  `assert`/`bind` set for *that same* observation. **L1 never re-executes
  anything** — it is zero-side-effect by construction, because the
  observation is fixed input, never refetched. The patch is validated
  against the exact assert/bind grammar (§3.4/§3.5) via
  `validateAssertSyntax`/`validateBindSyntax` before being trusted, and is
  rejected (falls through to a `"failed"` outcome, or to L2 if
  `--max-level 2`) if: the JSON response isn't a well-formed patch object,
  any proposed line fails grammar validation, any line contains an
  embedded newline (§3.4), or the patch would strip **all** assertions
  from a step that previously had at least one (`assertionsWereStripped`,
  `src/escalate.ts:314-316` — refusing to let a heal silently downgrade a
  previously-checked step to permanently `"unchecked"`). A holding L1
  patch is re-evaluated (`reEvaluatePatch`) against the fixed observation
  one more time before being accepted, merges its binds into `bindings`,
  and is **written back immediately** (§6.4).
- **L2** — tried only if L1 didn't hold and `--max-level 2`, **and** the
  step's `effect` is `read` or `idempotent-write` — a `destructive` step is
  refused before L2 is even invoked (`level3Message`), with a message
  pointing at manual (Level 3) recovery. `resolveL2`
  (`src/escalate.ts:369-409`) may additionally propose patched `args` (only
  referencing `{{name}}`s already present in `bindings` —
  `findUnboundTemplateVar` rejects anything else) for **exactly one**
  re-execution of the step's tool call. The harness fills the patched args,
  calls the tool once against the fresh result, re-evaluates the patched
  asserts/binds against that **new** observation, and accepts only if that
  holds. Same grammar/newline/empty-assertions validation as L1 applies.
  On success, binds merge into `bindings` and the heal is written back.
- **L3** (not implemented) — a diverged destructive step, or a failed L2,
  simply stops the run with a message directing a human to edit the skill
  by hand.

**maxLevel gating**: `options.maxLevel` (`0 | 1 | 2`, default `0`) is the
sole gate on how far escalation is allowed to climb; `options.llm` (an
injected `LlmClient`) is required for any escalation to happen at all —
absent, escalation is skipped entirely regardless of `maxLevel`.

**`allowDestructive` (`--yes`) and escalation are independent controls.**
`allowDestructive` only gates whether a `destructive` step's **L0**
execution is attempted in the first place (§6.1 step 2). Whether that
step, once diverged, is eligible for L2 re-execution is gated separately
by `step.effect !== "destructive"` — passing `--yes` does not make a
destructive step eligible for L2; a destructive step is categorically
excluded from L2 regardless of `--yes`.

**`dryRun` — two distinct things share this name; do not conflate them
(normative):**

- **`dryRunSkill(skill, vars, now)`** — the function the CLI's `--dry-run`
  flag actually calls. A separate, simpler code path from `runSkill`
  entirely: it fills `{tool, args}` for every step and returns that, with
  **zero execution and zero side effects** — no tool is ever called, no
  run record is written, nothing is appended anywhere.
- **`runSkill(skill, { dryRun: true, ... })`** — a different thing that
  happens to share the option name `dryRun`. Every step's tool call still
  **executes for real** (a destructive step still executes if
  `allowDestructive` is set, exactly as it would with `dryRun` unset) —
  `options.dryRun` here gates **only** the final `appendFile` that writes
  the run record to `.reelier/runs/<skill>.jsonl`. This is a narrower,
  programmatic knob for a caller that wants a real run's real side effects
  without that run counting toward `reelier bench` history — it is not
  wired to any CLI flag today.

### 6.4 Write-back (mandatory on heal)

A successful heal at L1 or L2 is applied to the **in-memory** `Skill`
object (`step.asserts`, `step.binds`, and — L2 only, when `args` was
proposed — `step.actionArgs`), a changelog line is appended to `trailing`
(§3.7), the whole skill is re-serialized via `serializeSkill`, and written
to `skillPath` — **synchronously, before the run record is written**
(`applyWritebackSafely`, `src/writeback.ts:158-168`, called from
`attemptEscalation`, `src/runner.ts:322-330, 393-401`). This is mandatory,
not best-effort: the entire point of the escalation ladder is that the
same drift never has to escalate twice. A filesystem failure during
write-back (disk full, permission denied) is caught and logged loudly to
stderr but MUST NOT crash the run — the heal already succeeded *for this
run*; only persistence failed. If `skillPath` was never provided to
`runSkill` (e.g. a caller running an in-memory skill), no write-back is
attempted at all and a stderr warning explains that the heal will not
persist.

**Write-safety: atomic write-back (0.3.0+, normative).** `applyWriteback`
MUST NOT write `skillPath` in place. It writes the fully-serialized skill to
a temp file in the same directory (`<skillPath>.tmp-<random suffix>`), then
renames the temp file over `skillPath` (`writeFileAtomic`,
`src/writeback.ts`). A reader can therefore only ever observe the file
**before** the heal (the complete old content) or **after** it (the
complete new content) — a torn/partial skill file from a mid-write crash or
kill is unrepresentable. If the direct rename throws `EEXIST` or `EPERM`
(observed on some Windows configurations when the target is open elsewhere,
though `fs.rename`'s `MoveFileExW`-with-`MOVEFILE_REPLACE_EXISTING`
semantics on modern Node already handle the common rename-over-existing-file
case directly), the fallback is: unlink the target, then retry the rename
exactly once. That retry's own failure propagates as a normal thrown error
(caught by `applyWritebackSafely`'s stderr-warning wrapper, same as any
other write-back failure, per the paragraph above) — it is not looped
further. The temp file is unconditionally cleaned up in a `finally` block on
every path (success, first-rename failure recovered by the fallback, or a
permanent failure) — it MUST NOT be left behind under any outcome. **Full
inter-process locking — two separate reelier processes racing a write-back
against the same skill file — is explicitly out of scope for this atomicity
guarantee and is deferred to cloud execution** (a future single-writer
arbitration layer), where concurrent runs against the same skill are
actually possible; a local CLI invocation of `reelier run` is not expected
to race itself.

### 6.5 Compiler: date-literal detection (0.3.0+)

Source of truth: `compile`, `src/compile.ts` (the date-literal detection
pass, run after dataflow recovery, before the promote-to-input pass),
`test/compile.test.ts`.

`reelier compile` never guesses whether a recorded literal date was meant to
be relative to run time or a genuinely fixed date — that's intent the trace
alone can't settle, and getting it wrong silently would be worse than not
compiling a computed var at all. Instead, for every call's **final** filled
args (i.e. after dataflow recovery has already turned any dataflow-matched
literal into a `{{var}}` — a value recovered from a prior step's result is
never also flagged as a date literal here), every string leaf shaped like an
ISO date (`YYYY-MM-DD`, optionally with a `T...` time suffix; month/day
range-validated AND round-trip-validated against `Date.UTC` — so
`2026-13-40` doesn't match as a date, and neither does a roll-over date like
`2026-02-30` or a non-leap `2026-02-29`, whose `Date.UTC` form would
silently shift into the next month and make any computed offset fabricated
math; date-SHAPED-but-impossible literals get their own honest "not a real
calendar date" open question instead of offset math. A version string like
`"1.2.3"` — no dashes at all — or a UUID's first hyphen-delimited group — 8
hex digits, not exactly 4 decimal digits — never matches the shape at all)
gets an **open question**, never an automatic substitution:

- If the literal's calendar date equals the trace's own recording date
  (`meta.startedAt`, truncated to `YYYY-MM-DD`, UTC): suggests `{{today}}`.
- If the literal is `N` days before the recording date, `1 <= N <= 365`:
  suggests `{{today-Nd}}`, with `N` computed exactly from the two dates
  (`Date.UTC` day-difference, not an approximation).
- If the literal is `N` days after the recording date, `1 <= N <= 365`:
  suggests `{{today+Nd}}`.
- If the literal is more than 365 days from the recording date in either
  direction: no computed form applies (the runner's own 1-365 range limit,
  §6.1a) — the open question says so explicitly rather than suggesting a
  form that would immediately fail at replay time.

Each open question names the step, quotes the literal exactly as recorded,
states the offset in plain language ("N days before/after run time", with
singular "1 day"), gives the concrete suggested substitution, and names the
recording date the offset was computed against — so a human reviewing the
compiled skill can decide in one read whether to accept the computed form or
keep the literal as a genuinely fixed date. Two datetime-specific
refinements (0.13.0+): a literal carrying a `T...` time suffix gets a
substitution that keeps the suffix verbatim (`"{{today-7d}}T09:30:00Z"` —
the runner's `{{today±Nd}}` resolves to a bare date, so replacing the whole
string would silently drop the time), and a literal whose explicit non-UTC
offset places it on a **different UTC calendar day** than the date as
written (e.g. `2026-07-11T23:30:00-05:00` is `2026-07-12` in UTC) gets an
explicit which-day note, since `{{today±Nd}}` resolves as a UTC date. The
offset math itself always uses the date as written. If the trace has no
`meta` record (or the `meta.startedAt` doesn't itself parse as a date, which
should never happen for anything `Recorder.start` produced), date-literal
detection is skipped entirely rather than guessing — a defensive fallback,
not a normal path.

**Lint consolidation (0.13.0+).** The date / UUID / Unix-timestamp lints all
key their occurrences by literal value: when the SAME literal appears in 3+
distinct steps, the compiler emits ONE consolidated open question on the
literal's first step, listing every step it appears in ("appears in steps 2,
4, 7 — one variable?"), instead of per-step duplicates. Below that threshold
(1-2 steps) the per-step flags are kept unchanged. The lint text depends
only on the literal value and the recording date, so consolidation never
drops information — every occurrence would have said the same thing.

---

## 7. Conformance

A third-party implementation reading or writing these formats should
verify against the following reference tests, which this specification was
cross-checked against line-by-line:

| Format area | Reference test file(s) |
| --- | --- |
| Assert grammar (all forms) | `test/assert.test.ts` |
| Bind grammar (all forms) | `test/assert.test.ts` |
| SKILL.md frontmatter/step parsing, field requiredness | `test/skill.test.ts` |
| Reserved bind names (`today`/`today±Nd`) | `test/skill.test.ts` |
| Serialize/round-trip, changelog write-back | `test/writeback.test.ts` |
| Atomic write-back (temp-then-rename, EEXIST/EPERM fallback, cleanup) | `test/writeback.test.ts` |
| Trace record shape, ordering, control tools | `test/recorder.test.ts`, `test/proxy-e2e.test.ts` |
| MCP result → Observation mapping | `test/mcp-tool.test.ts` |
| Compiler (dataflow recovery, effect classification, open questions) | `test/compile.test.ts`, `test/compile-cli.test.ts` |
| Compiler date-literal detection | `test/compile.test.ts` |
| Runner L0 loop, honest outcomes, totals | `test/runner.test.ts` |
| Computed date template vars (`{{today}}`, `{{today±Nd}}`) | `test/runner.test.ts` |
| Escalation ladder (L1/L2, grammar validation, destructive gating, write-back) | `test/runner-escalate.test.ts`, `test/escalate.test.ts` |
| Run-record legacy-derivation (`reelier bench`) | `test/bench-cli.test.ts` |
| Redaction patterns | `test/redact.test.ts` |
| Cloud sync (`reelier push`): cursor math, `--all`, mid-batch failure, auth abort, skill-upload-on-first-push, `--dry-run` | `test/push.test.ts` |

---

## 8. Cloud sync API (`reelier push`) — consumer-side contract

Source of truth: `src/push.ts` (`pushSkill`, `resolvePushConfig`), `test/push.test.ts`.

**This section specifies only what `reelier push` relies on as an HTTP
client.** The cloud server's own behavior — how it stores runs, what it
does with a skill upload, its auth model beyond "accepts or rejects this
bearer token" — is that product's own spec, not this one. What follows is
normative for the CLI side only: what it sends, what response shapes it
must be able to interpret, and what it does with each one.

### 8.1 Config resolution

`resolvePushConfig()` reads exactly two required env vars, no flags, no
defaults:

| Env var | Meaning |
| --- | --- |
| `REELIER_CLOUD_URL` | Base URL of the receipt-ledger endpoint (no trailing slash required — the client strips one if present). |
| `REELIER_CLOUD_KEY` | Bearer API key. |

Either missing is rejected before any network call, naming only the
missing var name(s) — the key's *value* MUST NOT appear in any error
message, log line, or stdout the CLI produces. `reelier push` is fully
inert (zero network calls, zero state mutation) until both are set.

### 8.1a Mock-run refusal (flight-recorder-v2, 0.19.0+, normative)

Before any fetch call (including the skill upload leg), `pushSkill` MUST
inspect every candidate record in the batch (`allRecords.slice(cursorBefore)`,
§8.3) for `RunRecord.mockFailures` (§4.2). If ANY candidate carries a
non-empty `mockFailures`, the whole push is refused with a structured
error naming the affected step number(s), and **zero** network calls are
made — not even for records earlier in the batch that carry no
`mockFailures` of their own. There is no `--force` or `--all` override:
mock runs (`--fail N`, §6.1d) are local recovery tests, and a mocked
receipt MUST never be published beside real ones. A batch containing only
records with no `mockFailures` field pushes exactly as before this
version.

### 8.2 Endpoints the client calls

| Endpoint | When | Request | Success | Client-recognized errors |
| --- | --- | --- | --- | --- |
| `POST {base}/api/v1/skills` | Once per skill: the first time that skill name is ever pushed from this working directory, or every time when `--with-skill` is passed. | `Authorization: Bearer <key>`; JSON body `{name, skillMd}` — `skillMd` is the raw skill file's full source text. | Any `2xx` status. | `401` aborts the whole push (no run records are attempted); any other non-2xx also aborts, with the response body's first 500 chars surfaced in the error. |
| `POST {base}/api/v1/runs` | Once per new run record being pushed. | `Authorization: Bearer <key>`; JSON body `{skillName, record}` — `record` is one `RunRecord` (§4) exactly as it appears in the `.jsonl` file, unmodified. When `reelier push --share` is used, the body also carries `share: true`. | `202` with JSON body `{id: string}`. `id` is optional to the client — a `202` with an unparseable or `id`-less body still counts as a successful push. With `share: true`, a successful response additionally carries `shareUrl` and `badgeUrl` (absolute URLs to the newly-minted-or-reused public receipt and its badge SVG) — both are optional to the client the same way `id` is. | `400` with JSON body `{fieldErrors: ...}` and `413` — **permanent** rejections, batch continues (§8.3a). `401` and a `fetch` rejection (network error, DNS failure, timeout) — **transient**, batch stops (§8.3a). Any other non-`202` status is treated as a transient error and stops the batch too. |

Neither endpoint's request ever includes anything beyond what's listed
above (plus the opt-in `share` field on `/api/v1/runs`) — no telemetry, no
extra headers, no implicit retry. `share` defaults to unset/false: a push
is never made public unless the caller explicitly passes `--share`.

`/api/v1/runs`'s body also carries `skillContentSha256` (sha256 of the
skill-file bytes that produced the run) whenever the record has one or a
push-time fallback hash is computed, and — as of 0.17.0, the $ meter
(flight-recorder-v1 §2) — optional top-level `costUsd` (number) and
`priceTableDate` (the bundled price table's retrieval date, `YYYY-MM-DD`)
computed from the record's own LLM tokens against the active price table
(`src/cost.ts`). Both are present together or absent together: absent
whenever any step's tokens can't be priced (no price entry for its
recorded model) — the client never sends a partial or guessed dollar
figure. An older cloud that doesn't recognize these fields ignores them;
this is a client-side-only addition (displaying them on a receipt page is
a separate, not-yet-built, piece of cloud-side work).

### 8.3 Cursor semantics (client-side state, not part of the wire contract)

`reelier push` maintains `.reelier/push-state.json` —
`{[skillName]: {pushed: number, skillUploaded: boolean, rejected?:
{index, reason, at}[]}}` — purely as local bookkeeping; the cloud API has
no concept of a cursor and is never asked "what have you already seen."
On each push:

1. `cursorBefore` = `state[skillName].pushed` (or `0` if never pushed, or
   always `0` when `--all` is passed — `--all` **only** affects which
   records are reconsidered this run; it does not, by itself, force a
   skill re-upload).
2. Candidates = every record in the skill's `.jsonl` file at index
   `>= cursorBefore`, in file order.
3. Records are pushed **strictly in order**. Each record's outcome is
   classified as either **consumed** (the cursor advances past it — a
   `"pushed"` success or a permanent `400`/`413` rejection, §8.3a) or
   **blocking** (the cursor stops here — a transient `401`/error, §8.3a).
   The first **blocking** outcome stops the batch outright; no record
   after it is attempted.
4. `cursorAfter` = `cursorBefore + <count of consecutive CONSUMED
   outcomes from the start of this batch>` — this counts both pushed
   successes and permanent rejections, per §8.3a. This is written back to
   `push-state.json` unconditionally (even on a partial/stopped batch) so
   the next `reelier push` resumes exactly where this one stopped.
5. `--dry-run` short-circuits before step 3 entirely — no config is even
   resolved, no network call is made, `push-state.json` is never read for
   a write and never written.

Because `--all` resets `cursorBefore` to `0` for *this run's* candidate
selection but the resulting `cursorAfter` is still written back
unconditionally, running `--all` and then hitting a **blocking** failure
partway through can leave `cursorAfter` **lower** than it was before the
`--all` run — this is expected, not a bug: `--all` means "reconsider
everything," and a partial `--all` batch honestly reports only what
actually got consumed *this run*.

### 8.3a Rejection policy: permanent vs. transient (normative)

A record push's outcome falls into exactly one of two categories, and the
category — not just the HTTP status — determines whether the cursor
advances:

- **Permanent (`400`, `413`)** — the cloud examined this exact record and
  gave a verdict that will not change on retry: a `400` means the record's
  shape was rejected (`fieldErrors` names why); a `413` means it will
  never fit under the size limit as-is. Retrying the identical bytes
  forever would wedge every later record in the file behind this one
  permanently — so instead: a warning is printed to stderr naming the
  record's index and the reason, an entry `{index, reason, at}` is
  appended to that skill's `rejected` array in `push-state.json` (an
  unbounded, never-pruned audit log — `reason` is the stringified
  `fieldErrors` for a 400, or the size-limit message for a 413; `at` is
  the ISO timestamp the rejection was recorded), the cursor **advances
  past** the record as if it had been consumed, and the batch
  **continues** to the next record.
- **Transient (`401`, any other non-`202`/`400`/`413` status, or a
  `fetch` rejection)** — nothing about the record itself was judged; the
  key might be fixable, the network might recover, the server might be
  restarted. These **stop the batch immediately** and the cursor does
  **not** advance past the failing record, so the very next `reelier
  push` retries it.

**`--all` re-reports, it does not deduplicate.** Passing `--all` resets
the cursor to `0`, so a record that was previously permanently rejected
is included in the candidate set again. If the cloud rejects it again,
**another** entry is appended to `rejected` (not merged with the earlier
one) — the array is a timestamped history, not a per-index map, precisely
so a record's rejection history across multiple `--all` attempts is
visible rather than silently overwritten. This does not wedge: a
record's *own* repeated rejection never blocks records after it, on this
run or any run, because §8.3a always advances the cursor past a permanent
rejection.

### 8.4 State file resilience

`push-state.json` is written via `writeFileAtomic` (`src/writeback.ts`,
§6.4's atomic write-back) — the same write-temp-then-rename primitive used
for skill-file write-back, for the same reason: a reader (including the
next `reelier push`) can only ever observe the complete old file or the
complete new file, never a torn write from a crash or kill mid-write.

Reading is equally defensive: if `push-state.json` exists but fails to
parse as JSON (`readPushState`, `src/push.ts`), that is treated as
**corruption, not a fatal error** — a loud warning is printed, the corrupt
file is renamed aside to `push-state.json.corrupt-<epoch-ms>`
(best-effort; a rename failure is swallowed and the corrupt content is
simply overwritten by the next successful write instead), and a fresh,
empty state is used for this run. A torn or corrupted cursor file MUST
NOT permanently wedge pushing — the worst case is re-pushing records the
cloud has already seen (a `--all`-shaped outcome), which is always
recoverable, versus a state file that can never be read again, which
would not be.

### 8.5 Future: idempotent ingestion (not implemented)

At-least-once delivery is possible today: if a push is interrupted after
the cloud accepts a record (`202`) but before the CLI durably writes the
advanced cursor (a crash or kill between the HTTP response and
`writePushState`'s rename), the next `reelier push` has no way to know
that record already landed and will resend it. The client currently has
no mechanism to signal "this exact record, deduplicate if you've already
ingested it" — a future revision of this contract MAY have `POST
{base}/api/v1/runs` include a stable content hash of `{skillName,
record}` (e.g. as an `Idempotency-Key` header or a body field) so a cloud
implementation that chooses to dedupe on it can. This requires
corresponding server-side support that does not exist yet and is **not
implemented in this client as of 0.4.0** — noted here as a known gap for
a future minor version, not a guarantee this version makes.

---

## 9. Session-derived skills (`reelier from-session` / `reelier scan`) and MCP install wrapping (`reelier install`)

Three commands (0.6.0+) close the gap between "an agent session already
happened" and "a replayable skill exists" without requiring the recorder
proxy (§5) to have been in the loop at all.

### 9.1 `reelier from-session <transcript.jsonl>` — compile a skill from an agent's own session log

Claude Code (and compatible agents) write session transcripts as JSONL —
one JSON object per line, mixing several line `type`s. Only two are
relevant here:

- An **assistant** message line: `{"type":"assistant","message":{"content":[...]}}`,
  where `content` may include `{"type":"tool_use","id","name","input"}` blocks.
- A **user** message line: `{"type":"user","message":{"content":[...]}}`,
  where `content` may include `{"type":"tool_result","tool_use_id","content","is_error"?}`
  blocks. `tool_result.content` is either a bare string or an array of
  `{"type":"text","text"}` blocks (both shapes occur in real transcripts —
  confirmed by reading actual `~/.claude/projects/*/*.jsonl` files, not
  assumed). `is_error` (snake_case, distinct from the MCP wire format's
  `isError`) marks a failed call.

Every other line `type` (`queue-operation`, `attachment`, summaries, ...)
carries no `message.content` array and is ignored.

**The honesty rule (normative, non-negotiable):** a tool_use is
*replayable* if and only if:

- its `name` is exactly `http.get` or `http.post` (Reelier's own
  builtins), or
- its `name` matches `mcp__<server>__<tool>` (split on the literal
  substring `__`; the recorded trace's `tool` field is the bare `<tool>`
  segment — server prefix stripped — so it matches the name
  `buildMcpTools()` (`src/mcp-tool.ts`) exposes a `--wrap`'d downstream
  tool under, keeping the compiled skill actually replayable).

Every other tool name (`Bash`, `Read`, `Edit`, `Write`, `Grep`, `Glob`,
`Task`, `WebFetch`, `ToolSearch`, ... — any Claude Code native tool) is
classified **not replayable** by default-deny, never by an exhaustive
blacklist. A replayable call whose matching `tool_result` never appears in
the transcript (recording cut off mid-call) is also skipped, not guessed
at.

The replayable subset is converted 1:1 into the existing trace format
(§2) — one `call`/`result` record pair per replayable tool_use/tool_result
pair, in transcript order — and handed to the unmodified compiler
(`compile()`, §"3. SKILL.md format"). No second skill format, no
LLM call.

If zero tool_use calls in the transcript are replayable, `from-session`
does **not** emit a skill (empty or otherwise) — it exits non-zero with:
`"no deterministically-replayable tool calls found in this session —
Reelier replays API/MCP tool workflows, not file edits or shell
commands."` The full skip list (tool name + reason, deduplicated and
counted) is always printed, success or failure.

### 9.2 `reelier scan [--dir <dir>] [--yes] [--out-dir <dir>]`

Recursively finds every `*.jsonl` under `--dir` (default
`~/.claude/projects`), summarizes each with the same classification as
§9.1 (so `scan`'s "replayable" verdict for a session can never disagree
with what `from-session` would do to that same file), and prints:

```
Found N session(s) in your agent history · M contain replayable workflows.
```

plus (0.13.0+) a self-measuring stat block (`replayableRateStats` /
`formatReplayableRate`, `src/scan.ts`):

```
Replayable rate: X/Y sessions fully read-only (Z%).
N session(s) blocked ONLY by unknown-verb tools (top blockers: tool1 ×a, tool2 ×b, ...)
```

where Y = sessions with ≥1 replayable call, X = those whose every replayable
call classified `read`, and the second line counts sessions that miss
read-only **solely** because every non-read call was an unknown-verb
fallthrough (unknown → destructive, `classifyEffect`) — i.e. exactly the
sessions a verb-list addition in `src/effect-verbs.ts` would convert; the
named blockers are the self-improvement loop's queue. The same stats object
is returned as `replayableRate` by the `reelier_scan` MCP tool.

The listing that follows shows one line per replayable session (project,
timestamp, replayable call count, MCP servers touched) and a count of
sessions skipped outright
(zero replayable calls — never offered as a selectable option, since there
is nothing honest to compile). Interactively prompts for a comma-separated
selection (or `all`); `--yes` selects every replayable session
non-interactively. Selected sessions are compiled via §9.1's exact logic
and written to `--out-dir` (default `.reelier/skills-from-scan/`).

### 9.3 `reelier install [--agent claude] [--dry-run]` / `reelier uninstall`

Extends `reelier init`'s existing config detection (`detectAgentConfig`,
§"Step 1" internals) into a one-command wrap: for the first of the
project `.mcp.json` / user `~/.claude.json` that exists, every configured
server of the plain `{command, args?}` (local stdio) shape is rewritten
in place to `{command: "npx", args: ["-y", "reelier", "mcp",
"--wrap", "<original command line, rejoined>"]}` — i.e. fronted by the
same `reelier mcp --wrap` proxy §5 already documents, under the *same*
server name key. Remote/url-based server entries (no `command` field) are
left untouched and reported as skipped, never mis-wrapped.

Idempotent: an entry already shaped like a reelier wrap (`command ===
"npx"` and `args` includes `reelier` (or the legacy `@seldonframe/reelier`), `mcp`, and `--wrap`) is
detected and left alone — running `install` twice never double-wraps, and
the second run does not write a redundant backup.

Before any write, the original config file content is copied byte-for-byte
to `<configPath>.backup-<ISO-timestamp-with-dashes>`; `reelier uninstall`
restores the lexically-latest such backup (ISO timestamps in the suffix
sort chronologically) and leaves the backup file in place afterward. If no
backup exists, `uninstall` exits non-zero with the config path it checked,
never guessing at what to restore. The backup is load-bearing, not
best-effort: if the backup file itself cannot be written, `applyInstall`
aborts with an explicit error and the config is left byte-identical — an
existing config is never rewritten without its backup on disk first.

`reelier init` closes with the same install as an offer (`planWrapOffer`,
`src/wrap.ts`): after the receipt, it re-detects the configs, plans the
identical wrap, and — on an interactive TTY without `--yes` — asks an
explicit y/N (default no; the config is never modified without an explicit
yes). Non-TTY or `--yes` prints the exact `reelier install` one-liner
instead of prompting. A successful install (either entry point) prints the
`reelier uninstall` revert path immediately, so the exit is always visible.
The offer's pitch — wrap-captured traces are lossless and include tool
annotations, while scan-from-history is a reconstruction — is kept true by
§2.2/§5: the recording proxy captures `tools/list` annotation hints into
the trace `meta` record.

## 10. Agent-native tool-server (`reelier serve`)

Source of truth: `src/serve.ts` (`buildToolServer` and the four
`run*Tool` functions), `test/serve.test.ts`.

`reelier serve` starts an MCP server on stdio that exposes Reelier's OWN
commands as callable tools — the **opposite** role from `reelier mcp`
(§5): that command fronts *other* MCP servers to record their calls;
`reelier serve` fronts *Reelier itself*, takes no `--wrap`, and never
starts or manages a recording. Each tool is a thin wrapper over an
existing module — no engine logic is duplicated.

### 10.1 Tool list

| Tool | Required input | Wraps | Output |
| --- | --- | --- | --- |
| `reelier_scan` | (none) | `scan.ts`'s `scanTranscripts` | `{ rootDir, totalSessions, replayableSessions, sessions: ScannedSession[] }` |
| `reelier_from_session` | `transcriptPath: string` | `session.ts`'s `compileSessionTranscript` | `{ ok: true, skillPath, steps, asserts, binds, servers, replayableCount, skipped, openQuestions }` on success, or `{ ok: false, reason, skipped }` when nothing in the transcript was replayable |
| `reelier_replay` | `skillPath: string` | `runner.ts`'s `runSkill` | The real `RunRecord` (§4.2), unmodified |
| `reelier_push` | `skillPath: string` | `push.ts`'s `pushSkill` | `{ outcome: "ok", result: PushResult }` \| `{ outcome: "skipped-no-key", message }` \| `{ outcome: "failed", message }` |

Optional inputs mirror the equivalent CLI flags 1:1: `reelier_scan.dir`
(`--dir`), `reelier_from_session.{name,out,force}` (`--name`/`--out`/
`--force`), `reelier_replay.{vars,wrap,allowDestructive,cwd}`
(`--var`/`--wrap`/`--yes`/implicit cwd), `reelier_push.{all,dryRun,
withSkill,cwd}` (`--all`/`--dry-run`/`--with-skill`/implicit cwd).

### 10.2 Normative behavior

- **`reelier_replay` always runs at Level 0** (`maxLevel: 0` is hardcoded
  in `runReplayTool`, never accepted as caller input) — the LLM is never
  constructed or called from this surface, regardless of what a
  malicious or careless caller might attempt to pass. A tool-server call
  is inert without a human explicitly choosing to escalate from the CLI.
- **Honesty is structural, not a formatting convention.** `reelier_scan`
  and `reelier_from_session` return the exact same `ok`/`skipped`/
  `reason` shapes as their CLI counterparts (§9.1, §9.2) — a session or
  transcript with zero deterministically-replayable tool calls is
  reported as such, never upgraded into a fabricated skill or a
  nonexistent replayable count.
- **`reelier_from_session` refuses to silently overwrite** an existing
  file at the resolved output path unless `force: true` is passed —
  matching the CLI's `--force` gate exactly (same `fileExists` check).
- **`reelier_push`'s three-way outcome is normative**: a thrown error
  whose message names `REELIER_CLOUD_URL`/`REELIER_CLOUD_KEY` (i.e.
  `resolvePushConfig`'s own error, §8.1) is classified `skipped-no-key`;
  any other thrown error (missing run records, read failure) is
  classified `failed` with the real error message; neither case is ever
  reported as `outcome: "ok"`.
- **Every tool call either returns `textResult(<JSON-serialized result>)`
  or an explicit MCP error** (`{ content: [...], isError: true }`) — a
  missing required argument, an unknown tool name, or a thrown exception
  from the wrapped module all produce `isError: true` with a human-
  readable message in `content[0].text`; none of these are ever
  represented as a silent/empty success.

### 10.3 Distinguishing `mcp` from `serve` at the CLI

`reelier mcp` invoked with no `--wrap` prints a usage error that
explicitly names `reelier serve` as the command to reach for instead when
the goal is exposing Reelier's own commands rather than recording a
downstream server. The top-level unknown-command usage text
(`reelier <run|bench|mcp|serve|...>`) likewise spells out the `mcp` vs.
`serve` role split inline, so a mistyped or unfamiliar invocation is
redirected rather than left to guess from a bare "unknown command" error.

## 11. The $ meter (`reelier cost` / `reelier prices`) — 0.17.0

Source of truth: `src/prices.ts` (bundled table), `src/cost.ts` (cost math,
`~/.reelier/prices.yml` parsing, `--since` filtering), `test/cost.test.ts`,
`test/cost-cli.test.ts`. See flight-recorder-v1 spec §2 for the feature
brief this implements.

### 11.1 Price table resolution (normative)

Prices are **never auto-fetched** — a wrong silent price is treated as a
lie, the same standard as any other honesty rule in this spec. The active
price table is the bundled default table (`src/prices.ts`, pinned to a
retrieval date against each provider's official pricing docs) merged with
an optional `~/.reelier/prices.yml` override, model-id keyed, user entries
winning per-model over the bundled default. A missing override file is
the normal case (bundled-only, no warning). A present-but-malformed
override file throws rather than silently falling back to bundled-only —
the user clearly meant to change something and a swallowed parse error
would leave them thinking their override took effect when it didn't.

`~/.reelier/prices.yml` shape (the only shape the hand-rolled parser
accepts — no new YAML dependency, matching this repo's zero-new-deps
convention):

```yaml
version: 1
models:
  <model-id>:
    inputPerMtok: <number>
    outputPerMtok: <number>
```

### 11.2 Cost math (normative)

A step's cost is computed only from its own `llm.inputTokens` /
`llm.outputTokens` / `llm.model` (§4.1). A step with zero tokens costs
exactly `$0` and carries no unpriced-model verdict. A step with tokens but
**no price entry for its recorded model** (or no model recorded at all)
is `unknown model` — its tokens are never guessed at any price, including
$0 or an average of known models. A run's total cost is the sum of every
priceable step; if any step in the run is unpriceable, the run's total is
explicitly a **partial** total (the CLI and the push-time `costUsd` field,
§8.2, both refuse to present a partial total as if it were complete —
`reelier cost` labels it `n/a (unknown model: <id>)` and flags the
aggregate total as PARTIAL; `reelier push` omits `costUsd`/`priceTableDate`
entirely for that record).

A run whose steps carry zero LLM tokens across the board — the common
case, since deterministic replay (`--max-level 0`, the default) never
constructs an LLM at all — is `isZeroTokenReplay`. `reelier cost` reports
how many of the listed runs are exactly this case as its honest "replay
would have cost $0.00" line: computed only from each record's own
zero-token steps, never a marketing estimate.

### 11.3 `reelier cost [skill] [--since 7d|30d|all]`

With `skill` given, reads only `.reelier/runs/<skill>.jsonl`. Without it,
enumerates every `.jsonl` file under `.reelier/runs/` and reports across
all of them. `--since` filters runs by `startedAt`; omitted defaults to
`all`. Output is one row per run (started time, skill, step count, input/
output tokens, the model(s) used — `mixed` when a run's steps used more
than one distinct model, `-` when none), a totals row, the PARTIAL note
when applicable, the zero-token-replay line, and the active price table's
provenance (bundled retrieval date, plus the override path when loaded).

### 11.4 `reelier prices` / `reelier prices update`

`reelier prices` lists the currently active merged table (§11.1),
model-sorted, each row tagged `bundled` or `override` by source.
`reelier prices update` is deliberately **not** an auto-fetch (spec
non-goal) — it only prints the bundled table's retrieval date and the
override file's expected shape; refreshing the bundled table itself is a
manual code change (edit `src/prices.ts`, re-verify each source URL,
bump the retrieval date).

## Deviations noted

This section is for the orchestrator, not part of the normative spec. No
code was changed while writing this document; these are places where
current behavior surprised the reading, or where the spec had to describe
an asymmetry rather than a clean rule:

1. **`RunRecord`/`StepRecord` have no version field of their own** — the
   only version signal a consumer can use is the *presence or absence* of
   `totals.unchecked`/`totals.skipped` (§4.4). This works today but is
   fragile: a future run-record change that isn't "add a totals field"
   won't have an equally clean detection heuristic. Worth a real
   `formatVersion` field before the next breaking-shaped change.
2. **Trace records also have no version field.** The SF profile
   (`packages/crm/.../trace-format.ts`) independently re-implements the
   exact same `TraceRecord` union rather than importing this package —
   the two are currently kept in sync by hand/convention, not by any
   shared type or schema. A drift between the two (e.g. this package
   adding a new `t` variant) would not be caught by either side's test
   suite.
3. **`json.<dotpath> > / <` silently evaluates false, not an error, when
   either side isn't a number** (`src/assert.ts:134-139`) — e.g.
   `json.count > "abc"` doesn't throw, it just reports the assert as
   failed with a possibly-confusing message. This is documented here as
   the actual behavior (§3.4) but a stricter implementation might prefer
   to reject a non-numeric comparison at patch-validation time (it
   currently only does so at the L1/L2 *empty-assertions* check, not a
   type check).
4. **The MCP proxy's tool list handler copies `route.tool.inputSchema` with
   an unchecked cast** (`inputSchema: route.tool.inputSchema as {type:
   "object"; ...}`, `src/recorder.ts:163`) — if a downstream ever
   advertised a non-object-typed schema, this would misrepresent it to the
   proxy's own caller without validation. Not exercised by any test found.
5. **`reelier_start_recording`/`reelier_note`/`reelier_stop_recording`
   "already recording" / "not recording" responses are plain-text tool
   results, not `isError: true`** — an automated caller parsing tool
   results by `isError` alone (rather than by response text) would treat
   a "you can't do that right now" response as a success. This is
   documented as the actual behavior (§5.1) but reads as an easy trap for
   a naive MCP client.

No fix is proposed or applied for any of the above — flagging only, per
the task brief.
