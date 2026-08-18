Files changed

- `src/cli.ts`
- `test/cli-subcommand-help.test.ts`
- `CHANGELOG.md`
- `.superpowers/sdd/2026-08-18-eve-governed-production-release/task-1-report.md`

## What changed

- `src/cli.ts`: exits through the existing top-level usage path when any
  subcommand receives `--help` or `-h`, before argv parsing or dispatch.
- `test/cli-subcommand-help.test.ts`: adds a self-contained black-box contract
  covering every command in `main()`'s dispatch switch and both help flags. It
  asserts exit 0, usage output, no isolated-home/workspace mutation, no timeout
  or signal, and runs the child under a 64 MiB V8 old-space limit.
- `CHANGELOG.md`: documents the read-only subcommand-help behavior under
  `0.32.1`'s Fixed section.

## TDD evidence

RED command:

```text
npx tsc -p tsconfig.test.json; if ($LASTEXITCODE -eq 0) { node --test --test-concurrency=1 dist-test/test/cli-subcommand-help.test.js }
```

RED output tail:

```text
✖ every dispatched subcommand exits read-only for --help and -h (419.3133ms)
AssertionError [ERR_ASSERTION]: run --help exited non-zero:
Usage: reelier run <skill.md> ...
1 !== 0
```

GREEN commands:

```text
npx tsc -p tsconfig.test.json
node --test --test-concurrency=1 dist-test/test/cli-subcommand-help.test.js
node --test --test-concurrency=1 --test-name-pattern="entrypoint guard|root parser" dist-test/test/cli-entrypoint.test.js
```

GREEN output tails:

```text
✔ every dispatched subcommand exits read-only for --help and -h (29475.2162ms)
ℹ tests 1
ℹ pass 1
ℹ fail 0
ℹ duration_ms 29538.0598

✔ cli.ts's entrypoint guard still runs main() when invoked through a symlinked/junctioned directory (Unix bin-symlink regression) (343.5776ms)
✔ root parser retains authority connection values required by the existing connection contract (0.6648ms)
ℹ tests 2
ℹ pass 2
ℹ fail 0
ℹ duration_ms 701.1093
```

`npx tsc -p tsconfig.test.json` exited 0 with no output.

## Deviations from plan

None.

## Self-review

The test enumerates all 35 current dispatch cases directly. It would fail if a
command bypassed the early help exit by returning nonzero, omitting usage,
mutating the isolated state, exceeding the 1.5-second timeout, being signaled,
or exceeding the child V8 memory limit. Normal entrypoint and root parsing
behavior remains covered by their existing focused tests.

## Open risks

The exhaustive process-level test is intentionally comprehensive and takes
about 30 seconds on this Windows worktree. It uses a V8 old-space cap rather
than a platform-specific RSS probe, keeping the assertion portable while still
making a memory-growth regression fail.

## Commits

- `3741edbbbead2cf503d3c4e74ae1e75484a37924` — `fix: make subcommand help read-only`
- `ac7c31dfe485d2c386e434089fae278b043239fb` — `docs: document read-only subcommand help`

## Fix round 1/5

### Files changed in this round

- `src/cli.ts`
- `test/cli-subcommand-help.test.ts`
- `CHANGELOG.md`
- `.superpowers/sdd/2026-08-18-eve-governed-production-release/task-1-report.md`

### What changed

- Replaced broad `rest.includes()` help recognition with the exact grammar
  `<known-dispatched-command> (--help|-h)`. Unknown commands and values such
  as `--wrap -h` therefore retain their former command semantics.
- Hardened the dedicated process-level test with a temporary preload oracle:
  it starts the child with a scrubbed environment (no inherited credentials,
  proxy, or configuration) and turns filesystem/state reads and writes,
  subprocess calls, DNS, socket, HTTP(S), TLS, datagram, and global fetch APIs
  into explicit failures. It records the OS-provided `maxRSS` peak from
  `process.resourceUsage()` and requires it to remain below 256 MiB.
- Added a deterministic parity assertion from the test inventory to the actual
  `main()` dispatch-switch cases.
- Narrowed the changelog language to the exact sole-help-token grammar.

### Covering tests

- `test/cli-subcommand-help.test.ts`
- `test/cli-entrypoint.test.ts` (focused existing entrypoint and root-parser
  regressions)

### RED

Command:

```text
npx tsc -p tsconfig.test.json; if ($LASTEXITCODE -eq 0) { node --test --test-concurrency=1 --test-name-pattern="subcommand help grammar" dist-test/test/cli-subcommand-help.test.js }
```

Output tail:

