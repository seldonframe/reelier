export const REELIER_PLUGIN_V1 = "ReelierPluginV1" as const;

export type ReelierPluginCapability = "discovery";

export interface ReelierPluginV1 {
  schemaVersion: typeof REELIER_PLUGIN_V1;
  id: string;
  name: string;
  version: string;
  description?: string;
  capabilities: ReelierPluginCapability[];
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
  const allowed = new Set(["schemaVersion", "id", "name", "version", "description", "capabilities"]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${key} is not allowed`);
  if (value.schemaVersion !== REELIER_PLUGIN_V1) errors.push("schemaVersion must be ReelierPluginV1");
  if (typeof value.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{1,127}$/.test(value.id)) errors.push("id must be 2-128 safe characters");
  if (typeof value.name !== "string" || value.name.length < 1 || value.name.length > 200) errors.push("name must be 1-200 characters");
  if (typeof value.version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value.version)) errors.push("version must be a valid semver");
  if (value.description !== undefined && (typeof value.description !== "string" || value.description.length > 1000)) errors.push("description must be at most 1000 characters");
  if (!Array.isArray(value.capabilities) || value.capabilities.length === 0 || value.capabilities.some((capability) => capability !== "discovery")) errors.push("capabilities must contain discovery");
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { ...value, capabilities: [...(value.capabilities as ReelierPluginCapability[])] } as ReelierPluginV1 };
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
