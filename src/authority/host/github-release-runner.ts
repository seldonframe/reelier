import { createHash } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { authorityDigest } from "../wire.js";
import { assertVerifiedReleaseAuthorizationV1, type ReleaseContractSignerV1, type ReleaseProviderEffectV1, type VerifiedReleaseAuthorizationV1 } from "../release-contracts.js";
import { createSignedJournal, type SignedJournal, type SignedJournalEventV1 } from "./signed-journal.js";
import { createGitHubReleaseProviderEvidence } from "./github-release-evidence.js";

const ALIASES = Object.freeze({ github_release_candidate_publish_v1: "candidate-branch", github_release_pr_ensure_v1: "draft-pr", github_release_pr_merge_v1: "exact-sha-merge", github_release_tag_create_v1: "non-force-tag" } satisfies Record<string, ReleaseProviderEffectV1>);
const LANES = Object.freeze({ "candidate-branch": "candidate-branch", "draft-pr": "candidate-pull-request", "exact-sha-merge": "merge-exact-sha", "non-force-tag": "tag-immutable-ref" } as const);
const TERMINAL = new Set(["candidate-verified", "pr-verified", "merge-verified", "tag-verified"]);
const TRANSITIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  authorized: ["blob-intent", "pr-intent", "merge-intent", "tag-intent"], "blob-intent": ["blob-created"], "blob-created": ["blob-intent", "tree-intent"], "tree-intent": ["tree-created"], "tree-created": ["commit-intent"], "commit-intent": ["commit-created"], "commit-created": ["branch-intent"], "branch-intent": ["candidate-verified"],
  "pr-intent": ["pr-created", "pr-verified"], "pr-created": ["pr-verified"], "merge-intent": ["merge-verified"], "tag-intent": ["tag-verified"],
});

