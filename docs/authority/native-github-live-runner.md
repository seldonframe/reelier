# Guarded native GitHub live runner

Task 11 authors the disposable native runner and its workflow; it does not execute them.
The workflow can be started only with `workflow_dispatch`, an explicit disposable target,
and the immutable Task 10 candidate. The consequential matrix is pinned to Ubuntu and
Windows and is attached to the protected `native-github-live` environment. Repository
permissions are read-only.

The preflight command is deterministic and sanitized:

```text
node scripts/native-github-live-runner.mjs --candidate /absolute/path/candidate.json --mode preflight
```

It verifies the candidate's content-addressed ID, public commit, tarball digest, pack digest,
and Task 9 evidence digest. It prints only a status marker. Relative paths, unknown or duplicate
options, malformed JSON, and any pin mismatch refuse.

`--mode run` is intentionally held behind three independent conditions: GitHub Actions,
the protected environment's approval marker, and an explicit execution marker. Even when
those conditions are present, this Task 11 runner stops with `status=held`; Task 12 owns the
separately approved hosted executor. Ambiguous sends are never retried automatically.

The workflow contains no automatic branch, pull-request, schedule, or repository-dispatch
trigger; no provider call; no credential interpolation; no retry loop; and no write step before
approval. Artifact upload is placed after the verification step and is gated on success. The
Windows lane is reserved for offline/native-host refusal evidence; Ubuntu is the only lane that
could later host consequential verification.

All Task 11 checks are local/offline. Authoring this file is not evidence of a live run, provider
behavior, delivery, exactly-once execution, or Gate 4 approval.
