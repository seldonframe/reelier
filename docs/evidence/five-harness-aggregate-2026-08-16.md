# Five-harness aggregate — 2026-08-16

The aggregate semantic matrix was rerun from the explicit manifest at
`docs/evidence/agent-adapter-mcp-probes-2026-08-16/manifest.json`. The public Reelier MCP
authority channel was exercised hermetically for all five harness identities, and every semantic
vector passed. The aggregate remains `failed` intentionally: those probes prove the public channel
and pre-freeze refusal semantics, not that the corresponding external harness dispatched through
that channel.

| Harness | Evidence attached | Aggregate status | What is proved | What remains unproved |
| --- | --- | --- | --- | --- |
| Codex | Hermetic public-MCP probe plus genuine Codex init/up observation | `observed-only` / `not-tested` | Public semantic vector; real Codex Linux init/up run and suite result | Codex semantic adapter execution, governed execution, route completeness |
| Claude Code | Hermetic public-MCP probe plus genuine live route/authority observation | `observed-only` / `not-tested` | Public semantic vector; real route inventory and Linux-only refusal | Claude Code semantic adapter execution, governed execution, route completeness |
| Eve | Hermetic public-MCP probe, detached continuity capture, and real Eve 0.37.1 process/tool-loop capture | `process-boundary` / `not-tested` | Shared contract binding, dynamic job discovery/load, attenuated delegation, authenticated Path C dispatch, one reservation, one verified receipt, and status read | External Eve-host adapter coverage and production topology; semantic matrix remains non-passing because this evidence is not the v0 candidate surface |
| Grok Build | Hermetic public-MCP probe; Grok Build CLI not installed or targetable | `fixture-only` / `not-tested` | Public semantic vector only | External Grok Build adapter execution, governed execution, completeness |
| Grok Bot | Hermetic public-MCP probe plus real session response and machine-checked capture | `fixture-only` / `not-tested` | Public semantic vector; external session honestly reported no local Reelier repository or adapter contract | External adapter execution, dispatch refusal, enforcement, coverage, outcome |

The Grok Bot capture is classified `observed-only` and is non-passing by design. Its response says
the session stopped without simulating evidence. The aggregate therefore preserves the distinction
between a real observation and a successful Reelier adapter execution.

The Codex and Claude Code observations are also non-passing by design. Codex performed a genuine
repository/init-up verification but did not invoke the shared semantic adapter. Claude Code
performed a genuine route/authority probe but the Authority Cell refused on Windows before the
semantic channel became callable. Neither observation upgrades the live adapter gate.

The process-boundary probes for all five identities now exist under
`docs/evidence/agent-adapter-process-probes-2026-08-16/`. They all bind the same frozen Adapter
Contract v1 digest and pass the local refusal vector. They do not prove that Codex, Claude Code,
Eve, Grok Build, or Grok Bot themselves invoked the server. Codex's desktop task confirmed the
configured MCP server was not dynamically registered; Grok Build remains unavailable locally; and
the real Grok Bot capture remains an explicit unsupported/not-tested result.

The disposable GitHub branch/readback/retry/protected-main test has not started. The approved
target is `fixlyai/soloproof`; its `main` branch currently has no protection, so branch push/readback
can be tested first and protected-main requires an explicit repository protection setup.

Verification in this pass:

- focused conformance: 54 passed, 0 failed;
- clean Linux suite from the conformance worktree: 3,427 passed, 5 failed, 8 skipped. The failures
  are authority bootstrap readiness, two ledger/process-isolation timing cases, Eve package/native
  process startup/cleanup cases, and are not promoted to adapter success.
- a corrected clean-install attempt rebuilt Reelier before installing the Eve fixture, fixing the
  `reelier/continuity` package-resolution error; the Eve process-boundary matrix then exceeded its
  bounded runtime and the isolated live-contract attempt failed Eve health startup in Docker.
- the Windows-host Eve capture is independently machine-checked and passed; Linux reproducibility
  remains blocked by the explicit process startup/cleanup failures above.
