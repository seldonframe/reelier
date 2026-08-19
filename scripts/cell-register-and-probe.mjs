#!/usr/bin/env node
// Runs INSIDE the live Fly Authority Cell. Registers the signed root grant, resolves the session
// binding, issues the `agent_release` principal session, and performs the FIRST authenticated
// conversation with the Cell's own serve process.
//
//   node /data/authority/cell-register-and-probe.mjs --grant /data/authority/smoke-root-grant.json \
//     [--config /data/authority/authority.yml] [--base-url http://127.0.0.1:8080] \
//     [--token-file /data/authority/principals/smoke-session.token] \
//     [--expires-in-hours 12] [--new-session]
//
// THE IMAGE HAS NO /app/scripts. `Dockerfile` copies `dist`, `node_modules`, `integrations`, and
// four markdown files into the runtime stage — nothing else. This file therefore ships to the
// VOLUME and is run from there; it imports the built CLI at `/app/dist` (override with
// `REELIER_CELL_PROBE_DIST`, which the hermetic test points at `dist-test/src`).
//
// WHAT IT PRINTS: the binding summary, the token FILE path and the token's sha256, the HTTP status,
// and the jobs response body. WHAT IT NEVER PRINTS: the raw `rat_` bearer. Every line goes through
// `say()`, which redacts any occurrence of the live token before it reaches a stream, so a future
// edit that interpolates the token by accident degrades to `<redacted>` instead of leaking it. The
// token is written to `--token-file` with mode 0600 and is the only place it exists at rest.
//
// ORDER MATTERS, AND HERE IS WHY. `createDelegationAuthority` caches its registry read
// (`ensureLoaded` memoizes `loadRegistry`), and the serve process's copy loads lazily on its FIRST
// delegation call — which, on a Cell that has served no traffic, is the `/v1/jobs` probe below.
// Registering BEFORE the first authenticated request is what makes the serve process observe this
// task at all. A task registered AFTER serve has already resolved a binding is invisible to it
// until serve restarts; the refusal in that case is honest ("delegation task is not active"), never
// a silent pass.
//
// IDEMPOTENCE, AS DESIGNED. `registerRoot` is a no-op when re-registering the identical
// (taskId, allocationId, rootGrant, signerDescriptor, effects) tuple and throws
// "delegation root activation conflict" on any divergence, so re-running with the SAME signed file
// is safe and re-running with a different one refuses. `resolveSessionBinding` refuses zero or
// ambiguous grants for a principal, so this script never creates a second grant for the audience.
// The session is keyed to a deterministic `runtimeSessionId` derived from the task id: a re-run
// REUSES the token already at `--token-file` after re-resolving it against the registry, and
// refuses cleanly if that file is gone (the registry stores only a hash, so a lost raw token is
// unrecoverable by construction). `--new-session` is the explicit escape hatch and mints a fresh
// runtime session id rather than silently minting a second credential for the same one.

import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_CONFIG = "/data/authority/authority.yml";
const DEFAULT_BASE_URL = "http://127.0.0.1:8080";
const DEFAULT_TOKEN_FILE = "/data/authority/principals/smoke-session.token";
const PAYLOAD_V = "reelier.cell-smoke-root-grant-registration/v1";
const PAYLOAD_FIELDS = new Set(["v", "taskId", "allocationId", "effects", "scope", "authorityCellId", "rootGrant"]);
const ROOT_GRANT_FIELDS = new Set(["grant", "digest", "signerId", "signature"]);
const TOKEN_PREFIX = "rat_";

/** Set once the raw bearer exists. `say`/`fail` scrub it out of every line they emit. */
let liveToken;
const redact = text => (liveToken ? String(text).split(liveToken).join("<redacted>") : String(text));
const say = message => { console.log(redact(message)); };

