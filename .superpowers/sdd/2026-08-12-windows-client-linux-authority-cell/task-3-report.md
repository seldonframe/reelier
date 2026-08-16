Files changed

- `contract/client/v1/authority-cell-connection.schema.json`
- `docs/runbooks/authority-cell-client.md`
- `src/authority/client/config.ts`
- `src/authority/client/http.ts`
- `src/authority/cli.ts`
- `src/authority/host/config.ts`
- `src/authority/host/server.ts`
- `src/authority/ingress/http.ts`
- `test/authority/authority-cell-connection.test.ts`
- `test/authority/http.test.ts`
- `.superpowers/sdd/2026-08-12-windows-client-linux-authority-cell/task-3-report.md`

What changed per file

- `contract/client/v1/authority-cell-connection.schema.json`: added the closed local client-config schema in the separately authorized client namespace.
- `docs/runbooks/authority-cell-client.md`: documented local WSL, local Linux container, and remote/Fly starts plus configure/doctor commands.
- `src/authority/client/config.ts`: added exact-key, accessor-safe connection parser, URL/reference validation, canonicalization, and atomic local-only config writing.
- `src/authority/client/http.ts`: added client-private, inert-injectable token resolution and authenticated identity checking with redirects refused and redacted failure results.
- `src/authority/cli.ts`: added `authority connect`; `authority doctor --live` now reads the local connection and performs the live identity check.
- `src/authority/host/config.ts`, `src/authority/host/server.ts`, `src/authority/ingress/http.ts`: added a minimal authenticated, read-only `/v1/identity` response with only Cell ID and frozen Adapter Contract digest.
- `test/authority/authority-cell-connection.test.ts`: specified connect output/config, unsafe endpoint/accessor refusal, and redirect/redaction behavior.
- `test/authority/http.test.ts`: specified authenticated closed identity response.

Deviations from the plan and why

- The founder-locked Adapter Contract v1 was not modified. The orchestrator explicitly resolved the schema/ABI conflict by authorizing `contract/client/v1`, because local client configuration is substrate-neutral but not dispatch/wire ABI.
- The orchestrator also explicitly expanded ownership to the minimal HTTP ingress/server composition so a live doctor can authenticate and compare Cell ID and contract digest.

Test results (verbatim tail)

```
✔ authority connect writes only a normalized opaque client connection (11.7504ms)
✔ connection parser rejects unsafe URLs and never invokes accessors (0.78ms)
✔ live cell check refuses redirect and redacts token resolver failures (2.1902ms)
✔ authority REST exposes job search and load with host identity (60.4299ms)
✔ doctor decodes every mapped IPv6 private form before bearer dispatch (0.4226ms)
✔ connection writer refuses a symlinked parent before an outside write (3.5669ms)
ℹ tests 9
ℹ pass 9
ℹ fail 0
```

`npx tsc --noEmit` completed silently with exit code 0. `npm run build` completed successfully. The required direct TypeScript test command could not start because this worktree has no `tsx` package; its exact failure was `ERR_MODULE_NOT_FOUND: Cannot find package 'tsx'`. The compiled focused test command above is the passing fallback. `pnpm check:use-server` is unavailable in this repository: `Command "check:use-server" not found`.

Open risks

- The current process is Windows, so existing `host-server.test.ts` refuses at the intended Linux host gate; this task's focused ingress test uses the host-neutral ingress function and passes.
- Fix round 1: token files are now confined to `.reelier/credentials` by default or an injected explicit credential root; each ancestry component and the final file are checked with `lstat`, then canonical containment is checked with `realpath`. Symlinks/junctions and non-regular files refuse as an `absent` token reference without revealing content.
- Fix round 1: HTTPS endpoints resolve every address before bearer dispatch. Any non-public result refuses; the production connector pins the selected validated address through Node's request lookup callback and preserves TLS server name. Redirects are not followed.
- Fix round 1: doctor states are now `absent` for unavailable config/token material, `unchecked` for transport/identity availability failures, `failed` for authentication/malformed/mismatch/refused endpoint evidence, and `verified` for exact identity/digest.
- Fix round 2: IPv4-mapped IPv6 answers are decoded before the IPv4 public-address policy; config writer parent ancestry refuses symlinks/junctions before creating or writing its temporary file.
- Fix round 3: configuration metadata is explicitly non-authorizing. Native Windows same-user mutation resistance remains `unchecked`; no native-helper TCB was introduced. Expanded, compressed, hexadecimal, and dotted IPv4-mapped IPv6 forms now decode through the IPv4 deny policy.
- Consequential request construction is not introduced by this task; the server continues to derive requester/session context from authenticated ingress. Future client dispatch code must consume the verified live result before sending consequential requests.

