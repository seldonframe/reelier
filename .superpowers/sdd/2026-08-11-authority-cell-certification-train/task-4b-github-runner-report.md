Files changed

- `src/authority/certification/cell.ts`
- `src/authority/certification/authority.ts`
- `src/authority/certification/github-issue-labels-runner.ts`
- `src/authority/types.ts`
- `contract/authority/v1/authority-key-descriptor.schema.json`
- `test/authority/certification-github-issue-labels-runner.test.ts`
- `.superpowers/sdd/2026-08-11-authority-cell-certification-train/task-4b-github-runner-report.md`

What changed

- `authority.ts`, `types.ts`, and the schema add purpose-separated `outcome-contract` and `authority-journal` Cell purposes.
- `cell.ts` captures activated contract, gate, and journal descriptors plus matching private keys at genuine host construction. Probe signatures prove each match; execution calls never receive raw keys. The host-internal GitHub-only permit reuses current signed readiness, Job Card, trust, grant, task, principal, budget, preflight, endpoint, runner, test, and plan checks. Ordinary readiness remains non-dispatchable.
- `github-issue-labels-runner.ts` removes runtime-generated/self-trusted keys. Trust roots use activated Cell descriptors. Authority files are link-safe. Journals are signed, identity-bound, monotonic-phase checked, cross-validated against ledger/allocation truth, and protected by a per-request filesystem lock. Signed rollback refuses. Dispatched/send-intent cuts retain consumed capacity and remain pending reconciliation. Attempted writes are recorded before response normalization.
- `certification-github-issue-labels-runner.test.ts` proves signer substitution refusal, ordinary readiness refusal, duplicate/status bearer authentication, exact budget invariants, journal tamper and rollback refusal, live-run/recovery serialization, linked-path refusal, response descriptor safety, and attempted-write truth using a real signed Cell/gate/ledger/budget fixture.

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
tests 17
suites 0
pass 16
fail 0
cancelled 0
skipped 1
todo 0
duration_ms 9593.5892
```

`node --test --test-concurrency=1 dist-test/test/authority/certification-cell.test.js dist-test/test/authority/certification-authority.test.js dist-test/test/authority/certification-preflight.test.js dist-test/test/authority/certification-runner-abi-v2.test.js`

```
tests 45
suites 0
pass 45
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 2049.4455
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
- The journal rename is durable at the file level but the containing directory is not fsynced on Windows. A live process holds an exclusive per-request lock; an orphaned lock currently requires operator removal after confirming owner death.
- The hermetic provider is test-only and carries no credentials. This report is not evidence that a live GitHub credential, transport, or topology is implementation-ready.
