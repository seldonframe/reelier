import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { authorityDigest, signAuthorityDigest } from "../src/authority/index.js";
import { loadAuthorityDeployment } from "../src/authority/host/deployment.js";
import { loadAuthorityHostConfig } from "../src/authority/host/config.js";
import { __testSetAuthorityCellHostPlatform } from "../src/authority/host/platform.js";
import type { AuthorityHostServer } from "../src/authority/host/server.js";
import { githubReleaseAliases } from "../src/packs/github-release/manifest.js";
import { verifyTrustedAuthority } from "../src/authority/trust.js";
// The staging/signing/registration/serve harness is shared with
// `test/continuity/eve-remote-cell.test.ts`, so both suites drive the SAME production composition.
import { distRoot, probe, serve, sign, signScript, stage, TASK_ID } from "./authority/support/cell-smoke-harness.js";

let restorePlatform: (() => void) | undefined;
test.before(() => { restorePlatform = __testSetAuthorityCellHostPlatform("linux"); });
test.after(() => { restorePlatform?.(); });

function jobRefsFrom(stdout: string): string[] {
  const line = stdout.split("\n").find(value => value.startsWith("jobs body: "));
  assert.ok(line, `no jobs body line in:\n${stdout}`);
  const body = JSON.parse(line.slice("jobs body: ".length)) as { verdict: string; jobs: Array<{ jobRef: string }> };
  assert.equal(body.verdict, "accepted");
  return body.jobs.map(job => job.jobRef);
}

test("sign-root-grant emits a key-free payload the deployment's own trust roots verify", async () => {
  const harness = stage();
  try {
    const result = sign(harness, ["--trust-key", harness.operatorTrustKey, "--authority-cell-id", harness.authorityCellId]);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

    const raw = readFileSync(harness.grantFile, "utf8");
    // The payload is uploaded to a production volume: nothing key-shaped may be in it.
    for (const marker of ["BEGIN", "PRIVATE KEY", "-----"]) assert.equal(raw.includes(marker), false, `signed payload leaks ${marker}`);
    const payload = JSON.parse(raw) as { v: string; taskId: string; allocationId: string; effects: number; scope: string; authorityCellId: string; rootGrant: { grant: Record<string, unknown>; digest: string; signerId: string; signature: { alg: string; sig: string } } };
    assert.equal(payload.v, "reelier.cell-smoke-root-grant-registration/v1");
    assert.equal(payload.taskId, TASK_ID);
    assert.equal(payload.allocationId, "root");
    assert.equal(payload.effects, 1);
    assert.equal(payload.scope, "listing");
    assert.equal(payload.authorityCellId, harness.authorityCellId);
    assert.equal(payload.rootGrant.signerId, "operator");
    assert.equal(payload.rootGrant.grant.parentDigest, null);
    assert.equal(payload.rootGrant.grant.grantee, "agent_release");
    assert.equal(payload.rootGrant.grant.tenant, "tenant_release");
    assert.equal(authorityDigest(payload.rootGrant.grant), payload.rootGrant.digest);
    // The schema floor: one alias, not the four the mission needs.
    const constraints = payload.rootGrant.grant.constraints as { definitionAliases: string[]; limits: Record<string, number> };
    assert.deepEqual(constraints.definitionAliases, [githubReleaseAliases[0]]);
    assert.deepEqual(constraints.limits, { maxEffectsPerWindow: 1, windowSeconds: 1, maxEffectsPerSourceTrigger: 1, maxBodyBytes: 1 });

    // The exact check `verifyRootGrant` runs in-Cell, against the STAGED deployment's trust roots.
    const config = (await loadAuthorityHostConfig(harness.configFile)).config;
    const deployment = await loadAuthorityDeployment(config.deploymentPath!, { jobCardTrustPin: JSON.parse(readFileSync(config.jobCardTrustPinPath!, "utf8")) });
    verifyTrustedAuthority(deployment.trustRoots, {
      tenant: config.tenant, signerId: payload.rootGrant.signerId, purpose: "delegation-grant",
      advertisedDigest: payload.rootGrant.digest, value: payload.rootGrant.grant, signature: payload.rootGrant.signature as never,
    });

    // `--scope release` widens to the four reviewed definitions, and only there.
    const releaseFile = path.join(harness.root, "release-root-grant.json");
    const widened = sign(harness, ["--scope", "release", "--trust-key", harness.operatorTrustKey], releaseFile);
    assert.equal(widened.status, 0, `${widened.stdout}\n${widened.stderr}`);
    const releasePayload = JSON.parse(readFileSync(releaseFile, "utf8")) as { rootGrant: { grant: { constraints: { definitionAliases: string[] } } } };
    assert.deepEqual(releasePayload.rootGrant.grant.constraints.definitionAliases, [...githubReleaseAliases]);
  } finally { rmSync(harness.root, { recursive: true, force: true }); }
});

