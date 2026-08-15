import { constants } from "node:fs";
import { open, lstat, readdir, realpath, type FileHandle } from "node:fs/promises";
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

type LoaderOpenEvent = Readonly<{ name: typeof FILES[number]; phase: "before-child-open" | "child-opened" | "after-child-read" }>;
type LoaderFilesystemBarrier = (event: LoaderOpenEvent) => Promise<void>;
let loaderFilesystemBarrier: LoaderFilesystemBarrier | undefined;

/** Package-private deterministic race seam. Deliberately omitted from the public host barrel. */
export function __testSetProfileGovernanceFilesystemBarrier(barrier: LoaderFilesystemBarrier): () => void {
  if (typeof barrier !== "function") throw new TypeError("profile governance filesystem barrier must be callable");
  const previous = loaderFilesystemBarrier;
  loaderFilesystemBarrier = barrier;
  return () => { if (loaderFilesystemBarrier === barrier) loaderFilesystemBarrier = previous; };
}

export async function loadProfileGovernanceFromOperatorTrust(input: LoadProfileGovernanceInputV1): Promise<AdmittedProfileGovernanceV1> {
  const values = parseInput(input);
  const root = path.resolve(values.homedir, ".reelier", "trust", "outcome-profiles", values.tenant, values.governanceRef);
  await assertConfinedDirectory(root, values.homedir);
  const rootIdentity = await lstat(root);
  const canonicalRoot = await realpath(root);
  const rootHandle = await retainLinuxDirectory(root, rootIdentity);
  try {
    const childIdentities = new Map<typeof FILES[number], Awaited<ReturnType<typeof lstat>>>();
    for (const name of FILES) childIdentities.set(name, await captureChildIdentity(root, rootIdentity, rootHandle, name));
    const documents = new Map<string, unknown>();
    for (const name of FILES) {
      assertSameRoot(rootIdentity, await lstat(root), root, canonicalRoot);
      documents.set(name, await readConfinedJson(root, rootIdentity, rootHandle, name, childIdentities.get(name)!));
      assertSameRoot(rootIdentity, await lstat(root), root, canonicalRoot);
    }
    const admitted = admitProfileGovernance(values, root, rootIdentity, canonicalRoot, documents);
    assertSameRoot(rootIdentity, await lstat(root), root, canonicalRoot);
    return admitted;
  } finally {
    await rootHandle?.close();
  }
}

