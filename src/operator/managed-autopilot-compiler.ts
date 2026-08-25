import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import canonicalize from "canonicalize";
import {
  parseManagedUpgradeTargetManifestV1,
  type ManagedUpgradeExecutionTargetManifestV2,
  type ManagedUpgradeGithubOnlyExecutionTargetManifestV3,
} from "./autopilot-handoff-client.js";
import {
  parseAutopilotTargetSelectionV1,
  type AutopilotTargetSelectionV1,
} from "./autopilot-target-selection-client.js";
import {
  loadManagedUpgradeTargetBundleV1,
  stageManagedUpgradeTargetBundleV1,
  type ManagedUpgradeTargetBundleV1,
} from "./managed-upgrade-target-store.js";

const SHA1 = /^[0-9a-f]{40}$/u;
const CHECK = /^[^\u0000-\u001f\u007f]{1,128}$/u;
const MAX_GIT_OUTPUT = 5 * 1024 * 1024;

type GitRunner = (args: readonly string[]) => Promise<Buffer>;

function digest(bytes: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalBytes(value: unknown): Buffer {
  const encoded = canonicalize(value);
  if (typeof encoded !== "string") throw new TypeError("Autopilot candidate is not canonicalizable");
  return Buffer.from(encoded, "utf8");
}

function gitBlobSha(bytes: Uint8Array): string {
  return createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${bytes.byteLength}\0`), Buffer.from(bytes)])).digest("hex");
}

function gitCommitSha(input: Readonly<{ tree: string; parent: string; message: string; name: string; email: string; date: Date }>): string {
  const timestamp = Math.floor(input.date.getTime() / 1000), identity = `${input.name} <${input.email}> ${timestamp} +0000`;
  const body = Buffer.from(`tree ${input.tree}\nparent ${input.parent}\nauthor ${identity}\ncommitter ${identity}\n\n${input.message}`, "utf8");
  return createHash("sha1").update(Buffer.concat([Buffer.from(`commit ${body.byteLength}\0`), body])).digest("hex");
}

function defaultGit(root: string): GitRunner {
  return args => new Promise((resolve, reject) => {
    const child = spawn("git", [...args], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    let total = 0;
    const collect = (target: Buffer[], chunk: Buffer) => {
      total += chunk.byteLength;
      if (total > MAX_GIT_OUTPUT) { child.kill(); reject(new TypeError("Git inspection output is too large")); return; }
      target.push(chunk);
    };
    child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
    child.once("error", reject);
    child.once("close", code => code === 0 ? resolve(Buffer.concat(stdout)) : reject(new TypeError(`Git inspection refused: ${Buffer.concat(stderr).toString("utf8").trim() || "command failed"}`)));
  });
}

function text(buffer: Buffer): string { return buffer.toString("utf8").trim(); }

function repositoryFromRemote(value: string): string {
  const trimmed = value.trim();
  const https = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/u.exec(trimmed);
  const ssh = /^(?:ssh:\/\/git@github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/u.exec(trimmed);
  const repository = (https ?? ssh)?.[1];
  if (!repository) throw new TypeError("Autopilot requires an exact GitHub origin repository");
  return repository;
}

async function baseBranch(git: GitRunner): Promise<string> {
  try {
    const symbolic = text(await git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]));
    if (/^origin\/[A-Za-z0-9._/-]+$/u.test(symbolic)) return symbolic.slice("origin/".length);
  } catch { /* explicit fallbacks below */ }
  for (const candidate of ["main", "master"]) {
    try { if (SHA1.test(text(await git(["rev-parse", `refs/remotes/origin/${candidate}`])))) return candidate; } catch { /* next */ }
  }
  throw new TypeError("Autopilot cannot determine the exact origin base branch");
}

function changedPaths(value: Buffer): readonly Readonly<{ status: string; path: string }>[] {
  const tokens = value.toString("utf8").split("\0").filter(Boolean), result: Array<{ status: string; path: string }> = [];
  for (let index = 0; index < tokens.length;) {
    const token = tokens[index++]!;
    const tab = /^([A-Z])\t(.+)$/u.exec(token);
    const status = tab?.[1] ?? token;
    const target = tab?.[2] ?? tokens[index++];
    if (!/^[A-Z]$/u.test(status) || typeof target !== "string" || target.length < 1) throw new TypeError("Git candidate change inventory is invalid");
    if (status === "D") throw new TypeError("Git candidate deletions are not supported by the reviewed publisher");
    if (!["A", "M", "T"].includes(status)) throw new TypeError("Git candidate contains an unsupported change kind");
    if (target.startsWith(".reelier/") || target === ".reelier" || target.includes("\\") || target.split("/").some(segment => !segment || segment === "." || segment === ".." || segment.toLowerCase() === ".git")) throw new TypeError("Git candidate path is invalid");
    result.push({ status, path: target });
  }
  if (result.length < 1 || result.length > 512 || new Set(result.map(item => item.path)).size !== result.length) throw new TypeError("Git candidate must contain 1 to 512 unique changed files");
  return Object.freeze(result.sort((left, right) => left.path.localeCompare(right.path)));
}

function lsTree(value: Buffer, expectedPath: string): Readonly<{ mode: "100644" | "100755" | "120000"; sha: string }> {
  const match = /^(100644|100755|120000) blob ([0-9a-f]{40})\t([^\0]+)\0$/u.exec(value.toString("utf8"));
  if (!match || match[3] !== expectedPath) throw new TypeError("Git candidate tree entry is invalid");
  return Object.freeze({ mode: match[1] as "100644" | "100755" | "120000", sha: match[2]! });
}

function checks(value: readonly string[]): readonly string[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length < 1 || value.length > 32 || value.some(item => typeof item !== "string" || !CHECK.test(item)) || new Set(value).size !== value.length) throw new TypeError("Autopilot required checks must be a non-empty unique bounded list");
  return Object.freeze([...value].sort((left, right) => left.localeCompare(right)));
}

function exactRetry(bundle: ManagedUpgradeTargetBundleV1, selection: AutopilotTargetSelectionV1, requiredChecks?: readonly string[]): ManagedUpgradeTargetBundleV1 {
  const manifest = bundle.targetManifest;
  if (manifest.version !== "reelier.managed-upgrade-target-manifest/v2") throw new TypeError("existing Autopilot target is not execution-ready");
  const linear = manifest.authority.linear;
  if (manifest.missionRef !== selection.missionRef || manifest.linearTarget.workspaceId !== selection.workspaceId || manifest.linearTarget.teamId !== selection.teamId || manifest.linearTarget.projectId !== selection.projectId || linear.githubLinear.issue !== selection.composite.issueId || linear.githubLinear.preStatus !== selection.composite.preStatusName || linear.githubLinear.targetStatus !== selection.composite.targetStatusName || linear.linearOnly.issue !== selection.linearOnly.issueId || linear.linearOnly.preStatus !== selection.linearOnly.preStatusName || linear.linearOnly.targetStatus !== selection.linearOnly.targetStatusName || (requiredChecks && JSON.stringify(manifest.authority.github.requiredChecks) !== JSON.stringify(requiredChecks))) throw new TypeError("existing Autopilot target conflicts with the exact selected authority");
  return bundle;
}

function inferWorkflowChecks(value: Buffer): readonly string[] {
  const source = value.toString("utf8");
  if (source.includes("\t") || source.length > 1_048_576) throw new TypeError("Autopilot workflow is not safely inspectable");
  const lines = source.split(/\r?\n/u), jobsIndex = lines.findIndex(line => /^jobs:\s*(?:#.*)?$/u.test(line));
  if (jobsIndex < 0) throw new TypeError("Autopilot workflow has no closed jobs map");
  const discovered: string[] = [];
  for (let index = jobsIndex + 1; index < lines.length;) {
    const line = lines[index]!;
    if (line && !/^\s/u.test(line)) break;
    const job = /^  ([A-Za-z0-9_-]+):\s*(?:#.*)?$/u.exec(line);
    if (!job) { index += 1; continue; }
    const id = job[1]!;
    let name = id;
    index += 1;
    for (; index < lines.length; index += 1) {
      const nested = lines[index]!;
      if (/^  [A-Za-z0-9_-]+:\s*(?:#.*)?$/u.test(nested) || (nested && !/^\s/u.test(nested))) break;
      if (/^    strategy:\s*/u.test(nested) || /^      matrix:\s*/u.test(nested)) throw new TypeError("Autopilot workflow matrix checks require an explicit reviewed check list");
      const candidate = /^    name:\s*(.+?)\s*$/u.exec(nested)?.[1];
      if (candidate) name = candidate.replace(/^(["'])(.*)\1$/u, "$2");
    }
    discovered.push(name);
  }
  return checks(discovered);
}

type FrozenGitCandidate = Readonly<{
  repository: string;
  artifactBytes: Buffer;
  artifactDigest: string;
  expiresAt: string;
  github: ManagedUpgradeExecutionTargetManifestV2["authority"]["github"];
}>;

async function freezeGitCandidate(input: Readonly<{
  root: string;
  missionRef: string;
  requiredChecks?: readonly string[];
  workflowPath?: string;
  now?: () => Date;
  git?: GitRunner;
}>): Promise<FrozenGitCandidate> {
  const requestedChecks = input.requiredChecks ? checks(input.requiredChecks) : undefined;
  const git = input.git ?? defaultGit(path.resolve(input.root));
  const dirty = text(await git(["status", "--porcelain=v1", "--untracked-files=all", "--", ".", ":(exclude).reelier"]));
  if (dirty) throw new TypeError("Autopilot requires a clean committed Git candidate");
  const repository = repositoryFromRemote(text(await git(["remote", "get-url", "origin"])));
  const base = await baseBranch(git), baseSha = text(await git(["rev-parse", `refs/remotes/origin/${base}`])), treeSha = text(await git(["rev-parse", "HEAD^{tree}"]));
  if (!SHA1.test(baseSha) || !SHA1.test(treeSha)) throw new TypeError("Autopilot Git authority is invalid");
  const inventory = changedPaths(await git(["diff", "--name-status", "-z", "--no-renames", baseSha, "HEAD"]));
  const files = [] as Array<Readonly<{ path: string; mode: "100644" | "100755" | "120000"; contentBase64: string; blobSha: string }>>;
  for (const item of inventory) {
    const entry = lsTree(await git(["ls-tree", "-z", "HEAD", "--", item.path]), item.path), content = await git(["show", `HEAD:${item.path}`]);
    if (gitBlobSha(content) !== entry.sha) throw new TypeError("Git candidate blob does not match its committed content");
    files.push(Object.freeze({ path: item.path, mode: entry.mode, contentBase64: content.toString("base64"), blobSha: entry.sha }));
  }
  const workflowPath = input.workflowPath ?? ".github/workflows/ci.yml";
  if (!/^\.github\/workflows\/[A-Za-z0-9._-]+\.ya?ml$/u.test(workflowPath)) throw new TypeError("Autopilot workflow path is invalid");
  const workflow = await git(["show", `HEAD:${workflowPath}`]), requiredChecks = requestedChecks ?? inferWorkflowChecks(workflow);
  const name = text(await git(["config", "user.name"])), email = text(await git(["config", "user.email"]));
  if (!name || name.length > 128 || /[<>\r\n]/u.test(name) || !/^[^\s@]{1,128}@[^\s@]{1,128}$/u.test(email)) throw new TypeError("Autopilot Git actor is invalid");
  const now = (input.now ?? (() => new Date()))();
  if (Number.isNaN(now.getTime())) throw new TypeError("Autopilot compile time is invalid");
  const message = `Reelier mission ${input.missionRef}`, headBranch = `reelier/${input.missionRef}`, headSha = gitCommitSha({ tree: treeSha, parent: baseSha, message, name, email, date: now });
  const artifact = Object.freeze({ v: "reelier.github-candidate-artifact/v1" as const, repository, baseSha, headBranch, expectedHeadSha: headSha, expectedTreeSha: treeSha, commit: Object.freeze({ message, author: Object.freeze({ name, email, date: now.toISOString() }), committer: Object.freeze({ name, email, date: now.toISOString() }) }), files: Object.freeze(files) });
  const artifactBytes = canonicalBytes(artifact), artifactDigest = digest(artifactBytes), expiresAt = new Date(now.getTime() + 15 * 60_000).toISOString();
  return Object.freeze({ repository, artifactBytes, artifactDigest, expiresAt, github: Object.freeze({ repository, baseBranch: base, baseSha, headBranch, headSha, candidateDigest: artifactDigest, workflowPath, workflowDigest: digest(workflow), requiredChecks, postMergeTreeSha: treeSha }) });
}

export async function compileAndStageManagedAutopilotBundleV1(input: Readonly<{
  root: string;
  missionRef: string;
  selection: AutopilotTargetSelectionV1;
  requiredChecks?: readonly string[];
  workflowPath?: string;
  now?: () => Date;
  git?: GitRunner;
}>): Promise<ManagedUpgradeTargetBundleV1> {
  const selection = parseAutopilotTargetSelectionV1(input.selection);
  if (selection.missionRef !== input.missionRef) throw new TypeError("Autopilot selection mission binding mismatch");
  const requestedChecks = input.requiredChecks ? checks(input.requiredChecks) : undefined;
  try { return exactRetry(await loadManagedUpgradeTargetBundleV1({ root: input.root, missionRef: input.missionRef }), selection, requestedChecks); }
  catch (error) { if ((error as { code?: string }).code !== "ENOENT") throw error; }

  const frozen = await freezeGitCandidate(input), { repository, artifactBytes, artifactDigest, expiresAt, github } = frozen;
  const compositeEvidenceDigest = digest(canonicalBytes({ v: "reelier.autopilot-evidence/v1", repository, headSha: github.headSha, treeSha: github.postMergeTreeSha }));
  const linearOnlyEvidenceDigest = digest(canonicalBytes({ v: "reelier.autopilot-evidence/v1", missionRef: input.missionRef, issue: selection.linearOnly.issueId, project: selection.projectId }));
  const linearTarget = { workspaceId: selection.workspaceId, teamId: selection.teamId, projectId: selection.projectId, issueIds: [selection.composite.issueId, selection.linearOnly.issueId] };
  const target = (mode: "composite" | "linear-only") => {
    const operation = mode === "composite" ? selection.composite : selection.linearOnly, evidenceContentDigest = mode === "composite" ? compositeEvidenceDigest : linearOnlyEvidenceDigest;
    return Object.freeze({ workspace: selection.workspaceId, team: selection.teamId, project: selection.projectId, issue: operation.issueId, preStatus: operation.preStatusName, targetStatus: operation.targetStatusName, commentMarker: `reelier:${input.missionRef}:${mode}`, evidenceUrl: mode === "composite" ? `https://github.com/${repository}/commit/${github.headSha}` : `https://www.reelier.com/autopilot/evidence/${evidenceContentDigest.slice(7)}`, evidenceContentDigest });
  };
  const targetManifest = parseManagedUpgradeTargetManifestV1({
    version: "reelier.managed-upgrade-target-manifest/v2",
    missionRef: input.missionRef,
    repository,
    githubActions: ["github_release_candidate_publish_v1", "github_release_pr_ensure_v1", "github_release_pr_merge_v1"],
    linearTarget,
    linearActions: ["linear_evidence_comment_v1", "linear_status_transition_v1", "linear_only_evidence_comment_v1", "linear_only_status_transition_v1"],
    maximumWrites: 7,
    expiresAt,
    artifactDigest,
    authority: { github, linear: { githubLinear: target("composite"), linearOnly: target("linear-only") } },
  }) as ManagedUpgradeExecutionTargetManifestV2;
  await stageManagedUpgradeTargetBundleV1({ root: input.root, operation: "github_release_candidate_publish_v1", targetManifest, artifactBytes, seen: new Set() });
  return loadManagedUpgradeTargetBundleV1({ root: input.root, missionRef: input.missionRef });
}

