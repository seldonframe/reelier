Files changed

- `src/authority/certification/cell.ts`
- `src/authority/certification/github-issue-labels-runner.ts`
- `src/authority/certification/lifecycle-authority.ts`
- `src/authority/certification/lifecycle-receipts.ts`
- `src/authority/certification/task-receipt-graph.ts`
- `test/authority/certification-github-issue-labels-runner.test.ts`
- `test/authority/certification-lifecycle-authority.test.ts`
- `.superpowers/sdd/2026-08-12-windows-client-linux-authority-cell/task-4-report.md`

What changed per file

- `cell.ts`: consumes a one-use opaque lifecycle-authority handle after activated/current trust, human commitment, binding signature, identity, and validity checks. Hermetic root activation uses the ceremony delegation key rather than accepting it in the call.
- `github-issue-labels-runner.ts`: persists branded provider state, supports cut-after-apply authoritative reconciliation without resend, semantic duplicate/conflict outcomes, exact cleanup restoration, portable receipt publication, and authenticated graph export.
- `lifecycle-authority.ts`: adds the process-local pre-readiness ceremony, six legal activated descriptors, four evidence-root-delegated artifact subkeys, human-signed companion commitment, one-use handle consumption, and public offline binding verification. It does not modify the frozen Adapter Contract.
- `lifecycle-receipts.ts`: composes `createFileReceiptPublication` with real portable reservation, dispatch, and reconciliation bundles. Every artifact is exact-purpose signed, prior receipt links use receipt-value digests, and restart reconciliation rebuilds only from the prior portable bundle.
- `task-receipt-graph.ts`: adds the closed certification-local graph and offline verifier. It derives roots from activated descriptors plus the human/evidence-root binding, calls `verifyAuthorityReceiptBundle`, and rejects closed-shape, lineage, budget, receipt-chain, contract, and confidential-field failures. Topology is `unchecked`; leases are `absent`.
- `certification-github-issue-labels-runner.test.ts`: activates the private Linux platform seam on Windows and covers apply, duplicate, conflict, cut/reconcile/no-resend, cleanup, portable receipts, graph verification/tampering, rollback, race, and linked-path behavior.
- `certification-lifecycle-authority.test.ts`: covers opaque/nonserializable ceremony output, exact public purposes, purpose-separated subkeys, evidence-root delegation, human commitment, frozen digest, and private-material canary absence.

Deviations from the plan and why

- The four artifact signing purposes are not legal `AuthorityKeyDescriptorV1` purposes, and that schema belongs to the frozen Adapter Contract. Per orchestrator direction, a certification-local binding signed by the activated `authority-evidence` key delegates those subkeys; a human readiness companion commitment prevents unsigned attachment. The frozen digest remains `sha256:7f46242b26d9c921f4e1ec9de6418ac5fc8c03d70c4415c25e799ae0e73a1512`.
- The actual scenario has a root grant with `mayDelegate:false`; the graph exports the complete actual lineage (root only) rather than fabricating a child grant.
- Cleanup restores the exact before state and is graph-visible as a signed journal Outcome, but no distinct portable cleanup receipt is minted because portable AuthorityEvidence v1 has no cleanup lifecycle state. Reservation, dispatch, ambiguity/reconciliation are portable receipts.
- Existing non-hermetic certification callers retain the legacy raw delegation activation input. The hermetic lifecycle path neither accepts nor uses it. Removing it globally requires migration of the broader certification API and tests beyond this task.
- The opaque ceremony is deliberately process-local and non-restartable. A production keystore may implement the same opaque boundary later.

Test results (verbatim tail)

```text
✔ dispatch and reconciliation mint portable chained receipts accepted by the existing offline verifier (670.3533ms)
✔ closed task receipt graph verifies offline and rejects tampering, omission, duplication, imbalance, forks, contract drift, and confidential leakage (820.403ms)
✔ pre-readiness lifecycle ceremony exposes only activated public descriptors and an opaque process-local handle (4.3695ms)
✔ artifact subkeys are closed, purpose-separated, evidence-root delegated, and human committed (2.9447ms)
ℹ tests 23
ℹ suites 0
ℹ pass 22
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 13869.5795
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

- A distinct portable cleanup receipt and a delegated child-grant scenario remain open as described above; do not interpret this report as satisfying those two literal checklist bullets.
- The confidential scan is structural and the graph regression injects/rejects `canary-private-token`. The implementation source necessarily contains the canary literal in the rejection predicate, so a raw source grep is not itself an empty artifact scan.
- Existing unrelated dirt was preserved: `.gitignore`, `src/authority/certification/manifests.ts`, `src/authority/certification/runner-registry.ts`, `test/authority/certification-input-fixture.ts`, `.tmp-pack/`, `native/`, and `rust-toolchain.toml`.
