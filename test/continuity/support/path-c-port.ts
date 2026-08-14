import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { authorityCanonicalBytes } from "../../../src/authority/wire.js";
import type { AuthorityIngressOutcome } from "../../../src/authority/ingress/mcp.js";
import { verifyCertificationTaskReceiptGraph } from "../../../src/authority/certification/task-receipt-graph.js";
import type { GitHubHermeticRunnerResult } from "../../../src/authority/certification/github-issue-labels-runner.js";
import type { GitHubIssueLabelsFixture } from "../../authority/fixtures/github-issue-labels.js";

type PathCFault = "after-provider-apply-before-response";
type CounterSnapshot = Readonly<{ outcomeRequests: number; statusReads: number; providerDispatches: number; reservations: number }>;
type PublicRunnerOutcome = AuthorityIngressOutcome & Readonly<{ providerWrites: number }>;

export interface PathCConformancePort {
  readonly url: string;
  readonly clientToken: string;
  readonly faultReached: Promise<void>;
  counters(): CounterSnapshot;
  release(): void;
  exportVerifiedGraph(): Promise<ReturnType<typeof verifyCertificationTaskReceiptGraph>>;
  close(): Promise<void>;
}

export async function startPathCConformancePort(options: Readonly<{ fixture: GitHubIssueLabelsFixture; fault?: PathCFault }>): Promise<PathCConformancePort> {
  const { fixture } = options;
  const clientToken = randomBytes(32).toString("base64url");
  const requestBindings = new Map<string, string>();
  let outcomeRequests = 0, statusReads = 0, providerDispatches = 0, reservations = 0;
  let released = false, closed = false, faultUsed = false;
  let reachFault!: () => void, releaseFault!: () => void;
  const faultReached = new Promise<void>(resolve => { reachFault = resolve; });
  const faultRelease = new Promise<void>(resolve => { releaseFault = resolve; });

  const refreshTruth = async (result: GitHubHermeticRunnerResult): Promise<void> => {
    providerDispatches = result.providerWrites;
    reservations = (await fixture.delegation.budget.get(fixture.activation.allocationId))?.consumed ?? 0;
  };
  const refreshTruthAfterFailure = async (requestId: string): Promise<void> => {
    try {
      const status = await fixture.runner.status({ bearerToken: fixture.credential.token, requestId });
      providerDispatches = status.providerWrites;
    } catch {}
    reservations = (await fixture.delegation.budget.get(fixture.activation.allocationId))?.consumed ?? 0;
  };
  const server = createServer((request, response) => { void handle(request, response).catch(() => write(response, 500, refused("", "port-unavailable", "unavailable"))); });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!authorized(request.headers.authorization, clientToken)) return write(response, 401, refused("", "authentication-required", "refused"));
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "POST" && url.pathname === "/outcomes") {
      let parsed: unknown;
      try { parsed = JSON.parse(await readBody(request)); }
      catch { return write(response, 400, refused("", "invalid-request", "refused")); }
      const body = parseRequest(parsed);
      if (!body) return write(response, 400, refused("", "invalid-request", "refused"));
      outcomeRequests += 1;
      const canonicalBase64 = authorityCanonicalBytes({ v: "reelier.outcome-request/v1", ...body }).toString("base64");
      const prior = requestBindings.get(body.requestId);
      if (prior !== undefined && prior !== canonicalBase64) return write(response, 409, refused(body.requestId, "request-id-conflict", "conflict"));
      requestBindings.set(body.requestId, canonicalBase64);
      let result: GitHubHermeticRunnerResult;
      try { result = await fixture.runner.run({ bearerToken: fixture.credential.token, requestId: body.requestId }); }
      catch (error) { await refreshTruthAfterFailure(body.requestId); throw error; }
      await refreshTruth(result);
      if (options.fault === "after-provider-apply-before-response" && !faultUsed) {
        faultUsed = true;
        reachFault();
        await faultRelease;
      }
      return write(response, 202, publicOutcome(result));
    }
    const statusMatch = request.method === "GET" ? /^\/outcomes\/([^/]+)$/.exec(url.pathname) : null;
    if (statusMatch) {
      const requestId = decodeURIComponent(statusMatch[1]);
      statusReads += 1;
      const result = await fixture.runner.status({ bearerToken: fixture.credential.token, requestId });
      await refreshTruth(result);
      return write(response, 200, publicOutcome(result));
    }
    if (request.method === "GET" && url.pathname === "/counters") return write(response, 200, counters());
    return write(response, 404, refused("", "not-found", "refused"));
  }

  const counters = (): CounterSnapshot => Object.freeze({ outcomeRequests, statusReads, providerDispatches, reservations });
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => { server.off("listening", onListening); reject(error); };
    const onListening = () => { server.off("error", onError); resolve(); };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });
  const address = server.address() as AddressInfo | null;
  if (!address || address.address !== "127.0.0.1") { await closeServer(server); throw new Error("Path C conformance port did not bind loopback"); }

  return Object.freeze({
    url: `http://127.0.0.1:${address.port}`,
    clientToken,
    faultReached,
    counters,
    release: () => { if (!released) { released = true; releaseFault(); } },
    exportVerifiedGraph: async () => {
      const graph = await fixture.runner.exportGraph({ bearerToken: fixture.credential.token });
      const evidenceSignerId = fixture.pin.keyDescriptors.find((item: any) => item.role === "authority-cell" && item.purpose === "authority-evidence")?.keyId;
      return verifyCertificationTaskReceiptGraph(graph, {
        trustPin: fixture.pin,
        currentTrustObservation: { v: "reelier.portable-current-trust-observation/v1", observedAt: "2026-08-11T20:00:00.000Z", expiresAt: "2026-08-11T21:00:00.000Z", activeAuthorityEvidenceSignerIds: [evidenceSignerId] },
        now: new Date("2026-08-11T20:10:00.000Z"),
        expectedResponseSemanticsProfile: { v: "reelier.http-response-semantics/v1", profileId: "github.issue-labels.hermetic-v1", acknowledgedStatuses: [200] },
      });
    },
    close: async () => {
      if (closed) return;
      closed = true;
      reachFault();
      if (!released) { released = true; releaseFault(); }
      await closeServer(server);
    },
  });
}

