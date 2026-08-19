#!/usr/bin/env node
// Live READ-ONLY smoke for the GitHub release HTTPS provider against a DISPOSABLE rehearsal
// repository. DEFAULT SKIP — inert with no environment at all.
//
// It invokes only getRef / getCommit / readPackageManifest / npmVersionExists / getChecks. No
// provider WRITE method is referenced anywhere in this file, so no external write can occur even if
// the gate is set by accident.
//
// Gate:   REELIER_RELEASE_PROVIDER_LIVE_SMOKE=1
// Inputs: REELIER_SMOKE_REPOSITORY  owner/name of the disposable rehearsal repo
//         REELIER_SMOKE_TOKEN_REF   env:NAME or file:PATH — a secret REFERENCE, never a token value
// Build prerequisite: npm run build (this imports dist/authority/host/index.js).
import { readFileSync } from "node:fs";
import process from "node:process";

const SECRET_REF = /^(?:env:[A-Za-z_][A-Za-z0-9_]{0,127}|file:.+)$/;
const REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
// The rehearsal is a rehearsal. The production repository is refused by name, not by convention.
const FORBIDDEN_REPOSITORIES = new Set(["seldonframe/reelier"]);

if (process.env.REELIER_RELEASE_PROVIDER_LIVE_SMOKE !== "1") {
  console.log("github-release-provider live smoke: skipped (set REELIER_RELEASE_PROVIDER_LIVE_SMOKE=1 to run)");
  process.exit(0);
}

const repository = process.env.REELIER_SMOKE_REPOSITORY;
const tokenRef = process.env.REELIER_SMOKE_TOKEN_REF;
if (!repository || !tokenRef) {
  console.error("live smoke: REELIER_SMOKE_REPOSITORY and REELIER_SMOKE_TOKEN_REF are required");
  process.exit(1);
}
if (!REPOSITORY.test(repository) || FORBIDDEN_REPOSITORIES.has(repository.toLowerCase())) {
  console.error(`live smoke: REELIER_SMOKE_REPOSITORY must name a disposable rehearsal repository, never ${repository}`);
  process.exit(1);
}
if (!SECRET_REF.test(tokenRef)) {
  console.error("live smoke: REELIER_SMOKE_TOKEN_REF must be an env: or file: secret reference — never a token value");
  process.exit(1);
}

const { createGitHubReleaseHttpsProvider } = await import(new URL("../dist/authority/host/index.js", import.meta.url).href);
const secrets = {
  async resolve(reference) {
    if (reference.startsWith("env:")) { const value = process.env[reference.slice(4)]; if (!value) throw new Error("secret is unavailable"); return value; }
    if (reference.startsWith("file:")) { const value = readFileSync(reference.slice(5), "utf8").trim(); if (!value) throw new Error("secret is empty"); return value; }
    throw new TypeError("secret references must use env: or file:");
  },
};

const provider = createGitHubReleaseHttpsProvider({
  v: "reelier.github-release-https-provider-config/v1",
  githubAccountIdentity: "rehearsal-smoke",
  githubBaseUrl: process.env.REELIER_SMOKE_GITHUB_BASE_URL ?? "https://api.github.com",
  githubTokenRef: tokenRef,
  npmRegistryBaseUrl: "https://registry.npmjs.org",
  repository,
  timeoutMs: 30_000,
}, secrets);

try {
  const main = await provider.getRef({ repository, ref: "heads/main" });
  if (!main) { console.error("live smoke: heads/main is absent on the rehearsal repository"); process.exit(1); }
  console.log(`getRef heads/main -> ${main.sha}`);
  const commit = await provider.getCommit({ repository, sha: main.sha });
  console.log(`getCommit -> tree ${commit?.treeSha ?? "(null)"}`);
  const manifest = await provider.readPackageManifest({ repository, sha: main.sha });
  console.log(`readPackageManifest -> ${manifest.name}@${manifest.version}`);
  console.log(`npmVersionExists reelier@0.0.0-never -> ${await provider.npmVersionExists({ packageName: "reelier", version: "0.0.0-never" })}`);
  const checks = await provider.getChecks({ repository, sha: main.sha });
  console.log(`getChecks -> ${checks.length} check(s): ${checks.map(check => `${check.name}=${check.status}`).join(", ") || "(none)"}`);
  console.log("github-release-provider live smoke: PASS (reads only; no write was dispatched)");
} catch (error) {
  // A provider fault is a closed {v, kind, reason} DTO and carries no credential; an unexpected
  // Error is reported by message only, never by dumping the thrown value.
  const detail = error && typeof error === "object" && "kind" in error && "reason" in error
    ? `${error.kind}: ${error.reason}`
    : error instanceof Error ? error.message : "unknown failure";
  console.error(`github-release-provider live smoke: FAIL — ${detail}`);
  process.exit(1);
}
