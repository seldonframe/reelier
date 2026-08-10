import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { authorityDigest } from "../wire.js";
import { assertCodexDogfoodPlan, type CodexDogfoodPlan, type CodexDogfoodProfile } from "./codex-dogfood.js";
import type { PrincipalRegistry } from "./principal-registry.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export interface CodexSessionGrantBinding {
  readonly taskId: string;
  readonly grantId: string;
  readonly grantDigest: string;
  readonly grantee: string;
  readonly allocationId: string;
  readonly expiresAt: string;
  readonly effects: number;
  readonly lifecycleState: "allocated" | "revoked";
}

export interface ActivatedCodexSession {
  readonly profile: CodexDogfoodProfile;
  readonly principalId: string;
  readonly taskId: string;
  readonly grantId: string;
  readonly grantDigest: string;
  readonly allocationId: string;
  readonly runtimeSessionId: string;
  readonly expiresAt: string;
  readonly sessionTokenDigest: string;
  readonly tokenFile: string;
}

export interface CodexSessionActivationResult {
  readonly v: "reelier.codex-session-activation/v1";
  readonly taskId: string;
  readonly jobId: string;
  readonly authorityCellId: string;
  readonly activatedAt: string;
  readonly sessions: readonly ActivatedCodexSession[];
  readonly digest: string;
}

export async function activateCodexPrincipalSessions(input: Readonly<{
  tenant: string;
  plan: CodexDogfoodPlan;
  jobId: string;
  authorityCellId: string;
  credentialDirectory: string;
  principalRegistry: PrincipalRegistry;
  resolveBinding: (input: Readonly<{ tenant: string; taskId: string; principalId: string }>) => Promise<CodexSessionGrantBinding | undefined>;
  now?: Date;
}>): Promise<CodexSessionActivationResult> {
  assertCodexDogfoodPlan(input.plan);
  assertId(input.tenant, "tenant");
  assertId(input.jobId, "jobId");
  assertId(input.authorityCellId, "authorityCellId");
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new TypeError("activation time is invalid");
  const credentialDirectory = path.resolve(input.credentialDirectory);

  const bindings = await Promise.all(input.plan.profiles.map(async profile => {
    const binding = await input.resolveBinding({ tenant: input.tenant, taskId: input.plan.taskId, principalId: profile.principalId });
    if (!binding) throw new TypeError(`active grant is missing for ${profile.profile}`);
    validateBinding(binding, profile.principalId, input.plan.taskId, now);
    if (profile.authorityMode === "preparation-only" && binding.effects !== 0) throw new TypeError(`preparation-only profile ${profile.profile} must have a zero-effect allocation`);
    if (profile.authorityMode === "outcome-capable" && binding.effects < 1) throw new TypeError(`outcome-capable profile ${profile.profile} requires an effect allocation`);
    return Object.freeze({ profile, binding });
  }));
  assertUnique(bindings.map(item => item.binding.grantId), "grant");
  assertUnique(bindings.map(item => item.binding.allocationId), "allocation");

  await mkdir(credentialDirectory, { recursive: true, mode: 0o700 });
  const issued: Array<Readonly<{ digest: string; tokenFile: string }>> = [];
  const sessions: ActivatedCodexSession[] = [];
  try {
    for (const { profile, binding } of bindings) {
      const credential = await input.principalRegistry.issue({
        principalId: profile.principalId,
        taskId: input.plan.taskId,
        grantId: binding.grantId,
        grantDigest: binding.grantDigest,
        allocationId: binding.allocationId,
        runtimeSessionId: profile.runtimeSessionId,
        jobId: input.jobId,
        authorityCellId: input.authorityCellId,
        expiresAt: binding.expiresAt,
      });
      const tokenFile = path.join(credentialDirectory, `${profile.profile}.token`);
      issued.push(Object.freeze({ digest: credential.context.sessionTokenDigest, tokenFile }));
      try {
        await writeFile(tokenFile, `${credential.token}\n`, { flag: "wx", mode: 0o600 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new TypeError(`Codex session credential already exists for ${profile.profile}`);
        throw error;
      }
      sessions.push(Object.freeze({
        profile: profile.profile,
        principalId: profile.principalId,
        taskId: input.plan.taskId,
        grantId: binding.grantId,
        grantDigest: binding.grantDigest,
        allocationId: binding.allocationId,
        runtimeSessionId: profile.runtimeSessionId,
        expiresAt: binding.expiresAt,
        sessionTokenDigest: credential.context.sessionTokenDigest,
        tokenFile,
      }));
    }
  } catch (error) {
    await Promise.allSettled(issued.map(item => input.principalRegistry.revoke(item.digest)));
    await Promise.allSettled(sessions.map(item => rm(item.tokenFile, { force: true })));
    throw error;
  }

  const body = Object.freeze({
    v: "reelier.codex-session-activation/v1" as const,
    taskId: input.plan.taskId,
    jobId: input.jobId,
    authorityCellId: input.authorityCellId,
    activatedAt: now.toISOString(),
    sessions: Object.freeze(sessions),
  });
  return Object.freeze({ ...body, digest: authorityDigest(body) });
}

function validateBinding(binding: CodexSessionGrantBinding, principalId: string, taskId: string, now: Date): void {
  if (binding.taskId !== taskId || binding.grantee !== principalId) throw new TypeError("Codex grant binding identity drift");
  assertId(binding.grantId, "grantId");
  assertId(binding.allocationId, "allocationId");
  if (!DIGEST.test(binding.grantDigest)) throw new TypeError("grantDigest is invalid");
  if (binding.lifecycleState !== "allocated") throw new TypeError("Codex grant binding is not active");
  if (!Number.isInteger(binding.effects) || binding.effects < 0) throw new TypeError("Codex allocation effects are invalid");
  const expiry = Date.parse(binding.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= now.getTime()) throw new TypeError("Codex grant binding is expired");
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new TypeError(`Codex ${label} binding is duplicated`);
}

function assertId(value: string, label: string): void {
  if (typeof value !== "string" || !ID.test(value)) throw new TypeError(`${label} is invalid`);
}
