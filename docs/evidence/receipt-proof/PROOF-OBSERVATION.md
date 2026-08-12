# Proof observation - released Reelier 0.32.0

## Retained observed facts

The released package was `reelier@0.32.0`, with SRI `sha512-XFrsLKdPuw7R0+gNcvduUIHDj2RE4m9j6eLgmRPKLOKS+Z1SiQEj0sLEmIkxaUujoM8NUfyzeUgIOXL1kAihrQ==`. The retained skill came from commit `bd44bf81bbd41915543fb647f433ddb386cc6a1d` at `examples/registry-seeds/httpbin-echo-check.skill.md`.

The local run started at `2026-08-11T21:27:50.400Z..2026-08-11T21:27:50.590Z`. `npx --yes reelier@0.32.0 --version` exited 0 and printed `0.32.0`. The run exit code: 0 and printed `PASSED: 1/1 steps ok`; local verification verify exit code: 0 and printed `No present claim failed verification.` The receipt's startedAt and finishedAt are local-clock receipt fields, not a trusted timestamp.

The retained raw `PROOF-RECEIPT.jsonl` contains one receipt record. It records `skill: httpbin-echo-check`, `passed: true`, `step title: Echo check via httpbin`, `step outcome: passed`, `failures: []`, `policy.status: absent`, `passedSteps: 1`, `unchecked: 0`, `llmInputTokens: 0`, and `llmOutputTokens: 0`. Its `skillContentSha256` is `04748fc814f8a983f941ea2f97e66a6f38ba472e62bab0fe2cbd774a8dfc49df`; the receipt SHA-256 is `0f5830b6b2b526a31ef0f8133553c3c1d8d02b3d0458a35d306853d127f9bfe1`.

The retained skill contains three skill assertions. The observed local receipt is unsigned and untimestamped. This is an initial pre-publication validator snapshot only; post-review or measurement requires a preserved reviewed snapshot or separate workflow, and this pack does not change review or measurement state. This does not establish safety, semantic correctness, complete observation, authorship, trusted execution time, active policy, or a write-state delta.