export type GitHubReleaseAliasV1 = keyof typeof ALIASES;
export interface GitHubReleaseAuthorizationContextV1 { readonly authorization: VerifiedReleaseAuthorizationV1; readonly fileContents: readonly Readonly<{ path: string; bytesBase64: string }>[] }
export interface GitHubReleaseProviderV1 {
  createBlob(input: Readonly<{ repository: string; contentBase64: string }>): Promise<Readonly<{ sha: string }>>;
  createTree(input: Readonly<{ repository: string; baseCommit: string; files: readonly Readonly<{ path: string; mode: string; blobSha: string }>[] }>): Promise<Readonly<{ sha: string }>>;
  createCommit(input: Readonly<Record<string, unknown>>): Promise<Readonly<{ sha: string }>>;
  getRef(input: Readonly<{ repository: string; ref: string }>): Promise<Readonly<{ sha: string }> | null>;
  createRef(input: Readonly<{ repository: string; ref: string; sha: string; force: false }>): Promise<Readonly<{ sha: string }>>;
  getCommit(input: Readonly<{ repository: string; sha: string }>): Promise<Readonly<{ sha: string; parentSha: string; treeSha: string }> | null>;
  findPullRequests(input: Readonly<Record<string, unknown>>): Promise<readonly Readonly<Record<string, unknown>>[]>;
  createPullRequest(input: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>;
  getPullRequest(input: Readonly<{ repository: string; number: number }>): Promise<Readonly<Record<string, unknown>> | null>;
  getChecks(input: Readonly<{ repository: string; sha: string }>): Promise<readonly Readonly<{ name: string; status: string; workflowDigest: string }>[] >;
  mergePullRequest(input: Readonly<Record<string, unknown>>): Promise<Readonly<{ merged: boolean; sha: string }>>;
  npmVersionExists(input: Readonly<{ packageName: string; version: string }>): Promise<boolean>;
  readPackageManifest(input: Readonly<{ repository: string; sha: string }>): Promise<Readonly<{ name: string; version: string }>>;
}
export interface GitHubReleaseRunResultV1 { readonly status: "verified" | "pending-reconciliation" | "refused"; readonly phase: string; readonly evidenceDigest: string | null }
export interface GitHubReleaseRunnerV1 { run(input: Readonly<{ alias: GitHubReleaseAliasV1; authorizationHandle: string; requestId: string; semanticsDigest: string }>): Promise<GitHubReleaseRunResultV1>; recover(): Promise<readonly string[]> }

export async function createGitHubReleaseRunner(input: Readonly<{ rootDir: string; journalSigner: Readonly<{ signerId: string; privateKey: KeyObject; publicKey: KeyObject }>; evidenceSigner: ReleaseContractSignerV1; authorizationResolver: (handle: string) => Promise<GitHubReleaseAuthorizationContextV1 | VerifiedReleaseAuthorizationV1>; provider: GitHubReleaseProviderV1; now: () => Date }>): Promise<GitHubReleaseRunnerV1> {
  if (!path.isAbsolute(input.rootDir)) throw new TypeError("GitHub release runner root must be absolute");
  await mkdir(input.rootDir, { recursive: true });
  const journal = await createSignedJournal({ rootDir: path.join(input.rootDir, "journal"), journalId: "github-release", ...input.journalSigner });
  const run = async (request: Readonly<{ alias: GitHubReleaseAliasV1; authorizationHandle: string; requestId: string; semanticsDigest: string }>): Promise<GitHubReleaseRunResultV1> => {
    validateRequest(request);
    const resolved = await input.authorizationResolver(request.authorizationHandle);
    const context: GitHubReleaseAuthorizationContextV1 = "authorization" in resolved && "fileContents" in resolved ? resolved as GitHubReleaseAuthorizationContextV1 : { authorization: resolved as VerifiedReleaseAuthorizationV1, fileContents: [] };
    assertVerifiedReleaseAuthorizationV1(context.authorization);
    const authorization = context.authorization, effect = ALIASES[request.alias], now = input.now();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || now.getTime() < Date.parse(authorization.authorization.value.issuedAt) || now.getTime() >= Date.parse(authorization.authorization.value.expiresAt)) throw new TypeError("release authorization is stale or clock is invalid");
    const allocation = authorization.authorization.value.effectAllocations.find(candidate => candidate.effect === effect);
    if (!allocation || allocation.maxEffects !== 1 || !/^sha256:[0-9a-f]{64}$/.test(allocation.allocationDigest) || !/^[a-z0-9][a-z0-9-]{7,127}$/.test(allocation.allocationId)) throw new TypeError("release alias does not have an exact one-effect allocation");
    let events = await journal.load(request.requestId);
    if (events.length > 0) {
      if (events[0].semanticsDigest !== request.semanticsDigest) throw new TypeError("release requestId semantic reuse is forbidden before provider dispatch");
      const root = events[0].data;
      if (root.alias !== request.alias || root.authorizationHandle !== request.authorizationHandle || root.allocationId !== allocation.allocationId || root.allocationDigest !== allocation.allocationDigest || root.effect !== effect) throw new TypeError("release journal authority binding is inconsistent");
      const terminal = events.at(-1)!;
      if (TERMINAL.has(terminal.phase)) return Object.freeze({ status: "verified", phase: terminal.phase, evidenceDigest: terminal.data.evidenceDigest as string });
    } else {
      await journal.append(request.requestId, request.semanticsDigest, "authorized", { alias: request.alias, allocationDigest: allocation.allocationDigest, allocationId: allocation.allocationId, authorizationDigest: authorization.authorization.digest, authorizationHandle: request.authorizationHandle, effect });
      events = await journal.load(request.requestId);
    }
    if (effect === "candidate-branch") return candidate(request, context, events, journal, input.provider, input.evidenceSigner, now);
    if (effect === "draft-pr") return pullRequest(request, authorization, events, journal, input.provider, input.evidenceSigner, now);
    if (effect === "exact-sha-merge") return merge(request, authorization, events, journal, input.provider, input.evidenceSigner, now);
    return tag(request, authorization, events, journal, input.provider, input.evidenceSigner, now);
  };
  const recover = async (): Promise<readonly string[]> => {
    const recovered: string[] = [];
    for (const requestId of await journal.listRequestIds()) {
      const first = (await journal.load(requestId))[0];
      if (!first || TERMINAL.has((await journal.load(requestId)).at(-1)!.phase)) continue;
      const result = await run({ alias: first.data.alias as GitHubReleaseAliasV1, authorizationHandle: first.data.authorizationHandle as string, requestId, semanticsDigest: first.semanticsDigest });
      if (result.status === "verified") recovered.push(requestId);
    }
    return Object.freeze(recovered);
  };
  return Object.freeze({ run, recover });
}

