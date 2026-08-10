# Reelier — what it actually does

**Release snapshot: `reelier@0.32.0`, verified 2026-08-10.** npm serves **v0.32.0**. The published
artifact predates the certification additions now on `codex/outcomes-delegation-infra`; the Cloud branch is
`codex/outcomes-cloud`. Production Cloud is deployed and database migrations are applied, but live
provider certification and the real ten-agent Codex run remain gated on isolated resources and
credentials. Every claim below must be re-verified against code and live evidence before saying a
capability is production-certified.

> **What the 2026-08-06 pass found, as a warning about this file's own failure mode.** The previous
> pin (`62cd841`, 2026-08-01) claimed policy attestation was "fixed on main, NOT yet released" and
> that npm still carried the silent version. By 2026-08-06 `npm view reelier version` returned
> **0.30.0** — it had shipped. The file spent an unknown number of days asserting a *false and
> pessimistic* claim about a safety property. Two commands would have caught it. Run §10.1.

> **Why this file is pinned.** A capabilities doc is the exact artifact that silently goes stale —
> the failure class this product exists to catch. An unpinned version of this file would be a
> guardrail that is present, silent, and dead.

## 1. One-line identity

**Mission: "Let agents write."** Every autonomous write bounded before it happens, attested after it
happens, answerable forever. Reelier sells capability ("this is how you let your agents write"),
never surveillance ("this is how you watch what they did").

The bet: write-trust is a **state-transition** problem, not a model problem. You make a write
grantable by bounding and proving what it *changes*, not by evaluating what the agent *thinks*.

## 2. THE THING MOST OFTEN GOT WRONG — there are two execution paths

Reelier is **not** a git tool and **not** replay-only. Confusing these two paths produces false
statements about the product. Read this section before answering any capability question.

