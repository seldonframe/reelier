import { createPrivateKey, createPublicKey } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { verifyReleaseAuthorizationBundleV1 } from "../release-contracts.js";
import { assertAccountIdentity, assertHttpsOrigin, assertRepositoryIdentity, assertSecretReference, assertTimeoutMs, createGitHubReleaseHttpsProvider, GITHUB_RELEASE_HTTPS_DEFAULT_API_BASE_URL, GITHUB_RELEASE_HTTPS_DEFAULT_NPM_REGISTRY_BASE_URL, GITHUB_RELEASE_HTTPS_DEFAULT_TIMEOUT_MS } from "./github-release-https-provider.js";
import { createGitHubReleaseRunner, type GitHubReleaseAuthorizationContextV1, type GitHubReleaseProviderFaultV1, type GitHubReleaseProviderV1, type GitHubReleaseRunnerV1 } from "./github-release-runner.js";
import { createSecretResolver, type SecretResolver } from "./secret-resolver.js";

/** Matches `createSignedJournal` and `release-contracts`' SIGNER_ID. One rule, three slots. */
const SIGNER_ID = /^[a-z0-9][a-z0-9._:-]{7,127}$/;
const OPAQUE_HANDLE = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;

/** Closed DISCRIMINATED UNION of provider kinds, keyed on `kind`. Every kind carries its OWN key
 * set, so a config for one kind can never carry another kind's fields.
 *
 * An unrecognized kind is a refusal, never a silent fallback to the fixture provider.
 *
 * `github-https` (Lane B, landed) is the live arm. Its credential lives inside the arm as a
 * `SecretResolver` REFERENCE (`env:NAME` / `file:PATH`) and nowhere else — never a token value,
 * never at the config top level. Three of its fields carry defaults, so the live arm is the only
 * one whose key set is required-plus-optional rather than exact; unknown keys are still refused. */
const PROVIDER_KINDS = Object.freeze(["loopback-fixture", "github-https"] as const);
const PROVIDER_KEYS_BY_KIND = Object.freeze({
  "loopback-fixture": Object.freeze(["kind", "fixtureDir"] as const),
  "github-https": Object.freeze(["kind", "githubAccountIdentity", "githubTokenRef", "repository"] as const),
});
/** `github-https` only. Absent means the default, never "unset". */
const PROVIDER_OPTIONAL_KEYS_BY_KIND = Object.freeze({ "github-https": Object.freeze(["githubBaseUrl", "npmRegistryBaseUrl", "timeoutMs"] as const) });
const CONFIG_KEYS = Object.freeze(["v", "rootDir", "journalSignerId", "journalKeyFile", "evidenceSignerId", "evidenceKeyFile", "releaseAuthority", "authorizationDir", "provider"] as const);
const AUTHORITY_KEYS = Object.freeze(["signerId", "publicKeySpkiBase64"] as const);
const AUTHORIZATION_KEYS = Object.freeze(["authorization", "candidateManifest", "operationPlan", "policy", "evidence", "fileContents"] as const);
const PROVIDER_METHODS = Object.freeze(["createBlob", "createTree", "createCommit", "getRef", "createRef", "getCommit", "findPullRequests", "createPullRequest", "markPullRequestReady", "getPullRequest", "getChecks", "mergePullRequest", "npmVersionExists", "readPackageManifest"] as const);

export type GitHubReleaseRunnerProviderKindV1 = (typeof PROVIDER_KINDS)[number];

/** The deterministic, credential-free, network-free arm. */
export type GitHubReleaseRunnerLoopbackFixtureProviderConfigV1 = Readonly<{ kind: "loopback-fixture"; fixtureDir: string }>;
/** The live arm. Every field is normalized by `parseProvider`, so a parsed value always carries all
 * seven keys even when the operator wrote only the four required ones. */
export type GitHubReleaseRunnerGitHubHttpsProviderConfigV1 = Readonly<{ kind: "github-https"; githubAccountIdentity: string; githubBaseUrl: string; githubTokenRef: string; npmRegistryBaseUrl: string; repository: string; timeoutMs: number }>;
export type GitHubReleaseRunnerProviderConfigV1 = GitHubReleaseRunnerLoopbackFixtureProviderConfigV1 | GitHubReleaseRunnerGitHubHttpsProviderConfigV1;

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
  readonly provider: GitHubReleaseRunnerProviderConfigV1;
}