```text
✖ subcommand help grammar does not reinterpret unknown commands or option values
AssertionError [ERR_ASSERTION]: unknown command must remain non-zero:
Usage: reelier <run|bench|baseline|cost|prices|mcp|serve|trace|compile|manifest|approve|push|get|verify|diff|ci|policy|init|up|discover|connections|connect|deploy|doctor|bridge|from-session|scan|install|uninstall|login|logout|whoami> [options]
0 !== 1
```

### GREEN / targeted verification

Commands:

```text
npx tsc -p tsconfig.test.json
node --test --test-concurrency=1 dist-test/test/cli-subcommand-help.test.js
node --test --test-concurrency=1 --test-name-pattern="entrypoint guard|root parser" dist-test/test/cli-entrypoint.test.js
```

Output tails:

```text
✔ dedicated help inventory exactly matches main's dispatch switch (4.7017ms)
✔ every dispatched subcommand exits read-only for --help and -h (24858.8722ms)
✔ subcommand help grammar does not reinterpret unknown commands or option values (730.5172ms)
ℹ tests 3
ℹ pass 3
ℹ fail 0
ℹ duration_ms 25655.2274

✔ cli.ts's entrypoint guard still runs main() when invoked through a symlinked/junctioned directory (Unix bin-symlink regression) (337.6904ms)
✔ root parser retains authority connection values required by the existing connection contract (0.6748ms)
ℹ tests 2
ℹ pass 2
ℹ fail 0
ℹ duration_ms 718.5087
```

`npx tsc -p tsconfig.test.json` exited 0 with no output in both runs.

### Self-review and open risks

The child oracle operates before CLI module evaluation, so any future handler
dispatch that reaches a listed side-effect API fails even if it writes outside
the temporary sandbox or creates then deletes state. `process.resourceUsage()`
provides the platform's OS-recorded peak RSS in KiB; this is not a V8 heap
limit. The exhaustive process test remains intentionally comprehensive and
takes about 25 seconds on this Windows worktree.

### Commit

- `90e2401d54fa4817fe186e58081e96523c91d969` — `test: harden subcommand help contract`

## Fix round 2/5

### Files changed in this round

- `src/cli.ts`
- `test/cli-subcommand-help.test.ts`
- `.superpowers/sdd/2026-08-18-eve-governed-production-release/task-1-report.md`

### What changed

- The oracle now blocks the complete current synchronous `node:fs` callable
  surface in addition to its asynchronous filesystem, subprocess, and network
  guards, including `openSync`, `writeFileSync`, `mkdirSync`, and `rmSync`.
- Oracle installation moved to immediately after the actual CLI module loads
  and immediately before its exported `main()` is invoked. This permits Node's
  own unavoidable module-loader reads while guarding all command execution.
- `main()` is exported solely so the process-level harness can load the real
  CLI, enable its guard, then execute the exact CLI dispatcher.
- Added a direct self-test proving a representative `node:fs.writeFileSync`
  call exits nonzero, emits the oracle violation, and leaves no target file.

### Covering tests

- `test/cli-subcommand-help.test.ts`
- `test/cli-entrypoint.test.ts` (focused existing normal entrypoint/parser
  behavior)

### RED

Command:

```text
npx tsc -p tsconfig.test.json; if ($LASTEXITCODE -eq 0) { node --test --test-concurrency=1 --test-name-pattern="synchronous filesystem" dist-test/test/cli-subcommand-help.test.js }
```

Output tail:

```text
✖ the help oracle rejects representative synchronous filesystem writes
AssertionError [ERR_ASSERTION]: synchronous write bypassed the help oracle
```

The first attempt to block sync functions from preload also correctly exposed
Node bootstrap dependencies (`realpathSync`, then `readFileSync`), so the
oracle was redesigned to activate after module loading. The wrapper initially
failed RED with `TypeError: main is not a function`; exporting `main()` was the
minimal production change required for the guardable real dispatch path.

### GREEN / targeted verification

Commands:

```text
npx tsc -p tsconfig.test.json
node --test --test-concurrency=1 dist-test/test/cli-subcommand-help.test.js
node --test --test-concurrency=1 --test-name-pattern="entrypoint guard|root parser" dist-test/test/cli-entrypoint.test.js
```

Output tails:

```text
✔ dedicated help inventory exactly matches main's dispatch switch (7.6645ms)
✔ the help oracle rejects representative synchronous filesystem writes (108.78ms)
✔ every dispatched subcommand exits read-only for --help and -h (25847.0932ms)
✔ subcommand help grammar does not reinterpret unknown commands or option values (748.6847ms)
ℹ tests 4
ℹ pass 4
ℹ fail 0
ℹ duration_ms 26807.6856

✔ cli.ts's entrypoint guard still runs main() when invoked through a symlinked/junctioned directory (Unix bin-symlink regression) (348.2935ms)
✔ root parser retains authority connection values required by the existing connection contract (0.6828ms)
ℹ tests 2
ℹ pass 2
ℹ fail 0
ℹ duration_ms 693.415
```

