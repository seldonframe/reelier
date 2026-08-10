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
const manifests = firstPartyPacks.map(pack => pack.manifest).sort((a, b) => a.packId < b.packId ? -1 : a.packId > b.packId ? 1 : 0);
if (manifests.length !== 10 || manifests.some(manifest => manifest.definitions.length !== 1)) throw new Error("Path C requires ten single-definition first-party manifests");
await mkdir("dist/packs", { recursive: true });
await writeFile("dist/packs/manifests.json", `${JSON.stringify({ v: "reelier.pack-index/v1", packs: manifests }, null, 2)}\n`, "utf8");
process.stdout.write(`built ${manifests.map(manifest => manifest.packId).join(", ")}\n`);
