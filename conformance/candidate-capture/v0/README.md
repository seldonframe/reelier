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

`captureMode` has three values, all non-passing in v0:

- `fixture`: local fixture material; always non-passing.
- `observed`: an observation not supplied as a live black-box candidate; always non-passing.
- `live-candidate`: a candidate asserted to have been supplied by the named harness instance. A
  fresh, valid envelope is classified as live-candidate evidence, but the standalone capture report
  remains `failed` because this boundary cannot authenticate the supplier or prove execution.

`evidenceMode` classifies the supplied artifact as `observed` or `enforced`. It is not upgraded by
the checker. A valid `live-candidate` report says only that a fresh, identity-bound candidate was
supplied to this boundary. It does not prove semantic conformance, execution, route enforcement, traffic
completeness, outcome correctness, or production safety; those non-claims are machine-readable in
every output. An `enforced` label remains asserted, not verified, at this boundary.

The input carries canonical UTC `capturedAt` and `freshUntil` timestamps. It cannot supply
`evaluatedAt`: the checker records trusted current UTC time at runtime and evaluates freshness
against that time. The freshness window must be positive and no longer than 24 hours; backdated
replays, future-dated captures, invalid timestamps, and stale captures become explicit failed
`invalid-candidate` reports. Deterministic clock entry points are named test-only helpers and are
not used by the CLI. Use `missingCandidate: true` only when no candidate exists. That produces
`not-tested`, with no artifact or binding digest, and never fabricates candidate data.

Raw payloads are parsed only for identity and secret rejection and are never echoed into reports.
URL, URI, endpoint, transport, protocol, host, port, socket, connection, header, cookie, auth, token,
secret, password, API-key, access-key, and credential field-name variants are rejected recursively.
The required candidate identity field `descriptor.agentHost` is the only host-key exception. Any
`scheme://` value, connection URI, and common `Basic`, `Bearer`, `sk-`, `ghp_`, `xox`, `npm_`,
`eyJ`, credential-assignment, private-key, or AWS-key form is also rejected recursively. The checker
does not silently redact them. Remove transport data and secrets at the harness before capture. For
a supplied invalid artifact, the output retains at most its kind and a checker-computed raw digest;
it never retains the raw payload. Valid semantic reports with none of those fields remain accepted
at this non-passing boundary and retain only artifact kind, raw digest, identity binding digest, and
their own integrity digest.

Malformed, stale, identity-mismatched, digest-mismatched, and secret-bearing supplied inputs emit
`status: "failed"`, `classification: "invalid-candidate"`, and a specific reason code. They never
fall through to `candidate-missing` or `not-tested`. The closed standalone v0 report schema admits
no `passed` status and binds each classification to its allowed identity, capture mode, evidence
mode, freshness, artifact, binding, and non-claim shape.

Run locally after compiling tests:

```text
node conformance/candidate-capture/v0/check.mjs <capture.json>
```

Exit code `1` means supplied evidence or the invocation was classified non-passing or invalid, and
`2` means no candidate path argument was supplied. Extra arguments are invalid-candidate, never
candidate-missing. Candidate capture v0 has no exit-code-0 report. No package script is added by
Task 5.
