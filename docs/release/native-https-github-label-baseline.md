# Native HTTPS GitHub label critical-path baseline

This artifact records the measurement contract for the exact packed native HTTPS
GitHub-label Outcome. It does not claim a latency SLO or regression budget.

```json
{
  "v": "reelier.authority-latency-evaluation/v1",
  "baselineStatus": "insufficient-samples",
  "sampleCount": 0,
  "minimumSampleCount": 30,
  "sloStatus": "absent",
  "regressionBudgetStatus": "absent",
  "liveProviderStatus": "absent",
  "namedHostConformance": "unchecked"
}
```

The release job must associate a measured artifact with its exact tarball SHA-256,
commit, runner operating-system and hardware class, Node version, sample count,
aggregate phase percentiles, operation counts, and variance. The hermetic path
contains no provider-network measurement. Setup and ceremony are separate from
the dispatch trace. The trace exposes only closed phase names and aggregate
durations; it excludes origins, paths, queries, headers, bodies, account names,
credential-slot details, provider content, and identifiers.
