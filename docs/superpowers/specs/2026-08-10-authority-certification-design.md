# Authority Certification Design

## Goal

Turn the existing guarded topology, provider, and Codex fixtures into a repeatable certification workflow that can be run locally or in a managed Authority Cell, while keeping live claims fail-closed and offline-verifiable.

## Boundaries

The certification system does not discover credentials, create provider accounts, or silently mutate production. It accepts non-secret references and injected provider operations from an Authority Cell. A missing resource, missing secret reference, unsupported runtime, or incomplete cleanup plan produces a refusal report, never a partial pass.

## Command surface

`reelier authority certify preflight` reads the local authority configuration and explicit environment references. It emits a closed JSON report containing only resource identifiers, statuses, missing references, and next actions.

`reelier authority certify run` executes selected provider scenarios through registered adapters, writes an append-only evidence directory, and emits a signed release-evidence manifest. The command requires an explicit live acknowledgement and a cleanup reference for every write scenario.

`reelier authority certify verify --input <manifest>` verifies the manifest, linked provider evidence, topology evidence, test digests, and receipt graph offline. It reports `verified`, `failed`, or `unchecked` claims independently.

## Components

1. **Preflight**: deterministic validation of package, Cloud deployment, migrations, provider references, Fly topology references, and Codex runtime capability.
2. **Provider adapter registry**: closed adapter IDs with explicit scenario metadata, account binding, cleanup, ambiguity cut point, and receipt export.
3. **Fly probe adapter**: active operations for challenge-response identity, credential isolation, provider egress, raw-route denial, read coverage, and declared-surface digest matching.
4. **Codex dogfood runner**: materializes ten scoped sessions from the existing dogfood plan, binds identity only from `SubagentStart.agent_id`, and records task graph events without accepting model-supplied identity.
5. **Evidence builder**: canonicalizes evidence, signs the manifest with the Authority Cell signer, and stores only digests and redacted metadata outside the Cell.
6. **Offline verifier**: recomputes every digest and verifies signatures and claim states without contacting providers.

## Failure and privacy rules

- Live execution requires `REELIER_LIVE_CERTIFY=1` and explicit provider/account/credential/cleanup references.
- Credentials are represented by opaque references; values never enter reports, logs, receipts, or manifests.
- Ambiguous writes become exceptions and trigger reconciliation; the runner never retries automatically.
- Cleanup is a required declared operation. A scenario cannot report passed if cleanup is unknown.
- Release evidence never converts `unchecked`, `absent`, or `pending` into success.

## Verification

Each component receives unit tests first. The command tests cover redacted preflight output, missing-resource refusal, explicit-live gating, adapter selection, cleanup failure, manifest tampering, signature-purpose confusion, and offline verification. Existing provider and topology fixtures remain hermetic and are used as the default test corpus.