async function candidate(request: any, context: GitHubReleaseAuthorizationContextV1, initial: readonly SignedJournalEventV1[], journal: SignedJournal, provider: GitHubReleaseProviderV1, signer: ReleaseContractSignerV1, now: Date): Promise<GitHubReleaseRunResultV1> {
  const auth = context.authorization, plan = auth.operationPlan.value, byPath = new Map(context.fileContents.map(file => [file.path, file.bytesBase64]));
  for (let index = 0; index < plan.files.length; index += 1) {
    const file = plan.files[index], bytesBase64 = byPath.get(file.path); if (!bytesBase64) throw new TypeError("authenticated candidate file bytes are missing");
    const bytes = Buffer.from(bytesBase64, "base64"); if (bytes.toString("base64") !== bytesBase64 || sha256(bytes) !== file.contentDigest || gitBlobSha(bytes) !== file.blobSha) throw new TypeError("candidate bytes do not match signed content and Git blob commitments");
    if (!has(initial, "blob-created", "index", index)) { await step(journal, request, "blob-intent", { index, path: file.path }); const result = await provider.createBlob({ repository: plan.repository, contentBase64: bytesBase64 }); if (result.sha !== file.blobSha) throw new TypeError("provider blob readback does not match expected Git SHA"); await step(journal, request, "blob-created", { index, sha: result.sha }); }
  }
  let events = await journal.load(request.requestId);
  if (!has(events, "tree-created")) { await step(journal, request, "tree-intent", {}); const tree = await provider.createTree({ repository: plan.repository, baseCommit: plan.baseCommit, files: plan.files.map(file => ({ path: file.path, mode: file.mode, blobSha: file.blobSha })) }); if (tree.sha !== plan.expectedTreeSha) throw new TypeError("provider tree SHA is not authorized"); await step(journal, request, "tree-created", { sha: tree.sha }); }
  events = await journal.load(request.requestId);
  if (!has(events, "commit-created")) { await step(journal, request, "commit-intent", {}); const commit = await provider.createCommit({ repository: plan.repository, treeSha: plan.expectedTreeSha, ...plan.commit }); if (commit.sha !== plan.expectedCommitSha) throw new TypeError("provider commit SHA is not authorized"); await step(journal, request, "commit-created", { sha: commit.sha }); }
  events = await journal.load(request.requestId); const refName = `heads/${plan.candidateBranch}`, existing = await provider.getRef({ repository: plan.repository, ref: refName });
  if (existing && existing.sha !== plan.expectedCommitSha) throw new TypeError("candidate branch ref conflicts with authorization");
  if (!existing) { if (has(events, "branch-intent")) return pending("branch-intent"); await step(journal, request, "branch-intent", {}); try { await provider.createRef({ repository: plan.repository, ref: refName, sha: plan.expectedCommitSha, force: false }); } catch { /* authoritative readback below */ } }
  const reconciled = await provider.getRef({ repository: plan.repository, ref: refName }), commit = await provider.getCommit({ repository: plan.repository, sha: plan.expectedCommitSha });
  if (!reconciled || reconciled.sha !== plan.expectedCommitSha) return pending("branch-intent");
  if (!commit || commit.parentSha !== plan.baseCommit || commit.treeSha !== plan.expectedTreeSha) throw new TypeError("candidate commit parent or tree readback is tampered");
  return finish(journal, request, auth, "candidate-branch", "candidate-verified", authorityDigest({ ref: reconciled, commit }), signer, now);
}

