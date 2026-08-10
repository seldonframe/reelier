# Live certification runbook

## Preconditions

1. Provision one isolated Fly Authority Cell and durable ledger.
2. Provision disposable provider resources and cleanup approvals.
3. Add only opaque secret references to the Authority Cell environment.
4. Confirm the packed OSS version is `0.32.0` and Cloud migrations are applied.
5. Run `reelier authority certify preflight` and resolve every reported missing item.

Use a strict operator file rather than putting credentials in command arguments:

```text
reelier authority certify preflight --config authority/certification.json
reelier authority serve --path authority/authority.yml --certification-config authority/certification.json
```

The file contains disposable resource identifiers and `env:`/`file:` references only. The current live host path supports authoritative GitHub issue, Cloudflare DNS, and Slack channel reads plus their bounded writes and read-back reconciliation. Vercel compound deployment state, Neon catalog/migration execution, confidential Cloudflare-to-Vercel transfer, Fly topology evidence, and Codex dogfood remain blocked until their dedicated drivers pass certification; the preflight must not render those placeholders as live evidence.

The fixed opaque source references for the first live slice are `certification_github_issue`, `certification_cloudflare_record`, and `certification_slack_channel`. They identify host-owned bindings; they are not provider IDs and cannot change the configured account or resource.

## Execution

Run each adapter from the Authority Cell with `REELIER_LIVE_CERTIFY=1`. Every adapter must perform a controlled connection cut after the provider may have applied the write, reconcile without resending, export its receipt bundle, and run cleanup. A failed cleanup is a failed certification.

Run the Fly topology adapter before provider writes. Any stale digest, reachable raw write route, agent credential, or failed provider-egress check blocks dispatch.

Run the Codex dogfood adapter with ten distinct sessions. Verify hook-derived identities, duplicate collapse, conflict/partial exceptions, root revocation, and graph export.

## Offline verification

Run `reelier authority certify verify --input <signed-manifest> --key <authority-cell-public-key> --signer <signer-id>`. Store the signed manifest and complete graph in the operator-controlled receipt directory. Never store provider secret values in the evidence directory.
