# Flight Recorder v1 — Spec

_Drafted 2026-07-23. The recorder-native feature set that turns `reelier install` (the MCP wrap) from recording plumbing into the standalone product: **safety, audit, cost — with traces as exhaust.** Positioning: "black box for agents." Six features, ordered by leverage. Each ships independently; none blocks another._

**Prime directive (applies to all six):** the recorder must never break, slow, or alter the plane. Overhead budget: <5ms added latency per tool call, zero added failure modes for the agent (recorder errors degrade to pass-through + a gap marker in the trace — a missing record must be *visible*, never silent). A flight recorder that crashes the plane is dead on arrival.

---

## 1. Deny-list + dry-run config (the seatbelt)

**Job:** let a human declare what their agent may never do, enforced at the chokepoint — not in the prompt, where it can be talked out of.

**UX:**
- `.reelier/policy.yml` (per-project; `~/.reelier/policy.yml` global fallback; project overrides global):
  ```yaml
  version: 1
  deny:
    - tool: "*.delete_*"            # glob on tool name
    - tool: "gmail.send_email"
      unless: "--allow-writes"      # deny unless the existing gate flag is passed
    - endpoint: "*.stripe.com"      # deny by destination, not just tool name
  dry_run:
    - tool: "crm.*"                 # intercept: log the call + args, return a synthetic
                                    # success marked DRY-RUN, never forward
  ```
- `reelier install` prints the active policy on wrap start; `reelier policy check` lints it.
- A denied call returns a structured tool error to the agent ("blocked by reelier policy: <rule>") — the agent can adapt; the human sees it in the trace flagged DENIED.
- Dry-run responses are marked in the trace and in receipts (`dryRun: true` per step) — **a receipt containing dry-run steps says so on its face.** Never let a dry-run receipt read as a real one (never-lies).

**Design decisions:** policy lives in a file (versionable, reviewable in PRs) not in flags; deny beats dry-run beats allow; glob semantics = the existing effect-ladder tool-name normalization; no remote/cloud policy in v1 (non-goal — keeps trust story local-first).
**Verify:** unit matrix (deny/dry-run/pass per rule type); e2e — wrapped MCP fixture where a denied call is blocked, trace shows DENIED, agent receives the structured error, exit path clean; a dry-run receipt renders with the DRY-RUN banner.

## 2. The $ meter (accounting)

**Job:** answer "what did this agent run cost me?" per step, per run, per week — in dollars, not vibes.

**Mechanics:** records already carry `llmInputTokens`/`llmOutputTokens` (record-time) and tool timing. Add:
- `~/.reelier/prices.yml` — model → $/Mtok in/out, shipped with a maintained default table (pin prices to retrieval date per the established rule; user-overridable). Never auto-fetch prices silently (a wrong silent price is a lie); `reelier prices update` refreshes explicitly and prints the diff + source.
- `reelier cost [skill|--since 7d]` — table: run → steps → tokens → $ (recorded model) + "replay would have cost $0.00" line (the marketing sentence, computed honestly: only for read-only-replayable runs).
- Receipts gain optional `costUsd` (computed at push time from the recorded model + the price table version used — receipt states the price-table date it used).
**Verify:** unit — cost math against fixture records incl. unknown-model → "n/a (unknown model)" never a guess; snapshot of the cost table output.

## 3. Freeze-suggestion (the memory feature)

**Job:** the recorder notices repetition and suggests the replay — "you've done this 3× — freeze it," turning exhaust into skills without the user remembering Reelier exists.

**Mechanics:**
- After each wrapped session (and during `scan`), compute a workflow fingerprint per session segment: ordered tool-name sequence + normalized arg shapes (NOT arg values — privacy + stability). Similarity = sequence match ≥ threshold (start exact-match; fuzzy is a non-goal for v1).
- On ≥3 sightings of the same fingerprint in the local history: print once (not nag): `This workflow ran 3×. Freeze it: reelier from-session --last --name <suggested-name>` with an estimated tokens-saved figure from the $ meter.
- `reelier suggestions` lists current candidates; `--quiet` / `suggestions.disabled: true` in policy.yml silences globally. State in `.reelier/suggestions.json` (local only — zero telemetry, per the trust stance).
- If a fingerprint matches a **registry** listing's step signature (name+shape, computed locally against fetched/seeded skills), suggest `reelier get <owner>/<skill>` instead — this is the registry-doorway lever from the discovery analysis.
**Verify:** unit — fingerprint stability across value changes / instability across sequence changes; 3-sighting trigger; suppression paths; registry-match suggestion against a fixture.

