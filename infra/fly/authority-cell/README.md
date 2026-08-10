# Reelier Authority Cell on Fly

This directory is a reference topology, not a credential store. Deploy one Authority Cell per project with a separate durable ledger and an egress gateway. The agent runtime may reach its model endpoint and the Authority Cell, but it must not receive provider credentials or direct authenticated provider routes.

Deploy from the repository root so the manifest can build the root `Dockerfile`. Supply the app name explicitly, create the `reelier_authority_data` volume first, and place `authority.yml` plus the ignored operator configuration on that volume. The process starts authenticated HTTP on port 8080. The host refuses a non-loopback bind unless `authority.yml` contains an ingress `bearerRef` that resolves only inside the Cell.

Do not treat the environment declarations in the manifest as topology proof. The managed release remains blocked until active probes verify the deployed image, actual Fly network-policy digest, credential mounts, Cell-versus-agent provider reachability, raw-write routes, and read coverage.

The three `*.network-policy.json` files are the canonical reference policies. Applying any egress rule makes unmatched egress default-deny on Fly. The agent and Cell policies intentionally omit TCP 443; their external traffic must traverse a separately authenticated Fly Proxy/Flycast gateway. Only the egress-gateway policy permits public HTTPS. Apply policies through Fly's Machines API, restart the Machines as Fly requires, fetch the deployed policies back, and bind `digestFlyNetworkPolicies(...)` over that read-back into topology evidence. A local file digest is not deployment evidence.

Before enabling managed dispatch, record the image, network policy, connector schema, and provider-surface digests in the signed deployment. Run `reelier authority certify preflight` and `reelier authority certify run --adapter fly-topology` from the Cell. Any topology change invalidates the evidence and current lease.

The reference manifest intentionally contains no tokens, OAuth grants, hostnames with embedded credentials, or provider response bodies.
