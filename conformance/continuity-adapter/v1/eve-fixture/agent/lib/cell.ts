// REMOTE Authority Cell binding for the Eve conformance fixture.
//
// LOOPBACK MODE IS UNTOUCHED. `agent/lib/runtime.ts` still drives the hermetic Path C port through
// `REELIER_PATH_C_PORT_URL`, and nothing in this module is reachable from it. Remote mode activates
// ONLY when `REELIER_CELL_URL` names a Cell; with that variable unset every entry point here refuses
// with a configuration error before any socket is opened, so the continuity suite's scenarios cannot
// silently acquire a remote dependency.
//
// THE BEARER NEVER LEAVES THIS MODULE. `REELIER_CELL_TOKEN` is read per call, sent only in the
// `Authorization` header (never a query parameter, never a body, never a URL), never written to
// disk, and never present in any value handed back to the model — the response projections below are
// CLOSED, so a Cell that tried to echo a credential into an unexpected field is refused rather than
// forwarded. `scrubCellSecrets` redacts the token from any string a caller is about to print, so a
// future edit that interpolates it degrades to `<redacted>` instead of leaking into a transcript.
//
// WHAT IT DOES NOT DO. No Outcome is requested, no artifact is staged, no delegation is minted.
// `jobs.search` and `job load` are the entire surface; both are reads.
import { ContinuityConfigurationError } from "./faults.js";

/** A single opaque catalogue entry. `jobRef` is the Cell's opaque reference; `alias` appears only on
 * single-definition deployments, never on a signed multi-definition Job Card. */
export type CellJobRefV1 = Readonly<{ jobRef: string; alias?: string }>;
export type CellJobCatalogV1 = Readonly<{
  requestId: string;
  verdict: "accepted" | "refused";
  reasonCode: string;
  lifecycleState: string;
  jobs: readonly CellJobRefV1[];
}>;
export type CellJobLoadV1 = Readonly<{
  requestId: string;
  verdict: "accepted" | "refused";
  reasonCode: string;
  lifecycleState: string;
  jobRef?: string;
  alias?: string;
}>;
export type CellHarnessCapabilityV1 = Readonly<{
  v: "reelier.harness-capability/v1";
  harnessId: "eve" | "codex" | "claude-code" | "cursor" | "grok" | "hermes" | null;
  harnessVersion: string | null;
  abiDigest: string;
  protocolCompatibility: "compatible";
  transports: readonly ["mcp", "http", "openapi"];
  fixtureStatus: "passed" | "not-passed";
  liveTested: boolean;
  providerCertification: "not-claimed";
}>;
export type CellAgentStatusV1 = Readonly<{ requestId: string; verdict: "accepted" | "refused"; reasonCode: string; lifecycleState: string; outcomeRefs: readonly string[]; capability: CellHarnessCapabilityV1 }>;
export type CellOutcomeProposalV1 = Readonly<{ requestId: string; verdict: "accepted" | "refused"; reasonCode: string; lifecycleState: string; outcomeRef?: string }>;

/** A Cell that answered, but not with a usable 2xx, or a Cell that could not be reached at all.
 * Distinct from `ContinuityConfigurationError`, which means the operator's environment is wrong. */
export class AuthorityCellError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthorityCellError";
  }
}

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_REFUSAL_BODY_CHARS = 512;
const MAX_CATALOGUE_ENTRIES = 256;
const CATALOG_FIELDS = new Set(["requestId", "verdict", "reasonCode", "lifecycleState", "jobs"]);
const JOB_FIELDS = new Set(["jobRef", "jobId", "alias"]);
const LOAD_FIELDS = new Set(["requestId", "verdict", "reasonCode", "lifecycleState", "jobRef", "alias"]);
const AGENT_STATUS_FIELDS = new Set(["requestId", "verdict", "reasonCode", "lifecycleState", "outcomeRefs", "capability"]);
const OUTCOME_PROPOSAL_FIELDS = new Set(["requestId", "verdict", "reasonCode", "lifecycleState", "outcomeRef"]);
const CAPABILITY_FIELDS = new Set(["v", "harnessId", "harnessVersion", "abiDigest", "protocolCompatibility", "transports", "fixtureStatus", "liveTested", "providerCertification"]);
const OPAQUE_OUTCOME_REF = /^(?:jobref|outcomeref)_[0-9a-f]{64}$/;

/** True when the operator has named a remote Cell. Callers use this to keep loopback-only runs on
 * the loopback path instead of discovering the missing variable through a thrown error. */
