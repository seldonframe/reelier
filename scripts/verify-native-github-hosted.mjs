import { createPublicKey } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const EXPECTED_CANDIDATE = Object.freeze({
  v: "reelier.native-github-candidate/v1",
  candidateId: "sha256:e46498b6441a44e7de42264ebf243e4462aae6e4c4b3d33ed4276fcc50190e96",
  publicCommitSha: "03ac48e",
  tarballDigest: "sha256:0659c2f402002d733dfd2621c5d8cce5df301975606a3fcb1b802e492bec5309",
  laneCommits: [
    { laneId: "operator-evidence", commitSha: "c".repeat(40) },
    { laneId: "provider-authority", commitSha: "a".repeat(40) },
    { laneId: "reconciliation-verifier", commitSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
  ],
  packDigest: "sha256:8101632acbacaf2738b8a7e698b0fb301539163edc713a37e74df0a6d233d689",
  task8BaselineDigest: `sha256:${"8".repeat(64)}`,
  task9VerificationDigest: `sha256:${"9".repeat(64)}`,
  portableEvidenceContractDigest: `sha256:${"e".repeat(64)}`,
  checkerIdentities: [
    { role: "contract", signerId: "checker-contract", publicKeyDigest: `sha256:${"c".repeat(64)}`, verifierVersion: "authority-contract-checker/v1", verdictDigest: `sha256:${"e".repeat(64)}` },
    { role: "pack", signerId: "checker-pack", publicKeyDigest: `sha256:${"d".repeat(64)}`, verifierVersion: "packed-consumer/v1", verdictDigest: "sha256:8101632acbacaf2738b8a7e698b0fb301539163edc713a37e74df0a6d233d689" },
    { role: "task8", signerId: "checker-task8", publicKeyDigest: `sha256:${"8".repeat(64)}`, verifierVersion: "task8-baseline-verifier/v1", verdictDigest: `sha256:${"8".repeat(64)}` },
    { role: "task9", signerId: "checker-task9", publicKeyDigest: `sha256:${"9".repeat(64)}`, verifierVersion: "portable-evidence-verifier/v1", verdictDigest: `sha256:${"9".repeat(64)}` },
  ],
  provenance: { v: "reelier.native-candidate-provenance/v1", source: "clean-export", reproducibility: "hermetic-offline", liveProviderStatus: "absent", credentialStatus: "absent", workflowDispatch: "absent" },
});

function fail(message) { throw new Error(`refused: ${message}`); }
function args(argv) {
  if (argv.length !== 6 || argv[0] !== "--bundle" || argv[2] !== "--execution" || !["offline-fixture", "hosted-run"].includes(argv[3]) || argv[4] !== "--public-key") fail("usage is --bundle <absolute-path> --execution <offline-fixture|hosted-run> --public-key <absolute-path>");
  if (!path.isAbsolute(argv[1])) fail("bundle path must be absolute");
  if (!path.isAbsolute(argv[5])) fail("public-key path must be absolute");
  if (argv[3] === "hosted-run" && process.env.GITHUB_ACTIONS !== "true") fail("hosted verification is only available inside GitHub Actions");
  return { bundlePath: path.resolve(argv[1]), execution: argv[3], publicKeyPath: path.resolve(argv[5]) };
}

export async function verifyHostedBundleFile(bundlePath, execution, publicKey) {
  const api = await import(pathToFileURL(path.resolve("dist/authority/certification/gate4-decision.js")).href);
  let value;
  try { value = JSON.parse(await readFile(bundlePath, "utf8")); } catch { fail("bundle cannot be read as JSON"); }
  if (!publicKey) fail("an out-of-band hosted checker public key is required");
  const key = createPublicKey(publicKey);
  const expectedRunnerSourceCommitSha = execution === "hosted-run" ? (process.env.EXPECTED_RUNNER_SOURCE_COMMIT ?? process.env.GITHUB_SHA) : EXPECTED_CANDIDATE.publicCommitSha;
  if (!expectedRunnerSourceCommitSha) fail("hosted runner source commit is not available");
  const jobs = value?.jobs;
  if (!Array.isArray(jobs) || jobs.length !== 2) fail("bundle must contain exactly Ubuntu and Windows job artifacts");
  const result = api.verifyGate4Bundle(value, {
    candidate: EXPECTED_CANDIDATE,
    artifactBytes: { ubuntu: api.authorityCanonicalBytes(jobs.find(item => item.os === "ubuntu-latest")), windows: api.authorityCanonicalBytes(jobs.find(item => item.os === "windows-latest")) },
    now: new Date().toISOString(),
    verifier: { signerId: value.signerId, publicKey: key },
    execution,
    expectedRunnerSourceCommitSha,
  });
  const output = JSON.stringify({ v: "reelier.native-github-gate4-offline-result/v1", ...result });
  await mkdir(path.resolve(".superpowers"), { recursive: true });
  await writeFile(path.resolve(".superpowers/native-github-gate4-decision.json"), `${output}\n`, { flag: "wx" }).catch(error => { if (error?.code === "EEXIST") fail("refusing to overwrite a retained Gate 4 artifact"); throw error; });
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const parsed = args(process.argv.slice(2));
  verifyHostedBundleFile(parsed.bundlePath, parsed.execution, await readFile(parsed.publicKeyPath)).then(result => {
    console.log(`state=${result.state} decision=${result.decision} liveProviderClaim=${result.liveProviderClaim}`);
  }).catch(error => { console.error(error instanceof Error ? error.message : "refused: invalid hosted bundle"); process.exitCode = 1; });
}