`npx tsc -p tsconfig.test.json` exited 0 with no output.

### Self-review and open risks

The self-test makes removal or unblocking of `writeFileSync` a deterministic
failure. The oracle now catches all listed synchronous state reads and writes
after CLI module load. Node's bootstrap cannot itself be guarded because it
uses synchronous filesystem calls to locate and load the entry module; the
guard begins before `main()` and therefore before help recognition or any
handler code. The exhaustive process suite remains about 26 seconds on this
Windows worktree.

### Commit

- `dfb45f92dbb16859ca4f75be818051b00e151d0e` — `test: block synchronous help side effects`

## Fix round 3/5

### Files changed in this round

- `src/cli.ts`
- `test/cli-subcommand-help.test.ts`
- `.superpowers/sdd/2026-08-18-eve-governed-production-release/task-1-report.md`

### What changed

- The oracle is once again installed by the Node preload hook, before the CLI
  entry module and every transitive import are evaluated. The direct CLI
  entrypoint executes unchanged, so the temporary `main()` export introduced
  in fix round 2 was removed.
- The preload blocks mutation-capable `node:fs` callback, sync, and promises
  APIs; writable descriptor acquisition; subprocess APIs; and socket, DNS,
  HTTP(S), TLS, datagram, and fetch APIs. Read-only module-loader/import probes
  remain permitted. `openSync` has a narrowly stack-gated exception for Node's
  own module loader, which otherwise cannot load ESM source after a preload.
- Added a focused fixture module whose top-level code calls `writeFileSync`.
  Running it under the preload oracle must fail before it can create its
  target, proving coverage starts before a transitive module evaluates.

### Covering tests

- `test/cli-subcommand-help.test.ts`
- `test/cli-entrypoint.test.ts` (focused existing normal entrypoint/parser
  behavior)

### RED

Command:

```text
npx tsc -p tsconfig.test.json; if ($LASTEXITCODE -eq 0) { node --test --test-concurrency=1 --test-name-pattern="transitive module loading" dist-test/test/cli-subcommand-help.test.js }
```

Output tail:

```text
✖ the preload oracle rejects synchronous writes during transitive module loading
AssertionError [ERR_ASSERTION]: load-time synchronous write bypassed the preload oracle
```

### GREEN / targeted verification

Commands:

```text
npx tsc -p tsconfig.test.json
node --test --test-concurrency=1 dist-test/test/cli-subcommand-help.test.js
node --test --test-concurrency=1 --test-name-pattern="entrypoint guard|root parser" dist-test/test/cli-entrypoint.test.js
```

Output tails:

```text
✔ dedicated help inventory exactly matches main's dispatch switch (5.3414ms)
✔ the help oracle rejects representative synchronous filesystem writes (73.107ms)
✔ the preload oracle rejects synchronous writes during transitive module loading (69.6296ms)
✔ every dispatched subcommand exits read-only for --help and -h (26040.7836ms)
✔ subcommand help grammar does not reinterpret unknown commands or option values (753.1226ms)
ℹ tests 5
ℹ pass 5
ℹ fail 0
ℹ duration_ms 27002.7865

✔ cli.ts's entrypoint guard still runs main() when invoked through a symlinked/junctioned directory (Unix bin-symlink regression) (352.4236ms)
✔ root parser retains authority connection values required by the existing connection contract (0.8465ms)
ℹ tests 2
ℹ pass 2
ℹ fail 0
ℹ duration_ms 720.3992
```

`npx tsc -p tsconfig.test.json` exited 0 with no output.

### Self-review and open risks

The process execution window is closed from preload through CLI termination:
transitive-import mutation, handler mutation, subprocess starts, and network
starts each raise an oracle violation. Necessary read-only Node loader/import
operations remain allowed by design; `openSync` is stack-gated to
`node:internal/modules/` so an application call cannot use its loader path.
The suite remains intentionally process-comprehensive and takes about 27
seconds on this Windows worktree.

### Commit

- `ac52fc76bc4aebeac83038de286ef9a6118bc2ab` — `test: guard cli module initialization`

## Fix round 4/5

### Files changed in this round

- `test/cli-subcommand-help.test.ts`
- `.superpowers/sdd/2026-08-18-eve-governed-production-release/task-1-report.md`

### What changed per file

