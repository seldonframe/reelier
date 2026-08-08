export const REELIER_PLUGIN_V1 = "ReelierPluginV1" as const;

export type ReelierPluginCapability = "discovery" | "recommendation" | "work-card" | "certification";

export interface ReelierPluginRuntimePin {
  name: string;
  version: string;
}

export interface ReelierPluginV1 {
  schemaVersion: typeof REELIER_PLUGIN_V1;
  id: string;
  name: string;
  version: string;
  description?: string;
  capabilities: ReelierPluginCapability[];
  harness?: ReelierPluginRuntimePin;
  models?: { providers: string[]; models: string[] };
  launch?: { command: string; version?: string; localOnly?: boolean };
  requiredMcpTools?: string[];
  configuration?: { required: string[]; optional?: string[] };
  redaction?: { fields: string[] };
  verification?: { hooks: string[]; receipt: "required" | "optional" | "none" };
  fixtures?: Array<{ id: string; digest: string }>;
  approval?: { beforeWrite: boolean; rollback: "required" | "supported" | "none" };
  execution?: { localOnly: boolean; cloudCertificationEligible: boolean };
  integrity?: { contentDigest: string; signature?: { algorithm: "ed25519"; keyId: string; value: string } };
}

export type PluginValidationResult =
  | { ok: true; value: ReelierPluginV1 }
  | { ok: false; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateReelierPluginV1(value: unknown): PluginValidationResult {
  if (!isRecord(value)) return { ok: false, errors: ["plugin manifest must be an object"] };
  const errors: string[] = [];
  const allowed = new Set(["schemaVersion", "id", "name", "version", "description", "capabilities", "harness", "models", "launch", "requiredMcpTools", "configuration", "redaction", "verification", "fixtures", "approval", "execution", "integrity"]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${key} is not allowed`);
  if (value.schemaVersion !== REELIER_PLUGIN_V1) errors.push("schemaVersion must be ReelierPluginV1");
  if (typeof value.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{1,127}$/.test(value.id)) errors.push("id must be 2-128 safe characters");
  if (typeof value.name !== "string" || value.name.length < 1 || value.name.length > 200) errors.push("name must be 1-200 characters");
  if (typeof value.version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value.version)) errors.push("version must be a valid semver");
  if (value.description !== undefined && (typeof value.description !== "string" || value.description.length > 1000)) errors.push("description must be at most 1000 characters");
  const capabilities = value.capabilities;
  const knownCapabilities = new Set<ReelierPluginCapability>(["discovery", "recommendation", "work-card", "certification"]);
  if (!Array.isArray(capabilities) || capabilities.length === 0 || capabilities.some((capability) => typeof capability !== "string" || !knownCapabilities.has(capability as ReelierPluginCapability)) || new Set(capabilities).size !== capabilities.length) errors.push("capabilities must be a non-empty list of unique known capabilities");
  const semver = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
  const digest = /^sha256:[a-f0-9]{64}$/;
  const safeList = (candidate: unknown, field: string): void => {
    if (!Array.isArray(candidate) || candidate.some((item) => typeof item !== "string" || item.length === 0 || item.length > 200 || /(?:secret|token|password|credential|authorization|cookie|api[-_]?key)/i.test(item))) errors.push(`${field} must contain safe non-secret names`);
  };
  if (value.harness !== undefined && (!isRecord(value.harness) || typeof value.harness.name !== "string" || !semver.test(String(value.harness.version)))) errors.push("harness must contain a pinned semver version");
  if (value.models !== undefined && (!isRecord(value.models) || !Array.isArray(value.models.providers) || !Array.isArray(value.models.models))) errors.push("models must contain providers and models lists");
  if (isRecord(value.models)) { safeList(value.models.providers, "models.providers"); safeList(value.models.models, "models.models"); }
  if (value.launch !== undefined && (!isRecord(value.launch) || typeof value.launch.command !== "string" || value.launch.command.length > 200 || (value.launch.version !== undefined && !semver.test(String(value.launch.version))))) errors.push("launch must contain a descriptive command and pinned version");
  if (value.requiredMcpTools !== undefined) safeList(value.requiredMcpTools, "requiredMcpTools");
  if (isRecord(value.configuration)) { safeList(value.configuration.required, "configuration.required"); if (value.configuration.optional !== undefined) safeList(value.configuration.optional, "configuration.optional"); }
  if (isRecord(value.redaction)) safeList(value.redaction.fields, "redaction.fields");
  if (isRecord(value.verification) && (!Array.isArray(value.verification.hooks) || !["required", "optional", "none"].includes(String(value.verification.receipt)))) errors.push("verification must declare hooks and receipt policy");
  if (Array.isArray(value.fixtures)) for (const fixture of value.fixtures) if (!isRecord(fixture) || typeof fixture.id !== "string" || typeof fixture.digest !== "string" || !digest.test(fixture.digest)) errors.push("fixtures must use sha256-pinned digests");
  if (isRecord(value.approval) && (typeof value.approval.beforeWrite !== "boolean" || !["required", "supported", "none"].includes(String(value.approval.rollback)))) errors.push("approval must declare beforeWrite and rollback policy");
  if (isRecord(value.execution) && (typeof value.execution.localOnly !== "boolean" || typeof value.execution.cloudCertificationEligible !== "boolean")) errors.push("execution must declare localOnly and cloudCertificationEligible");
  if (isRecord(value.integrity) && (typeof value.integrity.contentDigest !== "string" || !digest.test(value.integrity.contentDigest))) errors.push("integrity.contentDigest must be a sha256 digest");
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { ...value, capabilities: [...(value.capabilities as ReelierPluginCapability[])] } as ReelierPluginV1 };
}

/** A stronger gate used before a plugin can participate in reviewed Cloud certification. */
export function validateReelierPluginForCertification(value: unknown): PluginValidationResult {
  const result = validateReelierPluginV1(value);
  if (!result.ok) return result;
  const plugin = result.value;
  const errors: string[] = [];
  if (!plugin.harness || !plugin.models || !plugin.launch || !plugin.execution || !plugin.integrity?.signature) errors.push("certification requires pinned harness, model, launch, execution, and signature metadata");
  if (plugin.execution && (!plugin.execution.cloudCertificationEligible || plugin.execution.localOnly)) errors.push("plugin is not eligible for Cloud certification");
  if (errors.length) return { ok: false, errors };
  return result;
}

export function parseReelierPluginV1(source: string): ReelierPluginV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("invalid JSON plugin manifest");
  }
  const result = validateReelierPluginV1(parsed);
  if (!result.ok) throw new Error(`invalid ReelierPluginV1 manifest: ${result.errors.join("; ")}`);
  return result.value;
}
