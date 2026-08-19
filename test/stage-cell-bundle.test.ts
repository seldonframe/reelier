import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadAuthorityDeployment, validateAuthorityHostConfig } from "../src/authority/host/index.js";
import { parseGitHubReleaseRunnerOperatorConfig } from "../src/authority/host/github-release-runner-config.js";
import { githubReleaseAliases } from "../src/packs/github-release/manifest.js";

const scriptPath = path.resolve("scripts/stage-cell-bundle.mjs");
/** The script imports built modules; the test points it at the SAME `dist-test/src` output
 * `npm test` already produced, so the hermetic run needs no separate production build. */
const distRoot = path.resolve("dist-test/src");
const REQUIRED_KEYS = ["release-authority.key.pem", "journal-signer.key.pem", "evidence-signer.key.pem"] as const;

interface Staged { readonly root: string; readonly keysDir: string; readonly outDir: string; readonly authorityDir: string }

function workspace(): Staged {
  const root = mkdtempSync(path.join(os.tmpdir(), "reelier-stage-cell-test-"));
  const keysDir = path.join(root, "keys");
  const outDir = path.join(root, "out");
  mkdirSync(keysDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  for (const name of REQUIRED_KEYS) writeFileSync(path.join(keysDir, name), generateKeyPairSync("ed25519").privateKey.export({ format: "pem", type: "pkcs8" }));
  return { root, keysDir, outDir, authorityDir: path.join(outDir, "authority") };
}

function run(staged: Staged, extra: readonly string[] = [], repository = "seldonframe/reelier") {
  return spawnSync(process.execPath, [scriptPath, "--keys", staged.keysDir, "--out", staged.outDir, "--repository", repository, ...extra], {
    encoding: "utf8",
    env: { ...(process.env as Record<string, string>), REELIER_STAGE_CELL_DIST: distRoot },
  });
}

function walk(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...walk(child));
    else found.push(child);
  }
  return found;
}

test("stage-cell-bundle stages a bundle whose runner config the real parser accepts", () => {
  const staged = workspace();
  try {
    const result = run(staged);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

    const runnerConfigFile = path.join(staged.authorityDir, "release-runner.config.json");
    const raw = JSON.parse(readFileSync(runnerConfigFile, "utf8"));
    // Guest paths, exactly as the volume mounts them. The parser demands absolute paths and never
    // touches the filesystem, so the emitted guest paths are validated as-is — no test-only
    // rewriting and no `--root-prefix` seam.
    for (const key of ["rootDir", "journalKeyFile", "evidenceKeyFile", "authorizationDir"] as const) {
      assert.equal(String(raw[key]).startsWith("/data/authority/"), true, `${key} is not a /data/authority guest path: ${String(raw[key])}`);
    }
    const parsed = parseGitHubReleaseRunnerOperatorConfig(raw);
    assert.equal(parsed.v, "reelier.github-release-runner-config/v1");
    assert.equal(parsed.journalSignerId, "reelier.cell.journal.2026");
    assert.equal(parsed.evidenceSignerId, "reelier.cell.evidence.2026");
    assert.equal(parsed.journalKeyFile, "/data/authority/keys/journal-signer.key.pem");
    assert.equal(parsed.evidenceKeyFile, "/data/authority/keys/evidence-signer.key.pem");
    assert.equal(parsed.authorizationDir, "/data/authority/authorizations");
    assert.equal(parsed.releaseAuthority.signerId, "reelier.release-authority.2026");
    assert.equal(parsed.provider.kind, "github-https");
    assert.equal(parsed.provider.kind === "github-https" && parsed.provider.repository, "seldonframe/reelier");
    assert.equal(parsed.provider.kind === "github-https" && parsed.provider.githubTokenRef, "env:REELIER_RELEASE_GITHUB_PAT");

    // The embedded public SPKI is the operator's release-authority key, derived from the private one.
    const releaseAuthorityPublic = createPublicKey(readFileSync(path.join(staged.keysDir, "release-authority.key.pem")))
      .export({ format: "der", type: "spki" }).toString("base64");
    assert.equal(parsed.releaseAuthority.publicKeySpkiBase64, releaseAuthorityPublic);
  } finally { rmSync(staged.root, { recursive: true, force: true }); }
});

