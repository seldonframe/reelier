Files changed

- `contract/certification/v1/task-receipt-graph.schema.json`
- `contract/certification/v1/task-current-state.schema.json`
- `src/authority/certification/cell.ts`
- `src/authority/certification/filesystem.ts`
- `src/authority/certification/github-issue-labels-runner.ts`
- `src/authority/certification/lifecycle-authority.ts`
- `src/authority/certification/lifecycle-receipts.ts`
- `src/authority/certification/portable-evidence.ts`
- `src/authority/certification/task-receipt-graph.ts`
- `src/authority/host/delegation-budget.ts`
- `src/authority/host/delegation-service.ts`
- `test/authority/certification-github-issue-labels-runner.test.ts`
- `test/authority/certification-lifecycle-authority.test.ts`
- `test/authority/certification-portable-evidence.test.ts`
- `test/authority/delegation-service.test.ts`
- `test/authority/linux-authority-cell.test.ts`
- `.superpowers/sdd/2026-08-12-windows-client-linux-authority-cell/task-4-report.md`

What changed per file

- `task-receipt-graph.schema.json`: closes the certification-local graph vocabulary and exact collection/count/commitment shapes without widening the frozen public contract.
- `task-current-state.schema.json`: closes the signed dispatch/export task-status observation shape and fixes freshness beyond its signed observation time at `unchecked`.
- `cell.ts`: consumes a one-use opaque lifecycle-authority handle after activated/current trust, human commitment, binding signature, identity, Adapter Contract digest, and validity checks. Hermetic root activation uses the ceremony delegation key rather than accepting it in the call, and the pre-dispatch permit snapshot binds the exact Adapter Contract digest.
- `github-issue-labels-runner.ts`: persists branded provider state, supports cut-after-apply authoritative reconciliation without resend, semantic duplicate/conflict outcomes, exact cleanup restoration, portable receipt publication, and authenticated graph export.
- `lifecycle-authority.ts`: adds the process-local pre-readiness ceremony, six legal activated descriptors, four evidence-root-delegated artifact subkeys, human-signed companion commitment, one-use handle consumption, exact Adapter Contract commitment, and public offline binding verification. It does not modify the frozen Adapter Contract.
- `lifecycle-receipts.ts`: composes `createFileReceiptPublication` with real portable reservation, dispatch, and reconciliation bundles. Every artifact is exact-purpose signed, prior receipt links use receipt-value digests, each receipt has a signed certification-local Adapter Contract extension, and restart reconciliation rebuilds only from the prior portable bundle.
- `portable-evidence.ts`: defines and verifies purpose-bound task authority, comparable post-state, distinct Outcome Contract/local-gate policy, task-status, and zero-effect duplicate evidence under the activated `authority-evidence` key.
- `task-receipt-graph.ts`: adds the closed certification-local graph and offline verifier. It derives roots from activated descriptors plus the human/evidence-root binding, calls `verifyAuthorityReceiptBundle`, and rejects closed-shape, full-journal-lineage, budget chronology/conservation, receipt-chain/extension, contract, and confidential-field failures. Topology is `unchecked`; leases are `absent`.
- `delegation-budget.ts`: exports validated per-task budget events so the graph can prove exact chronology and conservation rather than accepting caller summaries.
- `delegation-service.ts`: requires the signed child grant's signer descriptor to be externally active/current before registration, while preserving exact replay idempotence and conflicting-replay refusal.
- `certification-github-issue-labels-runner.test.ts`: activates the private Linux platform seam on Windows and covers apply, duplicate, conflict, cut/reconcile/no-resend, cleanup, portable receipts, graph verification/tampering, rollback, race, and linked-path behavior.
- `certification-lifecycle-authority.test.ts`: covers opaque/nonserializable ceremony output, exact public purposes, purpose-separated subkeys, evidence-root delegation, human commitment, frozen digest, and private-material canary absence.
- `certification-portable-evidence.test.ts`: covers signed task-status observation semantics, explicitly unchecked later freshness, and refusal of false active claims after expiry or revocation.
- `delegation-service.test.ts`: covers forged signers, wrong purpose, inactive descriptors, exact/conflicting replay, and concurrent registration with one allocation/effect.
- `filesystem.ts`: adds confined directory enumeration so portable receipt discovery revalidates directory identity and rejects link/junction substitution.
- `linux-authority-cell.test.ts`: creates the fault schedule during the pre-readiness ceremony; no runtime caller fault selector remains.

Round 1 reviewer closure and commits