- `test/cli-subcommand-help.test.ts`: replaced the bypassable filesystem and
  subprocess wrapper deny-lists with Node 24's permission boundary
  (`--permission --allow-fs-read=*`), which keeps imports readable while
  denying filesystem writes, child processes, native addons, and
  `process.binding`. Replaced the convenience-only network list with denial at
  the lowest application-callable surfaces remaining under permissions:
  `net.Socket`/`net.Server`, `tls.TLSSocket`, `dgram.Socket`, callback and
  promises DNS module/resolver APIs (including `resolveTlsa`), and `fetch`.
  Added a real module-evaluation escape matrix covering writable `openSync`,
  `fs/promises.mkdtempDisposable`, `execSync`, `execFileSync`, direct TCP/TLS/
  datagram sockets, DNS promises lookup and both TLSA forms, and fetch. Network
  probes use only loopback targets.
- `.superpowers/sdd/2026-08-18-eve-governed-production-release/task-1-report.md`:
  added this round-4 implementation, TDD, verification, and risk record.

### TDD evidence

RED command:

```text
npx tsc -p tsconfig.test.json; if ($LASTEXITCODE -eq 0) { node --test --test-concurrency=1 --test-name-pattern="low-level network escape paths" dist-test/test/cli-subcommand-help.test.js }
```

RED output tail after correcting the probe itself to run as CommonJS:

```text
✖ the help oracle closes filesystem, subprocess, and low-level network escape paths (158.3953ms)
AssertionError [ERR_ASSERTION]: promises mkdtempDisposable bypassed the help oracle:
REELIER_HELP_ORACLE_ESCAPE
REELIER_HELP_ORACLE_MAX_RSS_KIB=60064

0 !== 23
```

GREEN focused command:

```text
npx tsc -p tsconfig.test.json; if ($LASTEXITCODE -eq 0) { node --test --test-concurrency=1 --test-name-pattern="low-level network escape paths" dist-test/test/cli-subcommand-help.test.js; if ($LASTEXITCODE -eq 0) { node --test --test-concurrency=1 --test-name-pattern="entrypoint guard|root parser" dist-test/test/cli-entrypoint.test.js } }
```

GREEN output tail:

```text
✔ the help oracle closes filesystem, subprocess, and low-level network escape paths (770.8154ms)
ℹ tests 1
ℹ pass 1
ℹ fail 0
ℹ duration_ms 834.2359
✔ cli.ts's entrypoint guard still runs main() when invoked through a symlinked/junctioned directory (Unix bin-symlink regression) (346.4266ms)
✔ root parser retains authority connection values required by the existing connection contract (0.6967ms)
ℹ tests 2
ℹ pass 2
ℹ fail 0
ℹ duration_ms 712.5064
```

### Final verification

Command:

```text
npx tsc -p tsconfig.test.json; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; node --test --test-concurrency=1 dist-test/test/cli-subcommand-help.test.js; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; node --test --test-concurrency=1 --test-name-pattern="entrypoint guard|root parser" dist-test/test/cli-entrypoint.test.js
```

`npx tsc -p tsconfig.test.json` exited 0 with no output. Test output tail:

```text
✔ dedicated help inventory exactly matches main's dispatch switch (6.0038ms)
✔ the help oracle closes filesystem, subprocess, and low-level network escape paths (803.6322ms)
✔ every dispatched subcommand exits read-only for --help and -h (26001.3638ms)
✔ subcommand help grammar does not reinterpret unknown commands or option values (712.0532ms)
ℹ tests 4
ℹ suites 0
ℹ pass 4
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 27587.5495
✔ cli.ts's entrypoint guard still runs main() when invoked through a symlinked/junctioned directory (Unix bin-symlink regression) (339.2605ms)
✔ root parser retains authority connection values required by the existing connection contract (0.7241ms)
ℹ tests 2
ℹ suites 0
ℹ pass 2
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 686.3747
```

### Deviations from plan

None. The existing `src/cli.ts` early exit and `CHANGELOG.md` entry already
matched the approved behavior, so round 4 changed only the dedicated test and
this required report.

### Self-review

The permission boundary removes the round-3 stack inspection and API coverage
maintenance burden for filesystem and subprocess effects. Under that boundary,
application code cannot reach `process.binding` or native addons to get beneath
the patched network prototypes. The retained exhaustive matrix still checks
command parity, exact sole-help-token grammar, exit 0, usage output, scrubbed
credentials/configuration, 1.5-second per-process timeout, and peak RSS below
256 MiB. The escape probes run as the evaluated entry module, so their write,
process, and network attempts occur at module-evaluation time.

### Open risks

- Network denial is necessarily a Node-runtime oracle because Node 24's
  permission model has no network permission. The self-test therefore pins all
  currently application-callable low-level TCP/TLS/datagram/DNS/fetch paths;
  a future Node release adding a new network primitive must extend this matrix.
- The comprehensive Windows process matrix remains intentionally slow at about
  28 seconds.

### Commits

- `e33d133a` — `test: expose help oracle escape paths`
- `132345f8` — `test: close help oracle escape paths`