test("sign-root-grant can bind a distinct rehearsal allocation without changing the listing default", () => {
  const harness = stage();
  try {
    const rehearsalFile = path.join(harness.root, "rehearsal-root-grant.json");
    const result = sign(harness, ["--allocation-id", "release-rehearsal-root-01"], rehearsalFile);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const payload = JSON.parse(readFileSync(rehearsalFile, "utf8")) as { allocationId: string };
    assert.equal(payload.allocationId, "release-rehearsal-root-01");
    assert.match(result.stdout, /allocation: release-rehearsal-root-01/);
  } finally { rmSync(harness.root, { recursive: true, force: true }); }
});

test("sign-root-grant can bind the rehearsal to an exact twelve-hour window", () => {
  const harness = stage();
  try {
    const rehearsalFile = path.join(harness.root, "twelve-hour-root-grant.json");
    const result = sign(harness, ["--expires-in-hours", "12"], rehearsalFile);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const payload = JSON.parse(readFileSync(rehearsalFile, "utf8")) as { rootGrant: { grant: { issuedAt: string; expiresAt: string } } };
    assert.equal(
      Date.parse(payload.rootGrant.grant.expiresAt) - Date.parse(payload.rootGrant.grant.issuedAt),
      12 * 60 * 60 * 1_000,
    );
  } finally { rmSync(harness.root, { recursive: true, force: true }); }
});

test("sign-root-grant refuses a missing key, a key that is not the deployed trust root, and an existing output", () => {
  const harness = stage();
  try {
    const emptyKeys = path.join(harness.root, "empty-keys");
    mkdirSync(emptyKeys, { recursive: true });
    const missing = spawnSync(process.execPath, [signScript, "--keys", emptyKeys, "--out", harness.grantFile], {
      encoding: "utf8", env: { ...(process.env as Record<string, string>), REELIER_SIGN_GRANT_DIST: distRoot },
    });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /deployment delegation-grant key is missing/);
    assert.equal(existsSync(harness.grantFile), false, "a refused signing run must leave no payload behind");

    // A correctly-shaped ed25519 key that is NOT the deployed one. This is the failure the Cell
    // would otherwise only surface after upload, as "authority signature verification failed".
    const wrongKeys = path.join(harness.root, "wrong-keys");
    mkdirSync(wrongKeys, { recursive: true });
    writeFileSync(path.join(wrongKeys, "deployment-operator.key.pem"), generateKeyPairSync("ed25519").privateKey.export({ format: "pem", type: "pkcs8" }));
    const wrong = spawnSync(process.execPath, [signScript, "--keys", wrongKeys, "--out", harness.grantFile, "--trust-key", harness.operatorTrustKey], {
      encoding: "utf8", env: { ...(process.env as Record<string, string>), REELIER_SIGN_GRANT_DIST: distRoot },
    });
    assert.equal(wrong.status, 1);
    assert.match(wrong.stderr, /not the deployment delegation-grant key/);
    assert.equal(existsSync(harness.grantFile), false);
    // Nothing key-shaped is ever echoed, not even on the refusal paths.
    for (const stream of [missing.stdout, missing.stderr, wrong.stdout, wrong.stderr]) assert.equal(stream.includes("PRIVATE KEY"), false);

    assert.equal(sign(harness, ["--trust-key", harness.operatorTrustKey]).status, 0);
    const again = sign(harness, ["--trust-key", harness.operatorTrustKey]);
    assert.equal(again.status, 1);
    assert.match(again.stderr, /refusing to overwrite a signed registration payload/);
  } finally { rmSync(harness.root, { recursive: true, force: true }); }
});

