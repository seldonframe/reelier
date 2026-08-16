# Candidate capture v0

This boundary accepts the same detached JSON envelope from Codex, Claude Code, Eve, Grok Build,
and Grok Bot. It performs no network calls and accepts no transport configuration, URLs, headers,
or credentials. The harness exports a raw JSON candidate or report; an operator computes its exact
UTF-8 SHA-256 digest and submits both through `capture.schema.json`.

The envelope binds the harness and harness-instance digests to the canonical adapter and
adapter-instance digests, capture timestamps, evidence mode, artifact kind, and raw digest. A
candidate raw object identifies itself at `descriptor.agentHost` and `descriptor.adapterId`; a
report identifies its adapter at `adapterId` and, when present, its harness at `harnessId`. Existing
agent-adapter reports omit `harnessId`, so their harness identity is bound by the outer harness
instance, canonical harness-to-adapter mapping, and committed raw digest. Relabeling an identity,
changing the raw bytes, or changing committed capture metadata invalidates the binding.

`captureMode` has three values:

- `fixture`: local fixture material; always non-passing.
- `observed`: an observation not supplied as a live black-box candidate; always non-passing.
- `live-candidate`: a candidate actually supplied by the named harness instance. A fresh, valid
  envelope can pass this capture boundary only.

`evidenceMode` classifies the supplied artifact as `observed` or `enforced`. It is not upgraded by
the checker. Even a passing `live-candidate` report says only that a fresh, identity-bound candidate
was supplied. It does not prove semantic conformance, execution, route enforcement, traffic
completeness, outcome correctness, or production safety; those non-claims are machine-readable in
every output. An `enforced` label remains asserted, not verified, at this boundary.

Fresh captures use canonical UTC `capturedAt`, `freshUntil`, and `evaluatedAt` timestamps. The
freshness window must be positive and no longer than 24 hours; future-dated and stale captures are
rejected. Use `missingCandidate: true` when no candidate exists. That produces `not-tested`, with no
artifact or binding digest, and never fabricates candidate data.

Raw payloads are parsed only for identity and secret rejection and are never echoed into reports.
Credential-like field names and token-shaped values cause rejection; the checker does not silently
redact them. Remove secrets at the harness before capture. The output retains only artifact kind,
raw digest, identity binding digest, and its own integrity digest.

Run locally after compiling tests:

```text
node conformance/candidate-capture/v0/check.mjs <capture.json>
```

Exit code `0` means a live candidate passed this capture boundary, `1` is non-passing or invalid,
and `2` is missing CLI input. No package script is added by Task 5.