export function remoteCellConfigured(): boolean {
  return typeof process.env.REELIER_CELL_URL === "string" && process.env.REELIER_CELL_URL.length > 0;
}

/** The Cell origin. Refuses anything that could carry or leak a credential: embedded userinfo, a
 * query string, a fragment, a base path (which `new URL("/v1/jobs", base)` would silently drop), and
 * plaintext HTTP anywhere except loopback, where the hermetic proof runs. */
export function cellEndpoint(): URL {
  const raw = process.env.REELIER_CELL_URL;
  if (!raw) throw new ContinuityConfigurationError("REELIER_CELL_URL is required for the remote Authority Cell binding");
  let url: URL;
  try { url = new URL(raw); } catch { throw new ContinuityConfigurationError("REELIER_CELL_URL is not a URL"); }
  if (url.username || url.password) throw new ContinuityConfigurationError("REELIER_CELL_URL must not carry credentials");
  if (url.search || url.hash) throw new ContinuityConfigurationError("REELIER_CELL_URL must be an origin, not a query or fragment");
  if (url.pathname !== "/") throw new ContinuityConfigurationError("REELIER_CELL_URL must be an origin with no path; the ingress paths are absolute");
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new ContinuityConfigurationError("REELIER_CELL_URL must be https, or http only on loopback");
  }
  return url;
}

/** The bearer, whitespace-trimmed because the operator path is `$(cat <token-file>)` and a token file
 * ends with a newline. Never returned to a caller that prints. */
function cellToken(): string {
  const raw = process.env.REELIER_CELL_TOKEN;
  if (raw === undefined) throw new ContinuityConfigurationError("REELIER_CELL_TOKEN is required for the remote Authority Cell binding");
  const token = raw.trim();
  if (token.length === 0) throw new ContinuityConfigurationError("REELIER_CELL_TOKEN is empty");
  return token;
}

/** Redacts the live bearer out of any text on its way to a stream. Both the raw environment value and
 * the trimmed value that is actually sent are scrubbed, so neither form can survive a print. */
export function scrubCellSecrets(value: unknown): string {
  let text = typeof value === "string" ? value : String(value);
  const raw = process.env.REELIER_CELL_TOKEN;
  for (const secret of new Set([raw, raw?.trim()])) {
    if (typeof secret === "string" && secret.length > 0) text = text.split(secret).join("<redacted>");
  }
  return text;
}

/** PINNED DUPLICATION of the inert-object guard in `agent/lib/runtime.ts`. It is deliberately copied
 * rather than shared: the loopback outcome path must not acquire an import from the remote binding. */
function inertRecord(value: unknown, what: string): Record<string, unknown> {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Reflect.ownKeys(value).some(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return typeof key !== "string" || !descriptor || descriptor.get !== undefined || descriptor.set !== undefined;
    })
  ) {
    throw new AuthorityCellError(`${what} must be an inert plain object`);
  }
  return value as Record<string, unknown>;
}

function closedKeys(record: Record<string, unknown>, allowed: ReadonlySet<string>, what: string): void {
  for (const key of Reflect.ownKeys(record)) {
    if (typeof key !== "string" || !allowed.has(key)) throw new AuthorityCellError(`${what} carries an unexpected field; the Authority Cell projection is closed`);
  }
}

function verdictOf(record: Record<string, unknown>, what: string): "accepted" | "refused" {
  if (record.verdict !== "accepted" && record.verdict !== "refused") throw new AuthorityCellError(`${what} has no verdict`);
  return record.verdict;
}

function requiredString(record: Record<string, unknown>, key: string, what: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new AuthorityCellError(`${what} is missing ${key}`);
  return value;
}

function optionalString(record: Record<string, unknown>, key: string, what: string): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) throw new AuthorityCellError(`${what} has an invalid ${key}`);
  return value;
}

