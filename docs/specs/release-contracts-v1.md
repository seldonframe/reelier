# Governed release contracts v1

Status: implemented for the Reelier `0.32.1` governed production release.

## Canonical form and signatures

`StagedCandidateManifestV1`, `ReleasePolicyV1`, `ReleaseAuthorizationBundleV1`, and `ReleaseReceiptGraphV1` are closed wire contracts. Their signed envelopes contain exactly `digest`, `signature`, `signerId`, `v`, and `value`. Digests are lowercase `sha256:` digests over RFC 8785/JCS bytes. Signatures are Ed25519 signatures over the existing Reelier authority signing domain, using the purpose `release-authorization` for the manifest, policy, and bundle, and `release-receipt` for the receipt graph.

Object parsing rejects inherited state, non-plain prototypes, accessors, unknown fields, invalid scalar encodings, duplicate or non-canonical sets, and broken digest links. Canonical JSON parsing additionally rejects whitespace, key reordering, duplicate JSON object keys, and any other byte representation that is not the exact JCS form.

## Authorization closure

The staged manifest fixes repository `seldonframe/reelier`, base `e600ad5c2dc5e1bde0714915e7a84980c8d5602b`, destination `main`, candidate branch `reelier/release/0.32.1`, tag `v0.32.1`, and package `reelier@0.32.1`. Its candidate commit is a full Git SHA. Its candidate tree, packed tarball, and every workflow file are committed by digest. A workflow commitment means: the `path` names the reviewed workflow definition and `digest` names its exact bytes; it does not claim that the workflow ran. Run evidence is separate quality evidence, bound to the same candidate head, with explicit full-test `verified`, coverage `non-regressed`, and mutation score at least 9000 basis points verdicts plus their evidence digests.

The release policy permits exactly `src/cli.ts`, `test/cli-subcommand-help.test.ts`, and `CHANGELOG.md`, capped at three files and 65,536 changed bytes. It forbids workflow, dependency, lockfile, credential, authority-contract, policy, generated-contract, and release-script changes. It fixes the destinations to npm, MCP Registry, and GHCR.

The authorization bundle binds the mission, task, Job Card, pack, policy, Authority Cell, root grant, and staged candidate manifest digests. Each of its four provider effects—candidate branch, draft PR, exact-SHA merge, and non-force tag—has a distinct allocation identity, allocation digest, and a one-effect limit. `expiresAt` must be exactly twelve hours after `issuedAt`; verification at or after expiry refuses the bundle.

## Receipt graph honesty

`ReleaseReceiptGraphV1` keeps separate required lanes for candidate branch and PR, exact-SHA merge, immutable tag, npm integrity and provenance, MCP Registry version, GHCR immutable manifest and tags, Windows and Linux installed checks, and human authorization count, interruptions, exceptions, and post-release review. Windows and Linux lanes bind observation and freshness instants and can be `verified` only while fresh at the graph's signed `verifiedAt` instant.

Every required lane uses one of `verified`, `failed`, `pending`, `absent`, `unchecked`, or `ambiguity`. Evaluation returns success only when every required lane is exactly `verified`. Global `completeness` is fixed to `unchecked` and can never be upgraded by this contract: the graph proves the evidence it contains, not that every release-relevant event was observed.
