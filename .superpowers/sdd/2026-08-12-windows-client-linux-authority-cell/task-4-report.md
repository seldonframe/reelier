Files changed

- `src/authority/certification/cell.ts`
- `src/authority/certification/filesystem.ts`
- `src/authority/certification/github-issue-labels-runner.ts`
- `src/authority/certification/lifecycle-authority.ts`
- `src/authority/certification/lifecycle-receipts.ts`
- `src/authority/certification/task-receipt-graph.ts`
- `test/authority/certification-github-issue-labels-runner.test.ts`
- `test/authority/certification-lifecycle-authority.test.ts`
- `test/authority/linux-authority-cell.test.ts`
- `.superpowers/sdd/2026-08-12-windows-client-linux-authority-cell/task-4-report.md`

What changed per file

- `cell.ts`: consumes a one-use opaque lifecycle-authority handle after activated/current trust, human commitment, binding signature, identity, and validity checks. Hermetic root activation uses the ceremony delegation key rather than accepting it in the call.
- `github-issue-labels-runner.ts`: persists branded provider state, supports cut-after-apply authoritative reconciliation without resend, semantic duplicate/conflict outcomes, exact cleanup restoration, portable receipt publication, and authenticated graph export.
- `lifecycle-authority.ts`: adds the process-local pre-readiness ceremony, six legal activated descriptors, four evidence-root-delegated artifact subkeys, human-signed companion commitment, one-use handle consumption, and public offline binding verification. It does not modify the frozen Adapter Contract.
- `lifecycle-receipts.ts`: composes `createFileReceiptPublication` with real portable reservation, dispatch, and reconciliation bundles. Every artifact is exact-purpose signed, prior receipt links use receipt-value digests, and restart reconciliation rebuilds only from the prior portable bundle.
- `task-receipt-graph.ts`: adds the closed certification-local graph and offline verifier. It derives roots from activated descriptors plus the human/evidence-root binding, calls `verifyAuthorityReceiptBundle`, and rejects closed-shape, lineage, budget, receipt-chain, contract, and confidential-field failures. Topology is `unchecked`; leases are `absent`.
- `certification-github-issue-labels-runner.test.ts`: activates the private Linux platform seam on Windows and covers apply, duplicate, conflict, cut/reconcile/no-resend, cleanup, portable receipts, graph verification/tampering, rollback, race, and linked-path behavior.
- `certification-lifecycle-authority.test.ts`: covers opaque/nonserializable ceremony output, exact public purposes, purpose-separated subkeys, evidence-root delegation, human commitment, frozen digest, and private-material canary absence.
- `filesystem.ts`: adds confined directory enumeration so portable receipt discovery revalidates directory identity and rejects link/junction substitution.
- `linux-authority-cell.test.ts`: creates the fault schedule during the pre-readiness ceremony; no runtime caller fault selector remains.

Round 1 reviewer closure and commits

- `9bc2883` (RED) / `75f23bc` (GREEN): offline graph verification now starts from an external operator-owned readiness trust pin, verifies the complete signed readiness/trust chain, and derives the evidence/artifact roots from that pin. The graph cannot self-anchor. Cell binding verifies the chain before consuming the opaque handle, so a malformed attempt leaves the handle usable and successful consumption remains one-use.
- `b747fe1` (RED) / `53068ed` (GREEN): controlled hermetic cuts are selected by an opaque preactivation ceremony schedule whose digest is human/evidence committed. The public composition constructor no longer accepts a runtime `mode`.
- `ae16a4a` (RED) / `358be58` (GREEN): a 503 after provider apply is `pending-reconciliation`, retains budget consumption, and cannot be cleaned until authoritative reconciliation.
- `bfe4867` (RED) / `f9d41f3` (GREEN): cleanup is a separate accepted gate decision, reservation, capability/effect dispatch, second budget unit, provider write, and portable receipt chain. Exact replay is idempotent and does not spend or write again; ambiguity retains consumption.
- `bc82e10` (RED) / `6a7b881` and `01313a5` (GREEN): portable receipt storage uses confined/link-safe helpers and revalidates directory identity. The junction falsifier refuses and leaves the external target untouched.
- `778b1d9` (GREEN completion of the graph slice): receipts are verified as per-request portable chains, and graph content, exact counts, and root digest are sealed by an `authority-evidence` signed terminal commitment. Coordinated prefix omission is rejected.

