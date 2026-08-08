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

> **Why the pin did NOT move on 2026-08-08, measured.** Moving it was attempted and abandoned on
> evidence. A pin move asserts "someone read this paragraph against that commit", so it is only
> honest if the paragraph is re-audited — and the audit found the paragraph **materially stale**,
> not merely old. `git diff --name-status 9666b90d HEAD -- src/authority/` reports four modules
> **added** since the pin: `gate.ts`, `decision.ts`, `errors.ts`, `host/fs-ledger-coordination.ts`.
> `gate.ts` exports `AuthorityGate { decide(...) }`, `GateResult` (accepted / refused / existing /
> unavailable) and `GateDecisionSigner`; `decision.ts` exports `GateDecisionRecord`,
> `GateDecisionSink` and its fault points; `gate.test.ts` passes 33/33. So the paragraph's
> "**GateEvent decision/evidence runtime … remain designed/unbuilt**" is now **false**, and moving
> the pin without rewriting that clause would have published a false capability claim under a
> freshly-minted commit hash — worse than an openly stale one, because the new hash reads as
> verification.
>
> **A warning about the method, because it nearly shipped the error.** The first pass of this audit
> ran `git diff --stat … | tail -20` and concluded no `src/authority/` file had been added. The
> list was 25 files; `tail -20` silently cut the additions off the top. `--name-status` without a
> pager filter is what caught it. A truncated diff reads exactly like a clean one.
>
> **Therefore: re-auditing the paragraph clause by clause is its own task, not a line edit.** Until
> it happens the pin stays at `9666b90d` where it is honest about what was actually read, and the
> deltas below carry the corrections.

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
- **K1 admission preparation is active by default** (Batch D, `bc21407`).
- **The "16 red ledger tests, red by design" claim is retired — it was wrong twice over.** This
  entry used to read "the 16 red ledger tests are the ungranted housekeeping-permission family and
  are red by design — do not 'fix' them." Both halves are refuted by measurement.
  *The characterisation*: `docs/superpowers/plans/2026-08-07-d2-grant-measured.md` implemented the
  granted permission against build output and measured 18 -> 24 failures. Granting fixed **1 of 16
  and broke 7**, so "one family behind one switch" was false; `884dcc5` then decomposed them into
  four unrelated groups of which only 8 concerned housekeeping permission at all.
  *The count*: the family was closed by `0ab1a30` (six D2 pins re-scoped to the shipped contract),
  `a0fc39e` (`:1713`'s four residues re-fixtured to dead owners), `56dbc2f` (exact-revalidate at
  both renames), `da67f97` (the collision branch's terminal is corruption; its budget was
  truncating it) and `f214703` (three platform bugs, all in tests). The ledger gate now measures
  **704 pass / 0 fail**, re-measured on the merge commit with `baseline-diff` reporting no change
  in the failing set. There is no standing red set to preserve.
- **The K1 fence EACCES fail-fast was built, measured, and REVERTED — the defect stands.** Owner-
  granted 2026-08-08 and implemented; it did what it promised locally (3003ms of a 3000ms budget ->
  immediate, full local suite 0 fail, independent review clean). CI's `windows-latest` leg then
  failed `100 real processes converge on one committed reservation`: **all 100 processes returned
  `busy` and none acquired the fence**, because under ~100-way contention on that runner `EACCES`
  is also returned for transient conflicts, so failing fast on it destroyed real cross-process
  mutual exclusion. That is a far worse defect than the latency it fixed, so it was reverted in
  full. The safety measurement had used a single holder only; local green was not green. **~1.67%
  of roots still stall for the full `lockTimeoutMs` on every operation.** Do not retry the errno-
  only form; see the refutation recorded beside the rule in
  `docs/specs/compiled-authority-v1.md`.
