# Authority-cell merge checklist

- [ ] `npm run build` passes on the merge result.
- [ ] Full Windows and Linux test suites pass without hangs.
- [ ] Packed `reelier@0.32.0` is the exact Cloud dependency.
- [ ] Cloud migrations are generated from the final schema and applied manually.
- [ ] Signed Fly topology evidence is fresh and all six claims are verified.
- [ ] All guarded provider scenarios pass with cleanup and offline bundle verification.
- [ ] Ten-agent Codex graph verifies offline, including duplicate, conflict, partial, and revocation cases.
- [ ] Secret leakage scan covers workspace, logs, database, bundles, and Cloud metadata.
- [ ] No live claim is inferred from fixture-only tests.
- [ ] Only after all boxes pass: merge OSS and Cloud branches and publish the final release audit.
