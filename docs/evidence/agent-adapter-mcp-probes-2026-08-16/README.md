# Hermetic public-MCP probes — 2026-08-16

These five bundles run the same public Reelier Authority MCP semantic vector under each harness
identity: Codex, Claude Code, Eve, Grok Build, and Grok Bot.

They are not captures from those external applications. The runner uses an in-memory MCP transport
against Reelier's public authority host, so the bundles prove that the shared channel is callable,
that job discovery is dynamic, that delegation attenuates, and that the pending Adapter Contract
refuses dispatch. Each candidate is deliberately `fixture-only`; each candidate capture is
deliberately non-passing (`live-candidate-observed`).

The aggregate report is therefore expected to be `failed` with every harness marked
`executionStatus: not-tested`. An external harness can replace one candidate only by submitting
its own machine-checked transcript through the same boundary.
