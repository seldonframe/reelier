Files changed

- `src/managed-init.ts`
- `src/cli.ts`
- `test/managed-init.test.ts`
- `test/init-cli.test.ts`
- `.superpowers/sdd/task4_oss_managed_init-report.md`

What changed per file

- `src/managed-init.ts`: adds the fixed, deeply frozen `reelier.managed-init/v1` descriptor and renderer. It accepts no input, contains only trust-domain/remote-MCP/session-credential placeholders, and explicitly reports `authority: "absent"`, `completeness: "unchecked"`, `credentials: "absent"`, and `missionAuthorization: "absent"`.
- `src/cli.ts`: routes `reelier init --managed [--dry-run]` to the local descriptor preview. It rejects agent names, signing, and additional inputs/flags so this path cannot become a credential or authorization channel. It makes no filesystem or network writes.
- `test/managed-init.test.ts`: contract tests for the complete descriptor, immutability, redaction, and honest states.
- `test/init-cli.test.ts`: CLI dry-run test proves no init state is written and no ambient credential is rendered; compatibility tests cover named/signing refusal for managed mode.
- `.superpowers/sdd/task4_oss_managed_init-report.md`: this report.

Deviations from the plan and why

- None. The managed preview is deliberately side-effect-free even without `--dry-run`; the plan required dry-run to be write-free, and no supplied endpoint or credential exists to safely persist or activate a real configuration.

Test results (verbatim tail)

`npx tsc -p tsconfig.test.json && node --test --test-concurrency=1 dist-test/test/managed-init.test.js dist-test/test/init-cli.test.js dist-test/test/init-signing-cli.test.js dist-test/test/initialization.test.js`

```text
✔ dry-run never cleans a dead lock or crash residue (5.5365ms)
✔ stale-lock cleanup owns an exclusive recovery lease until residue is gone (34.2594ms)
✔ managed initialization emits a closed, redacted remote-session descriptor (1.3508ms)
✔ managed initialization rendering never includes ambient credentials (0.3155ms)
ℹ tests 37
ℹ suites 0
ℹ pass 37
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 9719.2878
```

`npx tsc --noEmit`

```text
(exit 0; no output)
```

`npm run build`

```text
> reelier@0.32.1 build
> node scripts/build-authority-contract.mjs --check && node scripts/build-bootstrap-contract.mjs --check && tsc -p tsconfig.json && node scripts/build-authority-contract.mjs --copy-schemas && node scripts/build-packs.mjs

built cloudflare_api_token, cloudflare_dns, github_issue_labels, github_release, gmail, gmail_labels, hubspot_slack_information_flow, neon_database, slack_channel_topic, stripe, vercel_deployment
```

Open risks

- This is a placeholder-only OSS contract, not a configured remote endpoint, stored credential, authority grant, mission authorization, provider write, or completeness proof. Any later activation must bind and validate those facts in a separate authority-bearing flow.
- The test runner command supplied by the broader gate (`node --import tsx --test`) is unavailable in this checkout because `tsx` is not installed. Focused TypeScript tests were compiled with the repository's `tsconfig.test.json` and run with Node instead.
