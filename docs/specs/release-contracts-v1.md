# Governed release contracts v1

Status: implemented for the Reelier `0.32.1` governed production release.

## Canonical form and signatures

`StagedCandidateManifestV1`, `ReleasePolicyV1`, `ReleaseAuthorizationBundleV1`, `ReleaseVerifierEvidenceV1`, and `ReleaseReceiptGraphV1` are closed wire contracts. Signed envelopes contain exactly `digest`, `signature`, `signerId`, `v`, and `value`. Digests are lowercase `sha256:` digests over RFC 8785/JCS bytes. Signatures are Ed25519 signatures over the existing authority signing domain, using `release-authorization` for the manifest, policy, and bundle, `release-evidence` for verifier-produced lane evidence, and `release-receipt` for the graph.

Parsing rejects inherited state, non-plain prototypes, accessors, symbols, non-enumerable fields, unknown fields, invalid scalar encodings, duplicate or non-canonical sets, and broken digest links. Arrays must be dense and contain no custom own fields or methods. Validation uses own data descriptors and does not invoke caller-supplied methods, accessors, or iterators. Canonical JSON parsing additionally rejects whitespace, key reordering, duplicate JSON object keys, and any byte representation other than the exact JCS form.

## Authorization closure

The staged manifest fixes repository `seldonframe/reelier`, base `e600ad5c2dc5e1bde0714915e7a84980c8d5602b`, destination `main`, candidate branch `reelier/release/0.32.1`, tag `v0.32.1`, and package `reelier@0.32.1`. Its candidate commit is a full Git SHA. Its candidate tree and packed tarball are committed by digest. Its workflow set is exactly `.github/workflows/ci.yml`, `.github/workflows/docker-publish.yml`, `.github/workflows/mcp-publish.yml`, and `.github/workflows/npm-publish.yml`; omissions, substitutions, duplicates, and reordering refuse. Workflow digests need not be globally unique because distinct paths may legitimately contain identical bytes.

A workflow commitment does not claim that the workflow ran. Full-test, coverage, and mutation claims require distinct typed signed verifier evidence bound to the exact candidate head and exact CI workflow path and digest. The mutation result equals the manifest score and must be at least 9000 basis points. Digest-shaped evidence references and manifest verdict strings alone never satisfy verification.

The release policy permits exactly `src/cli.ts`, `test/cli-subcommand-help.test.ts`, and `CHANGELOG.md`, capped at three files and 65,536 changed bytes. It forbids workflow, dependency, lockfile, credential, authority-contract, policy, generated-contract, and release-script changes. It fixes the destinations to npm, MCP Registry, and GHCR.

The authorization bundle binds the mission, task, Job Card, pack, policy, Authority Cell, root grant, and staged candidate manifest digests. Each of its four provider effects—candidate branch, draft PR, exact-SHA merge, and non-force tag—has a distinct allocation identity, allocation digest, and a one-effect limit. It additionally binds every quality and receipt lane to the trusted verifier's exact signer ID and SHA-256 SPKI digest. A caller-supplied key is never a trust root. `expiresAt` must be exactly twelve hours after `issuedAt`; verification before `issuedAt` and at or after expiry refuses the bundle.

## Receipt graph honesty

`ReleaseReceiptGraphV1` keeps separate required lanes for candidate branch and PR, exact-SHA merge, immutable tag, npm integrity and provenance, MCP Registry version, GHCR immutable manifest and tags, Windows and Linux installed checks, and human authorization count, interruptions, exceptions, and post-release review. Windows and Linux signed evidence binds observation and freshness instants and can be `verified` only while fresh at the graph's signed `verifiedAt` instant. Zero interruption and exception counts require signed summary evidence rather than an empty list.

Every required lane uses one of `verified`, `failed`, `pending`, `absent`, `unchecked`, or `ambiguity`. The graph maker's status is accepted only when complete, authorization-bound, lane-specific signed evidence independently confirms it. Offline verification refuses missing, duplicate, aliased, wrong-lane, wrong-authorization, wrong-subject, wrong-signer, untrusted-key, or tampered evidence. There is no raw graph-to-success evaluator: verification returns an evaluation only after the graph, the runtime-verified authorization, and the complete signed evidence set pass. Success requires every required signed lane result to be exactly `verified`.

Global `completeness` is fixed to `unchecked` and can never be upgraded by this contract: the graph proves the evidence it contains, not that every release-relevant event was observed.
