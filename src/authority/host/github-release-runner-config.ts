import { createPrivateKey, createPublicKey } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { verifyReleaseAuthorizationBundleV1 } from "../release-contracts.js";
import { createGitHubReleaseRunner, type GitHubReleaseAuthorizationContextV1, type GitHubReleaseProviderFaultV1, type GitHubReleaseProviderV1, type GitHubReleaseRunnerV1 } from "./github-release-runner.js";

/** Matches `createSignedJournal` and `release-contracts`' SIGNER_ID. One rule, three slots. */
const SIGNER_ID = /^[a-z0-9][a-z0-9._:-]{7,127}$/;
const OPAQUE_HANDLE = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;

/** Closed enum. Lane B widens it with the live `github-https` kind; an unrecognized kind is a
 * refusal, never a silent fallback to the fixture provider. */
const PROVIDER_KINDS = Object.freeze(["loopback-fixture"] as const);
const CONFIG_KEYS = Object.freeze(["v", "rootDir", "journalSignerId", "journalKeyFile", "evidenceSignerId", "evidenceKeyFile", "releaseAuthority", "authorizationDir", "provider"] as const);
const AUTHORITY_KEYS = Object.freeze(["signerId", "publicKeySpkiBase64"] as const);
const PROVIDER_KEYS = Object.freeze(["kind", "fixtureDir"] as const);
const AUTHORIZATION_KEYS = Object.freeze(["authorization", "candidateManifest", "operationPlan", "policy", "evidence", "fileContents"] as const);
const PROVIDER_METHODS = Object.freeze(["createBlob", "createTree", "createCommit", "getRef", "createRef", "getCommit", "findPullRequests", "createPullRequest", "markPullRequestReady", "getPullRequest", "getChecks", "mergePullRequest", "npmVersionExists", "readPackageManifest"] as const);

export type GitHubReleaseRunnerProviderKindV1 = (typeof PROVIDER_KINDS)[number];

/** Host-owned operator config for the four reviewed GitHub release Outcomes.
 *
 * Only file paths and PUBLIC key material live here. Private keys are read from the named PEM
 * files and are never inlined, and none of it is ever loaded from `authority.yml` — the
 * host-owned credential rule at `local.ts` (`LocalAuthorityRuntimeOptions.secretResolver`). */
export interface GitHubReleaseRunnerOperatorConfigV1 {
  readonly v: "reelier.github-release-runner-config/v1";
  readonly rootDir: string;
  readonly journalSignerId: string;
  readonly journalKeyFile: string;
  readonly evidenceSignerId: string;
  readonly evidenceKeyFile: string;
  readonly releaseAuthority: Readonly<{ signerId: string; publicKeySpkiBase64: string }>;
  readonly authorizationDir: string;
  readonly provider: Readonly<{ kind: GitHubReleaseRunnerProviderKindV1; fixtureDir: string }>;
}

export function parseGitHubReleaseRunnerOperatorConfig(value: unknown): GitHubReleaseRunnerOperatorConfigV1 {
  const raw = closedRecord(value, CONFIG_KEYS, "release runner operator config");
  if (raw.v !== "reelier.github-release-runner-config/v1") throw new TypeError("release runner operator config is not a closed reelier.github-release-runner-config/v1 record");
  const releaseAuthority = closedRecord(raw.releaseAuthority, AUTHORITY_KEYS, "release runner authorization authority");
  const provider = closedRecord(raw.provider, PROVIDER_KEYS, "release runner provider");
  if (typeof provider.kind !== "string" || !(PROVIDER_KINDS as readonly string[]).includes(provider.kind)) throw new TypeError(`release runner provider kind must be one of ${PROVIDER_KINDS.join(", ")}`);
  if (typeof releaseAuthority.publicKeySpkiBase64 !== "string" || !releaseAuthority.publicKeySpkiBase64) throw new TypeError("release runner authorization authority public SPKI is required");
  return Object.freeze({
    v: "reelier.github-release-runner-config/v1",
    rootDir: absolutePath(raw.rootDir, "release runner root directory"),
    journalSignerId: signerId(raw.journalSignerId, "release runner journal signer"),
    journalKeyFile: absolutePath(raw.journalKeyFile, "release runner journal key file"),
    evidenceSignerId: signerId(raw.evidenceSignerId, "release runner evidence signer"),
    evidenceKeyFile: absolutePath(raw.evidenceKeyFile, "release runner evidence key file"),
    releaseAuthority: Object.freeze({ signerId: signerId(releaseAuthority.signerId, "release authorization authority signer"), publicKeySpkiBase64: releaseAuthority.publicKeySpkiBase64 }),
    authorizationDir: absolutePath(raw.authorizationDir, "release runner authorization directory"),
    provider: Object.freeze({ kind: provider.kind as GitHubReleaseRunnerProviderKindV1, fixtureDir: absolutePath(provider.fixtureDir, "release runner provider fixture directory") }),
  });
}

