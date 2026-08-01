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
 *
 * An EXPECT-bearing step's declared probe tool (`attest.tool`) is covered
 * too (state-conditioned approval §8.6): a probe-tool schema drift on a
 * state-bound step should fail the preflight closed before step 1, not
 * surface only as a per-step `unevaluated`. Attest WITHOUT expect adds
 * nothing — the probe there is evidence-only, its drift degrades the attest
 * honestly at run time, and skills that never opted into state binding
 * keep byte-identical manifests (zero-touch).
 */
export function buildManifestForSkill(skill: Skill, downstreams: DownstreamConnection[]): SkillManifest {
  const routes = buildToolRoutes(downstreams);
  const usedToolNames = new Set(skill.steps.map((s) => s.actionTool));
  for (const step of skill.steps) {
    if (step.expect !== undefined && step.attest !== undefined) {
      usedToolNames.add(step.attest.tool);
    }
  }
  const tools: ManifestTool[] = [];
  for (const name of usedToolNames) {
    const route = routes.get(name);
    if (!route) continue;
    tools.push({ name: route.exposedName, server: route.downstream.name, digest: digestSha256(route.tool.inputSchema) });
  }
  return { v: 1, tools };
}

/**
 * ADDITIVELY cover the probe tools of expect-bearing steps in an EXISTING
 * manifest — the bind-time half of §8.6's probe coverage (review finding:
 * buildManifestForSkill's only caller is `reelier manifest`, so without
 * this, a skill bound by `approve --probe` kept an action-tools-only
 * manifest and probe-tool drift stayed invisible to preflight). Existing
 * entries are NEVER touched or re-digested — re-stamping the whole manifest
 * at approve time would silently bless any unrelated drift since the last
 * `reelier manifest`, which is that command's job, not approve's. A probe
 * tool not found live (e.g. a builtin http.* probe — builtins are never in
 * a manifest) is skipped, consistent with build-is-not-verify.
 */
export function addProbeToolsToManifest(
  manifest: SkillManifest,
  skill: Skill,
  downstreams: DownstreamConnection[]
): { manifest: SkillManifest; added: string[] } {
  const routes = buildToolRoutes(downstreams);
  const have = new Set(manifest.tools.map((t) => t.name));
  const added: string[] = [];
  const tools = [...manifest.tools];
  for (const step of skill.steps) {
    if (step.expect === undefined || step.attest === undefined) continue;
    const route = routes.get(step.attest.tool);
    if (!route || have.has(route.exposedName)) continue;
    tools.push({ name: route.exposedName, server: route.downstream.name, digest: digestSha256(route.tool.inputSchema) });
    have.add(route.exposedName);
    added.push(route.exposedName);
  }
  return { manifest: { v: 1, tools }, added };
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

  const recordedNames = new Set(manifest.tools.map((t) => t.name));
  const drifts: ManifestDrift[] = [];
  for (const tool of manifest.tools) {
    const liveDigest = liveDigestByExposedName.get(tool.name);
    if (liveDigest === undefined) {
      // Maybe the same schema is live, just exposed under a different name —
      // e.g. a different --wrap order changed the collision-prefix rename.
      // Only when the digest match is UNIQUE and the candidate is a name the
      // manifest does NOT already record: trivial schemas (e.g. a probe and
      // its write sharing `{slug}`) make coincidental matches routine, and a
      // "collision renaming" hint pointing at a sibling manifest entry is
      // worse than the plain truth (S5 review finding).
      const digestMatches = [...liveDigestByExposedName.entries()].filter(
        ([name, digest]) => digest === tool.digest && !recordedNames.has(name)
      );
      const renamedTo = digestMatches.length === 1 ? digestMatches[0][0] : undefined;
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
