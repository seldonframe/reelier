import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import {
  readAuthorityIngressOutcome,
  requestOutcomeFromPort,
  statusOutcomeFromPort,
} from "../agent/lib/runtime.js";

const request = {
  v: "reelier.outcome-request/v1" as const,
  choices: { label: "ready" },
  requestId: "request_redirect",
  sourceRefs: { issue: "issue_1" },
};

test("Outcome request and status refuse redirect hops before an alternate host is contacted", async () => {
  let alternateRequests = 0;
  const alternate = await listen((_request, response) => {
    alternateRequests += 1;
    response.end(JSON.stringify(validOutcome()));
  });
  const redirect = await listen((incoming, response) => {
    response.statusCode = incoming.method === "POST" ? 307 : 308;
    response.setHeader("location", `${url(alternate)}/private`);
    response.end();
  });
  try {
    await assert.rejects(() => requestOutcomeFromPort(new URL(url(redirect)), "port-token", request), /redirect|fetch failed/i);
    await assert.rejects(() => statusOutcomeFromPort(new URL(url(redirect)), "port-token", "request_redirect"), /redirect|fetch failed/i);
    assert.equal(alternateRequests, 0);
  } finally {
    await Promise.all([close(redirect), close(alternate)]);
  }
});

test("Authority response projection exposes only the five public outcome fields", async () => {
  const projected = await readAuthorityIngressOutcome(response(validOutcome({ receiptRef: "receipt_1" })));
  assert.deepEqual(projected, validOutcome({ receiptRef: "receipt_1" }));
});

test("Authority response projection refuses extras, accessors, and non-records", async () => {
  const accessor = Object.create(Object.prototype, {
    requestId: { enumerable: true, value: "request_eve_1" },
    verdict: { enumerable: true, value: "accepted" },
    reasonCode: { enumerable: true, value: "accepted" },
    lifecycleState: { enumerable: true, value: "acknowledged" },
    privateReceiptGraph: { enumerable: true, get: () => { throw new Error("private accessor executed"); } },
  });
  for (const malicious of [
    { ...validOutcome(), privateReceiptGraph: { credential: "must-not-cross" } },
    accessor,
    [validOutcome()],
    null,
    { ...validOutcome(), verdict: "private" },
    { ...validOutcome(), receiptRef: 7 },
  ]) {
    await assert.rejects(() => readAuthorityIngressOutcome(response(malicious)), /invalid|closed|inert|outcome/i);
  }
});

function validOutcome(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { requestId: "request_eve_1", verdict: "accepted", reasonCode: "accepted", lifecycleState: "acknowledged", ...extra };
}

function response(value: unknown): Response {
  return { ok: true, status: 200, json: async () => value } as Response;
}

async function listen(handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<Server> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server;
}

function url(server: Server): string {
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