export function parseGitHubReleaseRunnerOperatorConfig(value: unknown): GitHubReleaseRunnerOperatorConfigV1 {
  const raw = closedRecord(value, CONFIG_KEYS, "release runner operator config");
  if (raw.v !== "reelier.github-release-runner-config/v1") throw new TypeError("release runner operator config is not a closed reelier.github-release-runner-config/v1 record");
  const releaseAuthority = closedRecord(raw.releaseAuthority, AUTHORITY_KEYS, "release runner authorization authority");
  return Object.freeze({
    v: "reelier.github-release-runner-config/v1",
    rootDir: absolutePath(raw.rootDir, "release runner root directory"),
    journalSignerId: signerId(raw.journalSignerId, "release runner journal signer"),
    journalKeyFile: absolutePath(raw.journalKeyFile, "release runner journal key file"),
    evidenceSignerId: signerId(raw.evidenceSignerId, "release runner evidence signer"),
    evidenceKeyFile: absolutePath(raw.evidenceKeyFile, "release runner evidence key file"),
    releaseAuthority: Object.freeze({ signerId: signerId(releaseAuthority.signerId, "release authorization authority signer"), publicKeySpkiBase64: publicKeySpki(releaseAuthority.publicKeySpkiBase64, "release runner authorization authority") }),
    authorizationDir: absolutePath(raw.authorizationDir, "release runner authorization directory"),
    provider: parseProvider(raw.provider),
  });
}

/** Reads the discriminant BEFORE closing the record, so each arm is closed on its own key set. */
function parseProvider(value: unknown): GitHubReleaseRunnerProviderConfigV1 {
  const kind = plainRecord(value, "release runner provider").kind;
  if (typeof kind !== "string" || !(PROVIDER_KINDS as readonly string[]).includes(kind)) throw new TypeError(`release runner provider kind must be one of: ${PROVIDER_KINDS.join(", ")}`);
  switch (kind as GitHubReleaseRunnerProviderKindV1) {
    case "loopback-fixture": {
      const provider = closedRecord(value, PROVIDER_KEYS_BY_KIND["loopback-fixture"], "release runner loopback-fixture provider");
      return Object.freeze({ kind: "loopback-fixture", fixtureDir: absolutePath(provider.fixtureDir, "release runner provider fixture directory") });
    }
    case "github-https": {
      const provider = closedRecord(value, PROVIDER_KEYS_BY_KIND["github-https"], "release runner github-https provider", PROVIDER_OPTIONAL_KEYS_BY_KIND["github-https"]);
      return Object.freeze({
        kind: "github-https",
        githubAccountIdentity: assertAccountIdentity(provider.githubAccountIdentity),
        githubBaseUrl: assertHttpsOrigin(provider.githubBaseUrl ?? GITHUB_RELEASE_HTTPS_DEFAULT_API_BASE_URL, "githubBaseUrl"),
        githubTokenRef: assertSecretReference(provider.githubTokenRef, "githubTokenRef"),
        npmRegistryBaseUrl: assertHttpsOrigin(provider.npmRegistryBaseUrl ?? GITHUB_RELEASE_HTTPS_DEFAULT_NPM_REGISTRY_BASE_URL, "npmRegistryBaseUrl"),
        repository: assertRepositoryIdentity(provider.repository),
        timeoutMs: assertTimeoutMs(provider.timeoutMs ?? GITHUB_RELEASE_HTTPS_DEFAULT_TIMEOUT_MS),
      });
    }
  }
}

/** Constructs the branded host-owned runner in process. The brand cannot be deserialized, so a
 * runner only ever exists because this function (or another in-process factory) built one. */
export async function createGitHubReleaseRunnerFromOperatorConfig(config: GitHubReleaseRunnerOperatorConfigV1, now: () => Date = () => new Date(), secrets: SecretResolver = createSecretResolver()): Promise<GitHubReleaseRunnerV1> {
  const parsed = parseGitHubReleaseRunnerOperatorConfig(config);
  const journalPrivateKey = createPrivateKey(await readFile(parsed.journalKeyFile));
  const evidencePrivateKey = createPrivateKey(await readFile(parsed.evidenceKeyFile));
  return createGitHubReleaseRunner({
    rootDir: parsed.rootDir,
    journalSigner: { signerId: parsed.journalSignerId, privateKey: journalPrivateKey, publicKey: createPublicKey(journalPrivateKey) },
    evidenceSigner: { signerId: parsed.evidenceSignerId, privateKey: evidencePrivateKey },
    authorizationResolver: handle => resolveAuthorization(parsed, handle, now),
    provider: createReleaseProvider(parsed.provider, secrets),
    now,
  });
}

