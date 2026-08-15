import { open, lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { authorityDigest } from "../wire.js";
import { createFirstPartyPackRegistry } from "../../packs/index.js";
import { createProfileVerificationRoots, parseOutcomeProfileDraft, parseProfileConformanceReport, parseProfileGovernanceManifest, parseProfileTrustPin, parseSignedOutcomeProfileConformance, parseSignedTenantProfileActivation, verifyProfileGovernanceOffline } from "../outcome-profile.js";
import { assertExactDataRecord, createAdmittedProfileGovernance, type AdmittedProfileGovernanceV1 } from "./profile-governance.js";

export interface LoadProfileGovernanceInputV1 {
  readonly tenant: string;
  readonly governanceRef: string;
  readonly expectedManifestDigest: string;
  readonly expectedTrustHeadDigest: string;
  readonly homedir: string;
  readonly verificationTime: Date;
}

export type ProfileGovernanceStatusV1 = Readonly<
  | { status: "verified"; profileDigest: string; activationDigest: string; trustHeadDigest: string }
  | { status: "failed" | "unchecked" | "absent" }
>;

const FILES = ["trust-pin.json", "manifest.json", "profile.json", "conformance-report.json", "conformance.json", "activation.json"] as const;
const ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

export async function loadProfileGovernanceFromOperatorTrust(input: LoadProfileGovernanceInputV1): Promise<AdmittedProfileGovernanceV1> {
  const values = parseInput(input);
  const root = path.resolve(values.homedir, ".reelier", "trust", "outcome-profiles", values.tenant, values.governanceRef);
  await assertConfinedDirectory(root, values.homedir);
  const rootIdentity = await lstat(root);
  const canonicalRoot = await realpath(root);
  const documents = new Map<string, unknown>();
  for (const name of FILES) {
    assertSameRoot(rootIdentity, await lstat(root), root, canonicalRoot);
    documents.set(name, await readConfinedJson(root, name));
    assertSameRoot(rootIdentity, await lstat(root), root, canonicalRoot);
  }
  const trustPin = parseProfileTrustPin(documents.get("trust-pin.json"));
  const manifest = parseProfileGovernanceManifest(documents.get("manifest.json"));
  const draft = parseOutcomeProfileDraft(documents.get("profile.json"));
  const report = parseProfileConformanceReport(documents.get("conformance-report.json"));
  const conformance = parseSignedOutcomeProfileConformance(documents.get("conformance.json"));
  const activation = parseSignedTenantProfileActivation(documents.get("activation.json"));
  if (trustPin.tenant !== values.tenant || trustPin.governanceRef !== values.governanceRef || manifest.tenant !== values.tenant || manifest.governanceRef !== values.governanceRef) throw new TypeError("profile governance operator identity mismatch");
  const manifestDigest = authorityDigest(manifest);
  if (manifestDigest !== values.expectedManifestDigest || manifest.trustHeadDigest !== values.expectedTrustHeadDigest || trustPin.trustHeadDigest !== values.expectedTrustHeadDigest) throw new TypeError("profile governance manifest or trust head mismatch");
  const roots = createProfileVerificationRoots([
    { tenant: trustPin.tenant, governanceRef: trustPin.governanceRef, signerId: trustPin.certifier.signerId, purpose: trustPin.certifier.purpose, publicKeySpkiBase64: trustPin.certifier.publicKeySpkiBase64, currentTrustEvents: trustPin.currentTrustEvents, currentTrustEventsDigest: trustPin.currentTrustEventsDigest, trustHeadDigest: trustPin.trustHeadDigest },
    { tenant: trustPin.tenant, governanceRef: trustPin.governanceRef, signerId: trustPin.operator.signerId, purpose: trustPin.operator.purpose, publicKeySpkiBase64: trustPin.operator.publicKeySpkiBase64, currentTrustEvents: trustPin.currentTrustEvents, currentTrustEventsDigest: trustPin.currentTrustEventsDigest, trustHeadDigest: trustPin.trustHeadDigest },
  ]);
  const verified = verifyProfileGovernanceOffline({ tenant: values.tenant, draft, report, conformance, activation, trustRoots: roots, packs: createFirstPartyPackRegistry(), now: values.verificationTime });
  if (manifest.profileDigest !== verified.profileDigest || manifest.conformanceReportDigest !== verified.conformanceReportDigest || manifest.conformanceDigest !== verified.conformanceDigest || manifest.activationDigest !== verified.activationDigest || manifest.trustPinDigest !== verified.trustPinDigest || manifest.trustHeadDigest !== verified.trustHeadDigest) throw new TypeError("profile governance manifest artifact linkage mismatch");
  assertSameRoot(rootIdentity, await lstat(root), root, canonicalRoot);
  return createAdmittedProfileGovernance({
    draft, report, conformance, activation, manifest,trustPin, manifestDigest,
    operatorRootDigest: authorityDigest({ v: "reelier.profile-governance-operator-root/v1", tenant: values.tenant, governanceRef: values.governanceRef, canonicalRoot }),
    certifier: { signerId: trustPin.certifier.signerId, publicKeySpkiBase64: trustPin.certifier.publicKeySpkiBase64 },
    operator: { signerId: trustPin.operator.signerId, publicKeySpkiBase64: trustPin.operator.publicKeySpkiBase64 },
    reload:{tenant:values.tenant,governanceRef:values.governanceRef,expectedManifestDigest:values.expectedManifestDigest,expectedTrustHeadDigest:values.expectedTrustHeadDigest,homedir:values.homedir},
  });
}

export async function inspectProfileGovernanceStatus(input: LoadProfileGovernanceInputV1): Promise<ProfileGovernanceStatusV1> {
  try {
    const admitted = await loadProfileGovernanceFromOperatorTrust(input);
    const { profileGovernanceAdmissionSnapshot } = await import("./profile-governance.js");
    return Object.freeze({ status: "verified" as const, ...profileGovernanceAdmissionSnapshot(admitted) });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
    return Object.freeze({ status: code === "ENOENT" ? "absent" as const : "failed" as const });
  }
}

function parseInput(input: LoadProfileGovernanceInputV1): LoadProfileGovernanceInputV1 {
  assertExactDataRecord(input, ["tenant", "governanceRef", "expectedManifestDigest", "expectedTrustHeadDigest", "homedir", "verificationTime"], "profile governance load input");
  const descriptor = (key: keyof LoadProfileGovernanceInputV1) => Object.getOwnPropertyDescriptor(input, key)!.value;
  const tenant = descriptor("tenant"), governanceRef = descriptor("governanceRef"), expectedManifestDigest = descriptor("expectedManifestDigest"), expectedTrustHeadDigest = descriptor("expectedTrustHeadDigest"), homedir = descriptor("homedir"), verificationTime = descriptor("verificationTime");
  if (typeof tenant !== "string" || !ID.test(tenant) || typeof governanceRef !== "string" || !ID.test(governanceRef) || typeof expectedManifestDigest !== "string" || !DIGEST.test(expectedManifestDigest) || typeof expectedTrustHeadDigest !== "string" || !DIGEST.test(expectedTrustHeadDigest) || typeof homedir !== "string" || !path.isAbsolute(homedir) || !(verificationTime instanceof Date) || !Number.isFinite(Date.prototype.getTime.call(verificationTime))) throw new TypeError("profile governance load input is invalid");
  return { tenant, governanceRef, expectedManifestDigest, expectedTrustHeadDigest, homedir, verificationTime: new Date(Date.prototype.getTime.call(verificationTime)) };
}

async function assertConfinedDirectory(root: string, homedir: string): Promise<void> {
  const expected = path.resolve(homedir);
  const canonicalHome = await realpath(expected);
  if (canonicalHome !== expected) throw new TypeError("operator trust home link indirection is prohibited");
  let current = expected;
  for (const part of path.relative(expected, root).split(path.sep)) {
    current = path.join(current, part);
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new TypeError("profile governance directory link indirection is prohibited");
    if (await realpath(current) !== current) throw new TypeError("profile governance directory identity changed");
  }
}

async function readConfinedJson(root: string, name: typeof FILES[number]): Promise<unknown> {
  const file = path.join(root, name);
  let before: Awaited<ReturnType<typeof lstat>>;
  try { before = await lstat(file); }
  catch (error) {
    const refusal = new TypeError(`profile governance ${name} is missing or unavailable`) as TypeError & { code?: unknown };
    refusal.code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
    throw refusal;
  }
  if (!before.isFile() || before.isSymbolicLink()) throw new TypeError("profile governance artifact link indirection is prohibited");
  const canonical = await realpath(file);
  if (path.dirname(canonical) !== root || canonical !== file) throw new TypeError("profile governance artifact escaped operator root");
  const handle = await open(file, "r");
  try {
    const opened = await handle.stat();
    if (!sameIdentity(before, opened)) throw new TypeError("profile governance artifact changed before open");
    const raw = await handle.readFile("utf8");
    const after = await lstat(file);
    if (!sameIdentity(opened, after) || await realpath(file) !== canonical) throw new TypeError("profile governance artifact changed during read");
    try { return JSON.parse(raw); } catch { throw new TypeError(`profile governance ${name} is not valid JSON`); }
  } finally { await handle.close(); }
}

function sameIdentity(left: Awaited<ReturnType<typeof lstat>>, right: Awaited<ReturnType<typeof lstat>>): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs;
}

function assertSameRoot(before: Awaited<ReturnType<typeof lstat>>, after: Awaited<ReturnType<typeof lstat>>, root: string, canonicalRoot: string): void {
  if (!after.isDirectory() || after.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino) throw new TypeError("profile governance physical root identity changed");
  if (path.resolve(root) !== canonicalRoot) throw new TypeError("profile governance physical root is not canonical");
}
