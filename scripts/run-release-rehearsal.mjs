#!/usr/bin/env node

const JOB_REF = /^jobref_[0-9a-f]{64}$/;
const OPAQUE = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;
const ENV_REF = /^env:([A-Za-z_][A-Za-z0-9_]*)$/;
const REQUIRED_FLAGS = ["cell-url", "token-ref", "authorization-handle", "request-prefix"];
const FLAGS = new Set([...REQUIRED_FLAGS, "duplicate-step", "ci-wait-seconds"]);

let bearer = "";
const redact = value => bearer ? String(value).split(bearer).join("<redacted>") : String(value);
const fail = message => { throw new TypeError(redact(message)); };

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) fail(`unexpected positional argument ${JSON.stringify(arg)}`);
    const name = arg.slice(2);
    if (!FLAGS.has(name)) fail(`unknown option --${name}`);
    if (values.has(name)) fail(`--${name} was supplied more than once`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) fail(`--${name} requires a value`);
    values.set(name, value);
    index += 1;
  }
  for (const name of REQUIRED_FLAGS) if (!values.has(name)) fail(`--${name} is required`);

  let cell;
  try { cell = new URL(values.get("cell-url")); } catch { return fail("--cell-url is not a URL"); }
  const loopback = cell.hostname === "127.0.0.1" || cell.hostname === "localhost" || cell.hostname === "[::1]";
  if (cell.username || cell.password || cell.pathname !== "/" || cell.search || cell.hash || (cell.protocol !== "https:" && !(cell.protocol === "http:" && loopback))) {
    fail("--cell-url must be a bare https origin, or http only on loopback");
  }
  const tokenMatch = ENV_REF.exec(values.get("token-ref"));
  if (!tokenMatch) fail("--token-ref must be an env:NAME reference");
  const token = process.env[tokenMatch[1]];
  if (typeof token !== "string" || token.trim().length === 0) fail(`--token-ref environment variable ${tokenMatch[1]} is absent`);
  bearer = token.trim();
  const authorizationHandle = values.get("authorization-handle");
  const requestPrefix = values.get("request-prefix");
  if (!OPAQUE.test(authorizationHandle)) fail("--authorization-handle is not opaque-reference safe");
  if (!OPAQUE.test(requestPrefix)) fail("--request-prefix is not request-id safe");
  const duplicateStep = values.has("duplicate-step") ? Number(values.get("duplicate-step")) : null;
  if (duplicateStep !== null && (!Number.isInteger(duplicateStep) || duplicateStep < 1 || duplicateStep > 4)) fail("--duplicate-step must be an integer from 1 through 4");
  const ciWaitSeconds = Number(values.get("ci-wait-seconds") ?? "0");
  if (!Number.isInteger(ciWaitSeconds) || ciWaitSeconds < 0 || ciWaitSeconds > 600) fail("--ci-wait-seconds must be an integer from 0 through 600");
  return Object.freeze({ cell: cell.origin, authorizationHandle, requestPrefix, duplicateStep, ciWaitSeconds });
}

function exactRecord(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(`${label} is not a closed record`);
  const actual = Object.keys(value).sort();
  if (actual.join("\0") !== [...keys].sort().join("\0")) fail(`${label} is not a closed record`);
  return value;
}

async function requestJson(config, pathname, init = {}) {
  const response = await fetch(new URL(pathname, config.cell), {
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
    ...init,
    headers: { authorization: `Bearer ${bearer}`, accept: "application/json", ...(init.body === undefined ? {} : { "content-type": "application/json" }) },
  });
  let body;
  try { body = await response.json(); } catch { fail(`${pathname} returned non-JSON HTTP ${response.status}`); }
  return { status: response.status, body };
}

function parseCatalog(response) {
  if (response.status !== 200) fail(`job catalog returned HTTP ${response.status}`);
  const body = exactRecord(response.body, ["requestId", "verdict", "reasonCode", "lifecycleState", "jobs"], "job catalog response");
  if (body.verdict !== "accepted" || body.reasonCode !== "jobs-found" || body.lifecycleState !== "catalog" || !Array.isArray(body.jobs) || body.jobs.length !== 4) {
    fail("job catalog did not return exactly four accepted jobs");
  }
  const refs = body.jobs.map((raw, index) => {
    const item = exactRecord(raw, ["jobRef"], `job catalog entry ${index + 1}`);
    if (typeof item.jobRef !== "string" || !JOB_REF.test(item.jobRef)) fail(`job catalog entry ${index + 1} is not an opaque job reference`);
    return item.jobRef;
  });
  if (new Set(refs).size !== refs.length) fail("job catalog returned duplicate opaque references");
  return refs;
}

