import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MANIFEST_VERSION, PROTOCOL, TARGETS, expectedProbe, readClosedArtifact } from "./bootstrap-native-artifacts.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  const artifacts = TARGETS.map(entry => {
    const built = readClosedArtifact(root, entry);
    const evidencePath = path.join(root, "native", "bootstrap-helper", "evidence", `${entry.platform}-${entry.architecture}.json`);
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
    const exact = { v: "reelier.bootstrap-native-build/v1", protocol: PROTOCOL, ...entry, sha256: built.digest, probe: expectedProbe(entry) };
    if (JSON.stringify(evidence) !== JSON.stringify(exact)) throw new Error(`matching-host evidence mismatch: ${entry.platform}-${entry.architecture}`);
    return { ...entry, sha256: built.digest };
  });
  const manifest = { v: MANIFEST_VERSION, protocol: PROTOCOL, artifacts };
  writeFileSync(path.join(root, "native", "bootstrap-helper", "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write("native bootstrap universal manifest assembled\n");
} catch (error) {
  process.stderr.write(`native bootstrap assembly refused: ${error instanceof Error ? error.message : "unknown assembly failure"}\n`);
  process.exit(1);
}

