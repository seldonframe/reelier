# Reelier — what it actually does

**Pinned to `origin/main` @ `946d7f1` (v0.30.0 on main — npm still serves 0.29.0), verified
2026-08-01.** Every claim below was read
out of code or a live-verified example on that commit, not from memory. If the pin is stale, treat
this file as a hypothesis and re-verify (see §9) before telling anyone Reelier can or cannot do
something.

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
| Failure mode | **FAILS OPEN** — malformed policy degrades to deny-nothing (one WARN at start, `loadPolicyForWrap`) | **FAILS CLOSED** — manifest drift refuses to replay; `state_gate: refuse` blocks pre-dispatch |
| Installed by | `reelier install` (rewrites the agent's MCP config, wraps every server, idempotent, backs up first) | `reelier compile` from a trace |

**Path A is the differentiator.** One `install` covers every MCP server in the agent's config. No
per-agent, per-tool rebuild. Every DIY equivalent operators build is bound to the one system it was
written for.

**Path A is also where the fail-open gap lives.** See §7.

## 3. OSS command surface (26 commands, v0.30.0)

- **Record/observe:** `mcp` (the recorder/live proxy — takes `--wrap`), `trace`, `scan`,
  `from-session`, `compile` (trace → skill; never generates steps from instruction text)
- **Install:** `init`, `install`, `uninstall` (MCP config rewrite + reversible backup)
- **Run:** `run`, `bench`, `baseline`, `diff`, `ci` (scaffolds a replay workflow; default schedule
  `cron: "23 7 * * *"` — daily)
- **Bind/gate:** `manifest` (stamp tool schemas from live servers; preflight fails closed on drift),
  `approve` (incl. `--probe` state ceremony and `--expires`), `policy` (`policy check` is strict and
  exits 1; the wrap runtime is not)
- **Prove:** `verify`, `push`, `get`, `serve` (exposes Reelier's own commands as MCP tools — the
  OPPOSITE of `mcp`; takes no `--wrap`)
- **Account/meta:** `login`, `logout`, `whoami`, `cost`, `prices`

## 4. Skill grammar (what a step can express)

```
- intent:  declared purpose (projected into the receipt)
- action:  <tool_name> {json args}      # any MCP tool, any server
- assert:  status == 200 / body contains "…"
- effect:  read | idempotent-write | destructive
- attest:  {"tool":"<probe>","args":{…},"projection":["field"]}
```

Plus `{{var}}`/`bind` templating from prior responses, `expect:` field-level MACs, projection
namespaces (`header.`/`body.`), and parameterized probes with a `probeArgs` commitment.

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

## 6. Reelier Cloud — what it adds over OSS

Off-box, third-party-showable evidence. Receipts pushed to `/r/<id>` with an `/md` twin, the skill
registry, drift-watch (`isStale`, **48h** threshold with a ≥3-reporting-days-in-14 guard), run-shape
priors, the GitHub App (per-PR receipts, declared scope, unexpected-write detection).

**Calibrate the value honestly:** Cloud is not a universal upgrade tier. It is close to the entire
product for someone who must show an auditor/client/regulator, and close to marginal for an operator
who trusts their own disk. Never claim "orders of magnitude better" without naming which population.

Ops note: **no auto-migrate wiring** — migrations are applied by hand after merge.

## 7. Known limits — state these, do not paper over them

1. **Probe-less writes degrade.** `attest` needs a read-back tool. There is no "get the email you
   just sent." Sends, settled refunds, and anything a human already read have no post-state to hash.
   Email is currently the *weakest* substrate, not the strongest.
2. **Only MCP-shaped traffic is visible.** A direct HTTP call inside the operator's own service is
   invisible to the wrap. Whether Reelier helps a given stack is an empirical question about that
   stack.
3. **Effect classification is name-based.** Coverage of `create_appointment` vs `schedule` vs `book`
   is a list.
4. **Path A still fails open — but no longer silently.** A malformed `policy.yml` degrades to
   deny-nothing, which is correct (never-list #5, fail open at the recorder). What was the bug is
   that the degradation reached one stderr line nobody reads on a long-running server and no
   artifact at all. **Fixed and released as 0.30.0 (`946d7f1`), but NOT yet on npm** — `npm view
   reelier version` still returns 0.29.0 because publishing is manual and no workflow performs it,
   so anyone installing the package today still gets the silent version
   (`docs/specs/policy-attestation-v1.md`): both paths carry a
   four-state `policy` claim — trace `meta.policy` for the wrap, `RunRecord.policy` for the run —
   so a receipt now distinguishes `verified` from `failed`/`unchecked`/`absent`. **The
   enforcement behaviour is unchanged; only its visibility is.** Still true, and still the honest
   limit: this proves the file loaded and that its rules name real tools, never that a rule
   *fired*, and never that every write went through the wrap (see §8's completeness entry).
5. **Content correctness is out of scope by charter** (safety-atoms never-ours: live intent, content
   correctness, credential scoping, blast-radius topology, rollback execution). Reelier cannot know a
   minimum price is €X.

## 8. Designed, NOT built — never describe these as shipped

UCP/AP2 commerce attestation (design only); segregation-of-duties / "agent cannot amend the policy
that authorizes it" (ninth-atom candidate, specced nowhere in code); completeness attestation
("receipts prove what receipted writes did, nothing proves all writes were receipted"); the
simulator.

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
git cat-file blob $(git rev-parse origin/main:src/cli.ts) | grep -cE 'case "'  # command count moved?
git grep -h "^- effect:" origin/main -- "examples/*" | sort | uniq -c     # read/write example ratio
```

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
| Live proxy fails open on malformed policy; policy status absent from the record | 2, 7.4 | `loadPolicyForWrap` (`src/policy.ts`) |
| Manifest preflight refuses to replay on drift (fail closed) | 2 | `preflightManifest` (`src/cli.ts`) |
| Policy seatbelt is loaded once at wrap start and passed to the proxy | 2 | `buildProxyServer` (`src/recorder.ts`) |
| Effect classification is verb/name-based; unknown → rung-6 default-deny | 4, 7.3 | `classifyEffect` (`src/effect-verbs.ts`) |
| Dead-rule detection exists but only reaches stderr | 7.4 | `findUnmatchedToolRules` (`src/policy.ts`) |
| Malformed-policy gap marker exists in the trace only | 2 | `TraceRecord` (`src/recorder.ts`) |
| `install` rewrites every MCP server entry, idempotent + backed up | 2 | `planInstall` / `applyInstall` (`src/wrap.ts`) |

Dependency note: mex is ~690 downloads/week with a single maintainer. Fine as a droppable local tool;
never make it load-bearing. If it disappears, 10.1 still works.

### 10.4 The section-move rule

Anything in §7 or §8 that has since been fixed or shipped **must** move sections in the same commit
that fixes or ships it. A stale §8 is how a future session tells someone Reelier does something it
does not.