test("stage-cell-bundle stages an authority.yml and a deployment the serve path re-verifies", async () => {
  const staged = workspace();
  try {
    assert.equal(run(staged).status, 0);
    const configFile = path.join(staged.authorityDir, "authority.yml");
    const configBody = JSON.parse(readFileSync(configFile, "utf8"));
    assert.deepEqual([...configBody.definitions].sort(), [...githubReleaseAliases].sort());
    assert.equal(configBody.deploymentPath, "/data/authority/deployment/deployment.json");
    assert.equal(configBody.jobCardTrustPinPath, "/data/authority/trust/job-card.json");
    assert.equal(configBody.gateKeyFile, "/data/authority/keys/local-gate.pem");
    assert.equal(configBody.topology, "isolated");
    // Not decoration: a four-alias signed Job Card makes the runtime multi-definition, and
    // `resolveBoundJobs` refuses without the delegation authority `authority serve` builds only
    // when the config names a durable principal registry.
    assert.equal(configBody.ingress.principalRegistryFile, "/data/authority/principals/registry.jsonl");
    assert.equal("bearerRef" in configBody.ingress, false);
    assert.doesNotThrow(() => validateAuthorityHostConfig(configBody, staged.authorityDir));

    // The exact pairing `createLocalAuthorityRuntimeCore` performs: the deployment is loaded under
    // the externally owned Job Card trust pin, which re-verifies the signed readiness, the trust
    // event chain, and the Job Card signature.
    const trustPin = JSON.parse(readFileSync(path.join(staged.authorityDir, "trust", "job-card.json"), "utf8"));
    const deployment = await loadAuthorityDeployment(path.join(staged.authorityDir, "deployment", "deployment.json"), { jobCardTrustPin: trustPin });
    assert.equal(deployment.states.length, githubReleaseAliases.length);
    assert.deepEqual([...deployment.states.map(state => state.definitionAlias)].sort(), [...githubReleaseAliases].sort());
    assert.deepEqual([...deployment.jobCard!.definitionAliases].sort(), [...githubReleaseAliases].sort());
    // `verifyJobCardTrust` refuses a signer that is also an audience; assert the property directly.
    assert.equal(deployment.jobCard!.audiences.includes(deployment.jobCard!.signerId), false);
    assert.equal(deployment.states.every(state => state.candidates.length === 1), true);

    // The trust pin must live outside deployment-controlled output (`local.ts`).
    const pinDir = path.resolve(path.join(staged.authorityDir, "trust"));
    const deploymentDir = path.resolve(path.join(staged.authorityDir, "deployment"));
    assert.equal(pinDir.startsWith(`${deploymentDir}${path.sep}`) || pinDir === deploymentDir, false);

    assert.deepEqual(readdirSync(path.join(staged.authorityDir, "authorizations")), []);
    assert.equal(statSync(path.join(staged.authorityDir, "principals")).isDirectory(), true);
  } finally { rmSync(staged.root, { recursive: true, force: true }); }
});