function admitProfileGovernance(values: LoadProfileGovernanceInputV1, root: string, rootIdentity: Awaited<ReturnType<typeof lstat>>, canonicalRoot: string, documents: Map<string, unknown>): AdmittedProfileGovernanceV1 {
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
  return createAdmittedProfileGovernance({
    draft, report, conformance, activation, manifest,trustPin, manifestDigest,
    operatorRootDigest: authorityDigest({ v: "reelier.profile-governance-operator-root/v1", tenant: values.tenant, governanceRef: values.governanceRef, canonicalRoot, device: String(rootIdentity.dev), inode: String(rootIdentity.ino) }),
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

async function readConfinedJson(root: string, rootIdentity: Awaited<ReturnType<typeof lstat>>, rootHandle: FileHandle | undefined, name: typeof FILES[number], expected: Awaited<ReturnType<typeof lstat>>): Promise<unknown> {
  if (!rootHandle && loaderFilesystemBarrier) return readBarrierFallbackJson(root, rootIdentity, name, expected);
  await loaderFilesystemBarrier?.({ name, phase: "before-child-open" });
  let file = await anchoredChildPath(root, rootIdentity, rootHandle, name);
  let before: Awaited<ReturnType<typeof lstat>>;
  try { before = await lstat(file); }
  catch (error) {
    const refusal = new TypeError(`profile governance ${name} is missing or unavailable`) as TypeError & { code?: unknown };
    refusal.code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
    throw refusal;
  }
  if (!before.isFile() || before.isSymbolicLink()) throw new TypeError("profile governance artifact link indirection is prohibited");
  if (!sameGeneration(expected, before)) throw new TypeError("profile governance artifact generation changed before open");
  const flags = constants.O_RDONLY | (typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0);
  const handle = await open(file, flags);
  try {
    const opened = await handle.stat();
    if (!sameGeneration(expected, opened)) throw new TypeError("profile governance artifact changed before open");
    await loaderFilesystemBarrier?.({ name, phase: "child-opened" });
    file = await anchoredChildPath(root, rootIdentity, rootHandle, name);
    if (!sameGeneration(expected, await lstat(file)) || !sameGeneration(opened, await handle.stat())) throw new TypeError("profile governance artifact replacement changed after open");
    const raw = await handle.readFile("utf8");
    await loaderFilesystemBarrier?.({ name, phase: "after-child-read" });
    file = await anchoredChildPath(root, rootIdentity, rootHandle, name);
    const after = await lstat(file), openedAfter = await handle.stat();
    if (!sameGeneration(expected, after) || !sameGeneration(opened, openedAfter) || await realpath(file) !== path.join(root, name)) throw new TypeError("profile governance artifact changed during read");
    try { return JSON.parse(raw); } catch { throw new TypeError(`profile governance ${name} is not valid JSON`); }
  } finally { await handle.close(); }
}

async function readBarrierFallbackJson(root: string, rootIdentity: Awaited<ReturnType<typeof lstat>>, name: typeof FILES[number], expected: Awaited<ReturnType<typeof lstat>>): Promise<unknown> {
  await loaderFilesystemBarrier!({ name, phase: "before-child-open" });
  let file = await anchoredChildPath(root, rootIdentity, undefined, name);
  const before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || !sameGeneration(expected, before)) throw new TypeError("profile governance artifact generation changed before fallback open");
  const flags = constants.O_RDONLY | (typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0);
  const handle = await open(file, flags);
  let raw: string;
  try {
    const opened = await handle.stat();
    if (!sameGeneration(expected, opened)) throw new TypeError("profile governance artifact changed before fallback open");
    raw = await handle.readFile("utf8");
    if (!sameGeneration(opened, await handle.stat())) throw new TypeError("profile governance artifact changed during fallback read");
  } finally { await handle.close(); }
  await loaderFilesystemBarrier!({ name, phase: "child-opened" });
  file = await anchoredChildPath(root, rootIdentity, undefined, name);
  if (!sameGeneration(expected, await lstat(file))) throw new TypeError("profile governance artifact replacement changed after fallback open");
  await loaderFilesystemBarrier!({ name, phase: "after-child-read" });
  file = await anchoredChildPath(root, rootIdentity, undefined, name);
  if (!sameGeneration(expected, await lstat(file)) || await realpath(file) !== path.join(root, name)) throw new TypeError("profile governance artifact changed after fallback read");
  try { return JSON.parse(raw); } catch { throw new TypeError(`profile governance ${name} is not valid JSON`); }
}

function sameGeneration(left: Awaited<ReturnType<typeof lstat>>, right: Awaited<ReturnType<typeof lstat>>): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

function assertSameRoot(before: Awaited<ReturnType<typeof lstat>>, after: Awaited<ReturnType<typeof lstat>>, root: string, canonicalRoot: string): void {
  if (!after.isDirectory() || after.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino) throw new TypeError("profile governance physical root identity changed");
  if (path.resolve(root) !== canonicalRoot) throw new TypeError("profile governance physical root is not canonical");
}

async function retainLinuxDirectory(root: string, expected: Awaited<ReturnType<typeof lstat>>): Promise<FileHandle | undefined> {
  if (process.platform !== "linux") return undefined;
  const flags = constants.O_RDONLY | constants.O_DIRECTORY | (typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0);
  const handle = await open(root, flags);
  const opened = await handle.stat();
  if (!opened.isDirectory() || opened.dev !== expected.dev || opened.ino !== expected.ino) {
    await handle.close();
    throw new TypeError("profile governance physical root changed before retention");
  }
  return handle;
}

async function captureChildIdentity(root: string, rootIdentity: Awaited<ReturnType<typeof lstat>>, handle: FileHandle | undefined, name: typeof FILES[number]): Promise<Awaited<ReturnType<typeof lstat>>> {
  try { return await lstat(await anchoredChildPath(root, rootIdentity, handle, name)); }
  catch (error) {
    const refusal = new TypeError(`profile governance ${name} is missing or unavailable`) as TypeError & { code?: unknown };
    refusal.code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
    throw refusal;
  }
}

async function anchoredChildPath(root: string, identity: Awaited<ReturnType<typeof lstat>>, handle: FileHandle | undefined, name: typeof FILES[number]): Promise<string> {
  if (handle) return `/proc/self/fd/${handle.fd}/${name}`;
  if (!loaderFilesystemBarrier) return path.join(root, name);
  const parent = path.dirname(root);
  for (const candidateName of await readdir(parent)) {
    const candidate = path.join(parent, candidateName);
    try {
      const stat = await lstat(candidate);
      if (stat.isDirectory() && !stat.isSymbolicLink() && stat.dev === identity.dev && stat.ino === identity.ino) return path.join(candidate, name);
    } catch { /* A concurrent test mutation may remove a candidate between listing and stat. */ }
  }
  throw new TypeError("profile governance retained root is unavailable");
}
