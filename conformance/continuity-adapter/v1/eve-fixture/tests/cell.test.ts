import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import {
  cellEndpoint,
  loadCellJob,
  readCellJobCatalog,
  readCellJobLoad,
  remoteCellConfigured,
  requestRemoteOutcome,
  statusRemoteOutcome,
  scrubCellSecrets,
  searchCellJobs,
} from "../agent/lib/cell.js";

const TOKEN = "rat_hermetic_smoke_token_value";
const JOB_REF = `jobref_${"a".repeat(64)}`;

interface Seen { readonly method: string; readonly url: string; readonly authorization: string | undefined; readonly accept: string | undefined; readonly body: string }

test("remote mode is off until REELIER_CELL_URL names a Cell", () => {
  withEnv({ REELIER_CELL_URL: undefined, REELIER_CELL_TOKEN: undefined }, () => {
    assert.equal(remoteCellConfigured(), false);
    assert.throws(() => cellEndpoint(), /REELIER_CELL_URL is required/);
  });
  withEnv({ REELIER_CELL_URL: "https://cell.example", REELIER_CELL_TOKEN: TOKEN }, () => {
    assert.equal(remoteCellConfigured(), true);
    assert.equal(cellEndpoint().origin, "https://cell.example");
  });
});

test("the Cell endpoint refuses every URL shape that could carry or drop authority", () => {
  for (const [url, pattern] of [
    ["not a url", /not a URL/],
    ["https://user:secret@cell.example", /must not carry credentials/],
    ["https://cell.example/?token=leak", /must be an origin/],
    ["https://cell.example/prefix", /must be an origin with no path/],
    ["http://cell.example", /must be https, or http only on loopback/],
  ] as const) {
    withEnv({ REELIER_CELL_URL: url, REELIER_CELL_TOKEN: TOKEN }, () => {
      assert.throws(() => cellEndpoint(), pattern, url);
    });
  }
  // Loopback plaintext is the ONE exception, because the hermetic proof runs `authority serve` there.
  withEnv({ REELIER_CELL_URL: "http://127.0.0.1:8080", REELIER_CELL_TOKEN: TOKEN }, () => {
    assert.equal(cellEndpoint().origin, "http://127.0.0.1:8080");
  });
});

test("the bearer is required, trimmed, and scrubbed out of anything printable", async () => {
  await withServer(() => ({ status: 200, body: catalogBody() }), async (base, seen) => {
    await withEnvAsync({ REELIER_CELL_URL: base, REELIER_CELL_TOKEN: undefined }, async () => {
      await assert.rejects(() => searchCellJobs(), /REELIER_CELL_TOKEN is required/);
    });
    await withEnvAsync({ REELIER_CELL_URL: base, REELIER_CELL_TOKEN: "   " }, async () => {
      await assert.rejects(() => searchCellJobs(), /REELIER_CELL_TOKEN is empty/);
    });
    // A token file ends with a newline; `$(cat file)` strips it but `--env-file` does not.
    await withEnvAsync({ REELIER_CELL_URL: base, REELIER_CELL_TOKEN: `${TOKEN}\n` }, async () => {
      await searchCellJobs();
      assert.equal(seen.at(-1)?.authorization, `Bearer ${TOKEN}`);
      // The raw environment value (newline included) is redacted first, then the trimmed value that
      // actually goes on the wire — so neither form survives a print.
      const scrubbed = scrubCellSecrets(`Bearer ${TOKEN}\n and raw ${TOKEN}`);
      assert.equal(scrubbed, "Bearer <redacted> and raw <redacted>");
      assert.equal(scrubbed.includes(TOKEN), false);
    });
    assert.equal(scrubCellSecrets(`nothing to redact ${TOKEN}`).includes(TOKEN), true, "scrubbing is bound to the live environment, not to a compiled constant");
  });
});

