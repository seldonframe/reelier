import path from "node:path";
import { authorityDigest } from "../wire.js";
import { parseCertificationInitialization, type CertificationIdentifiers } from "./initializer.js";
import { preflightCertification, type CertificationInputSet } from "./preflight.js";
import type { CertificationScenarioId } from "./scenarios.js";
import { certificationWorkspaceRoot, publishPrivateContentAddressed, readConfinedFile, confinedExistingDirectory } from "./filesystem.js";

export interface CertificationReadinessCandidate {
  readonly v: "reelier.certification-readiness-candidate/v1";
  readonly status: "awaiting-human-signature";
  readonly preparationReady: true;
  readonly signatureStatus: "absent";
  readonly authorization: "absent";
  readonly dispatchable: false;
  readonly completeness: "unchecked";
  readonly configDigest: string;
  readonly preflightDigest: string;
  readonly scenarios: readonly CertificationScenarioId[];
  readonly identifiers: CertificationIdentifiers;
  readonly commitments: Readonly<{
    resources: readonly { readonly scenario: CertificationScenarioId; readonly digest: string; readonly status: "configured" | "missing" }[];
    cleanup: readonly { readonly scenario: CertificationScenarioId; readonly digest: string; readonly status: "configured" | "missing" }[];
    credentials: readonly { readonly slot: string; readonly status: "configured" | "missing" }[];
    runners: CertificationInputSet;
    tests: CertificationInputSet;
    topology: "configured" | "absent";
    signatureStatus: "absent";
  }>;
}

export async function sealCertificationReadiness(input: Readonly<{ workspace: string; scenario?: string; all?: boolean }>): Promise<Readonly<{ candidate: CertificationReadinessCandidate; digest: string; path: string }>> {
  const workspace = path.resolve(input.workspace);
  const root = await certificationWorkspaceRoot(workspace);
  const initialization = parseCertificationInitialization(JSON.parse((await readConfinedFile(root, root, "initialization.json")).toString("utf8")));
  const preflight = await preflightCertification(input);
  if (!preflight.preparationReady) throw new TypeError("certification preparation is incomplete and cannot be sealed");
  const candidate: CertificationReadinessCandidate = Object.freeze({
    v: "reelier.certification-readiness-candidate/v1",
    status: "awaiting-human-signature",
    preparationReady: true,
    signatureStatus: "absent",
    authorization: "absent",
    dispatchable: false,
    completeness: "unchecked",
    configDigest: initialization.configDigest,
    preflightDigest: preflight.digest,
    scenarios: preflight.scenarios,
    identifiers: initialization.identifiers,
    commitments: Object.freeze({ resources: preflight.resources, cleanup: preflight.cleanup, credentials: preflight.credentialReferences, runners: preflight.inputs.runners, tests: preflight.inputs.tests, topology: preflight.topology, signatureStatus: "absent" }),
  });
  const digest = authorityDigest(candidate);
  const directory = path.join(workspace, "readiness");
  const output = path.join(directory, `readiness-${digest.replace(":", "-")}.json`);
  await publishPrivateContentAddressed(root, "readiness", path.basename(output), `${JSON.stringify(candidate)}\n`);
  const safeDirectory = await confinedExistingDirectory(root, ["readiness"]);
  if (!safeDirectory) throw new TypeError("certification readiness directory is absent after publication");
  const existing = JSON.parse((await readConfinedFile(root, safeDirectory, path.basename(output))).toString("utf8"));
  if (authorityDigest(existing) !== digest || JSON.stringify(existing) !== JSON.stringify(candidate)) {
    throw new TypeError("immutable readiness candidate mismatch");
  }
  return Object.freeze({ candidate, digest, path: output });
}
