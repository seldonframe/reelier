import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { authorityDigest } from "../wire.js";
import { parseCertificationInitialization, type CertificationIdentifiers } from "./initializer.js";
import { preflightCertification, type CertificationInputSet } from "./preflight.js";
import type { CertificationScenarioId } from "./scenarios.js";

export interface CertificationReadinessCandidate {
  readonly v: "reelier.certification-readiness-candidate/v1";
  readonly status: "awaiting-human-signature";
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
    trust: "unchecked";
  }>;
}

export async function sealCertificationReadiness(input: Readonly<{ workspace: string; scenario?: string; all?: boolean }>): Promise<Readonly<{ candidate: CertificationReadinessCandidate; digest: string; path: string }>> {
  const workspace = path.resolve(input.workspace);
  const initialization = parseCertificationInitialization(JSON.parse(await readFile(path.join(workspace, "initialization.json"), "utf8")));
  const preflight = await preflightCertification(input);
  const candidate: CertificationReadinessCandidate = Object.freeze({
    v: "reelier.certification-readiness-candidate/v1",
    status: "awaiting-human-signature",
    authorization: "absent",
    dispatchable: false,
    completeness: "unchecked",
    configDigest: initialization.configDigest,
    preflightDigest: preflight.digest,
    scenarios: preflight.scenarios,
    identifiers: initialization.identifiers,
    commitments: Object.freeze({ resources: preflight.resources, cleanup: preflight.cleanup, credentials: preflight.credentialReferences, runners: preflight.inputs.runners, tests: preflight.inputs.tests, topology: preflight.topology, trust: "unchecked" }),
  });
  const digest = authorityDigest(candidate);
  const directory = path.join(workspace, "readiness");
  const output = path.join(directory, `readiness-${digest.replace(":", "-")}.json`);
  await mkdir(directory, { recursive: true });
  try { await writeFile(output, `${JSON.stringify(candidate)}\n`, { encoding: "utf8", flag: "wx", mode: 0o444 }); }
  catch (error) {
    const existing = JSON.parse(await readFile(output, "utf8"));
    if (authorityDigest(existing) !== digest || JSON.stringify(existing) !== JSON.stringify(candidate)) throw new TypeError("immutable readiness candidate mismatch");
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  return Object.freeze({ candidate, digest, path: output });
}
