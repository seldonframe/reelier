# Codex observed capture — 2026-08-16

This is a genuine observation from the Codex task `01a001e8-b11f-7333-9717-a5cfcd8a09cf`,
which verified the `init + up` branch in a clean Linux container. It records 3,439 passing
tests, 0 failures, and 8 explicit skips at commit `9947854`.

It is deliberately an `observed` and non-passing candidate-capture artifact. The task did not
execute the shared Reelier semantic delegation vector through a Codex adapter, so it proves
neither governed Codex execution nor route enforcement. The aggregate must keep Codex
`executionStatus: not-tested`.