test("jobs.search reaches GET /v1/jobs with the bearer in the header and never in the URL", async () => {
  await withServer(() => ({ status: 200, body: catalogBody() }), async (base, seen) => {
    await withEnvAsync({ REELIER_CELL_URL: base, REELIER_CELL_TOKEN: TOKEN }, async () => {
      const catalog = await searchCellJobs("release");
      assert.deepEqual(catalog, {
        requestId: "",
        verdict: "accepted",
        reasonCode: "jobs-found",
        lifecycleState: "catalog",
        jobs: [{ jobRef: JOB_REF }, { jobRef: "github_release_tag_create_v1", alias: "github_release_tag_create_v1" }],
      });
      const request = seen.at(-1);
      assert.equal(request?.method, "GET");
      assert.equal(request?.url, "/v1/jobs?query=release");
      assert.equal(request?.authorization, `Bearer ${TOKEN}`);
      assert.equal(request?.accept, "application/json");
      assert.equal(request?.url.includes(TOKEN), false, "the bearer must never reach the query string");
    });
  });
});

test("job load posts an explicit JSON body the ingress can parse", async () => {
  await withServer(() => ({ status: 200, body: { requestId: "", verdict: "accepted", reasonCode: "job-loaded", lifecycleState: "loaded", jobRef: JOB_REF } }), async (base, seen) => {
    await withEnvAsync({ REELIER_CELL_URL: base, REELIER_CELL_TOKEN: TOKEN }, async () => {
      const loaded = await loadCellJob(JOB_REF);
      assert.equal(loaded.verdict, "accepted");
      assert.equal(loaded.jobRef, JOB_REF);
      const request = seen.at(-1);
      assert.equal(request?.method, "POST");
      assert.equal(request?.url, `/v1/jobs/${JOB_REF}/load`);
      // `handleAuthorityHttp` reads and discards the body; an EMPTY body is a JSON parse error there,
      // which the ingress answers with 400 invalid-request.
      assert.equal(request?.body, "{}");
    });
  });
});

test("all four canonical quartet calls use the remote Cell and request binds its opaque Outcome reference", async () => {
  await withServer(request => request.url?.startsWith("/v1/agent/status") ? ({status:200,body:{requestId:"",verdict:"accepted",reasonCode:"ready",lifecycleState:"ready",outcomeRefs:[JOB_REF],capability:{v:"reelier.harness-capability/v1",harnessId:null,harnessVersion:null,abiDigest:`sha256:${"c".repeat(64)}`,protocolCompatibility:"compatible",transports:["mcp","http","openapi"],fixtureStatus:"not-passed",liveTested:false,providerCertification:"not-claimed"}}}) : request.url?.startsWith("/v1/outcome-proposals") ? ({status:200,body:{requestId:"",verdict:"accepted",reasonCode:"proposed",lifecycleState:"proposed",outcomeRef:JOB_REF}}) : ({status:request.method==="POST"?202:200,body:{requestId:"request_1",verdict:"accepted",reasonCode:"reconciled",lifecycleState:"reconciled",receiptRef:`sha256:${"d".repeat(64)}`}}), async (base,seen)=>{
    await withEnvAsync({REELIER_CELL_URL:base,REELIER_CELL_TOKEN:TOKEN},async()=>{
      await requestRemoteOutcome({outcomeRef:JOB_REF,requestId:"request_1",sourceRefs:{issue:"issue_1"},choices:{}});
      await statusRemoteOutcome("request_1");
    });
    assert.deepEqual(seen.map(item=>[item.method,item.url]),[["POST","/v1/outcome-requests"],["GET","/v1/outcome-status/request_1"]]);
    assert.deepEqual(JSON.parse(seen[0]!.body),{outcomeRef:JOB_REF,requestId:"request_1",sourceRefs:{issue:"issue_1"},choices:{}});
  });
});

test("a 401 fails loudly with the Cell's own reason and no credential material", async () => {
  await withServer(() => ({ status: 401, body: { verdict: "refused", reasonCode: "authentication-required", lifecycleState: "refused", requestId: "" } }), async base => {
    await withEnvAsync({ REELIER_CELL_URL: base, REELIER_CELL_TOKEN: TOKEN }, async () => {
      await assert.rejects(() => searchCellJobs(), error => {
        assert.match(String(error), /refused GET \/v1\/jobs with HTTP 401/);
        assert.match(String(error), /authentication-required/);
        assert.equal(String(error).includes(TOKEN), false, "a refusal message must never quote the bearer");
        return true;
      });
    });
  });
});