async function pullRequest(request: any, auth: VerifiedReleaseAuthorizationV1, events: readonly SignedJournalEventV1[], journal: SignedJournal, provider: GitHubReleaseProviderV1, signer: ReleaseContractSignerV1, now: Date): Promise<GitHubReleaseRunResultV1> {
  const plan = auth.operationPlan.value; let matches = await provider.findPullRequests({ repository: plan.repository, head: plan.pullRequest.head, base: plan.pullRequest.base });
  if (matches.length > 1) throw new TypeError("multiple release pull requests conflict");
  if (matches.length === 0) { if (has(events, "pr-intent")) return pending("pr-intent"); await step(journal, request, "pr-intent", {}); try { await provider.createPullRequest({ repository: plan.repository, ...plan.pullRequest }); } catch { /* lookup below */ } matches = await provider.findPullRequests({ repository: plan.repository, head: plan.pullRequest.head, base: plan.pullRequest.base }); if (matches.length === 0) return pending("pr-intent"); if (matches.length > 1) throw new TypeError("multiple release pull requests conflict after ambiguous create"); await step(journal, request, "pr-created", { number: matches[0].number }); }
  const pr = matches[0] as any; if (pr.head !== plan.pullRequest.head || pr.base !== plan.pullRequest.base || pr.draft !== true || pr.title !== plan.pullRequest.title || pr.body !== plan.pullRequest.body || pr.headSha !== plan.expectedCommitSha) throw new TypeError("pull request readback does not match exact authorized metadata");
  return finish(journal, request, auth, "candidate-pull-request", "pr-verified", authorityDigest(pr), signer, now);
}

async function merge(request: any, auth: VerifiedReleaseAuthorizationV1, events: readonly SignedJournalEventV1[], journal: SignedJournal, provider: GitHubReleaseProviderV1, signer: ReleaseContractSignerV1, now: Date): Promise<GitHubReleaseRunResultV1> {
  const plan = auth.operationPlan.value, base = await provider.getRef({ repository: plan.repository, ref: "heads/main" }); if (!base || (base.sha !== plan.baseCommit && base.sha !== plan.expectedSquashCommitSha)) throw new TypeError("release base branch drifted");
  const matches = await provider.findPullRequests({ repository: plan.repository, head: plan.pullRequest.head, base: plan.pullRequest.base }); if (matches.length !== 1) throw new TypeError("release merge requires exactly one pull request");
  let pr: any = matches[0]; if (pr.headSha !== plan.expectedCommitSha) throw new TypeError("release pull request head SHA drifted");
  if (!pr.merged) {
    const checks = await provider.getChecks({ repository: plan.repository, sha: plan.expectedCommitSha }), names = checks.map(check => check.name).sort(); if (names.join("\0") !== [...plan.requiredChecks].sort().join("\0") || checks.some(check => check.status !== "success" || check.workflowDigest !== plan.workflowCommitments[0].digest)) throw new TypeError("required release checks or workflow commitment are missing or failed");
    if (has(events, "merge-intent")) return pending("merge-intent"); await step(journal, request, "merge-intent", {}); try { await provider.mergePullRequest({ repository: plan.repository, number: pr.number, expectedHeadSha: plan.expectedCommitSha, method: "squash", ...plan.squash }); } catch { /* never resend; read below */ }
    pr = await provider.getPullRequest({ repository: plan.repository, number: pr.number });
  }
  const main = await provider.getRef({ repository: plan.repository, ref: "heads/main" }), commit = await provider.getCommit({ repository: plan.repository, sha: plan.expectedSquashCommitSha });
  if (!pr || pr.merged !== true || pr.mergeCommitSha !== plan.expectedSquashCommitSha || !main || main.sha !== plan.expectedSquashCommitSha) return pending("merge-intent");
  if (!commit || commit.treeSha !== plan.expectedTreeSha) throw new TypeError("squash commit tree readback is tampered");
  return finish(journal, request, auth, "merge-exact-sha", "merge-verified", authorityDigest({ pr, main, commit }), signer, now);
}

