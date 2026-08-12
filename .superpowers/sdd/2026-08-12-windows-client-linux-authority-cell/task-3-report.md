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
✔ doctor refuses private DNS answers before bearer dispatch (0.3437ms)
ℹ tests 7
ℹ pass 7
ℹ fail 0
```

`npx tsc --noEmit` completed silently with exit code 0. `npm run build` completed successfully. The required direct TypeScript test command could not start because this worktree has no `tsx` package; its exact failure was `ERR_MODULE_NOT_FOUND: Cannot find package 'tsx'`. The compiled focused test command above is the passing fallback. `pnpm check:use-server` is unavailable in this repository: `Command "check:use-server" not found`.

Open risks

- The current process is Windows, so existing `host-server.test.ts` refuses at the intended Linux host gate; this task's focused ingress test uses the host-neutral ingress function and passes.
- Fix round 1: token files are now confined to `.reelier/credentials` by default or an injected explicit credential root; each ancestry component and the final file are checked with `lstat`, then canonical containment is checked with `realpath`. Symlinks/junctions and non-regular files refuse as an `absent` token reference without revealing content.
- Fix round 1: HTTPS endpoints resolve every address before bearer dispatch. Any non-public result refuses; the production connector pins the selected validated address through Node's request lookup callback and preserves TLS server name. Redirects are not followed.
- Fix round 1: doctor states are now `absent` for unavailable config/token material, `unchecked` for transport/identity availability failures, `failed` for authentication/malformed/mismatch/refused endpoint evidence, and `verified` for exact identity/digest.
- Consequential request construction is not introduced by this task; the server continues to derive requester/session context from authenticated ingress. Future client dispatch code must consume the verified live result before sending consequential requests.
