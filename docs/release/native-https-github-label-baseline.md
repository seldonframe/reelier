# Native HTTPS GitHub label critical-path baseline

This is a deterministic, hermetic baseline for the exact packed artifact below.
It measures injected monotonic-clock traces only; it does not include provider
network time, make a live-provider claim, or set a latency SLO/regression budget.

```json
{
  "v": "reelier.factory-release-evidence/v1",
  "tarballDigest": "sha256:795732a20b5352d0aa0fc154470b75dcba0c062493fbaadbb1e6a01f99738917",
  "commit": "4a0e2261409ad336acd18f5310d65543ef188d88",
  "runner": {
    "os": "windows",
    "nodeVersion": "v24.9.0",
    "hardwareClass": "local-hermetic-injected-clock"
  },
  "latency": {
    "v": "reelier.authority-latency-evaluation/v1",
    "baselineStatus": "measured",
    "sampleCount": 3,
    "minimumSampleCount": 3,
    "percentiles": { "p50Ms": 12, "p95Ms": 15, "p99Ms": 15 },
    "sloStatus": "absent",
    "regressionBudgetStatus": "absent"
  },
  "liveProviderStatus": "absent",
  "namedHostConformance": "unchecked"
}
```

The closed evidence above deliberately contains only verifier-approved fields.
Its measurement metadata is recorded separately so it cannot be mistaken for a
signed/verified latency claim:

```json
{
  "varianceMs": 5,
  "operationCounts": {
    "modelCalls": 0,
    "reviewerCalls": 0,
    "graphExportsOnCriticalPath": 0
  }
}
```

The exact tarball was installed with npm offline into a clean temporary consumer
and its public authority adapter-contract verification surface passed. Setup and
ceremony are outside this dispatch trace. Trace evidence has only phase names and
aggregate durations; origins, paths, queries, headers, bodies, accounts,
credential slots/references/values, provider content, and identifiers are absent.