async function tag(request: any, auth: VerifiedReleaseAuthorizationV1, events: readonly SignedJournalEventV1[], journal: SignedJournal, provider: GitHubReleaseProviderV1, signer: ReleaseContractSignerV1, now: Date): Promise<GitHubReleaseRunResultV1> {
  const plan = auth.operationPlan.value, manifest = await provider.readPackageManifest({ repository: plan.repository, sha: plan.expectedSquashCommitSha }); if (manifest.name !== plan.npmPreflight.packageName || manifest.version !== plan.npmPreflight.version) throw new TypeError("release package name or version mismatch");
  if (await provider.npmVersionExists({ packageName: manifest.name, version: manifest.version })) throw new TypeError("release npm version already exists");
  const main = await provider.getRef({ repository: plan.repository, ref: "heads/main" }); if (!main || main.sha !== plan.expectedSquashCommitSha) throw new TypeError("release main ref does not match authorized squash commit");
  const ref = `tags/${plan.tag}`, existing = await provider.getRef({ repository: plan.repository, ref }); if (existing && existing.sha !== plan.expectedSquashCommitSha) throw new TypeError("release tag ref conflicts");
  if (!existing) { if (has(events, "tag-intent")) return pending("tag-intent"); await step(journal, request, "tag-intent", {}); try { await provider.createRef({ repository: plan.repository, ref, sha: plan.expectedSquashCommitSha, force: false }); } catch { /* never resend; read below */ } }
  const tagged = await provider.getRef({ repository: plan.repository, ref }); if (!tagged || tagged.sha !== plan.expectedSquashCommitSha) return pending("tag-intent");
  return finish(journal, request, auth, "tag-immutable-ref", "tag-verified", authorityDigest({ tagged, manifest, npmVersionAbsent: true }), signer, now);
}

async function finish(journal: SignedJournal, request: any, auth: VerifiedReleaseAuthorizationV1, lane: any, phase: string, subjectDigest: string, signer: ReleaseContractSignerV1, now: Date): Promise<GitHubReleaseRunResultV1> { const evidence = createGitHubReleaseProviderEvidence({ authorization: auth, lane, observedAt: now.toISOString(), subjectDigest, signer }); await step(journal, request, phase, { evidence, evidenceDigest: evidence.digest, subjectDigest }); return Object.freeze({ status: "verified", phase, evidenceDigest: evidence.digest }); }
async function step(journal: SignedJournal, request: any, phase: string, data: Readonly<Record<string, unknown>>): Promise<void> { const events = await journal.load(request.requestId), prior = events.at(-1)?.phase; if (!prior || !TRANSITIONS[prior]?.includes(phase)) { if (events.some(event => event.phase === phase && authorityDigest(event.data) === authorityDigest(data))) return; throw new TypeError(`invalid release saga transition ${prior ?? "absent"} -> ${phase}`); } await journal.append(request.requestId, request.semanticsDigest, phase, data); }
function has(events: readonly SignedJournalEventV1[], phase: string, key?: string, value?: unknown): boolean { return events.some(event => event.phase === phase && (key === undefined || event.data[key] === value)); }
function pending(phase: string): GitHubReleaseRunResultV1 { return Object.freeze({ status: "pending-reconciliation", phase, evidenceDigest: null }); }
function sha256(bytes: Uint8Array): string { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }
function gitBlobSha(bytes: Uint8Array): string { return createHash("sha1").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex"); }
function validateRequest(request: any): void { if (!request || typeof request !== "object" || Object.keys(request).sort().join("\0") !== ["alias", "authorizationHandle", "requestId", "semanticsDigest"].sort().join("\0") || !(request.alias in ALIASES) || !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(request.authorizationHandle) || !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(request.requestId) || !/^sha256:[0-9a-f]{64}$/.test(request.semanticsDigest)) throw new TypeError("GitHub release request is invalid"); }