test("cell-register-and-probe completes the first authenticated conversation without printing the bearer", async () => {
  const harness = stage();
  let running: Readonly<{ server: AuthorityHostServer; port: number }> | undefined;
  try {
    assert.equal(sign(harness, ["--trust-key", harness.operatorTrustKey, "--authority-cell-id", harness.authorityCellId]).status, 0);
    running = await serve(harness);
    const result = await probe(harness, running.port);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

    const refs = jobRefsFrom(result.stdout);
    assert.equal(refs.length, githubReleaseAliases.length, "the four reviewed definitions must each yield one opaque reference");
    assert.equal(refs.length, 4);
    assert.equal(new Set(refs).size, 4);
    for (const ref of refs) assert.match(ref, /^jobref_[0-9a-f]{64}$/);
    assert.match(result.stdout, /^HTTP 200 http:\/\/127\.0\.0\.1:\d+\/v1\/jobs$/m);
    assert.match(result.stdout, /^session: issued /m);
    assert.match(result.stdout, new RegExp(`^binding: task=${TASK_ID} grant=grant_${TASK_ID} allocation=root effects=1 `, "m"));

    const token = readFileSync(harness.tokenFile, "utf8").trim();
    assert.match(token, /^rat_[A-Za-z0-9_-]+$/);
    // The load-bearing assertion: the raw bearer exists on disk and NOWHERE in the operator's terminal.
    assert.equal(result.stdout.includes(token), false, "the raw bearer must never reach stdout");
    assert.equal(result.stderr.includes(token), false, "the raw bearer must never reach stderr");
    assert.match(result.stdout, new RegExp(`^token sha256: sha256:${createHash("sha256").update(token, "utf8").digest("hex")}$`, "m"));
    assert.ok(result.stdout.includes(`token file: ${harness.tokenFile} (mode 0600)`), result.stdout);
    // Windows reports synthesized permission bits, so the real mode is asserted where it is real.
    if (process.platform !== "win32") assert.equal(statSync(harness.tokenFile).mode & 0o777, 0o600);
  } finally {
    await running?.server.close();
    rmSync(harness.root, { recursive: true, force: true });
  }
});

test("the principal session can never outlive its signed root grant", async () => {
  const harness = stage();
  let running: Readonly<{ server: AuthorityHostServer; port: number }> | undefined;
  try {
    assert.equal(sign(harness, ["--expires-in-hours", "1"]).status, 0);
    running = await serve(harness);
    const result = await probe(harness, running.port, ["--expires-in-hours", "12", "--new-session"]);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const grantExpiry = /binding: .* expires=([^\s]+)/.exec(result.stdout)?.[1];
    const sessionExpiry = /session: .* expires=([^\s]+)/.exec(result.stdout)?.[1];
    assert.ok(grantExpiry && sessionExpiry, result.stdout);
    assert.equal(sessionExpiry, grantExpiry);
  } finally {
    await running?.server.close();
    rmSync(harness.root, { recursive: true, force: true });
  }
});

/** The invoke leg of the same authenticated conversation. `cell-register-and-probe.mjs` proves the
 * Cell answers `GET /v1/jobs`; this proves the Cell can also be ASKED to run one of them over HTTP,
 * through the real four-definition serve composition and the session that probe issued. The provider
 * is the loopback fixture, so what the Cell answers is its own governed decision either way — what
 * must never come back is `not-found`, which would mean the route does not exist. */
test("the Cell's HTTP ingress invokes a loaded opaque reference and refuses everything outside it", async () => {
  const harness = stage();
  let running: Readonly<{ server: AuthorityHostServer; port: number }> | undefined;
  try {
    assert.equal(sign(harness, ["--trust-key", harness.operatorTrustKey, "--authority-cell-id", harness.authorityCellId]).status, 0);
    running = await serve(harness);
    const registered = await probe(harness, running.port);
    assert.equal(registered.status, 0, `${registered.stdout}\n${registered.stderr}`);
    const refs = jobRefsFrom(registered.stdout);
    assert.equal(refs.length, githubReleaseAliases.length);
    const token = readFileSync(harness.tokenFile, "utf8").trim();
    const base = `http://127.0.0.1:${running.port}`;
    const invoke = async (jobRef: string, requestId: string, bearer?: string) => {
      const response = await fetch(`${base}/v1/jobs/${jobRef}/invoke`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
        body: JSON.stringify({ requestId, sourceRefs: { release: "release_candidate_1" }, choices: {} }),
      });
      return { status: response.status, body: await response.json() as { requestId: string; verdict: string; reasonCode: string; lifecycleState: string } };
    };

    const anonymous = await invoke(refs[0]!, "smoke_anonymous");
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.body.reasonCode, "authentication-required");

    const authenticated = await invoke(refs[0]!, "smoke_invoke", token);
    assert.equal(authenticated.status, 202, JSON.stringify(authenticated.body));
    // The Cell's OWN governed answer, in the same closed result contract the MCP tool returns. An
    // ingress with no invoke route answers `404 not-found`; this refusal comes from the GATE, after
    // job resolution and the authenticated binding both passed and source resolution did not — the
    // hermetic bundle stages no source for this reference, and the smoke never dispatches.
    assert.deepEqual(authenticated.body, { requestId: "smoke_invoke", verdict: "refused", reasonCode: "source-projection-invalid", lifecycleState: "refused" });

    // An opaque reference this Cell never issued is a governed refusal too, never a 404.
    const foreign = await invoke(`jobref_${"0".repeat(64)}`, "smoke_foreign", token);
    assert.equal(foreign.status, 202);
    assert.equal(foreign.body.reasonCode, "job-not-found");

    // A bearer the Cell will not resolve never reaches the runner at all.
    const forged = await invoke(refs[0]!, "smoke_forged", "rat_not_a_registered_session");
    assert.equal(forged.status, 401);
    assert.equal(forged.body.reasonCode, "authentication-required");
    assert.equal(registered.stdout.includes(token), false);
  } finally {
    await running?.server.close();
    rmSync(harness.root, { recursive: true, force: true });
  }
});

