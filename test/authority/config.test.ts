import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadAuthorityHostConfig } from "reelier/authority/host";

test("authority YAML accepts nested endpoint mappings", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-authority-config-"));
  const file = path.join(root, "authority.yml");
  await writeFile(file, [
    "version: 1", "tenant: tenant", "requester: operator", "definitions: []", "topology: same-user", "endpoints:",
    "  - endpointId: github", "    baseUrl: https://api.github.test", "    accountIdentity: acct", "    allowedMethods: [\"GET\"]", "    allowedPathPrefixes: [\"/repos\"]",
  ].join("\n"));
  const { config } = await loadAuthorityHostConfig(file);
  assert.equal(config.endpoints[0]?.endpointId, "github");
});
