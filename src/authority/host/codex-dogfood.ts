const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export const CODEX_DOGFOOD_PROFILES = ["coordinator", "code_implementer", "test_agent", "security_reviewer", "database_migration", "infrastructure", "secret_lifecycle", "release", "communication", "independent_verifier"] as const;
export type CodexDogfoodProfile = typeof CODEX_DOGFOOD_PROFILES[number];
export type CodexDogfoodAuthorityMode = "preparation-only" | "outcome-capable";

const PREPARATION_ONLY = new Set<CodexDogfoodProfile>(["code_implementer", "test_agent", "security_reviewer", "independent_verifier"]);

export interface CodexDogfoodProfileConfig {
  readonly profile: CodexDogfoodProfile;
  readonly principalId: string;
  readonly runtimeSessionId: string;
  readonly authorityMode: CodexDogfoodAuthorityMode;
  readonly tokenEnv: string;
  readonly mcpEndpoint: string;
  readonly providerCredentials: "absent";
}

export interface CodexDogfoodPlan {
  readonly v: "reelier.codex-dogfood-plan/v1";
  readonly taskId: string;
  readonly rootMayDelegate: true;
  readonly maxDepth: 2;
  readonly maxFanOut: 9;
  readonly profiles: readonly CodexDogfoodProfileConfig[];
  readonly hook: { readonly event: "SubagentStart"; readonly identityField: "agent_id"; readonly bodyIdentityAllowed: false };
}

export function createCodexDogfoodPlan(input: Readonly<{ taskId: string; endpoint: string }>): CodexDogfoodPlan {
  if (!ID.test(input.taskId) || !/^https?:\/\//.test(input.endpoint)) throw new TypeError("Codex dogfood task or endpoint is invalid");
  const profiles = CODEX_DOGFOOD_PROFILES.map((profile, index) => Object.freeze({ profile, principalId: `codex_${profile}`, runtimeSessionId: `${input.taskId}_session_${index}`, authorityMode: PREPARATION_ONLY.has(profile) ? "preparation-only" as const : "outcome-capable" as const, tokenEnv: `REELIER_CODEX_${profile.toUpperCase()}_TOKEN`, mcpEndpoint: input.endpoint, providerCredentials: "absent" as const }));
  return Object.freeze({ v: "reelier.codex-dogfood-plan/v1" as const, taskId: input.taskId, rootMayDelegate: true as const, maxDepth: 2 as const, maxFanOut: 9 as const, profiles: Object.freeze(profiles), hook: Object.freeze({ event: "SubagentStart" as const, identityField: "agent_id" as const, bodyIdentityAllowed: false as const }) });
}

export function assertCodexDogfoodPlan(value: unknown): asserts value is CodexDogfoodPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Codex dogfood plan is required");
  const plan = value as CodexDogfoodPlan;
  if (plan.v !== "reelier.codex-dogfood-plan/v1" || plan.rootMayDelegate !== true || plan.maxDepth !== 2 || plan.maxFanOut !== 9 || plan.hook?.event !== "SubagentStart" || plan.hook.identityField !== "agent_id" || plan.hook.bodyIdentityAllowed !== false || !Array.isArray(plan.profiles) || plan.profiles.length !== 10) throw new TypeError("Codex dogfood plan is closed or incomplete");
  const principals = new Set<string>(), sessions = new Set<string>();
  for (const profile of plan.profiles) {
    const expectedMode = PREPARATION_ONLY.has(profile.profile) ? "preparation-only" : "outcome-capable";
    if (!ID.test(profile.principalId) || !ID.test(profile.runtimeSessionId) || profile.authorityMode !== expectedMode || !/^REELIER_CODEX_[A-Z0-9_]+_TOKEN$/.test(profile.tokenEnv) || profile.providerCredentials !== "absent" || principals.has(profile.principalId) || sessions.has(profile.runtimeSessionId)) throw new TypeError("Codex dogfood profile identity is invalid");
    principals.add(profile.principalId); sessions.add(profile.runtimeSessionId);
  }
}
