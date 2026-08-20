#!/usr/bin/env node
// Builds and signs the root-grant REGISTRATION PAYLOAD for the live Fly Authority Cell's
// authenticated smoke, entirely on the OPERATOR machine, from the operator's own ceremony keys.
//
//   node scripts/sign-root-grant.mjs --keys <dir> --out <file> \
//     [--task-id task_release_smoke_<yyyymmdd>] [--grantee agent_release] [--tenant tenant_release] \
//     [--allocation-id root] [--scope listing|release] \
//     [--expires-in-days 7 | --expires-in-hours 12] [--effects 1] \
//     [--trust-key <staged>/authority/deployment/trust/keys/operator.pem] [--authority-cell-id cell_…]
//
// WHY THIS KEY. `authority serve` verifies a root grant through
// `verifyTrustedAuthority(trustRoots, { purpose: "delegation-grant", … })` (`src/authority/host/
// local.ts` — `verifyRootGrant`). The staged deployment's ONLY `delegation-grant` trust entry is
// `signerId: "operator"`, whose PUBLIC half is `deployment/trust/keys/operator.pem`
// (`scripts/stage-cell-bundle.mjs`). Its PRIVATE half is `deployment-operator.key.pem` in `--keys`.
// That is the one key that can sign a root grant this Cell will accept, so it is the only key this
// script reads.
//
// WHAT IT WRITES. `--out` holds ONLY the signed PUBLIC payload: the grant, its digest, the signer
// id, and the detached signature, plus the registration parameters `registerRoot` takes alongside
// the grant. No PEM, no private scalar, no derived secret. The private key is read to sign and is
// never exported, never printed, and never interpolated into any message — including refusals.
//
// SIGNATURE SCOPE, STATED PLAINLY. The Ed25519 signature covers the GRANT ONLY, because that is
// the only thing `verifyTrustedAuthority` verifies. `taskId`, `allocationId`, and `effects` are
// registration arguments of `registerRoot`, not grant fields, so they ride in the envelope
// UNSIGNED. Editing them cannot forge a grant; it can only re-root the same authentic grant under
// a different task name, which `registerRoot`'s activation-conflict check makes visible on the
// second registration. Do not describe this file as a fully signed artifact.
//
// SCOPE FLOOR (`--scope listing`, the default). `contract/authority/v1/delegation-grant.schema.json`
// puts `minItems: 1` on every constraint list and `minimum: 1` on every limit, so a grant CANNOT be
// scoped to nothing. The floor this script emits is exactly one definition alias (the least
// irreversible of the four — candidate-branch publish), one audience (the grantee), one connector
// account, one projection pointer, one risk class, and all four limits at 1. `--scope release`
// emits the standard four-alias shape `stage-cell-bundle.mjs` uses for the real mission.
//
// HONEST LIMIT ON WHAT THE SCOPE BUYS. Nothing on the job-listing path reads the root grant's
// constraints: `resolveBoundJobs` (`src/authority/host/local.ts`) projects the signed Job Card's
// definition aliases and checks only the SESSION BINDING (task, grant id, grant digest, allocation).
// Dispatch reads each outcome contract's own `delegationGrantDigest`, which points at the
// per-definition `contract_grant_*` grants in the deployment, not at this root. So a minimal scope
// here is an honest declaration of intent and a real bound on any FUTURE child grant
// (`validateChildDelegationRequest` compares a child against its parent) — it is not, today, an
// enforced bound on the listing smoke.
//
// BUILD PREREQUISITE: imports the built modules under `dist/` (`npm ci && npm run build` first).
// `REELIER_SIGN_GRANT_DIST` overrides the imported root; the hermetic test points it at
// `dist-test/src`.

