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

## Fix round 1/5 — BLOCKED on link-safe Windows mutation

### Status and scope

No production or test file was changed in this fix round. Review finding 2 is a central safety invariant and the review explicitly requires work to stop rather than substitute pre/post pathname validation when Node cannot provide an actually link-safe primitive. Investigation confirmed that limitation on the supported Windows runtime, so findings 1 and 3–7 remain unimplemented pending an architectural decision.

### Finding mapping

1. **Permit invalidation:** not implemented because finding 2 triggered the mandatory stop. Required future RED coverage remains forged, foreign, closed, and double-close permits; GREEN must delete/transition the module-private `WeakMap` entry before closing owned resources and reject all reuse.
2. **Pathname TOCTOU:** confirmed blocking. A validated queue directory can be displaced and replaced by a junction before `open("wx")`; Node then follows the junction and writes outside the bound root. There is no built-in descriptor-relative child mutation API or Windows no-follow flag in this runtime.
3. **Mutable caller input:** not implemented because finding 2 triggered the mandatory stop. Required future RED coverage remains binding/runtime/fault-observer mutation, including mutation at the final observer; GREEN must capture an immutable deep binding projection and function references once and revalidate after the last observer.
4. **Directory `nlink`:** not implemented because finding 2 triggered the mandatory stop. Required future RED coverage remains a non-Windows publication success or deterministic directory-identity mutation test; GREEN must separate stable directory identity (`dev`/`ino`/`mode`) from regular-file identity (`nlink === 1`).
5. **Crash residue assertions:** not implemented because finding 2 triggered the mandatory stop. Required future RED coverage remains non-following `lstat`, direct-child `realpath` confinement, identity/no-link assertions, and exact canonical-prefix bytes for every residue.
6. **Committed collision:** not implemented because finding 2 triggered the mandatory stop. Required future RED coverage remains exact retry/collision with no newly introduced preparation artifact; GREEN must classify the committed destination before creating/writing preparation state and mutate only exact-owner artifacts.
7. **Sync event naming:** not implemented because finding 2 triggered the mandatory stop. Future GREEN must rename Windows no-op events to `...directory-sync-attempted` or emit an explicit supported/skipped state.

### Runtime API inventory command and exact output

Command:

```powershell
node --input-type=module -e "import fs from 'node:fs'; import fsp from 'node:fs/promises'; const h=await fsp.open('package.json','r'); console.log(JSON.stringify({node:process.version,platform:process.platform,O_NOFOLLOW:fs.constants.O_NOFOLLOW??null,O_DIRECTORY:fs.constants.O_DIRECTORY??null,atApis:Object.keys(fs).filter(k=>/at$/i.test(k)||k.includes('openat')||k.includes('renameat')||k.includes('mkdirat')),fileHandleMethods:Object.getOwnPropertyNames(Object.getPrototypeOf(h)).sort()},null,2)); await h.close()"
```

```text
{
  "node": "v24.9.0",
  "platform": "win32",
  "O_NOFOLLOW": null,
  "O_DIRECTORY": null,
  "atApis": [
    "fstat",
    "lstat",
    "stat"
  ],
  "fileHandleMethods": [
    "appendFile",
    "chmod",
    "chown",
    "constructor",
    "createReadStream",
    "createWriteStream",
    "datasync",
    "fd",
    "getAsyncId",
    "read",
    "readFile",
    "readLines",
    "readableWebStream",
    "stat",
    "sync",
    "truncate",
    "utimes",
    "write",
    "writeFile",
    "writev"
  ]
}
```

### Minimal deterministic reproducer and exact output

The disposable reproducer creates a real queue, validates it with non-following `lstat`, displaces it, installs an external junction at the same pathname, then performs the same path-based `open("wx")` used by publication. It does not touch the worktree.

```text
validated=true
external=escaped-write
```

Exit code: `0`.

### Exact API limitation and required decision

`node:fs` accepts pathnames for `mkdir`, `open`, `rename`, `readFile`, and `realpath`. On Windows in Node v24.9.0 it exposes neither descriptor-relative `openat`/`mkdirat`/`renameat` operations nor `O_NOFOLLOW`/`O_DIRECTORY`; a `FileHandle` cannot create, open, or rename a child relative to its already-validated handle. Even a final-component no-follow flag would not close traversal through a substituted intermediate queue/preparation junction. Therefore validation before and after a pathname mutation can detect substitution only after an external write may already have occurred.

Closing the invariant requires an architectural change outside the approved two-file TypeScript design: for example, a reviewed native Windows helper/addon that performs handle-relative, reparse-point-rejecting creation and rename from an anchored root directory handle, or a different coordination substrate. Weakening the invariant to detection-after-write is explicitly disallowed.
