# Path C — pinned capability summary

**Where this came from, and why it is here.** This was the whole of the branch's `AGENTS.md` until
the merge with `origin/main` on 2026-08-07. On `main`, `AGENTS.md` is a byte-identical twin of
`CLAUDE.md` — the capabilities doc — enforced by `test/claim-guard.test.ts`. The twin had no room
for a branch-local status summary, and folding this into the capabilities doc would have asserted
capability about work that is largely unbuilt. So it moved here intact rather than being dropped.

**Read the audit line before the paragraph.** The text below is preserved **verbatim** from the
audit on the date stated. It has not been re-derived against the current branch, and re-writing it
to look current would destroy the one thing that makes it useful — that it is pinned to a commit
someone actually read.

> **The pin below is stale, and this is a known open item.** `9666b90d…` is **Task 3B1's** product
> commit, not 3B2's. Task 3C's brief blocks the task until 3B2 has an independently approved product
> commit and a final docs-only pin; neither exists yet. The 3C launch prompt records this as
> prerequisite (b), but it names `AGENTS.md` as the file to re-pin — which, after this merge, no
> longer carries a `code pin` line at all. **Re-specify that prerequisite against this file before
> executing it.** See `docs/superpowers/plans/2026-08-07-paths-ab-merge-regression.md`.

---

# Reelier execution paths (audited 2026-08-02, code pin `9666b90d838820ffcf1f8f3e58ffdb370ba34530`)

Pinned capability summary: Path A (`reelier mcp --wrap`) records live MCP traffic and applies its policy seatbelt; malformed policy fails open with a warning/attestation claim. Path B (`reelier run`) replays a frozen skill and fails closed on manifest/state-gate drift. Path C currently ships its v1 closed wire schemas, JCS digest/signature primitives, deterministic vectors, pure two-phase standing-authority validation/compilation, deterministic kernel-owned multi-read source materialization, authenticated request and collision-safe key helpers, opaque connector/static commitments, the exact complete authority-state commitment and trusted local port adapter, durable ingress ownership and clock observation, crash-safe local atomic authority ledger, and safe public helper exports. The signed v1 wire carries sponsor/audience, delegation root-or-child constraints, connector/account, source projection/read/freshness authority, risk/limits, canonical policy commitment, and exact path-bound source claims. CompiledCapability seals authenticated tenant/requester/definition alias, request, contract, source and authority snapshots, exact quantitative limits, outcome/effect, and time; DecisionContext and AuthorityReceipt carry the authenticated alias and bind the portable digest chain. The v3 filesystem ledger requires a verified immutable ingress claim, strictly binds canonical request/capability preimages and exactly typed contract-window/source-trigger limits, owns a monotonic durable clock, and preserves the reservation/dispatch/result state machine; old v1/v2 transactions and missing/tampered ingress linkage fail closed, POSIX directory sync is verified, and Windows directory sync is reported best-effort. Contract selection, GateEvent decision/evidence runtime, production authority-state and provider-read backends, provider writes, ingress transport/server, credential broker, HTTPS driver, dispatch handles, and concrete packs remain designed/unbuilt. Path C's intended promise is to delegate outcomes, not credentials, and to prove bounded scope rather than safety or content correctness.

---

## What has changed since that audit, that a reader must not miss

Recorded here rather than edited into the paragraph above, so the pinned text stays pinned.

- **Path C still has no user-facing command.** `src/cli.ts` does not import the authority module.
  Task 4 (driver, host, ingress, CLI) is entirely pending and has no brief. Nothing in the summary
  above is reachable by a user today.
- **Path A's fail-open is now recorded, not silent.** Since 0.30.0 both paths carry a four-state
  `policy` claim. The enforcement behaviour is unchanged; only its visibility is. See `CLAUDE.md` §7.4.
- **The N-1 guard shipped.** `reelier@0.31.1` refuses any record carrying an own top-level `v`, so an
  old CLI cannot render a confident legacy verdict about an authority receipt. The branch previously
  carried its own narrower six-line version of this in `src/verify.ts`; the merge dropped it in
  favour of the published guard.
- **K1 admission preparation is active by default** (Batch D, `bc21407`). The 16 red ledger tests are
  the ungranted housekeeping-permission family and are **red by design** — do not "fix" them.
