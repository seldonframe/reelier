# Outcome Pack v0

Packs are reviewed, statically bundled first-party code. They have no credentials, network, filesystem, environment, clock, randomness, arbitrary runtime JavaScript, or third-party runtime ABI.

A pack may emit only a registered endpoint ID, exact relative path/query, allowed non-secret headers, exact body bytes, risk class, preconditions, idempotency strategy, and reconciliation recipe. It cannot emit authorization, cookie, host, absolute URL, credential material, or mutable template substitutions. The host injects credentials only after the gate accepts a sealed effect.

The immutable contract, not host-local mutable configuration, binds the target connector/account, definition and pack digests, source resolver/projection/read endpoints, resolver freshness ceiling, risk classes, quantitative limits, delegation leaf, and exact tenant-policy commitment. The static first-party definition owns the committed policy schema and interprets its exact JCS bytes. Trust roots, activation/revocation history, endpoint implementations, resolver implementations, and credentials remain host-local.

Static source resolvers are pure two-stage functions: `plan` returns endpoint IDs and opaque handles, then `project` receives only kernel-indexed plans and copied immutable Base64 observations. Resolver code cannot choose provenance digests, tenant/definition/schema authority, observation time, or freshness. The kernel constructs the closed plural SourceBundle and requires exact one-to-one claim ownership for every projection leaf. The same source restrictions as pack compilation apply to both callbacks: no credentials, network, filesystem, environment, clock, randomness, or dynamic code loading.

V1 delegation applies fixed-window attenuation: a descendant's `windowSeconds` must remain exactly equal to its parent's value. `maxEffectsPerWindow`, `maxEffectsPerSourceTrigger`, and `maxBodyBytes` may remain equal or decrease, never increase. Task 2 validates these parent/child comparisons; packs receive only authority that has passed that validation.

This v0 document is not a public pack ABI. A public build-time ABI is frozen only after two packs pass common conformance.