test("a re-run reuses the one session, and a divergent task refuses instead of forking authority", async () => {
  const harness = stage();
  let running: Readonly<{ server: AuthorityHostServer; port: number }> | undefined;
  try {
    assert.equal(sign(harness, ["--trust-key", harness.operatorTrustKey]).status, 0);
    running = await serve(harness);
    const first = await probe(harness, running.port);
    assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
    const token = readFileSync(harness.tokenFile, "utf8");

    const second = await probe(harness, running.port);
    assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);
    assert.match(second.stdout, /^session: reused /m);
    assert.deepEqual(jobRefsFrom(second.stdout), jobRefsFrom(first.stdout), "a re-run must not re-key the job references");
    assert.equal(readFileSync(harness.tokenFile, "utf8"), token, "a re-run must not rotate the token file");
    assert.equal(second.stdout.includes(token.trim()), false);

    // A second registration under a different task id would fork the audience's authority. It does
    // not: allocation ids are unique across the whole delegation root, so the budget refuses first.
    const otherFile = path.join(harness.root, "other-root-grant.json");
    const other = sign(harness, ["--task-id", "task_release_smoke_other"], otherFile);
    assert.equal(other.status, 0, `${other.stdout}\n${other.stderr}`);
    const forked = await probe(harness, running.port, [], otherFile);
    assert.equal(forked.status, 1);
    assert.match(forked.stderr, /already registered with a DIFFERENT grant|budget allocation identity conflict/);
    assert.equal(readFileSync(harness.tokenFile, "utf8"), token, "a refused registration must not touch the issued session");
  } finally {
    await running?.server.close();
    rmSync(harness.root, { recursive: true, force: true });
  }
});

test("cell-register-and-probe refuses a foreign-signed root grant and mints no session at all", async () => {
  const harness = stage();
  let running: Readonly<{ server: AuthorityHostServer; port: number }> | undefined;
  try {
    assert.equal(sign(harness, ["--trust-key", harness.operatorTrustKey]).status, 0);
    // Same grant, same advertised signer id, re-signed by a key the deployment does not trust.
    const payload = JSON.parse(readFileSync(harness.grantFile, "utf8")) as { rootGrant: { grant: unknown; digest: string; signerId: string; signature: unknown } };
    payload.rootGrant.signature = signAuthorityDigest(generateKeyPairSync("ed25519").privateKey, "delegation-grant", payload.rootGrant.digest);
    const forgedFile = path.join(harness.root, "forged-root-grant.json");
    writeFileSync(forgedFile, `${JSON.stringify(payload, null, 2)}\n`);

    running = await serve(harness);
    const result = await probe(harness, running.port, [], forgedFile);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not signed by a delegation-grant trust root/);
    assert.equal(existsSync(harness.tokenFile), false, "a refused grant must mint no bearer");
    assert.equal(existsSync(path.join(harness.authorityDir, "principals", "registry.jsonl")), false, "a refused grant must write no principal registry event");

    // The genuine payload still works afterwards: the refusal left nothing behind to block a retry.
    const retry = await probe(harness, running.port);
    assert.equal(retry.status, 0, `${retry.stdout}\n${retry.stderr}`);
    assert.equal(jobRefsFrom(retry.stdout).length, 4);
  } finally {
    await running?.server.close();
    rmSync(harness.root, { recursive: true, force: true });
  }
});

/** The public SPKI in the staged trust directory is the public half of the operator key the signer
 * reads. If this ever diverges, every signed grant is refused in-Cell and nowhere else. */
test("the deployment trust key is the public half of the operator key sign-root-grant reads", () => {
  const harness = stage();
  try {
    const derived = createPublicKey(readFileSync(path.join(harness.keysDir, "deployment-operator.key.pem"))).export({ format: "der", type: "spki" }).toString("base64");
    const deployed = createPublicKey(readFileSync(harness.operatorTrustKey)).export({ format: "der", type: "spki" }).toString("base64");
    assert.equal(derived, deployed);
  } finally { rmSync(harness.root, { recursive: true, force: true }); }
});
