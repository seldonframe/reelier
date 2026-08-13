import { authorityDigest } from "../wire.js";
import { parseCertificationOperatorConfigV3, type CertificationOperatorConfigV3 } from "./config.js";
import { deriveCertificationEndpointManifest } from "./initializer.js";
import { inertRecord } from "./inert.js";
import {
  parseCertificationEndpointManifest,
  parseCertificationRunnerManifest,
  parseCertificationScenarioPlan,
  type CertificationEndpointManifestV2,
  type CertificationRunnerManifestV2,
  type CertificationScenarioPlanV1,
} from "./manifests.js";
import { CERTIFICATION_SCENARIO_IDS, type CertificationScenarioId } from "./scenarios.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;

/** Host-only semantic verification; packaged JSON Schemas are structural gates, not authority verification. */
export function verifyCertificationOperatorConfigV3(value: unknown): CertificationOperatorConfigV3 {
  return parseCertificationOperatorConfigV3(value);
}

export function verifyCertificationEndpointManifestV2(value: unknown, configValue: unknown, scenario: CertificationScenarioId): CertificationEndpointManifestV2 {
  const config = parseCertificationOperatorConfigV3(configValue);
  if (!config.scenarios.includes(scenario)) throw new TypeError("certification endpoint scenario is not selected by host configuration");
  const manifest = parseCertificationEndpointManifest(value, scenario);
  if (manifest.v !== "reelier.certification-endpoint-manifest/v2" || authorityDigest(manifest) !== authorityDigest(deriveCertificationEndpointManifest(config, scenario))) throw new TypeError("certification endpoint manifest does not match host configuration commitments");
  return manifest;
}

export function verifyCertificationRunnerManifestV2(value: unknown, expectedValue: unknown): CertificationRunnerManifestV2 {
  const expected = inertRecord(expectedValue, "certification runner semantic expectations");
  if (Reflect.ownKeys(expected).length !== 2 || !Object.hasOwn(expected, "scenarioId") || !Object.hasOwn(expected, "endpointManifestDigest") || typeof expected.scenarioId !== "string" || !(CERTIFICATION_SCENARIO_IDS as readonly string[]).includes(expected.scenarioId) || typeof expected.endpointManifestDigest !== "string" || !DIGEST.test(expected.endpointManifestDigest)) throw new TypeError("certification runner semantic expectations are closed and invalid");
  const manifest = parseCertificationRunnerManifest(value, expected.scenarioId as CertificationScenarioId);
  if (manifest.v !== "reelier.certification-runner-manifest/v2" || manifest.endpointManifestDigest !== expected.endpointManifestDigest) throw new TypeError("certification runner manifest does not match expected endpoint commitment");
  return manifest;
}

export function verifyCertificationScenarioPlanV1(value: unknown, configValue: unknown, selectedScenarios?: readonly CertificationScenarioId[]): CertificationScenarioPlanV1 {
  const config = parseCertificationOperatorConfigV3(configValue);
  return parseCertificationScenarioPlan(value, config, selectedScenarios ?? config.scenarios);
}
