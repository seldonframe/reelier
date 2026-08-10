import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("Fly certification secret import uses masked input and stdin rather than arguments or files", async () => {
  const script = await readFile(path.resolve("scripts/import-fly-certification-secret.ps1"), "utf8");
  assert.match(script, /Read-Host[^\r\n]+-AsSecureString/);
  assert.match(script, /RedirectStandardInput\s*=\s*\$true/);
  assert.match(script, /secrets import --stage --app/);
  assert.match(script, /ZeroFreeBSTR/);
  assert.doesNotMatch(script, /secrets set|Set-Content|Out-File|WriteAllText/);
  assert.doesNotMatch(script, /Write-(?:Host|Output)[^\r\n]*\$plain/);
});

test("Fly certification secret import accepts only the certified provider reference names", async () => {
  const script = await readFile(path.resolve("scripts/import-fly-certification-secret.ps1"), "utf8");
  const names = [
    "REELIER_GITHUB_TOKEN",
    "REELIER_VERCEL_TOKEN",
    "REELIER_NEON_API_KEY",
    "REELIER_NEON_DATABASE_URL",
    "REELIER_CLOUDFLARE_TOKEN",
    "REELIER_SLACK_TOKEN",
    "REELIER_HUBSPOT_TOKEN",
  ];
  for (const name of names) assert.match(script, new RegExp(`\\b${name}\\b`));
  assert.match(script, /ValidatePattern\("\^\[a-z0-9\]\[a-z0-9-\]\{0,62\}\$"\)/);
  const probe = JSON.parse(await readFile(path.resolve("infra/fly/authority-cell/authority-cell.topology-probe.json"), "utf8"));
  assert.deepEqual([...probe.providerCredentialEnvNames].sort(), [...names].sort());
});
