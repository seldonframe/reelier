### Task 3: Add provider-neutral MCP, HTTP/OpenAPI, and CLI transport adapters

**Files:**

- Create `src/authority/host/effect-transports.ts`.
- Modify `src/authority/host/outcome-kernel.ts` only to make stored `pending` Outcomes in recoverable ledger states continue through authoritative reconciliation; terminal Outcome adoption remains unchanged.
- Modify `src/authority/host/index.ts`.
- Create `test/authority/effect-transports.test.ts`.
- Create `test/authority/fixtures/tool-effect-contracts.ts`.
- Create `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-3-report.md`.

**Requirements:**

Implement closed transport ports for MCP tool calls, reviewed HTTP/OpenAPI calls, and fixed CLI argv/env execution. Compilation accepts only fields named in the signed effect contract; host-owned fields and credentials are injected after model input validation and are excluded from evidence. CLI forbids shell strings and uses executable plus argv; HTTP binds method, origin, path template, request schema digest, and response projection; MCP binds server/tool/schema digests. Trusted port implementations serialize provider responses before delivering them through a host-owned result sink; the host never awaits or inspects a caller-controlled port return root. Create three deliberately unrelated hermetic contracts - a Slack-like message, a Calendar-like event, and a Slides-like document update - and prove all run through the same generic Task 2 kernel, including its minimal generic correction that lets stored pending Outcomes in recoverable states reach authoritative reconciliation. Include ambiguity/readback, conflict, no-readback=`absent`, delayed=`partial`, and credential-leak tests.