function parseLoad(response, jobRef) {
  if (response.status !== 200) fail(`job load for ${jobRef} returned HTTP ${response.status}`);
  const body = exactRecord(response.body, ["requestId", "verdict", "reasonCode", "lifecycleState", "jobRef"], "job load response");
  if (body.verdict !== "accepted" || body.reasonCode !== "job-loaded" || body.lifecycleState !== "loaded" || body.jobRef !== jobRef) fail(`job load for ${jobRef} was not accepted`);
}

function parseOutcome(response, requestId) {
  if (response.status !== 202) fail(`Outcome ${requestId} returned HTTP ${response.status}`);
  if (response.body && typeof response.body === "object" && !Array.isArray(response.body) && response.body.verdict === "refused") {
    const refused = exactRecord(response.body, ["requestId", "verdict", "reasonCode", "lifecycleState"], "refused Outcome response");
    if (refused.requestId !== requestId || typeof refused.reasonCode !== "string" || typeof refused.lifecycleState !== "string") fail(`Outcome ${requestId} returned a malformed refusal`);
    fail(`Outcome ${requestId} refused: ${refused.reasonCode} (${refused.lifecycleState})`);
  }
  const body = exactRecord(response.body, ["requestId", "verdict", "reasonCode", "lifecycleState", "receiptRef"], "accepted Outcome response");
  if (body.requestId !== requestId || body.verdict !== "accepted" || body.reasonCode !== "accepted" || !["acknowledged", "reconciled"].includes(body.lifecycleState) || typeof body.receiptRef !== "string" || body.receiptRef.length === 0) {
    fail(`Outcome ${requestId} did not return an accepted terminal receipt`);
  }
  return body.receiptRef;
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  const refs = parseCatalog(await requestJson(config, "/v1/jobs"));
  for (const ref of refs) parseLoad(await requestJson(config, `/v1/jobs/${encodeURIComponent(ref)}/load`, { method: "POST", body: "{}" }), ref);

  const receiptRefs = [];
  for (let index = 0; index < refs.length; index += 1) {
    // The draft PR (step 2) is what starts CI. The release runner intentionally does one exact
    // check read immediately before merge and never turns a pending check into an automatic retry,
    // so the harness gives GitHub one bounded settlement window before consuming step 3's budget.
    if (index === 2 && config.ciWaitSeconds > 0) await new Promise(resolve => setTimeout(resolve, config.ciWaitSeconds * 1_000));
    const requestId = `${config.requestPrefix}_${index + 1}`;
    const body = JSON.stringify({ requestId, sourceRefs: { authorization: config.authorizationHandle }, choices: {} });
    const pathname = `/v1/jobs/${encodeURIComponent(refs[index])}/invoke`;
    const receiptRef = parseOutcome(await requestJson(config, pathname, { method: "POST", body }), requestId);
    if (config.duplicateStep === index + 1) {
      const duplicateReceiptRef = parseOutcome(await requestJson(config, pathname, { method: "POST", body }), requestId);
      if (duplicateReceiptRef !== receiptRef) fail(`duplicate Outcome ${requestId} did not converge to the same terminal receipt`);
    }
    receiptRefs.push(receiptRef);
  }
  process.stdout.write(`${JSON.stringify({
    v: "reelier.release-rehearsal-run/v1",
    status: "verified",
    claim: "four-governed-transitions-returned-terminal-receipts",
    production: false,
    completeness: "unchecked",
    duplicateStep: config.duplicateStep,
    ciWaitSeconds: config.ciWaitSeconds,
    jobRefs: refs,
    receiptRefs,
  })}\n`);
}

try { await main(); }
catch (error) {
  process.stderr.write(`run-release-rehearsal: ${redact(error instanceof Error ? error.message : String(error))}\n`);
  process.exitCode = 1;
}