- `9bc2883` (RED) / `75f23bc` (GREEN): offline graph verification now starts from an external operator-owned readiness trust pin, verifies the complete signed readiness/trust chain, and derives the evidence/artifact roots from that pin. The graph cannot self-anchor. Cell binding verifies the chain before consuming the opaque handle, so a malformed attempt leaves the handle usable and successful consumption remains one-use.
- `b747fe1` (RED) / `53068ed` (GREEN): controlled hermetic cuts are selected by an opaque preactivation ceremony schedule whose digest is human/evidence committed. The public composition constructor no longer accepts a runtime `mode`.
- `ae16a4a` (RED) / `358be58` (GREEN): a 503 after provider apply is `pending-reconciliation`, retains budget consumption, and cannot be cleaned until authoritative reconciliation.
- `bfe4867` (RED) / `f9d41f3` (GREEN): cleanup is a separate accepted gate decision, reservation, capability/effect dispatch, second budget unit, provider write, and portable receipt chain. Exact replay is idempotent and does not spend or write again; ambiguity retains consumption.
- `bc82e10` (RED) / `6a7b881` and `01313a5` (GREEN): portable receipt storage uses confined/link-safe helpers and revalidates directory identity. The junction falsifier refuses and leaves the external target untouched.
- `778b1d9` (GREEN completion of the graph slice): receipts are verified as per-request portable chains, and graph content, exact counts, and root digest are sealed by an `authority-evidence` signed terminal commitment. Coordinated prefix omission is rejected.

Round 2 reviewer closure and commits

- `0e85c2b` / `6f1d609`: offline verification requires the externally anchored current trust history and refuses a revoked evidence root.
- `c61a961` / `98eef94`: pending provider outcomes reconcile from authoritative state without resend or budget release.
- `159ea76` / `a331975`: every signed journal transition is an append-only generation linked by its prior body digest; valid-old head rollback and omitted generations refuse.
- `9f15a27` / `06183c6`: lifecycle execution uses a genuine narrower signed child grant, principal, session, and allocation.
- `1d9ac56` / `4ce33f7`: the lifecycle Cell path accepts no caller-supplied raw private key fields.
- `d18b0e0` / `3a793a6`: cleanup publication recovers durably after authoritative restore without resend or additional budget.
- `bb4de3c` / `3f44aca`: conflict binds canonical exact bytes, persists a signed terminal journal generation and chained portable receipt, replays exactly, rejects changed bytes, and consumes/writes nothing additional.
- `6e590dd` / `e72fb10`: the certification-local graph schema and runtime verifier are closed and canonical. They export all signed journal generations, exact budget events, root/child grants and principals, allocations, exceptions, portable receipt chains, external trust material, honest topology/lease states, exact counts, per-collection digests, and a signed terminal commitment. Omission, extras, substitution, forks, chronology errors, and conservation errors refuse.
- `cd84a18` / `28c0e3b` / `86b5426`: the frozen Adapter Contract digest is signed into the lifecycle binding and human commitment, present in the opaque pre-dispatch permit snapshot, every journal generation, each certification-local signed portable-receipt extension, and the graph. Cross-link mismatch refuses offline, and graph counts cover every extension.
- `be812dd` / `f4811fc`: the direct Cell child-registration helper rejects forged signatures, wrong purposes, inactive descriptors, conflicting replay, and conserves a single allocation under concurrent exact replay.

Independent review closure

- `d7d68de` / `fe5bc67`: a self-listed attacker descriptor no longer counts as active. The host registry persists and verifies the root task's delegation signer, and direct signed-child registration must match that host-observed signer; the request carries no active-set assertion.
- `295a403` / `45f357f`: graph export checks raw receipt-extension cardinality before digest indexing, so duplicate files cannot be collapsed by a `Map`.
- `08fcb2f` / `33b2659`: conflict publication is journal-first and restart-safe. A signed `conflict-publication-pending` generation binds the exact bytes before publication; recovery selects the unique existing receipt-chain head, republishes idempotently, and commits the portable receipt digest. Graph export refuses pending conflict publication, and offline verification links the terminal journal to the exact conflict receipt and its reconciliation evidence.
- `61c8b05` / `19e9f3c`: restart recovery validates the complete receipt chain from its unique root through every node before selecting the head; duplicated non-head nodes, forks, disconnected nodes, and zero/multiple heads refuse.
- `f1955cd` / `4b4dba4`: the exact post-publication crash window is covered: the conflict receipt is durable while the journal remains pending, and restart recognizes and reuses that deterministic terminal receipt instead of generating a self-linked successor.
- `39a057a` / `a34a867`: every durable recovery-chain bundle and prior link is cryptographically verified against the activated, purpose-separated lifecycle roots before it can guide head selection or new publication. A tampered receipt signature refuses recovery.
- `fbab7d6` / `4172645`: the exact crash between portable conflict-receipt publication and its required signed Adapter Contract extension is recoverable. Restart idempotently creates or verifies the exact expected extension, including its signature, before terminal journal commitment.
- `c1fd737` / `f411691`: extension recovery compares the raw stored bytes with the exact expected JSON-plus-newline serialization before parsing and signature verification. Reordered but semantically equivalent signed JSON refuses while the conflict journal remains pending.
- `76db84e` / `65eaea7`: founder-approved plan amendments explicitly include the certification-local graph schema and the minimum host budget support file in Task 4 scope.

