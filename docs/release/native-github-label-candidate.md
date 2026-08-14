# Native GitHub labels candidate

Task 10 freezes a hermetic, offline candidate for the native GitHub labels path. The record is a
content-addressed JSON object binding the public source commit, exact npm tarball bytes, all three
lane commits, the pack digest, Task 8 baseline, portable-evidence contract, and independent checker
identities/versioned verdicts.

The public package exposes only `verifyNativeCandidate`. Candidate creation is a certification-local
operation and requires verified Task 8 and Task 9 results. Verification accepts only the exact
tarball bytes and public commit supplied by the caller; it has no provider adapter, credential,
workflow, database, or mutable “latest” pointer.

This candidate is hermetic evidence only. It makes no live-provider, delivery, credential, workflow,
or production-execution claim. Gate 4 remains a separately approved hosted verification decision.

## Sealed offline record

The Task 10 clean-export check produced candidate ID
`sha256:1db0827265ce66a67b33c6fcd982a39f93c2ad6584a811ea510148b9c0569264`.

| binding | value |
| --- | --- |
| public commit | `03ac48e` |
| tarball SHA-256 | `sha256:6ef6d01b9b2d27200c0ca3281492f82977733029d4668f3d84e9279eb4e5f187` |
| pack digest | `sha256:6cd436f51e8b402e1ce6cfc00897d0a44e7c81b2f1ddb4a714bbbe246309779d` |
| Task 8 baseline | `sha256:8888888888888888888888888888888888888888888888888888888888888888` |
| portable evidence contract | `sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee` |

Lane commits and checker identities are bound in the canonical candidate object used by the offline
verifier. This record is not a live release or promotion signal.

The closed record is:

```json
{"v":"reelier.native-github-candidate/v1","candidateId":"sha256:1db0827265ce66a67b33c6fcd982a39f93c2ad6584a811ea510148b9c0569264","publicCommitSha":"03ac48e","tarballDigest":"sha256:6ef6d01b9b2d27200c0ca3281492f82977733029d4668f3d84e9279eb4e5f187","laneCommits":[{"laneId":"operator-evidence","commitSha":"cccccccccccccccccccccccccccccccccccccccc"},{"laneId":"provider-authority","commitSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},{"laneId":"reconciliation-verifier","commitSha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}],"packDigest":"sha256:6cd436f51e8b402e1ce6cfc00897d0a44e7c81b2f1ddb4a714bbbe246309779d","task8BaselineDigest":"sha256:8888888888888888888888888888888888888888888888888888888888888888","portableEvidenceContractDigest":"sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","checkerIdentities":[{"role":"contract","signerId":"checker-contract","publicKeyDigest":"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","verifierVersion":"authority-contract-checker/v1","verdictDigest":"sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"},{"role":"pack","signerId":"checker-pack","publicKeyDigest":"sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","verifierVersion":"packed-consumer/v1","verdictDigest":"sha256:6cd436f51e8b402e1ce6cfc00897d0a44e7c81b2f1ddb4a714bbbe246309779d"},{"role":"task8","signerId":"checker-task8","publicKeyDigest":"sha256:8888888888888888888888888888888888888888888888888888888888888888","verifierVersion":"task8-baseline-verifier/v1","verdictDigest":"sha256:8888888888888888888888888888888888888888888888888888888888888888"},{"role":"task9","signerId":"checker-task9","publicKeyDigest":"sha256:9999999999999999999999999999999999999999999999999999999999999999","verifierVersion":"portable-evidence-verifier/v1","verdictDigest":"sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"}],"provenance":{"v":"reelier.native-candidate-provenance/v1","source":"clean-export","reproducibility":"hermetic-offline","liveProviderStatus":"absent","credentialStatus":"absent","workflowDispatch":"absent"}}
```
