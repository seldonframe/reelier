import { authorityDigest } from "../authority/wire.js";
import type { AgentProjectV1 } from "./types.js";
import { parseBootstrapSchema } from "./normalize.js";

export function parseAgentProjectV1(value: unknown): AgentProjectV1 {
  const parsed = parseBootstrapSchema<AgentProjectV1>("agent-project", value);
  const governance = [parsed.profileGovernanceRef, parsed.profileGovernanceManifestDigest, parsed.profileTrustHeadDigest];
  const configured = governance.every(member => member !== null);
  const absent = governance.every(member => member === null);
  if (!configured && !absent) throw new TypeError("agent project profile governance pins must be all present or all absent");
  if (parsed.authorityMode === "unconfigured") {
    if (!absent) throw new TypeError("unconfigured agent project cannot carry profile governance");
  } else if (!configured || parsed.tenant === null) throw new TypeError("configured authority requires tenant and exact profile governance pins");
  return parsed;
}

export function digestAgentProjectV1(value: unknown): string {
  return authorityDigest(parseAgentProjectV1(value));
}