## Fix round 4/5 — remaining Windows client and mapped-address findings

Commits:

- `3128f6e test(authority): expose Windows client output gaps` — RED tests committed before production changes.
- `185c575 fix(authority): close Windows client connection gaps` — structural mapped-IP parsing, Windows output contract, and runbook.
- `24fc977 fix(authority): make Windows client path portable` — explicit Windows path semantics and stronger bearer-resolution regression assertion.

The RED run compiled successfully and then failed 5 of 12 focused tests for the expected missing behavior: no `pathnameConfinement` result, a workspace-relative Windows default path, acceptance of Windows `--path`, an expanded dotted mapped DNS answer reaching the request seam, and a bracketed expanded dotted mapped literal reaching endpoint-address handling instead of being rejected before token resolution.

The client now parses IP literals structurally through Node's IP parser and canonical URL form, expands IPv6 to eight words, recognizes the mapped prefix, decodes the embedded IPv4, and applies the existing IPv4 deny policy. The same decoder is used for DNS answers and literal endpoints; no mapped-address spellings are enumerated. The bracketed literal test also proves the bearer resolver and request callback are both untouched.

Native Windows now derives the sole default output from `%LOCALAPPDATA%\Reelier\authority-cell-connection.json`, with a closed fallback to the current user's `AppData\Local` directory. `authority connect --path` refuses before writing on Windows. The platform, environment, and home-directory substitutions are private runtime/test inputs rather than CLI/config/body data, and tests do not mutate global process state. Connect and live-doctor results expose `pathnameConfinement: "unchecked"`; the implementation deliberately claims no same-user pathname authority on any client platform. The saved configuration remains the existing closed six-field public metadata object and cannot carry task, principal, grant, allocation, or session authority.

Focused GREEN evidence before the implementation commit:

```
ℹ tests 14
ℹ pass 14
ℹ fail 0
```

`npx tsc -p tsconfig.test.json --pretty false`, `npm run check:authority-contract`, `npm run build`, and `git diff --check` all exited 0. No native helper was added. Unrelated `.gitignore`, `native/`, `rust-toolchain.toml`, `.tmp-pack/`, and certification changes were left unstaged and untouched.

## Fix round 5/5 — endpoint validation before bearer-token access

Commits:

- `7e9ba4d test(authority): expose preflight token resolution` — strict RED regression tests.
- `e401614 fix(authority): validate endpoint before token access` — minimal GREEN reorder and explicit safe-address fixtures for token-state tests.

The RED run compiled successfully and failed 2 of 13 focused tests for the intended missing behavior. A private DNS answer and a mapped IPv6 private answer each produced `tokenResolverCalls === 1` while `requestCalls === 0`. Mixed public/private DNS was covered by the same regression loop. Unsafe IPv4, IPv6, and expanded dotted mapped literals already passed the required `tokenResolverCalls === 0` and `requestCalls === 0` invariant because the closed connection parser rejects them before live checking.

`checkAuthorityCellLive` now parses the closed public connection, resolves and classifies every endpoint address, and returns `failed/endpoint-address-refused` for an empty, private, mixed, or private-mapped result before resolving token material. Only an all-safe address set can reach bearer-token resolution and the pinned/request-injected identity request. Existing token-unavailable and symlink-token tests now explicitly establish a safe public address first, preserving the honest `absent/token-unavailable` state and redaction semantics after the ordering change.

Fresh final verification after the GREEN commit:

```
focused client tests: 13 passed, 0 failed
npx tsc --noEmit --pretty false: exit 0
npm run check:authority-contract: exit 0
npm run build: exit 0
```

`git diff --check` for the owned implementation and focused test files exited 0 before the GREEN commit. Unrelated `.gitignore`, `native/`, `rust-toolchain.toml`, `.tmp-pack/`, and certification changes remained unstaged and untouched.
