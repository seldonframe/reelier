# Live certification runbook

## Preconditions

1. Provision one isolated Fly Authority Cell and durable ledger.
2. Provision disposable provider resources and cleanup approvals.
3. Add only opaque secret references to the Authority Cell environment.
4. Confirm Cloud is tested against the exact next-release tarball. The published `0.32.0` tarball is immutable and does not contain the post-release certification work.
5. Run `reelier authority certify preflight` and resolve every reported missing item.

Use a strict operator file rather than putting credentials in command arguments:

```text
reelier authority certify preflight --config authority/certification.json
reelier authority serve --path authority/authority.yml --certification-config authority/certification.json
```

The scenario-scoped v2 format is tracked at `authority/certification.example.json`. It selects only the scenarios being certified and accepts only their exact resource, cleanup, metadata, and named secret-reference sections. It is private certification-estate configuration, not a customer onboarding requirement. The v2 parser and v1 migration are available now; the existing live certify commands continue to use the v1 compatibility path until their init/preflight slice lands.

V2 has exactly seven possible operator secret-reference slots: `githubCredential`, `vercelCredential`, `neonApiCredential`, `neonDatabaseUrl`, `cloudflareCredential`, `slackCredential`, and `flyApiCredential`. Only slots required by selected scenarios are allowed. Egress-gateway bearer material and the ten Codex session credentials are generated later and are never operator-config fields. HubSpot is not a v2 provider.

Start by copying `docs/runbooks/certification.operator.example.json` to the ignored file `authority/certification.local.json`. Replace only resource identifiers, cleanup names, the pinned Codex path/version, and secret references. Managed provider references must keep the documented `env:REELIER_*` names because those names identify secrets staged in the Authority Cell. Keep the local Fly API credential in a local environment variable or ignored file. Never place values in the JSON file, command line, issue, pull request, chat, receipt, or evidence directory.

On Windows, stage each provider credential directly into the Fly Authority Cell with the repository helper. It prompts with masked input and sends the value to `flyctl secrets import` over standard input; the value is not placed in a process argument or file. Run only the names for which the disposable resource is ready:

```powershell
.\scripts\import-fly-certification-secret.ps1 -Name REELIER_GITHUB_TOKEN
.\scripts\import-fly-certification-secret.ps1 -Name REELIER_VERCEL_TOKEN
.\scripts\import-fly-certification-secret.ps1 -Name REELIER_NEON_API_KEY
.\scripts\import-fly-certification-secret.ps1 -Name REELIER_NEON_DATABASE_URL
.\scripts\import-fly-certification-secret.ps1 -Name REELIER_CLOUDFLARE_TOKEN
.\scripts\import-fly-certification-secret.ps1 -Name REELIER_SLACK_TOKEN
.\scripts\import-fly-certification-secret.ps1 -Name REELIER_HUBSPOT_TOKEN
```

The helper stages secrets without restarting the bootstrap Cell. After all required names exist, deploy the serving manifest once; do not repeatedly restart the Cell while entering values. The values still exist transiently in the local PowerShell and `flyctl` process memory, so use a trusted operator machine and close the shell afterward.

`authority certify preflight --config ...` asks Fly only for secret metadata and retains only the secret names. A provider credential present on the operator laptop does not satisfy managed preflight unless the corresponding name exists in the Authority Cell. Secret values and Fly secret digests are never included in the report.

The Codex certification uses a dedicated `CODEX_HOME`, workspace, and session-credential directory. The session-credential directory must be outside the agent workspace. Authenticate that dedicated home once with the pinned standalone Codex binary:

```powershell
$env:CODEX_HOME = "C:\Users\you\.reelier\codex-certification\home"
& "C:\tools\codex\codex.exe" login
& "C:\tools\codex\codex.exe" login status
```

Do not invent or manually copy the ten `rat_...` session values. They must be issued by the Authority Cell against the real task grants and installed as `<profile>.token` files in the private session-credential directory. The Cell stores only their hashes in its append-only principal registry. Configure `ingress.principalRegistryFile` in `authority.yml`; do not combine it with the single-bearer mode.

After the human-signed root task and all nine child grants exist, activate the ten sessions from the Cell's durable delegation tree:

```powershell
reelier authority certify activate-codex --config authority/certification.local.json
```

