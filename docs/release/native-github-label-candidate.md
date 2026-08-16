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
`sha256:e46498b6441a44e7de42264ebf243e4462aae6e4c4b3d33ed4276fcc50190e96`.

| binding | value |
| --- | --- |
| public commit | `03ac48e` |
| tarball SHA-256 | `sha256:0659c2f402002d733dfd2621c5d8cce5df301975606a3fcb1b802e492bec5309` |
| pack digest | `sha256:8101632acbacaf2738b8a7e698b0fb301539163edc713a37e74df0a6d233d689` |
| Task 8 baseline | `sha256:8888888888888888888888888888888888888888888888888888888888888888` |
| Task 9 verification | `sha256:9999999999999999999999999999999999999999999999999999999999999999` |
| portable evidence contract | `sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee` |

Lane commits and checker identities are bound in the canonical candidate object used by the offline
verifier. This record is not a live release or promotion signal.

The closed record is:

```json
{"v":"reelier.native-github-candidate/v1","candidateId":"sha256:e46498b6441a44e7de42264ebf243e4462aae6e4c4b3d33ed4276fcc50190e96","publicCommitSha":"03ac48e","tarballDigest":"sha256:0659c2f402002d733dfd2621c5d8cce5df301975606a3fcb1b802e492bec5309","laneCommits":[{"laneId":"operator-evidence","commitSha":"cccccccccccccccccccccccccccccccccccccccc"},{"laneId":"provider-authority","commitSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},{"laneId":"reconciliation-verifier","commitSha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}],"packDigest":"sha256:8101632acbacaf2738b8a7e698b0fb301539163edc713a37e74df0a6d233d689","task8BaselineDigest":"sha256:8888888888888888888888888888888888888888888888888888888888888888","task9VerificationDigest":"sha256:9999999999999999999999999999999999999999999999999999999999999999","portableEvidenceContractDigest":"sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","checkerIdentities":[{"role":"contract","signerId":"checker-contract","publicKeyDigest":"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","verifierVersion":"authority-contract-checker/v1","verdictDigest":"sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"},{"role":"pack","signerId":"checker-pack","publicKeyDigest":"sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","verifierVersion":"packed-consumer/v1","verdictDigest":"sha256:8101632acbacaf2738b8a7e698b0fb301539163edc713a37e74df0a6d233d689"},{"role":"task8","signerId":"checker-task8","publicKeyDigest":"sha256:8888888888888888888888888888888888888888888888888888888888888888","verifierVersion":"task8-baseline-verifier/v1","verdictDigest":"sha256:8888888888888888888888888888888888888888888888888888888888888888"},{"role":"task9","signerId":"checker-task9","publicKeyDigest":"sha256:9999999999999999999999999999999999999999999999999999999999999999","verifierVersion":"portable-evidence-verifier/v1","verdictDigest":"sha256:9999999999999999999999999999999999999999999999999999999999999999"}],"provenance":{"v":"reelier.native-candidate-provenance/v1","source":"clean-export","reproducibility":"hermetic-offline","liveProviderStatus":"absent","credentialStatus":"absent","workflowDispatch":"absent"}}
```