export async function compileAndStageGitHubOnlyManagedAutopilotBundleV1(input: Readonly<{
  root: string;
  missionRef: string;
  requiredChecks?: readonly string[];
  workflowPath?: string;
  now?: () => Date;
  git?: GitRunner;
}>): Promise<ManagedUpgradeTargetBundleV1> {
  const requestedChecks = input.requiredChecks ? checks(input.requiredChecks) : undefined;
  try {
    const existing = await loadManagedUpgradeTargetBundleV1({ root: input.root, missionRef: input.missionRef });
    if (existing.targetManifest.version !== "reelier.managed-upgrade-target-manifest/v3" || (requestedChecks && JSON.stringify(existing.targetManifest.authority.github.requiredChecks) !== JSON.stringify(requestedChecks))) throw new TypeError("existing Autopilot target conflicts with the GitHub-only authority");
    return existing;
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") throw error;
  }
  const frozen = await freezeGitCandidate(input);
  const targetManifest = parseManagedUpgradeTargetManifestV1({
    version: "reelier.managed-upgrade-target-manifest/v3",
    mode: "github-only",
    missionRef: input.missionRef,
    repository: frozen.repository,
    githubActions: ["github_release_candidate_publish_v1", "github_release_pr_ensure_v1", "github_release_pr_merge_v1"],
    maximumWrites: 3,
    expiresAt: frozen.expiresAt,
    artifactDigest: frozen.artifactDigest,
    authority: { github: frozen.github },
  }) as ManagedUpgradeGithubOnlyExecutionTargetManifestV3;
  await stageManagedUpgradeTargetBundleV1({ root: input.root, operation: "github_release_candidate_publish_v1", targetManifest, artifactBytes: frozen.artifactBytes, seen: new Set() });
  return loadManagedUpgradeTargetBundleV1({ root: input.root, missionRef: input.missionRef });
}
