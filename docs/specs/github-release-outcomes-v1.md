# Governed GitHub release outcomes v1

Status: implemented for the reviewed Reelier `0.32.1` production release. This is a dedicated four-operation release saga, not a general GitHub issue, pull-request, ref, or workflow runner.

## Opaque request surface

The aliases are exactly `github_release_candidate_publish_v1`, `github_release_pr_ensure_v1`, `github_release_pr_merge_v1`, and `github_release_tag_create_v1`. Their authority request retains the closed `jobRef`, `requestId`, `sourceRefs`, and `choices` surface. `choices` is exactly `{}`. Resolvers accept only an opaque authorization reference and project only a host authorization handle. Repository, refs, package/version, metadata, limits, allocation identities, credentials, and bytes cannot enter through choices.

Each alias has a distinct definition digest, resolver identity, endpoint, and signed effect. Before provider dispatch the runner requires a runtime-verified authorization brand and the alias's exact signed allocation ID, allocation digest, effect, and `maxEffects: 1`. Raw objects and stale authorization refuse before GitHub or npm calls.

## Signed operation plan

`ReleaseOperationPlanV1` is a closed `release-authorization` artifact linked by `ReleaseAuthorizationBundleV1.operationPlanDigest`. It binds repository/base/refs/tag/package/version; every path, Git mode, SHA-256 content digest, expected Git blob/tree/candidate-commit/squash-commit SHA; fixed author, committer, messages, and timestamps; exact draft PR and squash metadata; exact required checks and path-addressed workflow byte digests; and npm's required pre-publication absence.

`candidateTreeDigest` is exactly the authority digest of `{ v: "reelier.release-candidate-tree/v1", files }`, where `files` is the complete ordered list of `{ blobSha, contentDigest, mode, path }`. It is not the Git tree SHA. `expectedTreeSha` separately fixes the Git object. Actual bytes come only from the authenticated opaque source and must reproduce both the SHA-256 digest and Git blob SHA.

## Durable transitions and recovery

Every request has a signed append-only journal. Events use exclusive creation, fsync, an authority-journal signature, monotonic sequence, prior hash, fixed semantic digest, and atomic head. A signed pending head distinguishes a crash between event and head publication from unsigned rollback. Gaps, forks, tampering, rollback, or semantic request-ID reuse refuse. Concurrent duplicates serialize per request.

Content-addressed blob/tree/commit calls may repeat after a crash because their expected IDs are signed. Branch, PR, merge, and tag intents persist before the potentially ambiguous write. A prior branch/PR intent with no authoritative match remains pending. Merge and tag are never resent after intent: recovery performs authoritative PR/main/commit or tag-ref readback only.

Candidate publication checks exact bytes, creates content-addressed objects and a non-force branch, then reads back ref, parent, and tree. PR ensure accepts exactly one draft with exact metadata and head. Merge requires unchanged base, exact head, exact successful checks and CI workflow digest, signed full-test/coverage/mutation evidence, squash metadata, and PR/main/commit/tree readback. Tag verifies package metadata, npm absence, exact main commit, and creates one non-force immutable ref.

The injected provider port has no ambient credentials. Exact readback emits authorization-bound signed `ReleaseVerifierEvidenceV1` for `candidate-branch`, `candidate-pull-request`, `merge-exact-sha`, and `tag-immutable-ref`. A provider acknowledgement alone is never evidence. This implementation does not publish npm, MCP Registry, or GHCR artifacts and does not mutate workflows.
