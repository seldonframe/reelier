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

Start by copying `docs/runbooks/certification.operator.example.json` to the ignored file `authority/certification.local.json`. Replace only resource identifiers, cleanup names, the pinned Codex path/version, and secret references. Put credential values under the ignored `authority/secrets/` directory or in environment variables; never place values in the JSON file, command line, issue, pull request, chat, receipt, or evidence directory.

The Codex certification uses a dedicated `CODEX_HOME`, workspace, and session-credential directory. The session-credential directory must be outside the agent workspace. Authenticate that dedicated home once with the pinned standalone Codex binary:

```powershell
$env:CODEX_HOME = "C:\Users\you\.reelier\codex-certification\home"
& "C:\tools\codex\codex.exe" login
& "C:\tools\codex\codex.exe" login status
```

Do not invent or manually copy the ten `rat_...` session values. They must be issued by the Authority Cell against the real task grants and installed as `<profile>.token` files in the private session-credential directory. The Cell stores only their hashes in its append-only principal registry. Configure `ingress.principalRegistryFile` in `authority.yml`; do not combine it with the single-bearer mode.

The file contains disposable resource identifiers and `env:`/`file:` references only. The current live host path supports authoritative GitHub issue, Cloudflare DNS, and Slack channel reads plus their bounded writes and read-back reconciliation. Vercel's deterministic compiler uses the current official `POST /v10/projects/{projectId}/promote/{deploymentId}` request, but the compound GitHub-check/current-alias source reader is not yet certified. Neon catalog/migration execution, confidential Cloudflare-to-Vercel transfer, and measured Fly topology evidence remain blocked until their dedicated drivers pass certification. The Codex launcher and profile/hook materializer are built, but the run is not certified until the Cell issues the real task-bound sessions and the exported graph verifies offline.

The fixed opaque source references for the first live slice are `certification_github_issue`, `certification_cloudflare_record`, and `certification_slack_channel`. They identify host-owned bindings; they are not provider IDs and cannot change the configured account or resource.

## Execution

Run each adapter from the Authority Cell with `REELIER_LIVE_CERTIFY=1`. Every adapter must perform a controlled connection cut after the provider may have applied the write, reconcile without resending, export its receipt bundle, and run cleanup. A failed cleanup is a failed certification.

Run the Fly topology adapter before provider writes:

```powershell
$env:REELIER_LIVE_CERTIFY = "1"
reelier authority certify run --adapter fly-topology --config authority/certification.local.json
```

It reads actual Machine/image state, executes in-Machine challenge probes, fetches all three deployed network policies, and writes signed evidence locally. Any stale digest, reachable raw write route, agent provider credential, unexpected secret-shaped environment name, or failed Cell-versus-agent egress check blocks dispatch. The current reference gateway manifest is intentionally non-serving; the command must remain blocked until the authenticated gateway path is deployed. Gateway-only public reachability is not accepted as Cell egress evidence.

Run the Codex dogfood adapter with ten distinct sessions:

```powershell
$env:REELIER_LIVE_CERTIFY = "1"
reelier authority certify run --adapter codex-ten-agent --config authority/certification.local.json
```

The launcher pins the binary version, verifies login, generates the coordinator profile and nine custom agents, filters secret/token variables out of model-run shell commands, refuses undeclared subagent profiles before spawn, binds `SubagentStart.agent_id` to the declared principal, and saves JSONL output plus hook evidence. A zero process exit is not certification by itself. Verify duplicate collapse, conflict/partial exceptions, root revocation, and graph export.

## Offline verification

Run `reelier authority certify verify --input <signed-manifest> --key <authority-cell-public-key> --signer <signer-id>`. Store the signed manifest and complete graph in the operator-controlled receipt directory. Never store provider secret values in the evidence directory.
