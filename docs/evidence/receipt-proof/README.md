# Agent receipt proof bundle

This public bundle supports the canonical Reelier evidence page, [What does an agent receipt prove?](https://www.reelier.com/evidence/what-agent-receipt-proves). It preserves the executable reproduction, the observed facts, and the exact retained receipt as independently inspectable files.

## Contents

- [Executable reproduction](EXECUTABLE-PROOF.md) — rerun the released package against immutable skill bytes.
- [Proof observation](PROOF-OBSERVATION.md) — the bounded facts observed during the retained run.
- [Retained receipt](PROOF-RECEIPT.jsonl) — the exact JSONL record, SHA-256 `0f5830b6b2b526a31ef0f8133553c3c1d8d02b3d0458a35d306853d127f9bfe1`.

## Evidence boundary

The retained local receipt is unsigned and untimestamped. It supports claims about the present fields in this one record. It does not prove safety, semantic correctness, or completeness of observation. It also does not prove authorship, intent, authorization in another system, trusted execution time, active policy, or a write-state delta.

The reproduction pins `reelier@0.32.0`, its npm package integrity, the immutable source commit for the skill, and the skill SHA-256. These pins make the experiment repeatable; they do not widen what the receipt claims.
