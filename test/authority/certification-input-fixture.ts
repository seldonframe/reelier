import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { authorityDigest } from "../../src/authority/wire.js";
import { CERTIFICATION_PROVIDER_SCENARIO_IDS, CERTIFICATION_RUNNER_OPERATIONS, certificationRunnerRegistryDigest, getCertificationRunnerRegistryEntry } from "../../src/authority/certification/runner-registry.js";
import { parseCertificationOperatorConfigV3 } from "../../src/authority/certification/config.js";
import { certificationScenarioPlanBindings } from "../../src/authority/certification/scenario-bindings.js";

export async function writeCertificationInputManifests(workspace: string, scenarios: readonly string[]): Promise<void> {
  const config = parseCertificationOperatorConfigV3(JSON.parse(await readFile(path.join(workspace, "config.json"), "utf8")));
  const runnerDirectory = path.join(workspace, "inputs", "runners");
  const testDirectory = path.join(workspace, "inputs", "tests");
  await mkdir(runnerDirectory, { recursive: true });
  await mkdir(testDirectory, { recursive: true });
  const planDirectory = path.join(workspace, "inputs", "plans");
  await mkdir(planDirectory, { recursive: true });
  for (const scenario of scenarios.filter(scenario => (CERTIFICATION_PROVIDER_SCENARIO_IDS as readonly string[]).includes(scenario))) {
    const endpoint = JSON.parse(await readFile(path.join(workspace, "authority", "endpoints", `${scenario}.json`), "utf8"));
    const stem = scenario.replaceAll("-", "_");
    const registry = getCertificationRunnerRegistryEntry(scenario as never);
    const bindings = certificationScenarioPlanBindings(config, scenario as never);
    const runner = { v: "reelier.certification-runner-manifest/v2", scenarioId: scenario, runnerId: registry.runnerId, endpointManifestDigest: authorityDigest(endpoint), metadataDigest: registry.metadataDigest, registryDigest: certificationRunnerRegistryDigest, operations: CERTIFICATION_RUNNER_OPERATIONS, executionReady: false, dispatchable: false };
    const runnerBytes = `${JSON.stringify(runner)}\n`;
    const runnerDigest = `sha256:${createHash("sha256").update(runnerBytes).digest("hex")}`;
    const tests = { v: "reelier.certification-test-manifest/v1", scenarioId: scenario, suiteId: `${stem}_v1`, runnerManifestDigest: runnerDigest, cases: ["account-binding", "ambiguity", "cleanup", "normal", "redaction", "stale-state"] };
    const testBytes = `${JSON.stringify(tests)}\n`;
    const testDigest = `sha256:${createHash("sha256").update(testBytes).digest("hex")}`;
    const plan = { v: "reelier.certification-scenario-plan/v1", scenarioId: scenario, definitionAliases: registry.definitionAliases, sourceRefs: bindings.sourceRefs, resourceDigest: bindings.resourceDigest, accountCommitments: bindings.accountCommitments, desiredStateDigest: bindings.desiredStateDigest, policyCommitments: [{ schemaId: `${stem}_policy_v1`, digest: `sha256:${"3".repeat(64)}` }], cleanup: { recipeIds: bindings.cleanupRecipeIds, beforeStateDigest: `sha256:${"4".repeat(64)}` }, controlledCut: { case: "ambiguous-after-dispatch" }, runnerManifestDigest: runnerDigest, testManifestDigest: testDigest, endpointManifestDigest: authorityDigest(endpoint), runnerRegistryDigest: certificationRunnerRegistryDigest };
    await writeFile(path.join(runnerDirectory, `${scenario}.json`), runnerBytes, "utf8");
    await writeFile(path.join(testDirectory, `${scenario}.json`), testBytes, "utf8");
    await writeFile(path.join(planDirectory, `${scenario}.json`), `${JSON.stringify(plan)}\n`, "utf8");
  }
}
