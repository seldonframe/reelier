# Files changed

- `src/authority/host/windows-k1-fifo.ts`
- `test/authority/windows-k1-fifo.test.ts`
- `.superpowers/sdd/2026-08-12-windows-k1-fifo-admission/task-2-report.md`

## What changed per file

- `src/authority/host/windows-k1-fifo.ts`: added the private `WindowsK1FifoHost` creation API, strict current-root binding validation at construction and entry, link/reparse-point-confined queue validation, exclusive preparation and `ticket.json` creation, progress-checked canonical writes, file synchronization, atomic promotion, exact identity/byte revalidation, and a module-private `WeakMap` holding all opaque permit state. Genuine permits are frozen empty objects; permits from another host reject. The module remains absent from every public export.
- `test/authority/windows-k1-fifo.test.ts`: added real child-process hard-exit coverage for all ten publication boundaries; asserted the empty queue or single typed preparation/committed artifact and its exact byte state; added root-binding, linked-queue, external-canary, final queue-identity substitution, and opaque-permit coverage.
- `.superpowers/sdd/2026-08-12-windows-k1-fifo-admission/task-2-report.md`: records Task 2 scope, evidence, deviations, and remaining risks.

## Deviations from the plan and why

- Added a second RED commit (`2ebe8b6`) after self-review found that the first test set did not independently falsify replacement of the queue directory after its sync boundary while preserving the committed ticket directory identity. The new test failed against the first implementation (`actual: { ok: true, permit: {} }`) and drove final queue-identity revalidation. This did not widen file or feature scope.
- True directory `fsync` is not issued on Windows. The implementation uses the repository's existing cross-platform durability pattern: every ticket file is synchronized with `FileHandle.sync()` before rename; directory handles are opened and synchronized on non-Windows platforms, while `syncDirectory` returns on `win32` because Node/Windows may refuse directory handles. Therefore Windows process-crash publication boundaries are covered, but Node cannot provide the same explicit parent-directory flush boundary there.

## Test results

`npx tsc -p tsconfig.test.json --pretty false`

```text
(no output; exit 0)
```

`node --test --test-concurrency=1 --test-name-pattern="Windows K1 FIFO publication|Windows K1 FIFO confinement|opaque FIFO permit" dist-test/test/authority/windows-k1-fifo.test.js`

```text
✔ Windows K1 FIFO publication leaves one typed recoverable artifact at every crash boundary (1623.9982ms)
✔ Windows K1 FIFO confinement refuses substituted roots and linked queue targets without external writes (8.7217ms)
✔ Windows K1 FIFO confinement final validation refuses a replaced queue identity (14.7965ms)
✔ opaque FIFO permit has no serializable state and rejects unrelated hosts (12.4339ms)
ℹ tests 14
ℹ suites 0
ℹ pass 14
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1838.3155
```

## Open risks

- Windows lacks the explicit directory-handle synchronization used on non-Windows platforms; file contents are synced before rename, and atomic namespace transitions plus crash-residue tests are covered, but a power-loss durability claim for directory entries remains platform-limited.
- By Task 2 scope, genuine-permit `withdraw` remains bounded `busy` and `close` only validates ownership. Election, liveness-server operation, withdrawal, dead-owner recovery, root-mutex acquisition, and ledger integration belong to later tasks and are intentionally absent.
- Verification was limited to the requested Task 2 compile and focused tests; the full suite and hosted Windows stress gate were not run.
