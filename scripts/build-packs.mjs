#!/usr/bin/env node

/*
 * Pack build gate. First-party packs are compiled by TypeScript with the kernel;
 * this script deliberately performs no package installation or runtime loading.
 * It validates the closed first-party manifests after `npm run build` and emits a
 * stable manifest index for release tooling.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { createFirstPartyPackRegistry, firstPartyPacks } from "../dist/packs/index.js";

createFirstPartyPackRegistry();
const byPackId = new Map();
for (const pack of firstPartyPacks) {
  const prior = byPackId.get(pack.manifest.packId);
  if (prior && JSON.stringify(prior) !== JSON.stringify(pack.manifest)) throw new Error(`first-party manifest ${pack.manifest.packId} conflicts across definitions`);
  byPackId.set(pack.manifest.packId, pack.manifest);
}
const manifests = [...byPackId.values()].sort((a, b) => a.packId < b.packId ? -1 : a.packId > b.packId ? 1 : 0);
const releaseDefinitions = ["github_release_candidate_publish_v1", "github_release_pr_ensure_v1", "github_release_pr_merge_v1", "github_release_tag_create_v1"];
const linearDefinitions = ["linear_evidence_comment_v1", "linear_status_transition_v1", "linear_only_evidence_comment_v1", "linear_only_status_transition_v1"];
const release = manifests.find(manifest => manifest.packId === "github_release");
const linear = manifests.find(manifest => manifest.packId === "linear_outcomes");
if (manifests.length !== 12 || !release || !linear || JSON.stringify(release.definitions) !== JSON.stringify(releaseDefinitions) || JSON.stringify(linear.definitions) !== JSON.stringify(linearDefinitions) || manifests.some(manifest => !["github_release", "linear_outcomes"].includes(manifest.packId) && manifest.definitions.length !== 1)) throw new Error("Path C requires twelve closed first-party manifests and exact four-definition GitHub release and Linear Outcomes packs");
await mkdir("dist/packs", { recursive: true });
await writeFile("dist/packs/manifests.json", `${JSON.stringify({ v: "reelier.pack-index/v1", packs: manifests }, null, 2)}\n`, "utf8");
process.stdout.write(`built ${manifests.map(manifest => manifest.packId).join(", ")}\n`);
