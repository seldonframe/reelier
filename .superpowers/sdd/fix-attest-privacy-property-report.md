Files changed

- `test/attest-hardening.test.ts`
- `.superpowers/sdd/fix-attest-privacy-property-report.md`

What changed per file

- `test/attest-hardening.test.ts`: Replaced the serialized-substring privacy oracle with a semantic string-leaf oracle that excludes intended hash values. Added a deterministic regression for the CI digest collision and a negative control proving that an actual raw projected value retained in an attestation still fails.
- `.superpowers/sdd/fix-attest-privacy-property-report.md`: Recorded scope, evidence, verification, and remaining risk.

Root cause evidence

The production attestation contained only `method`, `post.hash`, `post.at`, and `confidence`. Replaying CI's exact body found `body.sha = "10003"` only as a coincidental substring of this salted digest:

```text
sha256:c94c19f4dc439831861146b61000306b44f05d045b9b3c98ee3acb140044be79
```

The property oracle was wrong: flattening the entire JSON document discarded the semantic distinction between a raw projected value and characters inside its salted commitment. No production change was required.

Deviations from the plan and why

None. The fix is test-only. Pre-existing concurrent changes in `test/authority/ledger.test.ts` and `.tmp-pack/` were not touched or staged.

Test results (verbatim tail)

Red regression before the oracle correction:

```text
✖ privacy oracle does not treat projected digits inside a SHA-256 digest as raw-value leakage (1.0717ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
```

Randomized Windows stress:

```text
Windows randomized stress: 100/100 focused runs passed
```

`npx tsc -p tsconfig.test.json` completed with exit code 0 and no output. Full focused spec tail:

```text
✔ latency guard: read-only skill invokes its tool exactly once per step — no probe ever fires (0.352ms)
✔ cmdApprove --all: attest advisory still fires on a write step whose approve: hash is already CURRENT (10.8324ms)
ℹ tests 17
ℹ suites 0
ℹ pass 17
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 373.8046
```

Production build tail:

```text
> reelier@0.32.1 build
> tsc -p tsconfig.json && node scripts/build-authority-contract.mjs --copy-schemas && node scripts/build-packs.mjs

built cloudflare_api_token, cloudflare_dns, github_issue_labels, gmail, gmail_labels, hubspot_slack_information_flow, neon_database, slack_channel_topic, stripe, vercel_deployment
```

Full repository suite tail (`npm test`; a first attempt hit the 120-second command timeout, then the conclusive rerun used a sufficient timeout):

```text
ℹ tests 2718
ℹ suites 0
ℹ pass 2717
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 276134.6858
```

Open risks

- The oracle intentionally treats fields named `hash` as commitments rather than raw values. The response-derived attestation schema places projected data only in the salted hash, so this matches the production contract; schema-shape tests remain responsible for rejecting unexpected attestation fields.
