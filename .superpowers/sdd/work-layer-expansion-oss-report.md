Files changed

- contract/reelier-plugin.v1.json
- src/plugin.ts
- src/bridge.ts
- src/bridge-client.ts
- src/cli.ts
- test/plugin.test.ts
- test/bridge.test.ts
- .superpowers/sdd/work-layer-expansion-oss-report.md

What changed per file

- `contract/reelier-plugin.v1.json`: strict declarative ReelierPluginV1 schema.
- `src/plugin.ts`: typed manifest and closed validation/parser.
- `src/bridge.ts`: localhost bridge with capabilities, nonce-gated recommendation/work-card endpoints, CORS preflight, safe MCP/harness inventory, discovery integration, and privacy sanitization.
- `src/bridge-client.ts`: localhost-only client with capabilities nonce handshake.
- `src/cli.ts`: `reelier bridge --port <port>` with default port 4777 and help/dispatch wiring.
- `test/plugin.test.ts`: manifest acceptance and rejection coverage.
- `test/bridge.test.ts`: health, nonce, capabilities, CORS, recommendation sanitization, and work-card sanitization coverage.
- `.superpowers/sdd/work-layer-expansion-oss-report.md`: this structured handoff report.

Deviations from plan and why

- None. The bridge exposes only the planned `/v1/capabilities`, `/v1/recommend`, and `/v1/work-card` API routes; generated plugin packages were not modified and remain MCP-free.

Test results (verbatim tail)

```
ℹ tests 12
ℹ suites 0
ℹ pass 12
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 815.5113
```

Additional verification: `npx tsc --noEmit` exited 0; the broader filtered repository run reported 1663 passing, 0 failing, 1 skipped; `npm run build` exited 0; `git diff --check` exited 0.

Open risks

- The bridge inventory reports known local MCP configuration locations and Reelier-supported transcript harnesses; it intentionally does not claim complete host/plugin coverage.
- CORS defaults to localhost origins and can be narrowed or extended through `BridgeOptions`; the nonce remains required for POST requests.
