# Outcome Pack v0

Packs are reviewed, statically bundled first-party code. They have no credentials, network, filesystem, environment, clock, randomness, arbitrary runtime JavaScript, or third-party runtime ABI.

A pack may emit only a registered endpoint ID, exact relative path/query, allowed non-secret headers, exact body bytes, risk class, preconditions, idempotency strategy, and reconciliation recipe. It cannot emit authorization, cookie, host, absolute URL, credential material, or mutable template substitutions. The host injects credentials only after the gate accepts a sealed effect.

The immutable contract, not host-local mutable configuration, binds the target connector/account, definition and pack digests, source resolver/projection/read endpoints, risk classes, quantitative limits, delegation leaf, and exact tenant-policy commitment. The static first-party definition owns the committed policy schema and interprets its exact JCS bytes. Trust roots, activation/revocation history, endpoint implementations, resolver implementations, and credentials remain host-local.

This v0 document is not a public pack ABI. A public build-time ABI is frozen only after two packs pass common conformance.