## 4. Per-receipt agent/model attribution (who did what)

**Job:** a receipt must answer the investigator's first question: *which agent, which model, which tool server, when.*

**Mechanics:**
- Records gain `agent` block, captured at record time, best-effort and honest about unknowns: `{ harness: "claude-code|codex|cursor|...", harnessVersion?, model?, modelProvider?, recordedWith: "reelier vX" }`. Sources: env vars the harnesses set, MCP client info from the wrap handshake, `from-session` adapter metadata (each adapter knows its harness). Unknown fields are **omitted**, never guessed.
- Receipts and receipt pages render the attribution block; the registry's cross-tenant activation metric can later segment by harness (which agents actually replay skills — the market-intelligence exhaust).
- Wire: top-level optional `agent` object on the runs POST (same optional-field discipline as `skillContentSha256` — **one end-to-end integration test crossing the CLI→cloud seam is mandatory**, per the contract-mismatch lesson).
**Verify:** record fixtures with/without detectable harness; e2e push → DB row carries the block → receipt page renders it; old-CLI records (no block) unaffected.

## 5. The GitHub App (attestation — the Codecov loop)

**Job:** receipts where the demanding party lives: on pull requests. Org-wide install, near-zero churn, every contributor sees them forever.

**Mechanics (v1 deliberately thin):**
- GitHub App "Reelier receipts": on PR events, look for receipt references — (a) a `reelier-receipts` artifact/summary from the existing Action, or (b) receipt permalink URLs in the PR body — verify each against reelier.com (`/r/<token>/json`), and post ONE sticky comment: skill name, pass/fail per step count, effect grade, attribution block, permalink. Re-verify on edit; never post without a verifiable receipt (no "no receipt found" nagging in v1 — additive, not policing; maintainers opt into requiring it via their own CONTRIBUTING.md).
- A repo config `.github/reelier.yml`: `require_receipts: warn|off` (v1 max = warn — a check-run marked neutral with "no receipt attached"). Hard-fail mode is v2, after norm-seeding.
- Hosting: same reelier-cloud deployment (webhook route), App private key in env. The App writes nothing to repos — comments and check-runs only.
**Verify:** webhook fixture tests (opened/edited/synchronize), signature verification, one live PR on a seldonframe test repo end-to-end.
**Why it matters strategically:** this is the surface where the *norm* gets engineered (see norm plan) — maintainers drowning in AI PRs are the first party with an acute reason to ask for proof-of-work.

## 6. Signing (integrity — LAST, deliberately)

**Job:** make "tamper-evident" true before we ever say it (the standing word-split rule: the phrase is banned until this ships).

**Mechanics (minimal, sigstore-style, v1):**
- `reelier push` optionally signs the record hash chain: Ed25519 keypair generated at `reelier init --signing` (private key local, never uploaded); public key registered to the tenant via dashboard. Receipt stores signature + key id; `/r/<token>` shows "signed by <owner> ✓" only when the signature verifies server-side; `reelier verify <permalink|file>` verifies offline.
- What signing proves (state it exactly, on the page): *this receipt was produced by the holder of this key and has not been altered since push.* It does NOT prove the run wasn't fabricated pre-signing — that's why ranking stays distinct-tenant-based. No overclaim.
- Keyless/OIDC (sigstore proper) and transparency log = v2. Ship the smallest honest primitive first.
**Verify:** sign→push→verify roundtrip; altered-byte → verification fails loudly; unsigned receipts render exactly as today (no second-class shaming in v1).

## Non-goals (v1, all six)
Remote policy control-plane · fuzzy workflow matching · price auto-fetch · hard-fail PR gating · transparency logs · any CLI telemetry (forever) · any "tamper-evident/compliance-grade" copy before feature 6 ships.

## Order + effort
1. Deny-list/dry-run (the seatbelt — makes "gated" true in the headline) — ~3-4 days
2. $ meter — ~2 days
3. Attribution — ~2 days (unblocks App + market exhaust)
4. Freeze-suggestion — ~3 days (the registry doorway)
5. GitHub App — ~4-5 days (the norm engine)
6. Signing — ~3 days (unlocks the banned words)

Each gets the standard loop: implementer in worktree → adversarial review → fix → merge → deploy/publish. Features 4+5 include the mandatory cross-seam integration test.
