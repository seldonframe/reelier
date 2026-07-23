// Manifest build + preflight (docs/specs/flight-recorder-v2.md §1): the
// environment-binding half of replay safety. A manifest proves the tools a
// skill's steps depend on are still present, schema-identical, before step 1
// executes. Digest equality only — no semantic schema diffing (a changed
// schema is drift, full stop).

import type { Skill, SkillManifest, ManifestTool } from "./skill.js";
import type { DownstreamConnection } from "./mcp-client.js";
import { buildToolRoutes } from "./mcp-client.js";
import { digestSha256 } from "./canonical-json.js";

/**
 * Build a manifest for the tools this skill's steps actually use, from live
 * downstreams. Uses buildToolRoutes so names match replay's exposedName
 * semantics exactly. A step's tool not found among the live downstreams is
 * simply OMITTED (build is not verify — that's preflightManifest's job).
 */
export function buildManifestForSkill(skill: Skill, downstreams: DownstreamConnection[]): SkillManifest {
  const routes = buildToolRoutes(downstreams);
  const usedToolNames = new Set(skill.steps.map((s) => s.actionTool));
  const tools: ManifestTool[] = [];
  for (const name of usedToolNames) {
    const route = routes.get(name);
    if (!route) continue;
    tools.push({ name: route.exposedName, server: route.downstream.name, digest: digestSha256(route.tool.inputSchema) });
  }
  return { v: 1, tools };
}

export interface ManifestDrift {
  name: string;
  recorded?: string;
  live?: string;
  note: string;
}

/**
 * Compare a stored manifest against live downstreams. ok=false on any
 * missing tool or digest mismatch. Fail-open on digest computation for a
 * live tool (same discipline as collectToolManifest, src/recorder.ts): a
 * live tool whose schema can't be digested is simply absent from the live
 * map, which reads as "missing" below — never a thrown error.
 */
export function preflightManifest(
  manifest: SkillManifest,
  downstreams: DownstreamConnection[]
): { ok: boolean; drifts: ManifestDrift[] } {
  const routes = buildToolRoutes(downstreams);
  const liveDigestByExposedName = new Map<string, string>();
  for (const route of routes.values()) {
    try {
      liveDigestByExposedName.set(route.exposedName, digestSha256(route.tool.inputSchema));
    } catch {
      // Undigestable live schema — leave it out of the map; it reads as
      // "missing" below, which is the honest outcome (we can't prove it
      // matches what was recorded).
    }
  }

  const drifts: ManifestDrift[] = [];
  for (const tool of manifest.tools) {
    const liveDigest = liveDigestByExposedName.get(tool.name);
    if (liveDigest === undefined) {
      // Maybe the same schema is live, just exposed under a different name —
      // e.g. a different --wrap order changed the collision-prefix rename.
      const renamedTo = [...liveDigestByExposedName.entries()].find(([, digest]) => digest === tool.digest)?.[0];
      drifts.push(
        renamedTo
          ? {
              name: tool.name,
              recorded: tool.digest,
              note: `schema found under '${renamedTo}' — wrap order may have changed collision renaming`,
            }
          : { name: tool.name, recorded: tool.digest, note: "missing: tool not exposed by any wrapped server" }
      );
      continue;
    }
    if (liveDigest !== tool.digest) {
      drifts.push({ name: tool.name, recorded: tool.digest, live: liveDigest, note: "schema drifted since recording" });
    }
  }
  return { ok: drifts.length === 0, drifts };
}
