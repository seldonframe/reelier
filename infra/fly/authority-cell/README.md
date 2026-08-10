# Reelier Authority Cell on Fly

This directory is a reference topology, not a credential store. Deploy one Authority Cell per project with a separate durable ledger and an egress gateway. The agent runtime may reach its model endpoint and the Authority Cell, but it must not receive provider credentials or direct authenticated provider routes.

Before enabling managed dispatch, record the image, network policy, connector schema, and provider-surface digests in the signed deployment. Run `reelier authority certify preflight` and `reelier authority certify run --adapter fly-topology` from the Cell. Any topology change invalidates the evidence and current lease.

The reference manifest intentionally contains no tokens, OAuth grants, hostnames with embedded credentials, or provider response bodies.
