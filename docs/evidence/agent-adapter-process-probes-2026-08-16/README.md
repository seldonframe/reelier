# Process-boundary Adapter Contract probes — 2026-08-16

These captures launch the Reelier Authority MCP ingress as a separate stdio
process and execute the shared semantic vector through the real MCP transport.
Every harness identity is bound to the same Adapter Contract v1 digest:

`sha256:7f46242b26d9c921f4e1ec9de6418ac5fc8c03d70c4415c25e799ae0e73a1512`

The vector discovers a job, loads it, requests a narrower child allocation,
submits an identity-free Outcome request, and observes the pending-contract
refusal. No provider dispatch or receipt is claimed.

These are adapter process-boundary captures, not proof that an external model
or cloud harness invoked the server. A harness becomes execution-proven only
when its own runtime connects to this server and its call transcript is bound
to the same evidence bundle.
