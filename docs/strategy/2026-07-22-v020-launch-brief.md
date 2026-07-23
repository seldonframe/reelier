# Reelier 0.19 + 0.20 Launch Brief — README + reelier.com refresh

_Written 2026-07-22. Source-of-truth brief for the session that updates the GitHub README and the reelier.com website to reflect what shipped, told in terms of what it means for users, with a use-case marquee. Read this whole file first; it is written to be understood cold._

---

## 0. Current state (what is TRUE right now)

- **`reelier@0.20.0` is PUBLISHED on npm** and **LIVE on prod** (www.reelier.com deployed, Neon migrated, smoked green — the 8-row claims ladder renders on real receipts).
- Two releases shipped today, both traceable to one dev.to comment (Mads Hansen) on the "snapshot-test your agents" post:
  - **0.19.0 — Flight Recorder v2** (`git 9d2c420`)
  - **0.20.0 — Trust Ladder** (`git 0fff3db`; cloud `3cac547`)
- **Not yet done:** (a) post the Mads dev.to reply (draft exists — ends on the fabrication-resistance hook); (b) a signed receipt visible on reelier.com needs a tenant API key; (c) two infra-debt items filed as chips (delete accidental `reelier-cloud-mainwt` Vercel project; reconcile the divergent prod drizzle migration ledger).
- Repos on this machine: OSS = `C:\Users\maxim\CascadeProjects\reelier` (README lives here); cloud/website = `C:\Users\maxim\CascadeProjects\reelier-cloud` (Next.js; landing page + receipt pages). Prod Vercel project = `reelier-cloud` (`prj_nn4D…`), serves www.reelier.com. Cloud does NOT auto-deploy — manual `npx vercel --prod`.

## 1. The one-line product

**"Agents make claims. Reelier writes receipts."** Record an agent's tool-call workflow once; replay it deterministically at **0 model tokens**; get an asserted, shareable **receipt** every run. Snapshot testing for AI agents and workflows — plus a trust layer that makes the receipt worth showing to someone who doesn't trust you.

Positioning pillars (do not drift): **never-lies** (grounded, honest, no overclaim) · **never-taxes** (flat, owned, portable) · **never-goes-stale** (a thin harness that rides every model gain). Sell on value; anchor cost against "one booked job / one caught regression pays for it." BYOK is plumbing, never the pitch.

## 2. What shipped, in user terms

### 0.19.0 — Flight Recorder v2 (the three-test taxonomy)
A receipt now proves three independent things, not just one. **Credit the taxonomy to Mads Hansen's review** wherever it appears.

| Test | Command | What it proves | Why a user cares |
|---|---|---|---|
| **Determinism** | `reelier run <skill>` | the workflow logic is unchanged | classic snapshot/regression test, 0 tokens |
| **Drift** | manifest preflight (auto) + `reelier manifest` | the tools are still the tools that were recorded | a green replay against a drifted tool schema is a false pass — this fails closed *before step 1* with "schema drifted since recording" |
| **Recovery** | `reelier run --fail N[=status]` | the workflow recovers when a tool breaks | test the failure path on purpose, not by accident |

Plus **write safety**: `--allow-writes` was a blanket yes to every write. Now each write step carries a per-step **`approve:`** hash (via `reelier approve`) bound to the exact operation — replay executes approved writes with no flag, and refuses anything that drifted, **and no flag overrides an approval mismatch**. The receipt records an idempotency key + the resource `{id, version}` the write produced. Mock runs (`--fail`) are marked and **unpushable**.

### 0.20.0 — Trust Ladder (a receipt is TRUTH, graded)
A receipt is **not** a single "verified ✓" — it's a **ladder of independent claims, each graded green/amber/grey, each naming how to raise it.** This is the honest core; never collapse it into one blanket checkmark. What no rung claims: none of this proves a run wasn't *fabricated before it was recorded* — it makes faking **expensive** (fabrication-resistance), never impossible.

| Claim / row | Mechanism | User action to light it |
|---|---|---|
| **Unaltered since push** | Ed25519 signing (`reelier init --signing` → signed push → `reelier verify`) | generate a key, register it |
| **Timestamped** | RFC-3161 TSA (live-smoked against freetsa.org) | `--timestamp` on push |
| **Produced by** | key owner + verified-org badge | register key + verify domain (DNS TXT) |
| **Tools verified** | 0.19 schema-digest manifest | ship with a manifest |
| **Writes approved** | 0.19 hash-bound approvals | `reelier approve` |
| **Cross-checkable refs** | provider request-ids captured from responses | automatic |
| **CI-attested** | GitHub-OIDC JWT verified at ingest | add `permissions: id-token: write` to the workflow |
| **Corroborated** | N *distinct tenants* pushed a receipt for the **byte-identical skill content** | accrues automatically |

**Copy discipline (enforced, do not violate):** "**tamper-evident**" is now permitted **only** beside the *unaltered-since-push* row — never for the receipt as a whole. "**compliance-grade**" and "**fabrication-proof**" are banned everywhere. Grey rows are honest gaps with an upgrade hint, never shameful.