| | **A. Live proxy** (`reelier mcp --wrap`) | **B. Recorded replay** (`reelier run <skill>`) |
|---|---|---|
| What runs | The agent, freely. Any tool, any args, model-chosen. | A frozen, ordered step list. |
| What Reelier sees | Every MCP call in real time | The recorded sequence |
| Controls | policy.yml seatbelt, `--allow-writes`, effect classification | manifest preflight, `assert`, `attest`/`expect`, `state_gate` |
| Failure mode | **FAILS OPEN** — malformed policy degrades to deny-nothing (`loadPolicyForWrap`), but since 0.30.0 the degradation is **recorded**: `meta.policy.status` = `failed` | **FAILS CLOSED** — manifest drift refuses to replay; `state_gate: refuse` blocks pre-dispatch |
| Installed by | `reelier install` (rewrites the agent's MCP config, wraps every server, idempotent, backs up first) | `reelier compile` from a trace |

**Path A is the differentiator.** One `install` covers every MCP server in the agent's config. No
per-agent, per-tool rebuild. Every DIY equivalent operators build is bound to the one system it was
written for. The load-bearing word is *config*: on every host specified or observed so far, servers
an agent acquires through **plugins** load from the plugin's own manifest, not from that config,
and are not wrapped (§7.6; the falsifier — a host that materializes plugin entries into its main
config — lives in the research topic).

**Path A is also where the fail-open gap lives.** See §7.

## 3. OSS command surface (separate published 0.32.0 from post-release certification work)

Counted from the dispatch switch in `src/cli.ts`, not from a bare `case "` grep — see §10.1 for
why that distinction matters.

**The two numbers are not a typo.** `coverage` merged after 0.30.0 was published, so `main` has 28
and every npm user has 27. Say which one you mean.

- **Record/observe:** `mcp` (the recorder/live proxy — takes `--wrap`), `trace`, `scan`,
  `from-session`, `compile` (trace → skill; never generates steps from instruction text),
  `discover` (reads Claude Code / Codex CLI / OpenClaw history for replayable MCP-API workflow
  shapes; explicitly **does not** infer opportunities from shell or file edits),
  `coverage` (**unreleased — on `main` only**; read-only observed-coverage probe, Codex first —
  reports which MCP entries a host exposes that the wrap would and would not see, §7.6)
- **Install:** `init`, `install`, `uninstall` (MCP config rewrite + reversible backup)
- **Run:** `run`, `bench`, `baseline`, `diff`, `ci` (scaffolds a replay workflow; default schedule
  `cron: "23 7 * * *"` — daily)
- **Bind/gate:** `manifest` (stamp tool schemas from live servers; preflight fails closed on drift),
  `approve` (incl. `--probe` state ceremony and `--expires`), `policy` (`policy check` is strict and
  exits 1; the wrap runtime is not)
- **Prove:** `verify`, `push`, `get`, `serve` (exposes Reelier's own commands as MCP tools — the
  OPPOSITE of `mcp`; takes no `--wrap`), `resolve` (walks the ledger for a deferred probe and
  appends the answer — a **polling** command an operator or CI runs, never a listener; the CLI has
  no inbound HTTP), `authority certify preflight|run|verify` (**post-0.32.0 branch work**: preflight
  is live-resource aware and redacts credentials; the Codex ten-agent runner is implemented but
  requires Cell-issued scoped sessions; other live adapters still refuse until registered; verify
  checks signed release evidence offline)
- **Account/meta:** `login`, `logout`, `whoami`, `cost`, `prices`

## 4. Skill grammar (what a step can express)

```
- intent:  declared purpose (projected into the receipt)
- action:  <tool_name> {json args}      # any MCP tool, any server
- assert:  status == 200 / body contains "…"
- effect:  read | idempotent-write | destructive
- attest:  {"tool":"<probe>","args":{…},"projection":["field"]}
- emit:    {"projection":["field"]}     # 0.30.0 — pre-dispatch artifact commitment
```

Plus `{{var}}`/`bind` templating from prior responses, `expect:` field-level MACs, projection
namespaces (`header.`/`body.`), and parameterized probes with a `probeArgs` commitment.

**Added in 0.30.0 — both are breaking only for skills that opt in** (the step grammar is
deliberately closed, so a skill using them is a parse error on older Reelier; a skill that does not
stays compatible):

- **`emit:`** — an artifact declaration bound *before* dispatch. A malformed `emit` is a
  `SkillParseError`, never a silent degradation to "no emit" (`src/skill.ts:363-386`). Declared
  coverage that does not resolve is a first-class finding, and there is a coverage gate under the
  existing `state_gate: refuse` opt-in.
- **`attest.defer: "<duration>"`** — see §7.1. Makes `attest.confidence: "pending"` reachable for
  the first time; the closed `method` enum was **not** widened to get there.

**Effect classification** (`src/effect-verbs.ts`) reads the **tool name**. MCP annotations
(`readOnlyHint`/`destructiveHint`) win when present; most servers ship none. Unknown verb → rung-6
**default-deny** (`destructive`, `unknown: true`). Over-classification is the honest cost — a pure
read tool named `extraction_pending` gets treated as a write.

## 5. Substrate reality — this is NOT git-only

`examples/gbrain/` is a **live-verified, non-git MCP write** (CI-proven): `put_page` →
`idempotent-write`, `attest` probing `get_page` with an explicit `projection`. Anything reachable as
an MCP tool is in scope today: CRM rows, bookings, ad budgets, knowledge stores.

**But the public example corpus does not show this.** Effect counts across all shipped examples:

| effect | steps |
|---|---|
| `read` | **45** |
| `idempotent-write` | 2 |
| `destructive` | 2 |

All 4 write steps are the two gbrain files. For a product whose mission is *"Let agents write,"* 92%
of the demonstrated surface is API reads. **This is a demo gap, not a capability gap** — but never
cite the example corpus as evidence of write capability, because it isn't.

**Re-verified 2026-08-06 against `4ee9ba0`: unchanged, still 45 / 2 / 2.** Two releases (0.29.0,
0.30.0) added write *machinery* — deferred probes, `emit:` — and zero write *examples*. The gap is
widening, not closing.

## 6. Reelier Cloud — what it adds over OSS

Off-box, third-party-showable evidence. Receipts pushed to `/r/<id>` with an `/md` twin, the skill
registry, drift-watch (`isStale`, **48h** threshold with a ≥3-reporting-days-in-14 guard), run-shape
priors, the GitHub App (per-PR receipts, declared scope, unexpected-write detection).

**Calibrate the value honestly:** Cloud is not a universal upgrade tier. It is close to the entire
product for someone who must show an auditor/client/regulator, and close to marginal for an operator
who trusts their own disk. Never claim "orders of magnitude better" without naming which population.

Ops note: **no auto-migrate wiring** — migrations are applied by hand after merge.

## 7. Known limits — state these, do not paper over them

0. **Authority certification is partially implemented on the current branch.** Post-0.32.0 branch
work includes closed preflight contracts, guarded provider runner contracts, a remote Fly probe
runner that pins `flyctl`, reads Machine image and network-policy state, executes closed in-Machine
challenge probes, and signs evidence; an authenticated hostname-allowlisted CONNECT gateway whose
provider TLS terminates in the Cell; a durable hash-only principal registry; and a pinned Codex launcher that generates one
coordinator plus nine scoped custom-agent profiles, pre-spawn profile enforcement,
`SubagentStart.agent_id` evidence, and signed release-evidence verification. The launcher does not
mint authority: its ten bearer files must come from real task grants, and a successful Codex process
is not a verified task graph. Vercel compound source reads, Neon execution, confidential
Cloudflare-to-Vercel transfer, actual deployed Fly evidence, provider cleanup, and the live ten-agent graph
remain uncertified. A hermetic fixture pass is not live certification; live claims remain
`unchecked` until the Authority Cell and guarded provider resources produce signed evidence.

1. **Probe-less writes degrade — but as of 0.30.0, "later" counts.** `attest` still needs a
   read-back tool. What changed (§10.4 move, shipped 0.30.0): **most sends DO produce a post-state,
   just late** — a provider message-id, an event API, a bounce or delivery webhook. `attest.defer:
   "<duration>"` binds the expectation at dispatch and resolves when the provider's record appears
   (`src/defer.ts`; `reelier resolve`). It dispatches **neither** probe side at run time, since the
   record does not exist yet and the per-run salt would make a `pre` incomparable to a later `post`.
   The duration is bound into the approval hash — a deadline nobody approved is not a deadline.
   **The honest remainder, and do not soften it:** a resolved deferred probe grades `partial`,
   **never `exact`** — it proves post-state at resolution time, not a delta across the write. A
   deadline that elapses grades `absent` with `deferred-deadline-elapsed`, which claims only that
   Reelier stopped waiting and is *never* evidence the send failed. Resolution is a **second,
   non-passing record** (`RunRecord.deferredResolution: true`, `passed: false`), never an amendment.
   Anything with genuinely no post-state at any time — a human already read it — still has nothing
   to hash. Email is no longer the flatly weakest substrate, but it is still the one that degrades.
2. **Only MCP-shaped traffic is visible.** A direct HTTP call inside the operator's own service is
   invisible to the wrap. Whether Reelier helps a given stack is an empirical question about that
   stack.
3. **Effect classification is name-based. The read-noun leak is no longer silent — but it is still
   not gated.** Coverage of `create_appointment` vs `schedule` vs `book` is a list. Rung-6
   default-deny is the loud, safe half: measured 2026-08-06 over 85 tool names from live MCP
   servers, it fires on **38.8%**, and every one carries `unknown: true`, so every one is
   reviewable. Rung 4 used to match any read token *anywhere* in the name and return
   `{effect: "read", unknown: false}`, so a `<unlisted-verb>_<read-noun>` name classified as a read
   with **no review flag** — `complete_query_tuning` → `read`, though it applies DDL to a
   production main branch and deletes a branch; likewise `prepare_query_tuning` and (as a class
   probe) `archive_query`.
   **Changed (unreleased, on `main`):** when a name's ONLY read evidence is a NOUN — `READ_NOUNS`
   in `src/effect-verbs.ts`: `query`, `status`, `stat`, `stats`, `count`, `preview`, `health`,
   `head`, `info`, `screenshot`, `logs` — rung 4 still returns `read` but now sets
   `unknown: true`. A `readOnlyHint` from the server clears the flag. Blast radius measured on the
   same 85-name corpus: **3 newly flagged, 2 of them the actual leaked writes**, 1 noise
   (`browser_take_screenshot`). No effect changed.
   **Say this precisely, because the difference matters:** the leak is now **visible**, not
   **closed**. `unknown` drives reporting only (`src/session.ts`, and an open question at
   `src/compile.ts`); nothing gates on it, so a flagged read still passes replay's write gate.
   Closing it means routing those names to rung-6 default-deny, which over-classifies genuine reads
   and is a **separate, unmade decision**.
   The 2026-07 audit closed three *instances* of this shape by adding destructive verbs
   (`src/effect-verbs.ts` — `clear`/`rotate`/`push`); the **class** of unlisted write verbs is
   still open, because it can only ever be closed verb-by-verb.
   **The one falsifier is now measured, and it is refuted (2026-08-06).** The escape hatch was that
   the affected servers might ship `readOnlyHint`/`destructiveHint`, which would pre-empt the verb
   list at rungs 1–2. Probed the live neon server over stdio and read `tools/list`: **0 of 23 tools
   carry any annotation** — not few, none. Rungs 1–2 never fire there, so the verb list is the only
   thing deciding, and re-running `classifyEffect` against current `src` (not the `dist` the first
   pass used) reproduces `complete_query_tuning` → `{read, unknown: false}`. Do not describe this
   limit as theoretical. **Scope of the claim:** measured on one server; other servers may annotate,
   and that is worth checking per substrate rather than assuming either way.
   **What `unknown` does and does not do:** it is consumed in exactly one place (`src/session.ts:303`,
   destructured at `src/compile.ts:640`) and drives *reporting* — an open question on the compiled
   skill. Nothing gates on it. So flagging a leaked read makes it **visible, not blocked**; only
   moving such names to rung-6 default-deny would close the gate. Full method and corpus limits:
   `~/CascadeProjects/research/2026-08-06-effect-classifier-verb-gaps/`.
4. **Path A still fails open — and that is correct, not a bug.** A malformed `policy.yml` degrades
   to deny-nothing (never-list #5, fail open at the recorder). **Shipped and published in 0.30.0**
   (§10.4 move; `docs/specs/policy-attestation-v1.md`): both paths carry a four-state `policy`
   claim — `meta.policy` on the trace for the wrap, `RunRecord.policy` for the run — so a record
   distinguishes `verified` from `failed`/`unchecked`/`absent`. `digest` is `sha256:` over the raw
   file bytes, never a canonical form. **The enforcement behaviour is unchanged; only its
   visibility is.** The limit that remains, and it is the real one: this proves the file loaded
   and that its rules name real tools — **never that a rule *fired***, and never that every write
   went through the wrap (see §8's completeness entry). Reader obligation: `meta.policyGap` is
   superseded and no writer emits it as of 0.30.0, but readers must keep parsing it; a record with
   `policyGap` and no `policy` normalizes to `failed` with no `digest`, and a record with both
   prefers `policy`.
5. **Content correctness is out of scope by charter** (safety-atoms never-ours: live intent, content
   correctness, credential scoping, blast-radius topology, rollback execution). Reelier cannot know a
   minimum price is €X.
6. **Plugin-delivered MCP calls are outside the observed boundary** unless the plugin itself
   invokes `reelier mcp --wrap`, or the host exposes the entry through a supported configuration
   and Reelier subsequently rewrites it. (Added 2026-08-06.) Both plugin ecosystems load a plugin's MCP servers from the plugin's own
   manifest, never through the host config files `install` rewrites (`knownMcpConfigPaths`,
   `src/init.ts` — Claude Code, Cursor, Windsurf): Claude Code plugins carry MCP config in the
   plugin's own `.mcp.json` (or inline in `plugin.json`), "configured independently of user MCP
   servers" (code.claude.com/docs/en/plugins-reference, read 2026-08-06); the **Agent Plugins** standard
   (v1.0.0, agent-plugins.org, announced 2026-08-06 — TSC Amazon/Cursor/Microsoft/OpenAI/Vercel;
   launch clients Codex, ChatGPT, Cursor, GitHub Copilot, Kiro, VS Code) makes the same shape
   portable and normative: "Clients that support MCP servers MUST load configuration only from
   `mcp.json` at the plugin root." Codex is doubly out today — TOML main config `install`
   deliberately does not write (`src/init.ts:63`) *and* a live plugin/marketplace system (observed
   on one machine 2026-08-06; hypothesis until reproduced — spec §0.4). The only in-spec wrapped
   form is author-side and stdio-only: a plugin's own manifest declaring a stdio entry that fronts
   its server with `reelier mcp --wrap`; remote (`streamable-http`/`sse`) entries have no wrapped
   form at all — the wrap speaks stdio only (`src/mcp-client.ts`), and `install` skips `url`
   entries (`src/wrap.ts:119`). A receipt from a plugin-running host therefore can never be read
   as covering plugin-delivered writes — only author-wrapped stdio entries appear in it, and
   nothing attests that any did (§8's completeness entry). Spec:
   `docs/specs/agent-plugins-coverage-v1.md` (on `main`). Of the three responses it proposes, two
   are **built on `main` and unreleased** — the read-only observed-coverage probe (`reelier
   coverage`, §3; verified no writes in `cmdCoverage` or `src/coverage.ts`) and skill-only plugin
   packages generated from one source (`plugin/claude/`, `plugin/agent-plugins/`,
   `scripts/build-plugin-packages.mjs`). Non-mutating interception is still design-only.
   **None of this changes the boundary above**: the probe *reports* coverage, it does not extend
   the wrap, and both generated manifests declare no `mcpServers` at all ("Skill-only package — it
   includes no MCP servers"), so there is nothing in them to wrap.
   Research: `~/CascadeProjects/research/2026-08-06-agent-plugins-wrap-coverage/`.

## 8. Designed, NOT built — never describe these as shipped

UCP/AP2 commerce attestation (design only); segregation-of-duties / "agent cannot amend the policy
that authorizes it" (ninth-atom candidate, specced nowhere in code); completeness attestation
("receipts prove what receipted writes did, nothing proves all writes were receipted"); the
simulator.

**Re-verified 2026-08-06 against `4ee9ba0` — all four still unbuilt.** `git grep -il` over `src/`
for `ucp`/`ap2`/`segregation`/`completeness`/`simulator` returns exactly one hit: a comment at
`src/skill.ts:377` noting AP2 verifiers must treat unknown constraint types as failing. A comment
is not an implementation.

**Do not confuse this list with artifact attestation.** `docs/specs/artifact-attestation-v1.md` is
on `main` **and it shipped** — `emit:` is the built form (§4). A spec living in `docs/specs/` says
nothing either way about whether it shipped; check the grammar and the CHANGELOG, not the spec
directory.

## 9. Brand invariants (the never-list — breaking one ends the product's reason to exist)

1. Never render `absent` or `pending` as a pass. Four-state honesty (`verified`/`failed`/
   `unchecked`/`absent`) is the single most important property in the product.
2. Never meter attestation. Charge for the gate, never the record.
3. Never block from a learned score alone.
4. Never lead with cost savings. Determinism is the claim; cheapness is a consequence.
8. Never imply "verified" means "safe." Proof of change certifies **scope**, never semantic
   correctness.

Full list: `reelier-cloud/docs/company/FOUNDATION.md`.

## 10. Re-verifying this file

### 10.1 Manual checks — the ground truth, no dependencies

```bash
git log origin/main --oneline -1                                          # is the pin current?
npm view reelier version                                                  # what users actually have
git show origin/main:package.json | grep '"version"'                      # what main says
git grep -h "^- effect:" origin/main -- "examples/*" | sort | uniq -c     # read/write example ratio

# command count — MUST be scoped to the dispatch switch:
git cat-file blob $(git rev-parse origin/main:src/cli.ts) \
  | sed -n '/^  switch (cmd) {/,/^  }$/p' | grep -oE 'case "[a-z-]+"' | sort -u | wc -l
```

**The two `npm view` / `package.json` lines are new, and they are the ones that matter most.**
The 2026-08-01 pin was wrong for days precisely because nothing here compared main against what was
published. A release-status claim in §7 is a claim about what *users have*, and only npm knows that.

**The command-count check was also wrong and is now fixed.** The old form —
`git cat-file blob … | grep -cE 'case "'` — returns **43** on `4ee9ba0`, because `cli.ts` switches
on outcome strings too (`auth-failed`, `tamper`, `pushed`, `written`, `up-to-date`, …). Scoped to
the dispatch switch it returned **27** there, the real number, and returns **28** on `315b896`
(`coverage`, unreleased). A check that silently overcounts is worse than no check: it reads as
verification.

These stay authoritative. Everything in 10.2/10.3 is a convenience layer over them.

### 10.2 mex operating rule — build the graph ONLY where build output isn't

`mex-agent` (npm, MIT, local-only) builds a Tree-sitter/SQLite symbol graph used for grounding and
impact analysis. **The npm package is `mex-agent`, not `mex`** — `mex` is an unrelated empty ISC
placeholder at 0.0.1.

> **HARD RULE: never build the graph in a tree containing `dist-test/` or `dist/`.**
>
> This codebase imports NodeNext-style (`import { x } from "./policy.js"` where the file is
> `policy.ts`). When compiled output is present, that specifier resolves to the *real*
> `dist-test/src/policy.js`, so source call-edges get wired to build-output nodes and the `src`
> symbol is left orphaned. Verified 2026-08-01: with `dist-test/` indexed,
> `impact loadPolicyForWrap` reports **`callerCount: 0`** despite a live caller at `src/cli.ts`. In a
> clean tree the same query reports **4**. It fails silently and confidently — treat a surprising
> zero as a polluted graph until proven otherwise.

Use a fresh worktree, which has no build output by construction:

```bash
git worktree add ../reelier-specs origin/main
cd ../reelier-specs && npx -y mex-agent graph        # ~5,000 nodes / ~7,000 edges / 162 files / ~36s
npx -y mex-agent config set telemetry off            # ON by default; sends machine_id + command name
```

Useful queries: `graph query who-calls <sym>` · `impact <sym|file>` (blast radius, incl. scaffold) ·
`graph scope "<task>"` (compact task-relevant neighborhood as JSONL, with an explicit token budget —
prefer this over reading whole files).

### 10.3 Grounding — which claims here are bound to which symbols

Every symbol mex indexes carries a `bodyHash`. These are the claims in this file that rot when code
moves; re-check them by hash rather than by reading. **If a hash moved, the claim is suspect.**

| Claim | § | Bound symbol |
|---|---|---|
| Live proxy fails open on malformed policy; the degradation is now recorded as `policy.status: failed` | 2, 7.4 | `loadPolicyForWrap` (`src/policy.ts`) |
| Manifest preflight refuses to replay on drift (fail closed) | 2 | `preflightManifest` (**`src/manifest.ts`**) |
| Policy seatbelt is loaded once at wrap start and passed to the proxy | 2 | `buildProxyServer` (`src/recorder.ts`) |
| Effect classification is verb/name-based; unknown → rung-6 default-deny | 4, 7.3 | `classifyEffect` (`src/effect-verbs.ts`) |
| A read token anywhere in the name returns `read` with `unknown: false` — the silent leak | 7.3 | `classifyEffect` rung 4 (`src/effect-verbs.ts:210`) |
| Dead-rule detection; `rules`/`unmatchedRules` are counts only, wrap path only | 7.4 | `findUnmatchedToolRules` (`src/policy.ts`) |
| Four-state policy claim on the trace; `policyGap` superseded but still readable | 2, 7.4 | `TraceRecord` (`src/recorder.ts`) |
| Deferred probes grade `partial`, never `exact`; elapsed deadline → `absent` | 7.1 | `src/defer.ts` |
| `emit:` is a parse error when malformed, never a silent "no emit" | 4 | `src/skill.ts:363-386` |
| `install` rewrites every MCP server entry, idempotent + backed up | 2 | `planInstall` / `applyInstall` (`src/wrap.ts`) |
| Plugin-delivered servers load outside every host config `install` detects | 7.6 | `knownMcpConfigPaths` (`src/init.ts`) |

**Corrected 2026-08-06:** `preflightManifest` was listed at `src/cli.ts`; it is in `src/manifest.ts`
(`git grep -l "function preflightManifest" origin/main -- src/`). A grounding table pointing at the
wrong file is a grounding table that cannot ground anything.

Dependency note: mex is ~690 downloads/week with a single maintainer. Fine as a droppable local tool;
never make it load-bearing. If it disappears, 10.1 still works.

### 10.4 The section-move rule

Anything in §7 or §8 that has since been fixed or shipped **must** move sections in the same commit
that fixes or ships it. A stale §8 is how a future session tells someone Reelier does something it
does not.