export function readCellJobCatalog(value: unknown): CellJobCatalogV1 {
  const record = inertRecord(value, "the jobs.search response");
  closedKeys(record, CATALOG_FIELDS, "the jobs.search response");
  const jobs = record.jobs;
  if (!Array.isArray(jobs)) throw new AuthorityCellError("the jobs.search response has no job list");
  if (jobs.length > MAX_CATALOGUE_ENTRIES) throw new AuthorityCellError("the jobs.search response lists more jobs than this fixture accepts");
  return Object.freeze({
    requestId: requiredString(record, "requestId", "the jobs.search response"),
    verdict: verdictOf(record, "the jobs.search response"),
    reasonCode: requiredString(record, "reasonCode", "the jobs.search response"),
    lifecycleState: requiredString(record, "lifecycleState", "the jobs.search response"),
    jobs: Object.freeze(jobs.map(entry => {
      const job = inertRecord(entry, "a jobs.search entry");
      closedKeys(job, JOB_FIELDS, "a jobs.search entry");
      // A signed multi-definition Job Card yields `jobRef` only; a single-definition deployment
      // yields `{ jobId, alias }`. Both normalize to the reference `job load` accepts.
      const reference = optionalString(job, "jobRef", "a jobs.search entry") ?? optionalString(job, "jobId", "a jobs.search entry");
      if (reference === undefined) throw new AuthorityCellError("a jobs.search entry carries no job reference");
      const alias = optionalString(job, "alias", "a jobs.search entry");
      return Object.freeze({ jobRef: reference, ...(alias === undefined ? {} : { alias }) });
    })),
  });
}

export function readCellJobLoad(value: unknown): CellJobLoadV1 {
  const record = inertRecord(value, "the job load response");
  closedKeys(record, LOAD_FIELDS, "the job load response");
  const jobRef = optionalString(record, "jobRef", "the job load response");
  const alias = optionalString(record, "alias", "the job load response");
  return Object.freeze({
    requestId: requiredString(record, "requestId", "the job load response"),
    verdict: verdictOf(record, "the job load response"),
    reasonCode: requiredString(record, "reasonCode", "the job load response"),
    lifecycleState: requiredString(record, "lifecycleState", "the job load response"),
    ...(jobRef === undefined ? {} : { jobRef }),
    ...(alias === undefined ? {} : { alias }),
  });
}

export function readCellAgentStatus(value: unknown): CellAgentStatusV1 {
  const record = inertRecord(value, "the agent status response");
  closedKeys(record, AGENT_STATUS_FIELDS, "the agent status response");
  if (!Array.isArray(record.outcomeRefs) || record.outcomeRefs.length > MAX_CATALOGUE_ENTRIES || record.outcomeRefs.some(ref => typeof ref !== "string" || !OPAQUE_OUTCOME_REF.test(ref))) throw new AuthorityCellError("the agent status response carries an invalid opaque Outcome reference");
  const capability = readHarnessCapability(record.capability);
  return Object.freeze({ requestId: requiredString(record, "requestId", "the agent status response"), verdict: verdictOf(record, "the agent status response"), reasonCode: requiredString(record, "reasonCode", "the agent status response"), lifecycleState: requiredString(record, "lifecycleState", "the agent status response"), outcomeRefs: Object.freeze([...record.outcomeRefs]), capability });
}

export function readCellOutcomeProposal(value: unknown): CellOutcomeProposalV1 {
  const record = inertRecord(value, "the Outcome proposal response");
  closedKeys(record, OUTCOME_PROPOSAL_FIELDS, "the Outcome proposal response");
  const outcomeRef = optionalString(record, "outcomeRef", "the Outcome proposal response");
  if (outcomeRef !== undefined && !OPAQUE_OUTCOME_REF.test(outcomeRef)) throw new AuthorityCellError("the Outcome proposal response carries no authenticated opaque reference");
  return Object.freeze({ requestId: requiredString(record, "requestId", "the Outcome proposal response"), verdict: verdictOf(record, "the Outcome proposal response"), reasonCode: requiredString(record, "reasonCode", "the Outcome proposal response"), lifecycleState: requiredString(record, "lifecycleState", "the Outcome proposal response"), ...(outcomeRef === undefined ? {} : { outcomeRef }) });
}