function parseRequest(value: unknown): Readonly<{ requestId: string; sourceRefs: Readonly<Record<string, string>>; choices: Readonly<Record<string, string | number | boolean | null>> }> | undefined {
  if (!plainRecord(value) || !exactKeys(value, ["requestId", "sourceRefs", "choices"]) || typeof value.requestId !== "string" || value.requestId.length === 0 || !plainRecord(value.sourceRefs) || !plainRecord(value.choices)) return undefined;
  if (Object.values(value.sourceRefs).some(item => typeof item !== "string") || Object.values(value.choices).some(item => item !== null && typeof item !== "string" && typeof item !== "boolean" && (typeof item !== "number" || !Number.isFinite(item)))) return undefined;
  return { requestId: value.requestId, sourceRefs: value.sourceRefs as Record<string, string>, choices: value.choices as Record<string, string | number | boolean | null> };
}
function plainRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype); }
function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean { const keys = Object.keys(value).sort(); return keys.length === expected.length && keys.every((key, index) => key === [...expected].sort()[index]); }
function authorized(header: string | undefined, token: string): boolean { if (!header?.startsWith("Bearer ")) return false; const supplied = Buffer.from(header.slice(7)), expected = Buffer.from(token); return supplied.length === expected.length && timingSafeEqual(supplied, expected); }
function publicOutcome(result: GitHubHermeticRunnerResult): PublicRunnerOutcome { const accepted = result.status === "acknowledged" || result.status === "duplicate" || result.status === "cleaned"; return Object.freeze({ requestId: result.requestId, verdict: accepted ? "accepted" : "refused", reasonCode: `outcome-${result.status}`, lifecycleState: result.status, providerWrites: result.providerWrites }); }
function refused(requestId: string, reasonCode: string, lifecycleState: string): AuthorityIngressOutcome { return Object.freeze({ requestId, verdict: "refused", reasonCode, lifecycleState }); }
async function readBody(request: IncomingMessage): Promise<string> { const chunks: Buffer[] = []; let total = 0; for await (const chunk of request) { const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); total += bytes.length; if (total > 64 * 1024) throw new Error("request too large"); chunks.push(bytes); } return Buffer.concat(chunks).toString("utf8"); }
function write(response: ServerResponse, status: number, value: unknown): void { if (response.headersSent || response.destroyed) return; response.statusCode = status; response.setHeader("content-type", "application/json"); response.setHeader("connection", "close"); response.end(JSON.stringify(value)); }
async function closeServer(server: Server): Promise<void> { if (!server.listening) return; await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
