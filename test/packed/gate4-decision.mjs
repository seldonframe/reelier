import { mkdtemp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const tarball = process.argv[2];
if (!tarball || !path.isAbsolute(tarball)) throw new Error("usage: gate4-decision.mjs <absolute-tarball-path>");
const root = await mkdtemp(path.join(process.cwd(), ".packed-gate4-"));
try {
  execFileSync("tar", ["-xzf", tarball, "-C", root], { stdio: "ignore" });
  const api = await import(pathToFileURL(path.join(root, "package", "dist", "authority", "certification", "gate4-decision.js")).href);
  if (typeof api.verifyGate4Bundle !== "function" || typeof api.verifyGate4Decision !== "function") throw new Error("packed Gate 4 verifier is not present");
  console.log("packed-verifier=available");
  console.log("nonClaims=hosted-run,provider-credentials,gate4-approval");
} finally {
  await rm(root, { recursive: true, force: true });
}