Deviations from the plan and why

- The four artifact signing purposes are not legal `AuthorityKeyDescriptorV1` purposes, and that schema belongs to the frozen Adapter Contract. Per orchestrator direction, a certification-local binding signed by the activated `authority-evidence` key delegates those subkeys; a human readiness companion commitment prevents unsigned attachment. The frozen digest remains `sha256:7f46242b26d9c921f4e1ec9de6418ac5fc8c03d70c4415c25e799ae0e73a1512`.
- The actual scenario still uses the root actor. A real narrower child grant/principal/allocation is a remaining structural item, not represented as completed.
- Cleanup is represented by its own existing-v1 portable request receipt chain; no frozen AuthorityEvidence schema was widened.
- Existing non-hermetic certification callers retain the legacy raw delegation activation input. The hermetic lifecycle path neither accepts nor uses it. Removing it globally requires migration of the broader certification API and tests beyond this task.
- The opaque ceremony is deliberately process-local and non-restartable. A production keystore may implement the same opaque boundary later.

Test results (verbatim tail)

```text
✔ dispatch and reconciliation mint portable chained receipts accepted by the existing offline verifier (701.1758ms)
✔ closed task receipt graph verifies offline and rejects tampering, omission, duplication, imbalance, forks, contract drift, and confidential leakage (1284.7344ms)
✔ a junction-substituted receipt store refuses cleanup and leaves the external target untouched (1142.4022ms)
ℹ tests 23
ℹ suites 0
ℹ pass 22
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 16580.4108
```

```text
> reelier@0.32.1 check:authority-contract
> node scripts/build-authority-contract.mjs --check

> reelier@0.32.1 build
> node scripts/build-authority-contract.mjs --check && tsc -p tsconfig.json && node scripts/build-authority-contract.mjs --copy-schemas && node scripts/build-packs.mjs

built cloudflare_api_token, cloudflare_dns, github_issue_labels, gmail, gmail_labels, hubspot_slack_information_flow, neon_database, slack_channel_topic, stripe, vercel_deployment
```

`npx tsc --noEmit --pretty false` and `git diff --check` exited 0 without output. The single skip is the pre-existing Windows symlink-privilege case; native Linux CI remains required.

Open risks

- Real child grant/principal/allocation is not addressed: the fixture remains a root actor rather than a genuinely narrower child grantee with its own allocation.
- Conflict handling is not addressed completely: the conflict API still lacks exact conflicting bytes and a signed journal/ledger Outcome plus portable receipt.
- Journal append-only history is not addressed completely: journal records lack an explicit `priorJournalDigest`, including valid-old cleanup rollback coverage.
- Graph completeness is not addressed completely: the schema does not yet model and verify exact child grants/allocations, topology/leases signed-evidence states, full node reachability, and canonical chronology.
- Adapter Contract binding is not addressed completely: the frozen digest is not yet explicit in every pre-dispatch permit, journal, and receipt body.
- The confidential scan is structural and the graph regression injects/rejects `canary-private-token`. The implementation source necessarily contains the canary literal in the rejection predicate, so a raw source grep is not itself an empty artifact scan.
- Existing unrelated dirt was preserved: `.gitignore`, `src/authority/certification/manifests.ts`, `src/authority/certification/runner-registry.ts`, `test/authority/certification-input-fixture.ts`, `.tmp-pack/`, `native/`, and `rust-toolchain.toml`.
