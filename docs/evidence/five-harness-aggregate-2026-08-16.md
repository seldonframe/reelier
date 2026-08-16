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
| Eve | Hermetic public-MCP probe plus detached continuity capture and report | `fixture-only` / `not-tested` | Public semantic vector, continuity matrix, and focused cleanup | External Eve adapter execution, route coverage, provider outcome |
| Grok Build | Hermetic public-MCP probe; Grok Build CLI not installed or targetable | `fixture-only` / `not-tested` | Public semantic vector only | External Grok Build adapter execution, governed execution, completeness |
| Grok Bot | Hermetic public-MCP probe plus real session response and machine-checked capture | `fixture-only` / `not-tested` | Public semantic vector; external session honestly reported no local Reelier repository or adapter contract | External adapter execution, dispatch refusal, enforcement, coverage, outcome |

The Grok Bot capture is classified `observed-only` and is non-passing by design. Its response says
the session stopped without simulating evidence. The aggregate therefore preserves the distinction
between a real observation and a successful Reelier adapter execution.

The Codex and Claude Code observations are also non-passing by design. Codex performed a genuine
repository/init-up verification but did not invoke the shared semantic adapter. Claude Code
performed a genuine route/authority probe but the Authority Cell refused on Windows before the
semantic channel became callable. Neither observation upgrades the live adapter gate.

The disposable GitHub branch/readback/retry/protected-main test has not started. No disposable
repository and protected-branch target were supplied, and the real Reelier repository must not be
used as an inferred disposable target.

Verification in this pass:

- focused conformance: 54 passed, 0 failed;
- clean Linux suite with the Eve fixture installed and a real init process: 3,439 passed, 0 failed,
  8 skipped;
- the eight skips are explicit certified-artifact or platform-boundary skips, not promoted
  evidence.
