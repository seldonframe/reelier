# One-command onboarding and existing-connection adoption

## Decision

The public default is one resumable `reelier init`, not manual provider credential setup.

`reelier init` discovers supported harnesses, observes Path A coverage, identifies Path B preparation that can be frozen, identifies Path C commitment edges, and inventories existing callable connections. It never performs a consequential write or silently copies a credential.

Provider environment variables remain a private certification/developer mechanism. They are not the normal customer experience.

## Connection modes

### Observe

Reelier installs reversible observation adapters and reports what it can and cannot see. No provider credential is needed.

### Adopt existing connection

When an MCP server, plugin, CLI, or supported host connection is callable through the Reelier sidecar, Reelier records a non-secret connection descriptor, verifies account identity through a read-only operation, and routes a signed Outcome through that connection. The credential remains with its current owner.

This mode is immediately useful, but if the agent can still reach an equivalent raw write route, declared-surface enforcement and universal completeness remain `unchecked`.

### Secure for unattended autonomy

When the user requests managed autonomy, Reelier offers `Secure this connection`. OAuth, a provider-native grant, or a one-time masked local handoff moves the relevant credential behind the Authority Cell. The agent retains reads and bounded Outcomes but loses the equivalent raw consequential write route for the declared surface.

Managed autonomy refuses unless the Authority Cell measures exclusive routing for that surface. It never claims universal completeness.

## One-command flow

`reelier init` is isolated and checkpointed:

1. Discover Codex, Claude Code, Cursor, OpenClaw, Eve, Hermes, Herdr, MCP, plugin, and supported CLI surfaces.
2. Back up any configuration that may later be changed.
3. Start or validate the local observation service without blocking writes.
4. Import best-effort historical action shapes locally and begin live observation.
5. Inventory existing connections without reading or uploading secret values.
6. Verify callable provider account identity and schema through read-only probes.
7. Report Path A observation coverage, Path B replay candidates, Path C consequential edges, and bypasses separately.
8. Create local shadow candidates; never sign, reserve, or dispatch.
9. Resume from the last successful checkpoint when rerun.

After a candidate exists, `reelier deploy <candidate>` presents the account, exact transition, sources, limits, unresolved judgment, read-back, bypasses, connection mode, topology claim, and exceptions. The human signs once. Only then may Reelier alter the declared write route.

## Safety and honesty

- Never scrape secrets from code, environment files, process memory, agent transcripts, or host configuration.
- A secret reference may be detected, but its value is neither read nor uploaded during discovery.
- Existing raw reads remain available unless a separately signed information-flow policy narrows them.
- Existing raw writes remain available until deployment; local adopted mode reports that bypass honestly.
- After a managed deployment, equivalent raw writes on the declared surface must be absent or refused.
- Host-private or plugin-private connections that the sidecar cannot call are shadow-only until the user adds a callable or managed connection.
- Identity, accounts, recipients, amounts, endpoints, and credentials never come from an Outcome request body.

## Interfaces

Add a closed `ConnectionDescriptorV1` containing connection kind, provider/tool identity, verified account identity, callable endpoints, schema digests, secret owner, and observation/Outcome/exclusive-enforcement coverage.

Add a closed `ConnectionAdoptionV1` containing the descriptor digest, selected account, adoption mode, sidecar route, raw-write reachability, activation state, and signed deployment binding. It contains no credential value.

Public commands remain:

- `reelier init [--dry-run]`
- `reelier discover`
- `reelier connections`
- `reelier deploy [candidate]`
- `reelier doctor [--live]`

Expert certification commands remain under `reelier authority certify ...` and may use named secret references for disposable live certification.

## Compass result

This design removes repeated connection setup and approval while strengthening connection identity, signed authority, exact effects, topology evidence, reconciliation, and receipts. It preserves broad agent preparation and places control only at the consequential exit. The falsifier is a supported connection that appears adopted while an equivalent undeclared write remains reachable without being reported.