/** Constructs the branded host-owned runner in process. The brand cannot be deserialized, so a
 * runner only ever exists because this function (or another in-process factory) built one. */
export async function createGitHubReleaseRunnerFromOperatorConfig(config: GitHubReleaseRunnerOperatorConfigV1, now: () => Date = () => new Date()): Promise<GitHubReleaseRunnerV1> {
  const parsed = parseGitHubReleaseRunnerOperatorConfig(config);
  const journalPrivateKey = createPrivateKey(await readFile(parsed.journalKeyFile));
  const evidencePrivateKey = createPrivateKey(await readFile(parsed.evidenceKeyFile));
  return createGitHubReleaseRunner({
    rootDir: parsed.rootDir,
    journalSigner: { signerId: parsed.journalSignerId, privateKey: journalPrivateKey, publicKey: createPublicKey(journalPrivateKey) },
    evidenceSigner: { signerId: parsed.evidenceSignerId, privateKey: evidencePrivateKey },
    authorizationResolver: handle => resolveAuthorization(parsed, handle, now),
    provider: createReleaseProvider(parsed.provider),
    now,
  });
}

async function resolveAuthorization(config: GitHubReleaseRunnerOperatorConfigV1, handle: string, now: () => Date): Promise<GitHubReleaseAuthorizationContextV1> {
  if (typeof handle !== "string" || !OPAQUE_HANDLE.test(handle)) throw new TypeError("release authorization handle is invalid");
  const bundle = closedRecord(JSON.parse(await readFile(path.join(config.authorizationDir, `${handle}.json`), "utf8")), AUTHORIZATION_KEYS, "release authorization bundle");
  const authorization = verifyReleaseAuthorizationBundleV1(
    { authorization: bundle.authorization, candidateManifest: bundle.candidateManifest, operationPlan: bundle.operationPlan, policy: bundle.policy },
    config.releaseAuthority,
    now(),
    bundle.evidence as Parameters<typeof verifyReleaseAuthorizationBundleV1>[3],
  );
  return Object.freeze({ authorization, fileContents: Object.freeze((bundle.fileContents ?? []) as readonly Readonly<{ path: string; bytesBase64: string }>[]) });
}

function createReleaseProvider(provider: GitHubReleaseRunnerOperatorConfigV1["provider"]): GitHubReleaseProviderV1 {
  if (provider.kind !== "loopback-fixture") throw new TypeError(`release runner provider kind must be one of ${PROVIDER_KINDS.join(", ")}`);
  return createLoopbackFixtureProvider(provider.fixtureDir);
}

/** Deterministic, credential-free, network-free provider. It is sufficient for startup and every
 * refusal path; a real release dispatch waits on the live provider Lane B lands. */
function createLoopbackFixtureProvider(fixtureDir: string): GitHubReleaseProviderV1 {
  const absent: GitHubReleaseProviderFaultV1 = Object.freeze({ v: "reelier.github-release-provider-fault/v1", kind: "transport-uncertain", reason: "loopback fixture absent" });
  const call = async (method: string): Promise<unknown> => {
    let raw: string;
    try { raw = await readFile(path.join(fixtureDir, `${method}.json`), "utf8"); } catch { throw absent; }
    return JSON.parse(raw);
  };
  return Object.freeze(Object.fromEntries(PROVIDER_METHODS.map(method => [method, () => call(method)])) as unknown as GitHubReleaseProviderV1);
}

function closedRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value as object).sort().join("\0") !== [...keys].sort().join("\0")) throw new TypeError(`${label} is not a closed record`);
  return value as Record<string, unknown>;
}

function absolutePath(value: unknown, label: string): string {
  if (typeof value !== "string" || !value || !path.isAbsolute(value)) throw new TypeError(`${label} must be an absolute path`);
  return value;
}

function signerId(value: unknown, label: string): string {
  if (typeof value !== "string" || !SIGNER_ID.test(value)) throw new TypeError(`${label} identity is invalid`);
  return value;
}