test("a redirect is refused before the alternate host is contacted", async () => {
  let alternateRequests = 0;
  const alternate = await listen((_request, response) => { alternateRequests += 1; response.end("{}"); });
  await withServer((_request, response) => {
    response.statusCode = 307;
    response.setHeader("location", `${originOf(alternate)}/private`);
    return null;
  }, async base => {
    await withEnvAsync({ REELIER_CELL_URL: base, REELIER_CELL_TOKEN: TOKEN }, async () => {
      await assert.rejects(() => searchCellJobs(), /did not complete/);
      await assert.rejects(() => loadCellJob(JOB_REF), /did not complete/);
    });
  });
  await close(alternate);
  assert.equal(alternateRequests, 0);
});

test("the catalogue and load projections are closed against extras, accessors, and non-records", () => {
  const catalog = catalogBody();
  assert.equal(readCellJobCatalog(catalog).jobs.length, 2);
  const accessor = Object.create(Object.prototype, {
    requestId: { enumerable: true, value: "" },
    verdict: { enumerable: true, value: "accepted" },
    reasonCode: { enumerable: true, value: "jobs-found" },
    lifecycleState: { enumerable: true, value: "catalog" },
    jobs: { enumerable: true, value: [] },
    privateGraph: { enumerable: true, get: () => { throw new Error("private accessor executed"); } },
  }) as unknown;
  // No `JSON.stringify` in the assertion message: serializing `accessor` would run the very getter
  // this test proves is never touched.
  for (const [index, malicious] of [
    { ...catalog, providerCredential: "must-not-cross" },
    { ...catalog, jobs: [{ jobRef: JOB_REF, providerToken: "must-not-cross" }] },
    { ...catalog, jobs: [{ alias: "no-reference" }] },
    { ...catalog, jobs: "not-a-list" },
    { ...catalog, verdict: "private" },
    accessor,
    [catalog],
    null,
  ].entries()) {
    assert.throws(() => readCellJobCatalog(malicious), /inert|closed|verdict|reference|job list/i, `malicious catalogue #${index}`);
  }
  for (const malicious of [
    { requestId: "", verdict: "accepted", reasonCode: "job-loaded", lifecycleState: "loaded", providerUrl: "https://leak.example" },
    { requestId: "", verdict: "maybe", reasonCode: "job-loaded", lifecycleState: "loaded" },
    { requestId: "", verdict: "accepted", reasonCode: "job-loaded" },
  ]) {
    assert.throws(() => readCellJobLoad(malicious), /closed|verdict|missing/i, JSON.stringify(malicious));
  }
});

function catalogBody(): Record<string, unknown> {
  return {
    requestId: "",
    verdict: "accepted",
    reasonCode: "jobs-found",
    lifecycleState: "catalog",
    // Both shapes the host emits: opaque refs from a signed multi-definition Job Card, and the
    // `{ jobId, alias }` pair a single-definition deployment returns.
    jobs: [{ jobRef: JOB_REF }, { jobId: "github_release_tag_create_v1", alias: "github_release_tag_create_v1" }],
  };
}

function withEnv<T>(values: Readonly<Record<string, string | undefined>>, run: () => T): T {
  const previous = new Map(Object.keys(values).map(key => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    return run();
  } finally {
    for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}

async function withEnvAsync(values: Readonly<Record<string, string | undefined>>, run: () => Promise<void>): Promise<void> {
  // Deliberately NOT `withEnv(values, run)`: that restores the environment the moment `run` returns
  // its promise, so the request under test would fly with the wrong credential.
  const previous = new Map(Object.keys(values).map(key => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await run();
  } finally {
    for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}

type Reply = { readonly status: number; readonly body: unknown } | null;

async function withServer(handler: (request: IncomingMessage, response: ServerResponse) => Reply, run: (base: string, seen: Seen[]) => Promise<void>): Promise<void> {
  const seen: Seen[] = [];
  const server = await listen((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    request.on("end", () => {
      seen.push({
        method: request.method ?? "",
        url: request.url ?? "",
        authorization: request.headers.authorization,
        accept: typeof request.headers.accept === "string" ? request.headers.accept : undefined,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      const reply = handler(request, response);
      if (reply === null) { response.end(); return; }
      response.statusCode = reply.status;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(reply.body));
    });
  });
  try { await run(originOf(server), seen); } finally { await close(server); }
}

async function listen(handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<Server> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return server;
}

function originOf(server: Server): string {
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
