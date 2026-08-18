import type { KeyObject } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { authorityDigest } from "../wire.js";
import { assertVerifiedReleaseAuthorizationV1, type ReleaseContractSignerV1, type ReleaseProviderEffectV1, type VerifiedReleaseAuthorizationV1 } from "../release-contracts.js";
import { createSignedJournal, type SignedJournal } from "./signed-journal.js";

const ALIASES = Object.freeze({
  github_release_candidate_publish_v1: "candidate-branch",
  github_release_pr_ensure_v1: "draft-pr",
  github_release_pr_merge_v1: "exact-sha-merge",
  github_release_tag_create_v1: "non-force-tag",
} satisfies Record<string, ReleaseProviderEffectV1>);
export type GitHubReleaseAliasV1 = keyof typeof ALIASES;

export interface GitHubReleaseProviderV1 {
  readonly getRef?: (...args: any[]) => Promise<any>;
  readonly createBlob?: (...args: any[]) => Promise<any>;
  readonly createTree?: (...args: any[]) => Promise<any>;
  readonly createCommit?: (...args: any[]) => Promise<any>;
  readonly createRef?: (...args: any[]) => Promise<any>;
  readonly findPullRequests?: (...args: any[]) => Promise<any>;
  readonly createPullRequest?: (...args: any[]) => Promise<any>;
  readonly getPullRequest?: (...args: any[]) => Promise<any>;
  readonly getChecks?: (...args: any[]) => Promise<any>;
  readonly mergePullRequest?: (...args: any[]) => Promise<any>;
  readonly getCommit?: (...args: any[]) => Promise<any>;
  readonly npmVersionExists?: (...args: any[]) => Promise<any>;
}

export interface GitHubReleaseRunResultV1 { readonly status: "verified" | "pending-reconciliation" | "refused"; readonly phase: string; readonly evidenceDigest: string | null }
export interface GitHubReleaseRunnerV1 {
  run(input: Readonly<{ alias: GitHubReleaseAliasV1; authorizationHandle: string; requestId: string; semanticsDigest: string }>): Promise<GitHubReleaseRunResultV1>;
  recover(): Promise<readonly string[]>;
}

export async function createGitHubReleaseRunner(input: Readonly<{
  rootDir: string;
  journalSigner: Readonly<{ signerId: string; privateKey: KeyObject; publicKey: KeyObject }>;
  evidenceSigner: ReleaseContractSignerV1;
  authorizationResolver: (handle: string) => Promise<VerifiedReleaseAuthorizationV1>;
  provider: GitHubReleaseProviderV1;
  now: () => Date;
}>): Promise<GitHubReleaseRunnerV1> {
  if (!path.isAbsolute(input.rootDir)) throw new TypeError("GitHub release runner root must be absolute");
  await mkdir(input.rootDir, { recursive: true });
  const journal: SignedJournal = await createSignedJournal({ rootDir: path.join(input.rootDir, "journal"), journalId: "github-release", ...input.journalSigner });
  const run = async (request: Readonly<{ alias: GitHubReleaseAliasV1; authorizationHandle: string; requestId: string; semanticsDigest: string }>): Promise<GitHubReleaseRunResultV1> => {
    if (!(request.alias in ALIASES) || !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(request.authorizationHandle) || !/^sha256:[0-9a-f]{64}$/.test(request.semanticsDigest)) throw new TypeError("GitHub release request is invalid");
    const authorization = await input.authorizationResolver(request.authorizationHandle);
    assertVerifiedReleaseAuthorizationV1(authorization);
    const effect = ALIASES[request.alias];
    const allocation = authorization.authorization.value.effectAllocations.find(candidate => candidate.effect === effect);
    if (!allocation || allocation.maxEffects !== 1 || !/^sha256:[0-9a-f]{64}$/.test(allocation.allocationDigest) || !/^[a-z0-9][a-z0-9-]{7,127}$/.test(allocation.allocationId)) throw new TypeError("release alias does not have an exact one-effect allocation");
    const events = await journal.load(request.requestId);
    if (events.length > 0 && events[0].semanticsDigest !== request.semanticsDigest) throw new TypeError("release requestId semantic reuse is forbidden before provider dispatch");
    await journal.append(request.requestId, request.semanticsDigest, "authorized", { alias: request.alias, allocationDigest: allocation.allocationDigest, allocationId: allocation.allocationId, authorizationDigest: authorization.authorization.digest, effect });
    return Object.freeze({ status: "pending-reconciliation" as const, phase: "authorized", evidenceDigest: null });
  };
  return Object.freeze({ run, recover: async () => Object.freeze([]) });
}