## 3. What it means for each user (the "so what")

- **Solo dev / OSS maintainer of an agent:** your replay is a real regression test again — drift can no longer pass silently, and you can test recovery.
- **Team shipping agent changes:** "the migration ran clean" becomes a checkable artifact on the PR, not a claim — especially CI-attested (GitHub OIDC) receipts, which are structurally harder to fake than a laptop's.
- **Agency selling AI front-offices (SF's ICP):** whitelabel **proof-of-delivery** — "the agent booked these 40 jobs" as invoiceable, signed, timestamped evidence a client can verify.
- **Marketplace buyer/seller:** corroborated receipts = reviews that can't be astroturfed (distinct tenants, identical skill content).
- **Regulated / audit-facing ops:** a signed + timestamped + attested audit trail. (Stay honest: do **not** say "compliance-grade.")

## 4. The use-case marquee (Max's ask — build this)

A rotating/scrolling marquee of "what people use Reelier receipts for," each a tile with an icon, a short headline, and one honest line. Candidate tiles (pick/refine, keep each claim true today vs roadmap-flagged):

1. **GitHub PR receipts** — "Proof-of-work on every agent PR." CI-attested, drift-safe receipts a reviewer can trust. (CI attestation ships today; the sticky-PR-comment GitHub App is roadmap — flag honestly, don't imply it's live.)
2. **Marketplaces** — "Reviews that can't be faked." Corroboration across distinct tenants on identical skill content.
3. **Agencies** — "Show the client the receipt." Signed, timestamped proof the agent did the work, whitelabel.
4. **CI drift-detection** — "Catch the schema change before it breaks you." Manifest preflight fails closed on tool drift.
5. **Snapshot testing** — "Snapshot-test your agents. 0 tokens per replay." The original wedge.
6. **Recovery testing** — "Test the failure path on purpose." `--fail` injects breakage through the real recovery ladder.
7. **Audit trail** — "Every write, with an idempotency key and the resource it touched." (Honest, no "compliance" language.)

Ordering: lead with the two strongest *today* stories (snapshot testing + CI drift), then the trust-differentiated ones (agencies, marketplaces, PR). Marketing gate note: the marketing surface is host-gated via `x-forwarded-host` in this codebase — check how existing marketing sections render before adding.

## 5. The two tasks

### Task A — GitHub README (`reelier/README.md`)
Update to reflect 0.20.0. Must cover: the one-liner + pillars; the three-test taxonomy table (credited); the new commands (`init --signing`, `verify`, `manifest`, `approve`, `--fail`, `--timestamp`); the claims-ladder concept with the exact copy discipline; a short "what it means for you" by audience; link to `docs/specs/flight-recorder-v2.md` and `docs/specs/trust-ladder-v1.md`. Keep it honest — grey rungs are gaps, "tamper-evident" only for the one row. Verify against the actual shipped CLI (`node dist/cli.js <cmd> --help`) — do not document a flag that isn't there.

### Task B — reelier.com website (`reelier-cloud`)
1. **Scout first:** find the landing page and marketing components (likely under `src/app/` — the home route + marketing sections; the receipt page is `src/app/r/[token]/`). Map how sections/marquees are built before writing.
2. Refresh the hero + feature sections to reflect the trust ladder and the three-test taxonomy (what it means, not just what it is).
3. **Build the use-case marquee** (§4) as a real section, matching the site's existing design system and dark theme; reuse existing marquee/animation patterns if present (there's prior marquee work in the repo — grep for it).
4. Ensure the receipt page's claims ladder (already live) is discoverable/linked from the marketing copy — the ladder IS the product; show a real example receipt.
5. Deploy: `npx vercel --prod` from a dir linked to the `reelier-cloud` prod project (NOT `reelier-cloud-mainwt`). Smoke www.reelier.com after.

**Do NOT** touch pricing/positioning pillars, invent features, or use banned copy. When unsure whether a claim is true-today vs roadmap, check the specs or ask.

## 6. Reference docs (read before writing copy)
- `reelier/docs/specs/flight-recorder-v2.md` — 0.19 features, exact semantics
- `reelier/docs/specs/trust-ladder-v1.md` — 0.20 claims ladder, the honesty rules, what each rung does/doesn't prove
- `reelier/CHANGELOG.md` — 0.19.0 + 0.20.0 entries
- `reelier/README.md` — current state to update
- SeldonFrame memory `reelier-flight-recorder-v2.md` — full ship history + tech debt

## 7. Definition of done
- README reflects 0.20.0, every documented command verified against the shipped CLI, copy discipline honored, taxonomy credited.
- Website: hero/features refreshed + use-case marquee live + example receipt linked, deployed to prod (`reelier-cloud` project), www.reelier.com smoked 200.
- No banned copy anywhere ("compliance-grade", "fabrication-proof"; "tamper-evident" only beside unaltered-since-push).
- A short PR/commit summary of what changed and why.