function readHarnessCapability(value: unknown): CellHarnessCapabilityV1 {
  const record = inertRecord(value, "the harness capability descriptor");
  closedKeys(record, CAPABILITY_FIELDS, "the harness capability descriptor");
  const harnesses = ["eve", "codex", "claude-code", "cursor", "grok", "hermes"];
  if (record.v !== "reelier.harness-capability/v1" || !(record.harnessId === null || typeof record.harnessId === "string" && harnesses.includes(record.harnessId)) || !(record.harnessVersion === null || typeof record.harnessVersion === "string") || typeof record.abiDigest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(record.abiDigest) || record.protocolCompatibility !== "compatible" || !Array.isArray(record.transports) || record.transports.length !== 3 || record.transports[0] !== "mcp" || record.transports[1] !== "http" || record.transports[2] !== "openapi" || (record.fixtureStatus !== "passed" && record.fixtureStatus !== "not-passed") || typeof record.liveTested !== "boolean" || record.providerCertification !== "not-claimed" || (record.liveTested && (record.fixtureStatus !== "passed" || record.harnessId === null || record.harnessVersion === null))) throw new AuthorityCellError("the harness capability descriptor is invalid or overclaims fixture evidence");
  return Object.freeze({ v: "reelier.harness-capability/v1", harnessId: record.harnessId as CellHarnessCapabilityV1["harnessId"], harnessVersion: record.harnessVersion as string | null, abiDigest: record.abiDigest, protocolCompatibility: "compatible", transports: Object.freeze(["mcp", "http", "openapi"] as const), fixtureStatus: record.fixtureStatus, liveTested: record.liveTested, providerCertification: "not-claimed" });
}

/** The ONE place a request leaves this fixture for a remote Cell. Every failure — refused transport,
 * non-2xx, unparsable body — throws loudly and scrubbed; nothing here degrades to an empty result. */
async function cellRequest(target: URL, init: Readonly<{ method: "GET" | "POST"; body?: string }>): Promise<unknown> {
  const token = cellToken();
  let response: Response;
  try {
    response = await fetch(target, {
      method: init.method,
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(init.body === undefined ? {} : { body: init.body }),
    });
  } catch (error) {
    throw new AuthorityCellError(scrubCellSecrets(`the Authority Cell request ${init.method} ${target.pathname} did not complete: ${error instanceof Error ? error.message : String(error)}`));
  }
  if (!response.ok) {
    // The Cell's refusal bodies are closed and carry no credential material, so quoting a bounded
    // slice turns a 401 into an actionable message instead of a bare status.
    const detail = await response.text().then(text => text.slice(0, MAX_REFUSAL_BODY_CHARS), () => "");
    throw new AuthorityCellError(scrubCellSecrets(`the Authority Cell refused ${init.method} ${target.pathname} with HTTP ${response.status}${detail ? `: ${detail}` : ""}`));
  }
  try { return await response.json(); }
  catch (error) { throw new AuthorityCellError(scrubCellSecrets(`the Authority Cell answered ${init.method} ${target.pathname} with a body that is not JSON: ${error instanceof Error ? error.message : String(error)}`)); }
}

/** `GET /v1/jobs` — the authenticated catalogue read. The query is a filter, never a credential, so
 * it is the only thing that ever reaches the query string. */
export async function searchCellJobs(query = ""): Promise<CellJobCatalogV1> {
  if (typeof query !== "string" || query.length > 256) throw new AuthorityCellError("the jobs.search query must be a string of at most 256 characters");
  const target = new URL("/v1/jobs", cellEndpoint());
  if (query.length > 0) target.searchParams.set("query", query);
  return readCellJobCatalog(await cellRequest(target, { method: "GET" }));
}

/** `POST /v1/jobs/<ref>/load` — resolves one opaque reference inside the authenticated task. The body
 * is an empty object because the ingress reads and discards it; a missing body is a 400. */
export async function loadCellJob(jobRef: string): Promise<CellJobLoadV1> {
  if (typeof jobRef !== "string" || jobRef.length === 0 || jobRef.length > 128) throw new AuthorityCellError("the job reference must be a non-empty string of at most 128 characters");
  const target = new URL(`/v1/jobs/${encodeURIComponent(jobRef)}/load`, cellEndpoint());
  return readCellJobLoad(await cellRequest(target, { method: "POST", body: "{}" }));
}

/** Canonical quartet reads. These coexist with the legacy job routes until their separate removal. */
export async function readRemoteAgentStatus(): Promise<CellAgentStatusV1> {
  return readCellAgentStatus(await cellRequest(new URL("/v1/agent/status", cellEndpoint()), { method: "GET" }));
}

export async function proposeRemoteOutcome(outcomeRef: string): Promise<CellOutcomeProposalV1> {
  if (typeof outcomeRef !== "string" || !OPAQUE_OUTCOME_REF.test(outcomeRef)) throw new AuthorityCellError("the Outcome proposal requires an authenticated opaque reference");
  return readCellOutcomeProposal(await cellRequest(new URL("/v1/outcome-proposals", cellEndpoint()), { method: "POST", body: JSON.stringify({ outcomeRef }) }));
}