function fail(message) {
  console.error(`cell-register-and-probe: ${redact(message)}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = new Map();
  const flags = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) fail(`unexpected positional argument ${JSON.stringify(arg)}`);
    const name = arg.indexOf("=") > 0 ? arg.slice(2, arg.indexOf("=")) : arg.slice(2);
    if (name === "new-session") { if (flags.has(name)) fail("--new-session was supplied more than once"); flags.add(name); continue; }
    const eq = arg.indexOf("=");
    const value = eq > 0 ? arg.slice(eq + 1) : argv[index + 1];
    if (eq < 0) index += 1;
    if (value === undefined) fail(`--${name} requires a value`);
    if (opts.has(name)) fail(`--${name} was supplied more than once`);
    opts.set(name, value);
  }
  const known = new Set(["grant", "config", "base-url", "token-file", "expires-in-hours"]);
  for (const name of opts.keys()) if (!known.has(name)) fail(`unknown option --${name}`);
  if (!opts.has("grant")) fail("--grant is required");
  const baseUrl = opts.get("base-url") ?? DEFAULT_BASE_URL;
  let probeUrl;
  try { probeUrl = new URL("/v1/jobs", baseUrl); } catch { return fail("--base-url is not a URL"); }
  if (probeUrl.protocol !== "http:" && probeUrl.protocol !== "https:") fail("--base-url must be http or https");
  const hours = Number(opts.get("expires-in-hours") ?? "12");
  if (!Number.isInteger(hours) || hours < 1 || hours > 168) fail("--expires-in-hours must be an integer between 1 and 168");
  return Object.freeze({
    grantFile: path.resolve(opts.get("grant")),
    configFile: path.resolve(opts.get("config") ?? DEFAULT_CONFIG),
    tokenFile: path.resolve(opts.get("token-file") ?? DEFAULT_TOKEN_FILE),
    probeUrl: probeUrl.href,
    hours,
    newSession: flags.has("new-session"),
  });
}

const args = parseArgs(process.argv.slice(2));

const distRoot = process.env.REELIER_CELL_PROBE_DIST
  ? pathToFileURL(path.resolve(process.env.REELIER_CELL_PROBE_DIST) + path.sep).href
  : pathToFileURL("/app/dist/").href;

async function load(relative, names) {
  const url = new URL(relative, distRoot).href;
  let module;
  try { module = await import(url); } catch (error) {
    fail(`cannot import ${url}; the Cell image must carry a built /app/dist (${error instanceof Error ? error.message : String(error)})`);
  }
  for (const name of names) if (module[name] === undefined) fail(`${url} does not export ${name}; the image build is stale or the module moved`);
  return module;
}

const { authorityDigest } = await load("authority/index.js", ["authorityDigest"]);
const { createDelegationAuthority, createFilePrincipalRegistry, loadAuthorityDeployment, loadAuthorityHostConfig } =
  await load("authority/host/index.js", ["createDelegationAuthority", "createFilePrincipalRegistry", "loadAuthorityDeployment", "loadAuthorityHostConfig"]);
// Not re-exported by the public barrels; imported by path, exactly as `stage-cell-bundle.mjs` does.
const { verifyTrustedAuthority } = await load("authority/trust.js", ["verifyTrustedAuthority"]);

/** PINNED DUPLICATION of `delegationRoot` in `src/authority/cli.ts` (the private helper
 * `authority serve` uses to site its delegation authority). It is not exported, and pointing this
 * script at a different directory than the serve process would produce a registration the Cell
 * never sees. If that helper moves, this line must move with it. */
const delegationRoot = ledgerDir => path.join(path.dirname(path.resolve(ledgerDir)), "delegations");

const tokenDigest = token => `sha256:${createHash("sha256").update(token, "utf8").digest("hex")}`;

function parsePayload(value, file) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${file} is not a registration payload object`);
  if (value.v !== PAYLOAD_V) fail(`${file} is not a ${PAYLOAD_V} payload`);
  for (const key of Object.keys(value)) if (!PAYLOAD_FIELDS.has(key)) fail(`${file} carries an unknown field ${JSON.stringify(key)}; the registration payload is closed`);
  if (typeof value.taskId !== "string" || !value.taskId) fail(`${file} has no task id`);
  if (typeof value.allocationId !== "string" || !value.allocationId) fail(`${file} has no allocation id`);
  if (!Number.isInteger(value.effects) || value.effects < 1) fail(`${file} has no positive effects budget`);
  const root = value.rootGrant;
  if (!root || typeof root !== "object" || Array.isArray(root)) fail(`${file} has no root grant`);
  for (const key of Object.keys(root)) if (!ROOT_GRANT_FIELDS.has(key)) fail(`${file} root grant carries an unknown field ${JSON.stringify(key)}`);
  if (!root.grant || typeof root.grant !== "object" || Array.isArray(root.grant)) fail(`${file} root grant has no grant value`);
  if (root.grant.parentDigest !== null) fail(`${file} root grant is a child grant; a task root must have a null parent digest`);
  if (typeof root.digest !== "string" || typeof root.signerId !== "string" || !root.signature) fail(`${file} root grant is missing its digest, signer, or signature`);
  if (authorityDigest(root.grant) !== root.digest) fail(`${file} root grant digest does not match its grant`);
  return value;
}

