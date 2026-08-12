import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { authorityDigest } from "../../src/authority/wire.js";

export async function writeCertificationInputManifests(workspace: string, scenarios: readonly string[]): Promise<void> {
  const runnerDirectory = path.join(workspace, "inputs", "runners");
  const testDirectory = path.join(workspace, "inputs", "tests");
  await mkdir(runnerDirectory, { recursive: true });
  await mkdir(testDirectory, { recursive: true });
  for (const scenario of scenarios) {
    const endpoint = JSON.parse(await readFile(path.join(workspace, "authority", "endpoints", `${scenario}.json`), "utf8"));
    const stem = scenario.replaceAll("-", "_");
    const runner = { v: "reelier.certification-runner-manifest/v1", scenarioId: scenario, runnerId: `${stem}_v1`, endpointManifestDigest: authorityDigest(endpoint), implementationDigest: `sha256:${"2".repeat(64)}`, operations: ["prepare", "authoritative-read", "compile", "reserve", "reread", "dispatch", "reconcile", "receipt", "cleanup"] };
    const runnerBytes = `${JSON.stringify(runner)}\n`;
    const runnerDigest = `sha256:${createHash("sha256").update(runnerBytes).digest("hex")}`;
    const tests = { v: "reelier.certification-test-manifest/v1", scenarioId: scenario, suiteId: `${stem}_v1`, runnerManifestDigest: runnerDigest, cases: ["account-binding", "ambiguity", "cleanup", "normal", "redaction", "stale-state"] };
    await writeFile(path.join(runnerDirectory, `${scenario}.json`), runnerBytes, "utf8");
    await writeFile(path.join(testDirectory, `${scenario}.json`), `${JSON.stringify(tests)}\n`, "utf8");
  }
}
