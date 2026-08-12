Files changed

- `src/authority/certification/cell.ts`
- `src/authority/certification/github-issue-labels-runner.ts`
- `test/authority/certification-github-issue-labels-runner.test.ts`
- `.superpowers/sdd/2026-08-11-authority-cell-certification-train/task-4b-github-runner-report.md`

What changed

- `cell.ts`: brands genuine Cell hosts in a private WeakMap and provides a host-internal, GitHub-only hermetic permit path. It reuses current signed readiness, Job Card, trust history, root grant, task, principal session, allocation, preflight, endpoint, runner, test, and plan checks. The ordinary `verifyDispatchReadiness` path remains non-dispatchable for GitHub and every other Task 4A runner. Hermetic permits use a separate one-use WeakMap and cannot be consumed by the ordinary permit path.
- `github-issue-labels-runner.ts`: composes a fixed no-credential provider only from a genuine Cell. Resource, desired labels, account, endpoint, request context, limits, and allocation come from signed/verified Cell state and Task 4A config/plan. The runner performs AuthorityGate read/compile/reserve, authoritative reread/recompile equality, current hermetic permit revalidation, durable budget intent/consume and dispatch/send-intent journaling, then at most one provider write. Descriptor-bearing responses and non-2xx responses never acknowledge. Duplicate requests return the journaled status without resending. Recovery cancels/releases pre-network cuts, closes a dispatched/no-send-intent cut, and permanently leaves provider-send-intent pending reconciliation without resend.
- `certification-github-issue-labels-runner.test.ts`: constructs a real signed readiness/Job Card/root grant/principal fixture and exercises the real gate, filesystem ledger, and delegation budget. It proves look-alike Cell refusal, ordinary GitHub readiness refusal, one hermetic write, duplicate idempotence, zero-write source/effect drift, descriptor-safe/non-2xx handling, and restart recovery at three journal cuts.

Deviations from plan

- This fix round intentionally stops at milestone 4B.1. It does not implement apply-then-cut authoritative reconciliation, cleanup, portable receipts, task-graph export, or offline receipt verification.
- The general runner registry, endpoint manifest, and public readiness surface remain non-dispatchable. Hermetic execution is authorized only by the host-internal branded permit path; no live transport or credential route was enabled.
- The journal is an explicit convergence protocol, not a cross-file atomic transaction. It fsyncs each journal file before rename and binds request, reservation, allocation, effect, and permit snapshot digests. A persisted provider-send-intent is never resent and requires later authoritative reconciliation.

Test results (verbatim tails)

`npx tsc -p tsconfig.test.json --pretty false`

```
Exit code: 0
```

`node --test --test-concurrency=1 dist-test/test/authority/certification-github-issue-labels-runner.test.js`

```
tests 9
suites 0
pass 9
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 5916.2977
```

`node --test --test-concurrency=1 dist-test/test/authority/certification-cell.test.js dist-test/test/authority/certification-preflight.test.js dist-test/test/authority/certification-runner-abi-v2.test.js dist-test/test/authority/certification-runner.test.js`

```
tests 35
suites 0
pass 35
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 2032.8511
```

`npm run build`

```
> reelier@0.32.1 build
> tsc -p tsconfig.json && node scripts/build-authority-contract.mjs --copy-schemas && node scripts/build-packs.mjs

built cloudflare_api_token, cloudflare_dns, github_issue_labels, gmail, gmail_labels, hubspot_slack_information_flow, neon_database, slack_channel_topic, stripe, vercel_deployment
```

`npm run check:authority-contract`

```
> reelier@0.32.1 check:authority-contract
> node scripts/build-authority-contract.mjs --check
```

Open risks

- A provider-send-intent is deliberately non-passing and stranded at `pending-reconciliation` until milestone 4B.2 supplies authoritative readback reconciliation.
- No cleanup or portable receipt is claimed by this milestone; provider acknowledgement remains `success: false`.
- The journal rename is durable at the file level but the containing directory is not fsynced on Windows; recovery semantics rely on the last durable named journal phase.
- The hermetic provider is test-only and carries no credentials. This report is not evidence that a live GitHub credential, transport, or topology is implementation-ready.
