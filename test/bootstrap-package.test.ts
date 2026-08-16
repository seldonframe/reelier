import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as bootstrap from "../src/bootstrap/index.js";

const RUNTIME_EXPORTS = [
  "BOOTSTRAP_CONTRACT_V1", "BOOTSTRAP_CONTRACT_V1_DIGEST", "computeInstalledBuildDigest",
  "digestAgentProjectV1", "parseAgentProjectV1", "parseAuthorityCellSessionBindingV1",
  "parseBootstrapReportV1", "parseRuntimeDescriptorV1", "parseRouteCoverageV1",
  "parseSupervisorStatusV1", "normalizeRouteCoverageV1", "verifyAuthorityCellSessionBindingV1",
  "verifyBootstrapContractV1",
];

test("bootstrap public runtime surface is an exact inert allowlist", () => {
  assert.deepEqual(Object.keys(bootstrap).sort(), [...RUNTIME_EXPORTS].sort());
  for (const forbidden of ["writeAgentProject", "discoverRoutes", "createSupervisor", "spawn", "launchRuntime", "AdmittedProfileGovernanceV1"]) {
    assert.equal(forbidden in bootstrap, false, forbidden);
  }
});

test("package declares only the closed bootstrap subpath and contract checker", async () => {
  const manifest = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8")) as { exports: Record<string, string>; scripts: Record<string, string>; files: string[] };
  assert.equal(manifest.exports["./bootstrap"], "./dist/bootstrap/index.js");
  assert.equal(manifest.scripts["check:bootstrap-contract"], "node scripts/build-bootstrap-contract.mjs --check");
  assert.ok(manifest.scripts.build.includes("build-bootstrap-contract.mjs --check"));
  assert.ok(manifest.files.includes("contract"));
});

test("bootstrap declaration barrel exports only public records and inert operations", async () => {
  const source = await readFile(join(process.cwd(), "src", "bootstrap", "index.ts"), "utf8");
  for (const forbidden of ["writeAgentProject", "discoverRoutes", "createSupervisor", "child_process", "AdmittedProfileGovernanceV1"]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
  for (const expected of ["AgentProjectV1", "RuntimeDescriptorV1", "RouteCoverageV1", "BootstrapReportV1", "SupervisorStatusV1", "AuthorityCellSessionBindingV1"]) {
    assert.equal(source.includes(expected), true, expected);
  }
  assert.equal(source.replace(/\r\n/g, "\n"), [
    'export { BOOTSTRAP_CONTRACT_V1, BOOTSTRAP_CONTRACT_V1_DIGEST, verifyBootstrapContractV1, type BootstrapContractV1 } from "./contract.js";',
    'export { computeInstalledBuildDigest } from "./build-identity.js";',
    'export { parseAgentProjectV1, digestAgentProjectV1 } from "./project.js";',
    'export { parseBootstrapReportV1, parseSupervisorStatusV1, parseAuthorityCellSessionBindingV1, verifyAuthorityCellSessionBindingV1 } from "./normalize.js";',
    'export { parseRouteCoverageV1, normalizeRouteCoverageV1 } from "../routes/normalize.js";',
    'export { parseRuntimeDescriptorV1 } from "../runtime/manifest.js";',
    'export type { AgentProjectV1, BootstrapReportV1, SupervisorStatusV1, AuthorityCellSessionBindingV1, AuthorityCellSessionBindingVerificationV1, RouteCoverageV1, RuntimeDescriptorV1 } from "./types.js";',
    "",
  ].join("\n"));
});
