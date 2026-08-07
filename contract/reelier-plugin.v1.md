# ReelierPluginV1

`reelier-plugin.v1.json` is the declarative plugin contract used by the local
bridge. It describes harness and runtime pins, supported model/provider names,
required MCP tools, configuration keys (names only), redaction fields,
verification hooks, fixtures, approval/rollback policy, execution locality,
and an optional content digest/signature. It never contains credentials or
executable Cloud adapter code.

The ordinary validator is suitable for local discovery. A plugin entering
reviewed Cloud certification must also pass
`validateReelierPluginForCertification`, which requires pinned runtime
metadata, Cloud eligibility, and an Ed25519 signature. Eve, Hermes, OpenClaw,
or another harness can therefore use the same contract without granting it
permission to execute on Reelier infrastructure.
