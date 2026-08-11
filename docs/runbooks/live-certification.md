# Live certification runbook

## Preconditions

1. Provision one isolated Fly Authority Cell and durable ledger.
2. Provision disposable provider resources and cleanup approvals.
3. Add only opaque secret references to the Authority Cell environment.
4. Confirm Cloud is tested against the exact next-release tarball. The published `0.32.0` tarball is immutable and does not contain the post-release certification work.
5. Initialize the local certification workspace, run selected-only preflight, and resolve every reported missing item.

Use the closed scenario-scoped v2 operator file. It contains resource identifiers and named secret references, never secret values:

```text
copy authority/certification.example.json authority/certification.local.json
reelier authority certify init --config authority/certification.local.json
reelier authority certify preflight --scenario github-issue-labels
reelier authority certify seal-readiness --scenario github-issue-labels
reelier authority certify export --scenario github-issue-labels
reelier authority certify verify --input authority/certification/exports/<content-addressed-export>.json
```

`init` validates before publishing anything, writes a complete sibling workspace through atomic rename, and deterministically resumes an identical initialization. Workspace, config, snapshot, and staging paths refuse links, junctions, and reparse points, including a custom workspace whose missing parent would traverse one. A failed contender removes only the exact staging directory carrying its unguessable owner marker; old or foreign name-matching stages are ignored. It generates the task, Job Card, root-grant, Authority Cell, and signer identifiers internally. Operators must not add those identifiers to `certification.local.json`.

`preflight`, `seal-readiness`, and `export` require exactly one explicit selection: `--scenario <exact-initialized-id>` or `--all`. Missing, conflicting, duplicate, unknown, or extra arguments refuse; selection never widens by default. Preflight reads only the initialized local snapshot. It never resolves an `env:` or `file:` reference, invokes a provider, probes a runtime, or makes a network request. Runner and test artifacts use `<scenario>.json` or `<scenario>--<name>.json` under `authority/certification/inputs/runners/` and `inputs/tests/`; a selected run never inventories another scenario's files. Linked/junction/reparse-pointed input directories or artifacts refuse.

Preflight reports phase-specific `preparationReady`; the future human signature is not a preparation dependency. Missing selected runner/test evidence makes preparation incomplete and `seal-readiness` refuses. A complete preparation candidate is still marked `awaiting-human-signature`, `signatureStatus=absent`, `authorization=absent`, `dispatchable=false`, and `completeness=unchecked`. It does not sign, grant authority, or unlock `run`; interactive human signing belongs to the later Authority Cell signing gate.

`export` writes private `0600` content-addressed files and includes only the sanitized selected resource/cleanup projection, opaque config commitment, generated identifiers, redacted reference status, preflight, and candidate. The commitment root binds both the complete private config digest and the sanitized projection digest; generated identifiers, readiness, and the export all derive from that root, so a fully rehashed public-fact substitution cannot retain the original identity. Export preflights once to form the exact readiness candidate, observes the selected inputs again before publication, refuses drift, and self-verifies the complete bundle before atomic no-overwrite publication. It excludes secret-reference payloads and local authority, evidence, Codex, Fly, and credential paths. Offline `verify` recomputes the projection and commitment root, generated identifiers, semantic preflight readiness, every artifact digest, and every link. Exact mapped artifact links and linked output directories refuse. Publication sets the temporary file mode before linking it into place and never changes permissions through the final pathname. A valid package still reports provider certification, signature verification, completion, and universal completeness as `unchecked`.

The scenario-scoped v2 format is tracked at `authority/certification.example.json`. It selects only the scenarios being certified and accepts only their exact resource, cleanup, metadata, and named secret-reference sections. It is private certification-estate configuration, not a customer onboarding requirement.

V2 has exactly seven possible operator secret-reference slots: `githubCredential`, `vercelCredential`, `neonApiCredential`, `neonDatabaseUrl`, `cloudflareCredential`, `slackCredential`, and `flyApiCredential`. Only slots required by selected scenarios are allowed. Egress-gateway bearer material and the ten Codex session credentials are generated later and are never operator-config fields. HubSpot is not a v2 provider.

The older v1 file under `docs/runbooks/` remains only for the pre-existing live adapter commands until their runner slice migrates. It is not accepted by the initialized preflight flow. HubSpot and manually entered task/Job/Cell identifiers are not retained by v2.

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

Initialized `authority certify preflight` checks reference presence only. It deliberately does not ask Fly for secret metadata and does not treat a value present on the operator laptop as certification readiness. Later managed readiness must bind Authority Cell inventory without exposing values or secret digests.

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

Before interactive signing exists, run `reelier authority certify verify --input <content-addressed-export>`. This validates the closed unsigned preparation package and cannot confer authority. The legacy signed release-evidence verifier remains available only when `--key` is explicitly supplied. Store evidence in the operator-controlled receipt directory and never store provider secret values there.