The command refuses missing, expired, revoked, duplicated, or wrong-principal grants; it requires zero-effect allocations for the code, test, security-review, and independent-verifier profiles. It writes each bearer once with private permissions, emits only token digests in its activation evidence, and revokes every newly issued session if any file installation fails.

The file contains disposable resource identifiers and `env:`/`file:` references only. The current live host path supports authoritative GitHub issue, Cloudflare DNS, and Slack channel reads plus their bounded writes and read-back reconciliation. Vercel's deterministic compiler uses the current official `POST /v10/projects/{projectId}/promote/{deploymentId}` request, but the compound GitHub-check/current-alias source reader is not yet certified. Neon catalog/migration execution remain blocked until their dedicated drivers pass certification.

The confidential Cloudflare-to-Vercel driver is implemented and hermetically verified. Its direction is important: Cloudflare creates and returns the token value once; the Authority Cell captures it into a non-serializable one-use transfer and materializes Vercel's `type: "sensitive"` request privately. The Cloudflare creation effect contains only the exact name, permission-group IDs, resources, time bounds, and IP restrictions. Dispatch evidence commits the endpoint, method, path, query, public headers, and exact secret-bearing body digest, while the body itself is never persisted. Reconciliation observes Cloudflare token metadata and Vercel environment-variable metadata, never plaintext. A connection cut after Cloudflare may have created the token can reconcile the source metadata, but the lost one-time value is never recreated and the destination remains a partial-completion exception. This implementation is not live-certified until the guarded disposable resources and leakage scan pass.

For that live scenario, the operator must create a disposable Cloudflare account-owned bootstrap token with only Account API Tokens Read and Write, and a Vercel access token limited operationally to the disposable team/project. Store both values only in the ignored secret files or Fly secrets referenced by the operator config. Record only the Cloudflare account ID, exact permission-group IDs/resource expressions, Vercel team/project IDs, target (`production` or `preview`), and variable name in signed authority. Never paste either credential into this file, the operator JSON, the CLI, a PR, chat, evidence, or receipts.

The measured Fly probe and grant-bound Codex session activation are implemented; their real deployed evidence and the exported ten-agent task graph remain required before certification.

The fixed opaque source references for the first live slice are `certification_github_issue`, `certification_cloudflare_record`, and `certification_slack_channel`. They identify host-owned bindings; they are not provider IDs and cannot change the configured account or resource.

## Execution

Run each adapter from the Authority Cell with `REELIER_LIVE_CERTIFY=1`. Every adapter must perform a controlled connection cut after the provider may have applied the write, reconcile without resending, export its receipt bundle, and run cleanup. A failed cleanup is a failed certification.

Run the Fly topology adapter before provider writes:

```powershell
$env:REELIER_LIVE_CERTIFY = "1"
reelier authority certify run --adapter fly-topology --config authority/certification.local.json
```

It reads actual Machine/image state, executes in-Machine challenge probes, fetches all three deployed network policies, and writes signed evidence locally. Any stale digest, reachable raw write route, agent provider credential, unexpected secret-shaped environment name, or failed Cell-versus-agent egress check blocks dispatch. Set the same strong `REELIER_EGRESS_GATEWAY_BEARER` Fly secret on the Cell and gateway, and set the Cell's non-secret `REELIER_EGRESS_PROXY_BASE_URL` to the exact `http://<egress-app>.internal:8443` origin. The committed probe manifest resolves that project-specific origin from the environment and refuses when it is missing or public. The probe originates provider TLS from the Cell through that route; gateway-only public reachability is not accepted as Cell egress evidence.

Run the Codex dogfood adapter with ten distinct sessions:

```powershell
$env:REELIER_LIVE_CERTIFY = "1"
reelier authority certify run --adapter codex-ten-agent --config authority/certification.local.json
```

The launcher pins the binary version, verifies login, generates the coordinator profile and nine custom agents, filters secret/token variables out of model-run shell commands, refuses undeclared subagent profiles before spawn, binds `SubagentStart.agent_id` to the declared principal, and saves JSONL output plus hook evidence. A zero process exit is not certification by itself. Verify duplicate collapse, conflict/partial exceptions, root revocation, and graph export.

## Offline verification

Run `reelier authority certify verify --input <signed-manifest> --key <authority-cell-public-key> --signer <signer-id>`. Store the signed manifest and complete graph in the operator-controlled receipt directory. Never store provider secret values in the evidence directory.
