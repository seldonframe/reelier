import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const tarball = process.argv[2];
if (!tarball || !path.isAbsolute(tarball)) throw new Error("usage: native-candidate.mjs <absolute-tarball-path>");
const root = await mkdtemp(path.join(process.cwd(), ".packed-native-candidate-"));
try {
  execFileSync("tar", ["-xzf", tarball, "-C", root], { stdio: "ignore" });
  const api = await import(pathToFileURL(path.join(root, "package", "dist", "authority", "index.js")).href);
  const bytes = Buffer.from("hermetic-native-tarball-v1", "utf8");
  const tarballDigest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const lanes = [
    { laneId: "operator-evidence", commitSha: "cccccccccccccccccccccccccccccccccccccccc" },
    { laneId: "provider-authority", commitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    { laneId: "reconciliation-verifier", commitSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
  ];
  const packDigest = api.authorityDigest({ v: "reelier.native-pack/v1", publicCommitSha: "03ac48e", tarballDigest, laneCommits: lanes });
  const candidateBody = {
    v: "reelier.native-github-candidate/v1",
    publicCommitSha: "03ac48e",
    tarballDigest,
    laneCommits: lanes,
    packDigest,
    task8BaselineDigest: `sha256:${"8".repeat(64)}`,
    task9VerificationDigest: `sha256:${"9".repeat(64)}`,
    portableEvidenceContractDigest: `sha256:${"e".repeat(64)}`,
    checkerIdentities: [
      { role: "contract", signerId: "checker-contract", publicKeyDigest: `sha256:${"c".repeat(64)}`, verifierVersion: "authority-contract-checker/v1", verdictDigest: `sha256:${"e".repeat(64)}` },
      { role: "pack", signerId: "checker-pack", publicKeyDigest: `sha256:${"d".repeat(64)}`, verifierVersion: "packed-consumer/v1", verdictDigest: packDigest },
      { role: "task8", signerId: "checker-task8", publicKeyDigest: `sha256:${"8".repeat(64)}`, verifierVersion: "task8-baseline-verifier/v1", verdictDigest: `sha256:${"8".repeat(64)}` },
      { role: "task9", signerId: "checker-task9", publicKeyDigest: `sha256:${"9".repeat(64)}`, verifierVersion: "portable-evidence-verifier/v1", verdictDigest: `sha256:${"9".repeat(64)}` },
    ],
    provenance: { v: "reelier.native-candidate-provenance/v1", source: "clean-export", reproducibility: "hermetic-offline", liveProviderStatus: "absent", credentialStatus: "absent", workflowDispatch: "absent" },
  };
  const candidate = { v: candidateBody.v, candidateId: api.authorityDigest(candidateBody), ...candidateBody };
  const verified = api.verifyNativeCandidate(candidate, { tarballBytes: bytes, publicCommitSha: "03ac48e", task8BaselineDigest: candidate.task8BaselineDigest, task9VerificationDigest: candidate.task9VerificationDigest, portableEvidenceContractDigest: candidate.portableEvidenceContractDigest });
  console.log("verified");
  console.log(`candidateDigest=${verified.candidateDigest}`);
  console.log("nonClaims=live-provider,credentials,workflow-dispatch");
} finally {
  await rm(root, { recursive: true, force: true });
}