test("stage-cell-bundle never puts the release-authority private key or any PEM into the configs", () => {
  const staged = workspace();
  try {
    assert.equal(run(staged).status, 0);
    const releaseAuthorityPem = readFileSync(path.join(staged.keysDir, "release-authority.key.pem"), "utf8").trim();
    const journalPem = readFileSync(path.join(staged.keysDir, "journal-signer.key.pem"), "utf8");
    const evidencePem = readFileSync(path.join(staged.keysDir, "evidence-signer.key.pem"), "utf8");

    // Exactly two files carry key material, and they are the two Cell signer PEMs.
    assert.deepEqual(readdirSync(path.join(staged.authorityDir, "keys")).sort(), ["evidence-signer.key.pem", "journal-signer.key.pem"]);
    assert.equal(readFileSync(path.join(staged.authorityDir, "keys", "journal-signer.key.pem"), "utf8"), journalPem);
    assert.equal(readFileSync(path.join(staged.authorityDir, "keys", "evidence-signer.key.pem"), "utf8"), evidencePem);

    for (const file of walk(staged.authorityDir)) {
      const body = readFileSync(file, "utf8");
      assert.equal(body.includes(releaseAuthorityPem), false, `release-authority private key leaked into ${file}`);
    }
    for (const name of ["authority.yml", "release-runner.config.json"]) {
      const body = readFileSync(path.join(staged.authorityDir, name), "utf8");
      assert.equal(body.includes("PRIVATE KEY"), false, `${name} contains PEM private key content`);
      assert.equal(body.includes("BEGIN"), false, `${name} contains PEM content`);
    }
    // Ceremony keys the script mints stay operator-held and never enter the bundle.
    for (const name of ["job-signer.key.pem", "readiness-signer.key.pem", "deployment-operator.key.pem", "deployment-contract.key.pem"]) {
      const held = readFileSync(path.join(staged.keysDir, name), "utf8").trim();
      for (const file of walk(staged.authorityDir)) assert.equal(readFileSync(file, "utf8").includes(held), false, `${name} leaked into ${file}`);
    }
  } finally { rmSync(staged.root, { recursive: true, force: true }); }
});

test("stage-cell-bundle refuses missing keys, non-ed25519 keys, a malformed repository, and an existing bundle", () => {
  const missing = workspace();
  try {
    rmSync(path.join(missing.keysDir, "journal-signer.key.pem"));
    const result = run(missing);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Cell journal signer key is missing/);
    assert.equal(readdirSync(missing.outDir).length, 0);
  } finally { rmSync(missing.root, { recursive: true, force: true }); }

  const wrongAlgorithm = workspace();
  try {
    writeFileSync(path.join(wrongAlgorithm.keysDir, "evidence-signer.key.pem"), generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "pem", type: "pkcs8" }));
    const result = run(wrongAlgorithm);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /is ec, not ed25519/);
  } finally { rmSync(wrongAlgorithm.root, { recursive: true, force: true }); }

  const malformed = workspace();
  try {
    const result = run(malformed, [], "not-a-repository");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--repository must be an owner\/name identity/);
  } finally { rmSync(malformed.root, { recursive: true, force: true }); }

  const twice = workspace();
  try {
    assert.equal(run(twice).status, 0);
    const before = readFileSync(path.join(twice.authorityDir, "authority.yml"), "utf8");
    const second = run(twice);
    assert.equal(second.status, 1);
    assert.match(second.stderr, /refusing to overwrite a staged bundle/);
    assert.equal(readFileSync(path.join(twice.authorityDir, "authority.yml"), "utf8"), before);
  } finally { rmSync(twice.root, { recursive: true, force: true }); }
});

test("stage-cell-bundle reuses, never regenerates, the ceremony keys it minted", () => {
  const staged = workspace();
  try {
    assert.equal(run(staged).status, 0);
    const minted = ["job-signer.key.pem", "readiness-signer.key.pem", "deployment-operator.key.pem", "deployment-contract.key.pem"];
    const before = minted.map(name => readFileSync(path.join(staged.keysDir, name), "utf8"));
    rmSync(staged.authorityDir, { recursive: true, force: true });
    const second = run(staged);
    assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);
    assert.deepEqual(minted.map(name => readFileSync(path.join(staged.keysDir, name), "utf8")), before);
    assert.match(second.stdout, /job-signer\.key\.pem {2}\(reused, not overwritten\)/);
  } finally { rmSync(staged.root, { recursive: true, force: true }); }
});