import { createHash, createPrivateKey, createPublicKey } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const OPERATOR_SIGNER_ID = "operator";
const OPERATOR_KEY_FILE = "deployment-operator.key.pem";
const TENANT = "tenant_release";
const DEFAULT_GRANTEE = "agent_release";
const DEFAULT_ROOT_ALLOCATION_ID = "root";
/** `contract/authority/v1/delegation-grant.schema.json` `$defs/id`: no colon, no slash. */
const GRANT_ID = /^[A-Za-z0-9._~-]{1,128}$/;
/** `runtime.ts` taskCreate AND `principal-registry.ts` `ID`, intersected. */
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CELL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SCOPES = new Set(["listing", "release"]);

function fail(message) {
  console.error(`sign-root-grant: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) fail(`unexpected positional argument ${JSON.stringify(arg)}`);
    const eq = arg.indexOf("=");
    const name = eq > 0 ? arg.slice(2, eq) : arg.slice(2);
    const value = eq > 0 ? arg.slice(eq + 1) : argv[index + (eq > 0 ? 0 : 1)];
    if (eq < 0) index += 1;
    if (value === undefined) fail(`--${name} requires a value`);
    if (opts.has(name)) fail(`--${name} was supplied more than once`);
    opts.set(name, value);
  }
  const known = new Set(["keys", "out", "task-id", "allocation-id", "grantee", "tenant", "scope", "expires-in-days", "expires-in-hours", "effects", "trust-key", "authority-cell-id"]);
  for (const name of opts.keys()) if (!known.has(name)) fail(`unknown option --${name}`);
  for (const name of ["keys", "out"]) if (!opts.has(name)) fail(`--${name} is required`);

  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}`;
  const taskId = opts.get("task-id") ?? `task_release_smoke_${stamp}`;
  if (!TASK_ID.test(taskId)) fail("--task-id must match /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/");
  const allocationId = opts.get("allocation-id") ?? DEFAULT_ROOT_ALLOCATION_ID;
  if (!GRANT_ID.test(allocationId)) fail("--allocation-id must be a delegation-grant identity");
  const grantee = opts.get("grantee") ?? DEFAULT_GRANTEE;
  if (!GRANT_ID.test(grantee)) fail("--grantee must be a delegation-grant identity");
  const tenant = opts.get("tenant") ?? TENANT;
  if (!GRANT_ID.test(tenant)) fail("--tenant must be a delegation-grant identity");
  const scope = opts.get("scope") ?? "listing";
  if (!SCOPES.has(scope)) fail("--scope must be listing or release");
  if (opts.has("expires-in-days") && opts.has("expires-in-hours")) fail("--expires-in-days and --expires-in-hours are mutually exclusive");
  const hours = opts.has("expires-in-hours")
    ? Number(opts.get("expires-in-hours"))
    : Number(opts.get("expires-in-days") ?? "7") * 24;
  if (!Number.isInteger(hours) || hours < 1 || hours > 365 * 24) fail("the grant validity must be an integer from 1 hour through 365 days");
  const effects = Number(opts.get("effects") ?? "1");
  // `FsDelegationBudgetLedger.createRoot` -> `assertEffects`: a positive integer, never zero.
  if (!Number.isInteger(effects) || effects < 1 || effects > 1_000_000) fail("--effects must be a positive integer budget");
  const authorityCellId = opts.get("authority-cell-id");
  if (authorityCellId !== undefined && !CELL_ID.test(authorityCellId)) fail("--authority-cell-id must be an authority cell identity");
  const grantId = `grant_${taskId}`;
  if (!GRANT_ID.test(grantId)) fail("the derived grant id exceeds the delegation-grant identity shape; shorten --task-id");

  return Object.freeze({
    keysDir: path.resolve(opts.get("keys")),
    outFile: path.resolve(opts.get("out")),
    trustKeyFile: opts.has("trust-key") ? path.resolve(opts.get("trust-key")) : undefined,
    taskId, allocationId, grantId, grantee, tenant, scope, validityMs: hours * 3600 * 1000, effects, authorityCellId,
  });
}

const args = parseArgs(process.argv.slice(2));

const distRoot = process.env.REELIER_SIGN_GRANT_DIST
  ? pathToFileURL(path.resolve(process.env.REELIER_SIGN_GRANT_DIST) + path.sep).href
  : new URL("../dist/", import.meta.url).href;

async function load(relative, names) {
  const url = new URL(relative, distRoot).href;
  let module;
  try { module = await import(url); } catch (error) {
    fail(`cannot import ${url}; run "npm ci && npm run build" first (${error instanceof Error ? error.message : String(error)})`);
  }
  for (const name of names) if (module[name] === undefined) fail(`${url} does not export ${name}; the build is stale or the module moved`);
  return module;
}

const { authorityDigest, parseAuthorityWire, signAuthorityDigest } =
  await load("authority/index.js", ["authorityDigest", "parseAuthorityWire", "signAuthorityDigest"]);
const { githubReleaseAliases, githubReleaseRiskClass } =
  await load("packs/github-release/manifest.js", ["githubReleaseAliases", "githubReleaseRiskClass"]);

const spkiBase64 = key => key.export({ format: "der", type: "spki" }).toString("base64");

/** Reads the operator delegation-grant key. Every refusal names the FILE and the defect, never a
 * byte of the key: a key that failed to load is exactly the moment an error message is most likely
 * to be pasted into a terminal, a ticket, or a chat. */
async function readOperatorKey(file) {
  let pem;
  try { pem = await readFile(file, "utf8"); } catch (error) {
    fail((error && error.code) === "ENOENT"
      ? `the deployment delegation-grant key is missing at ${file}; it is minted into --keys by scripts/stage-cell-bundle.mjs and is the ONLY key whose public half the Cell trusts for delegation-grant`
      : `the deployment delegation-grant key at ${file} cannot be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  let privateKey;
  try { privateKey = createPrivateKey(pem); } catch (error) {
    return fail(`${file} is not a readable PRIVATE key: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (privateKey.asymmetricKeyType !== "ed25519") fail(`${file} is ${String(privateKey.asymmetricKeyType)}, not ed25519`);
  return { privateKey, publicKey: createPublicKey(privateKey) };
}

/** The staged deployment's PUBLIC operator SPKI, when the operator points at it. This is the check
 * that catches the real mistake: signing with a correctly-shaped key that is not the deployed one,
 * which produces a payload the Cell refuses only after upload. */
async function assertMatchesDeployedTrustKey(file, publicKey) {
  let pem;
  try { pem = await readFile(file, "utf8"); } catch (error) {
    fail((error && error.code) === "ENOENT" ? `--trust-key is missing at ${file}` : `--trust-key at ${file} cannot be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  let deployed;
  try { deployed = createPublicKey(pem); } catch (error) {
    return fail(`--trust-key at ${file} is not a readable public key: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (deployed.asymmetricKeyType !== "ed25519") fail(`--trust-key at ${file} is ${String(deployed.asymmetricKeyType)}, not ed25519`);
  if (spkiBase64(deployed) !== spkiBase64(publicKey)) {
    fail(`the key in ${path.join(args.keysDir, OPERATOR_KEY_FILE)} is not the deployment delegation-grant key pinned at ${file}; the Cell would refuse this grant with "authority signature verification failed"`);
  }
}

/** The schema floor. `minItems: 1` / `minimum: 1` everywhere means "no scope at all" is not
 * expressible; this is the smallest grant the closed wire accepts. */
function constraintsFor(scope, grantee) {
  const limits = scope === "release"
    ? { maxEffectsPerWindow: 4, windowSeconds: 3600, maxEffectsPerSourceTrigger: 1, maxBodyBytes: 65_536 }
    : { maxEffectsPerWindow: 1, windowSeconds: 1, maxEffectsPerSourceTrigger: 1, maxBodyBytes: 1 };
  return {
    definitionAliases: scope === "release" ? [...githubReleaseAliases] : [githubReleaseAliases[0]],
    audiences: [grantee],
    connectorAccounts: [{ connectorId: "github", accountId: "account_release" }],
    projectionPointers: ["/authorizationHandle"],
    riskClasses: [githubReleaseRiskClass],
    limits,
  };
}

async function main() {
  // Refuse BEFORE reading a key: an existing `--out` is a payload someone may already have uploaded,
  // and silently replacing it makes "which grant is in the Cell" unanswerable.
  try {
    await readFile(args.outFile);
    fail(`${args.outFile} already exists; refusing to overwrite a signed registration payload`);
  } catch (error) {
    if ((error && error.code) !== "ENOENT") fail(`${args.outFile} cannot be inspected: ${error instanceof Error ? error.message : String(error)}`);
  }

  const operator = await readOperatorKey(path.join(args.keysDir, OPERATOR_KEY_FILE));
  if (args.trustKeyFile) await assertMatchesDeployedTrustKey(args.trustKeyFile, operator.publicKey);

  const issuedAt = new Date();
  const grant = {
    v: "reelier.delegation-grant/v1",
    tenant: args.tenant,
    grantId: args.grantId,
    parentDigest: null,
    sponsor: OPERATOR_SIGNER_ID,
    grantor: OPERATOR_SIGNER_ID,
    grantee: args.grantee,
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + args.validityMs).toISOString(),
    constraints: constraintsFor(args.scope, args.grantee),
  };
  // The SAME closed parser `verifyTrustedAuthority` runs before it checks the signature. A grant
  // that fails here would be refused in-Cell after upload; refuse now, on the operator's machine.
  try { parseAuthorityWire("delegation-grant", grant); } catch (error) {
    fail(`the assembled root grant is not a valid delegation-grant: ${error instanceof Error ? error.message : String(error)}`);
  }
  const digest = authorityDigest(grant);
  const payload = {
    v: "reelier.cell-smoke-root-grant-registration/v1",
    taskId: args.taskId,
    allocationId: args.allocationId,
    effects: args.effects,
    scope: args.scope,
    ...(args.authorityCellId ? { authorityCellId: args.authorityCellId } : {}),
    rootGrant: {
      grant,
      digest,
      signerId: OPERATOR_SIGNER_ID,
      signature: signAuthorityDigest(operator.privateKey, "delegation-grant", digest),
    },
  };
  await writeFile(args.outFile, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });

  const lines = [];
  lines.push(`signed root-grant registration: ${args.outFile}`);
  lines.push(`task: ${args.taskId}   allocation: ${args.allocationId}   effects: ${args.effects}   scope: ${args.scope}`);
  lines.push(`grant: ${args.grantId}   tenant: ${args.tenant}   grantee: ${args.grantee}`);
  lines.push(`grant digest: ${digest}`);
  lines.push(`signer: ${OPERATOR_SIGNER_ID}   public SPKI sha256: sha256:${createHash("sha256").update(Buffer.from(spkiBase64(operator.publicKey), "base64")).digest("hex")}`);
  lines.push(`definition aliases: ${grant.constraints.definitionAliases.join(", ")}`);
  lines.push(`valid: ${grant.issuedAt} .. ${grant.expiresAt}`);
  lines.push("");
  lines.push("THE FILE CONTAINS NO KEY MATERIAL. Only the grant, its digest, the signer id, and the");
  lines.push("detached signature. The signature covers the GRANT ONLY — taskId, allocationId, and");
  lines.push("effects are unsigned registerRoot arguments (see the header).");
  lines.push("");
  lines.push("NOT CLAIMED: this proves a grant was signed by the deployment delegation-grant key. It does");
  lines.push("not attest that the Cell accepted it, that a session exists, or that any release is authorized.");
  console.log(lines.join("\n"));
}

await main();