async function main() {
  let payload;
  try { payload = parsePayload(JSON.parse(await readFile(args.grantFile, "utf8")), args.grantFile); }
  catch (error) { if (error?.code === "ENOENT") fail(`--grant is missing at ${args.grantFile}`); throw error; }
  const grant = payload.rootGrant.grant;

  let loadedConfig;
  try { loadedConfig = await loadAuthorityHostConfig(args.configFile); }
  catch (error) { return fail(`${args.configFile} is not a loadable authority host config: ${error instanceof Error ? error.message : String(error)}`); }
  const config = loadedConfig.config;
  if (!config.ingress?.principalRegistryFile) fail(`${args.configFile} names no ingress.principalRegistryFile; per-session bearers cannot be minted without the durable principal registry`);
  if (!config.deploymentPath || !config.jobCardTrustPinPath) fail(`${args.configFile} names no signed deployment and host trust pin`);
  if (!config.authorityCellId) fail(`${args.configFile} names no authorityCellId; the session context cannot be bound to this Cell`);
  if (grant.tenant !== config.tenant) fail(`the root grant tenant ${grant.tenant} is not this Cell's tenant ${config.tenant}`);
  if (grant.grantee !== config.requester) fail(`the root grant grantee ${grant.grantee} is not this Cell's configured requester ${config.requester}`);
  if (payload.authorityCellId !== undefined && payload.authorityCellId !== config.authorityCellId) {
    fail(`the signed payload expects Cell ${payload.authorityCellId} but this Cell is ${config.authorityCellId}`);
  }

  const jobCardTrustPin = JSON.parse(await readFile(config.jobCardTrustPinPath, "utf8"));
  const deployment = await loadAuthorityDeployment(config.deploymentPath, { jobCardTrustPin });
  if (!deployment.jobCard) fail("the staged deployment carries no signed Job Card");
  if (!deployment.jobCard.audiences.includes(grant.grantee)) fail(`${grant.grantee} is not an audience of the signed Job Card`);
  // The SAME check `verifyRootGrant` performs on the HTTP `/v1/tasks` path (`src/authority/host/
  // local.ts`), against the SAME deployment trust roots. `registerRoot` alone does NOT verify a
  // signature when no signer descriptor is supplied, so skipping this would register an unverified
  // grant into the Cell's durable registry.
  try {
    verifyTrustedAuthority(deployment.trustRoots, {
      tenant: config.tenant, signerId: payload.rootGrant.signerId, purpose: "delegation-grant",
      advertisedDigest: payload.rootGrant.digest, value: grant, signature: payload.rootGrant.signature,
    });
  } catch (error) {
    fail(`the root grant is not signed by a delegation-grant trust root of this deployment: ${error instanceof Error ? error.message : String(error)}`);
  }

  const delegation = createDelegationAuthority({
    root: delegationRoot(config.ledgerDir),
    // This tool registers a root and reads a binding. It never mints a child grant, so the signer
    // it would need is deliberately absent rather than stubbed with a usable key.
    signGrant: async () => { throw new TypeError("the smoke registration never mints child delegation grants"); },
  });
  try {
    await delegation.registerRoot({ taskId: payload.taskId, allocationId: payload.allocationId, rootGrant: payload.rootGrant, effects: payload.effects });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    fail(reason.includes("activation conflict")
      ? `task ${payload.taskId} is already registered with a DIFFERENT grant, allocation, or effects budget; re-run with the signed file that created it, or choose a new --task-id (note: allocation ids are unique across the whole delegation root, so a second task also needs a distinct allocation id): ${reason}`
      : `root grant registration refused: ${reason}`);
  }

  let binding;
  try { binding = await delegation.resolveSessionBinding({ tenant: config.tenant, taskId: payload.taskId, principalId: grant.grantee }); }
  catch (error) { return fail(`session binding unresolved: ${error instanceof Error ? error.message : String(error)}`); }

  const principals = createFilePrincipalRegistry({ tenant: config.tenant, file: config.ingress.principalRegistryFile });
  const runtimeSessionId = args.newSession
    ? `rts_${payload.taskId}_${createHash("sha256").update(`${payload.taskId}\0${Date.now()}\0${process.pid}`).digest("hex").slice(0, 8)}`
    : `rts_${payload.taskId}`;

  let token;
  let disposition;
  let context;
  const existing = await readFile(args.tokenFile, "utf8").then(value => value.trim(), error => { if (error?.code === "ENOENT") return ""; throw error; });
  if (existing && !args.newSession) {
    if (!existing.startsWith(TOKEN_PREFIX)) fail(`${args.tokenFile} does not hold a principal credential; move it aside or pass --new-session`);
    liveToken = existing;
    try { context = await principals.resolve(existing); }
    catch (error) { return fail(`${args.tokenFile} holds a credential this Cell will not resolve (${error instanceof Error ? error.message : String(error)}); pass --new-session to mint a replacement`); }
    if (context.taskId !== binding.taskId || context.grantId !== binding.grantId || context.grantDigest !== binding.grantDigest || context.allocationId !== binding.allocationId || context.principalId !== binding.grantee || context.jobId !== deployment.jobCard.jobId || context.authorityCellId !== config.authorityCellId) {
      fail(`${args.tokenFile} holds a credential bound to a different task, grant, job, or Cell; pass --new-session to mint one for this binding`);
    }
    token = existing;
    disposition = "reused";
  } else {
    try {
      const credential = await principals.issue({
        principalId: binding.grantee, taskId: binding.taskId, grantId: binding.grantId, grantDigest: binding.grantDigest,
        allocationId: binding.allocationId, runtimeSessionId, jobId: deployment.jobCard.jobId,
        authorityCellId: config.authorityCellId,
        expiresAt: new Date(Date.now() + args.hours * 3600 * 1000).toISOString(),
      });
      token = credential.token;
      liveToken = token;
      context = credential.context;
      disposition = "issued";
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return fail(reason.includes("already has a principal credential")
        ? `runtime session ${runtimeSessionId} already holds an active credential and ${args.tokenFile} does not carry it; the registry stores only a hash, so that raw bearer is unrecoverable — pass --new-session to mint one under a fresh runtime session id: ${reason}`
        : `principal session issuance refused: ${reason}`);
    }
    await mkdir(path.dirname(args.tokenFile), { recursive: true });
    await writeFile(args.tokenFile, `${token}\n`, { encoding: "utf8", mode: 0o600 });
    // `writeFile`'s mode applies only when it creates the file; an existing path keeps its old mode.
    await chmod(args.tokenFile, 0o600);
  }

  let status;
  let body;
  try {
    const response = await fetch(args.probeUrl, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
    status = response.status;
    body = await response.text();
  } catch (error) {
    return fail(`the authenticated probe of ${args.probeUrl} did not complete: ${error instanceof Error ? error.message : String(error)}`);
  }

  say(`binding: task=${binding.taskId} grant=${binding.grantId} allocation=${binding.allocationId} effects=${binding.effects} expires=${binding.expiresAt}`);
  say(`grant digest: ${binding.grantDigest}`);
  say(`session: ${disposition} runtimeSessionId=${context.runtimeSessionId} job=${context.jobId} cell=${context.authorityCellId} expires=${context.expiresAt}`);
  say(`token file: ${args.tokenFile} (mode 0600)`);
  say(`token sha256: ${tokenDigest(token)}`);
  say(`HTTP ${status} ${args.probeUrl}`);
  say(`jobs body: ${body}`);
  if (status !== 200) {
    fail(`the authenticated probe returned HTTP ${status}, not 200; the body above is the Cell's own refusal`);
  }
}

await main();
