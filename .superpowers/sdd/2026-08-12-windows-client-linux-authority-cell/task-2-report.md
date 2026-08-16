Files changed

- src/authority/certification/cell.ts
- src/authority/certification/github-issue-labels-runner.ts
- src/authority/cli.ts
- src/authority/host/delegation-service.ts
- src/authority/host/dispatch.ts
- src/authority/host/egress-gateway.ts
- src/authority/host/local.ts
- src/authority/host/platform.ts
- src/authority/host/receipts.ts
- src/authority/host/runtime.ts
- src/authority/host/server.ts
- src/authority/host/windows-k1-fifo.ts (deleted)
- test/authority/authority-serve.test.ts
- test/authority/init.test.ts
- test/authority/linux-authority-cell.test.ts
- test/authority/local-e2e.test.ts
- test/authority/windows-k1-fifo.test.ts (deleted)

What changed per file

- `src/authority/host/platform.ts`: added the closed Linux Authority Cell guard, typed `AUTHORITY_CELL_LINUX_REQUIRED` error, and a non-barrel private test platform seam.
- `src/authority/cli.ts`: guards authority init, bootstrap, serve, egress gateway, Codex principal activation, and Fly topology certification before configuration, writes, keys, secrets, or provider work. The certification guards remain outside their generic availability catches.
- `src/authority/host/local.ts`: guards local Authority Cell runtime composition before filesystem, key, ledger, or provider access.
- `src/authority/host/runtime.ts`, `dispatch.ts`, `receipts.ts`, `server.ts`, `delegation-service.ts`, and `egress-gateway.ts`: guard authority-bearing runtime, dispatch, receipt, server, delegation, and egress composition entry points.
- `src/authority/certification/cell.ts` and `github-issue-labels-runner.ts`: guard certification Cell construction, root activation, hermetic dispatch composition, and its gate construction.
- `src/authority/host/windows-k1-fifo.ts` and `test/authority/windows-k1-fifo.test.ts`: deleted after `rg -n 'windows-k1-fifo' src -g '!windows-k1-fifo.ts'` found no production references outside the module itself.
- `test/authority/linux-authority-cell.test.ts`: added Windows simulations with independent dependency-access counters and an empty-directory write boundary; asserts typed refusal and allowed client/offline preparation paths. It also proves Codex activation does not read a nonexistent configuration and Fly topology certification does not read configuration/live-provider state, plus an un-seamed native-Windows refusal assertion.
- `test/authority/init.test.ts`, `authority-serve.test.ts`, and `local-e2e.test.ts`: skip Linux Authority Cell happy-path tests only on native Windows; they remain native Linux regressions.

Deviations from the plan and why

- Added guards to direct server, delegation, and egress host factories as well as the explicitly named local, dispatch, and receipt composition points, because they are independently callable authority-host construction paths.
- Native Linux execution was unavailable in this Windows worktree. Read-only probes found `docker.exe` with no running `dockerDesktopLinuxEngine` pipe, and only a stopped `docker-desktop` WSL distribution. It can execute `uname -s` but has no `node`; no toolchain/runtime was installed. Existing Linux happy-path tests are explicitly skipped on Windows and remain runnable unchanged on Linux CI.

Test results (verbatim tail)

```
> npx tsc --noEmit
Exit code: 0

> rg -n 'windows-k1-fifo' src -g '!windows-k1-fifo.ts'
No production references outside deleted FIFO module.

> npx tsc -p tsconfig.test.json; node --test --test-concurrency=1 dist-test/test/authority/linux-authority-cell.test.js dist-test/test/authority/init.test.js dist-test/test/authority/authority-serve.test.js dist-test/test/authority/local-e2e.test.js dist-test/test/authority/ledger.test.js dist-test/test/authority/compile.test.js
ℹ tests 752
ℹ suites 0
ℹ pass 749
ℹ fail 0
ℹ cancelled 0
ℹ skipped 3
ℹ todo 0
ℹ duration_ms 93775.7496
```

Open risks

Round 1 verification tail

```
> npx tsc --noEmit; npx tsc -p tsconfig.test.json; node --test --test-concurrency=1 dist-test/test/authority/linux-authority-cell.test.js dist-test/test/authority/local-e2e.test.js dist-test/test/authority/ledger.test.js
tests 733
suites 0
pass 732
fail 0
cancelled 0
skipped 1
todo 0
duration_ms 96450.3007
```

- Hosted Windows CI and a native Linux happy-path run remain required by the train. Exact local blocker: Docker Desktop's Linux engine named pipe is absent; WSL has only `docker-desktop`, stopped by default and lacking Node, so it cannot execute the repository's Node tests without installing a toolchain (out of scope).
- Existing unrelated dirty files remain unmodified and unstaged: `.gitignore`, certification manifests/registry fixture changes, `.tmp-pack/`, `native/`, and `rust-toolchain.toml`.