Deviations from the plan and why

- The four artifact signing purposes are not legal `AuthorityKeyDescriptorV1` purposes, and that schema belongs to the frozen Adapter Contract. Per orchestrator direction, a certification-local binding signed by the activated `authority-evidence` key delegates those subkeys; a human readiness companion commitment prevents unsigned attachment. The frozen digest remains `sha256:7f46242b26d9c921f4e1ec9de6418ac5fc8c03d70c4415c25e799ae0e73a1512`.
- The actual scenario executes as the narrower child actor with its own grant, principal session, and allocation; the root remains only the grantor and conserved-budget ancestor.
- Cleanup is represented by its own existing-v1 portable request receipt chain; no frozen AuthorityEvidence schema was widened.
- Existing non-hermetic certification callers retain the legacy raw delegation activation input. The hermetic lifecycle path neither accepts nor uses it. Removing it globally requires migration of the broader certification API and tests beyond this task.
- The opaque ceremony is deliberately process-local and non-restartable. A production keystore may implement the same opaque boundary later.

Boundaries and non-claims

- Payment is not authorization. No payment or x402 state grants, widens, or substitutes delegation authority.
- Authentication or possession of a principal session is not delegation. Dispatch still requires the signed Job Card, grant lineage, allocation, and current Cell authority state.
- Linux or hermetic confinement is not proof of external-effect scope. The fixture proves only its declared in-Cell provider transition and declared labels projection.
- Skill repeatability is not content correctness, semantic correctness, safety, or fitness for purpose.
- Reviewer predictions and model judgments do not authorize dispatch; only the committed authority inputs and Cell decision do.
- Receipts are not universal completeness evidence. The export is a closed graph of the declared durable fixture collections, not proof that every possible write was receipted.
- GUI/computer-use actions, direct HTTP outside the Cell, plugin-delivered traffic, universal plugin interception, and external delivery are outside this fixture.

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

Round 2 final verification (2026-08-12)

```text
Cell/delegation focused: 36 tests, 36 pass, 0 fail, 0 skip.
Hermetic runner/graph focused: 38 tests, 37 pass, 0 fail, 1 skip.
```

The focused files were `delegation.test`, `delegation-budget.test`, `delegation-service.test`, `certification-cell.test`, `certification-lifecycle-authority.test`, `linux-authority-cell.test`, and the complete `certification-github-issue-labels-runner.test`. `npx tsc -p tsconfig.test.json --pretty false`, `npx tsc --noEmit --pretty false`, `npm run check:authority-contract`, `npm run build`, and `git diff --check` all exited 0. The sole skip remains the Windows configuration-symlink privilege case; its plan/journal sibling cases passed.

Open risks

- The graph deliberately reports production topology as `unchecked` and leases as `absent`; Task 4 has no signed production topology or lease evidence and does not fabricate either.
- The confidential scan is structural and the graph regression injects/rejects `canary-private-token`. The implementation source necessarily contains the canary literal in the rejection predicate, so a raw source grep is not itself an empty artifact scan.
- The pre-readiness lifecycle ceremony is process-local and non-restartable. A production keystore may implement the same opaque boundary later.
- Hosted native Ubuntu remains required by Task 5. Windows tests use the scoped private Linux-host seam only for the in-Cell lifecycle; native Windows hosting remains refused.
- One independent-review full-run attempt previously stalled for 30 seconds and surfaced `ingress-ledger-unavailable` during cleanup publication; its isolated rerun passed, and two fresh identical compiled full-runner executions passed cleanup in about 1.7 seconds without timeout or retry changes. This non-reproduced process-global/K1 contention risk is recorded, not treated as closed.
- Existing unrelated dirt was preserved: `.gitignore`, `src/authority/certification/manifests.ts`, `src/authority/certification/runner-registry.ts`, `test/authority/certification-input-fixture.ts`, `.tmp-pack/`, `native/`, and `rust-toolchain.toml`.
