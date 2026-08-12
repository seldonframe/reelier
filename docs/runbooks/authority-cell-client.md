# Linux Authority Cell client connection

The Authority Cell runs on Linux. Windows runs the client and retains only an endpoint, an opaque token reference, the expected Cell ID, and the frozen Adapter Contract digest. The connection file never contains the token value.

This file is public, non-secret, and non-authorizing metadata: it is never evidence of a safe Cell or authority to dispatch. On native Windows its same-user path-mutation resistance is `unchecked`; token-file ancestry remains fail-closed. Every consequential action still requires independently resolved credentials plus authenticated exact Cell ID and frozen Adapter Contract digest.

After a Cell endpoint and token reference exist, configure the client with one command:

```powershell
reelier authority connect --endpoint https://cell.example --token-ref env:REELIER_CELL_TOKEN --cell-id cell_linux_1 --adapter-contract-digest sha256:<frozen-adapter-contract-digest>
reelier authority doctor --live --connection .reelier/authority-cell-connection.json
```

For local WSL, run the Cell inside WSL and expose only a loopback listener such as `http://127.0.0.1:<port>`; loopback HTTP is the sole non-HTTPS client exception. For a local Linux container, publish its listener only to `127.0.0.1` and use the same loopback endpoint. For a remote Linux or Fly Cell, use its HTTPS endpoint.

`doctor --live` authenticates before reading the closed Cell identity response, then requires exact Cell ID and Adapter Contract digest matches. Redirects and resolver errors are refused without exposing bearer values. A digest mismatch is incompatible for consequential dispatch; status, export, and offline verification remain available.