/** @internal The exact resolver the constructed runner is wired to — same private
 * `resolveAuthorization`, same arguments. Exported so the verification trust boundary is directly
 * testable end to end; deliberately absent from the public host barrel. */
export function createReleaseAuthorizationResolver(config: GitHubReleaseRunnerOperatorConfigV1, now: () => Date = () => new Date()): (handle: string) => Promise<GitHubReleaseAuthorizationContextV1> {
  const parsed = parseGitHubReleaseRunnerOperatorConfig(config);
  return handle => resolveAuthorization(parsed, handle, now);
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

/** One `case` per union arm, and NO default.
 *
 * The removed default said "provider kind must be one of ${PROVIDER_KINDS.join(", ")}" on a value
 * whose kind was already IN `PROVIDER_KINDS` — a message that contradicts itself the moment the
 * tuple carries a kind this switch cannot build, which is exactly the state Lane B passes through.
 * Deleting it is the fix, not rewording it: the scrutinee is the closed kind tuple, so adding
 * `"github-https"` to `PROVIDER_KINDS` without adding a `case` here fails `tsc` ("not all code
 * paths return a value") instead of shipping an unreachable branch that lies. Unknown kinds are
 * already refused by `parseProvider`, which is the only producer of this argument. */
function createReleaseProvider(provider: GitHubReleaseRunnerProviderConfigV1, secrets: SecretResolver): GitHubReleaseProviderV1 {
  switch (provider.kind) {
    case "loopback-fixture": return createLoopbackFixtureProvider(provider.fixtureDir);
    case "github-https": return createGitHubReleaseHttpsProvider({ v: "reelier.github-release-https-provider-config/v1", githubAccountIdentity: provider.githubAccountIdentity, githubBaseUrl: provider.githubBaseUrl, githubTokenRef: provider.githubTokenRef, npmRegistryBaseUrl: provider.npmRegistryBaseUrl, repository: provider.repository, timeoutMs: provider.timeoutMs }, secrets);
  }
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

/** Refuses arrays, `null`, class instances, and `Object.create(null)` — but NOT an unexpected key
 * set, which only `closedRecord` decides once the key set is known. */
function plainRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${label} is not a closed record`);
  return value as Record<string, unknown>;
}

/** Exact key-set equality in BOTH directions: an extra key and a MISSING key are the same refusal.
 * A JSON-parsed `"__proto__"` key is an own enumerable property, so it lands in `Object.keys` and
 * is refused here rather than silently ignored.
 *
 * `optionalKeys` is the ONLY relaxation, and it relaxes exactly one direction: a listed key may be
 * absent (its default applies), an unlisted key is still refused, and a required key is still
 * mandatory. Omit it and the record stays exactly closed. */
function closedRecord(value: unknown, keys: readonly string[], label: string, optionalKeys: readonly string[] = []): Record<string, unknown> {
  const record = plainRecord(value, label);
  const present = Object.keys(record);
  const permitted = new Set([...keys, ...optionalKeys]);
  if (present.some(key => !permitted.has(key)) || keys.some(key => !Object.prototype.hasOwnProperty.call(record, key))) throw new TypeError(`${label} is not a closed record`);
  return record;
}

function absolutePath(value: unknown, label: string): string {
  if (typeof value !== "string" || !value || !path.isAbsolute(value)) throw new TypeError(`${label} must be an absolute path`);
  return value;
}

function signerId(value: unknown, label: string): string {
  if (typeof value !== "string" || !SIGNER_ID.test(value)) throw new TypeError(`${label} identity is invalid`);
  return value;
}

/** The release verifier hard-requires a canonical ed25519 SPKI (`release-contracts.ts` —
 * `parseReleaseContractVerifierInput`). Checking the SAME property here means a garbage or
 * wrong-algorithm operator key refuses at STARTUP, not on the first authorization dispatch. */
function publicKeySpki(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new TypeError(`${label} public SPKI is required`);
  const bytes = Buffer.from(value, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== value) throw new TypeError(`${label} public SPKI is not canonical base64`);
  try {
    const key = createPublicKey({ key: bytes, format: "der", type: "spki" });
    if (key.type !== "public" || key.asymmetricKeyType !== "ed25519" || !Buffer.from(key.export({ format: "der", type: "spki" })).equals(bytes)) throw new TypeError("noncanonical");
  } catch { throw new TypeError(`${label} public SPKI is not a canonical ed25519 SPKI public key`); }
  return value;
}
