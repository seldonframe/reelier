import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { createGitHubIssueLabelsFixture } from "../authority/fixtures/github-issue-labels.js";
import { startPathCConformancePort } from "./support/path-c-port.js";

const outcomeBody = (requestId: string, label = "ready") => JSON.stringify({ requestId, sourceRefs: { issue: "issue_1" }, choices: { label } });

test("loopback Path C port keeps provider credentials inside the port and deduplicates request IDs", async () => {
  const fixture = await createGitHubIssueLabelsFixture();
  const port = await startPathCConformancePort({ fixture });
  try {
    const headers = { authorization: `Bearer ${port.clientToken}`, "content-type": "application/json" };
    const body = outcomeBody("request_eve_retry");
    const first = await fetch(`${port.url}/outcomes`, { method: "POST", headers, body }).then(value => value.json()) as Record<string, unknown>;
    const retry = await fetch(`${port.url}/outcomes`, { method: "POST", headers, body }).then(value => value.json()) as Record<string, unknown>;
    assert.equal(first.lifecycleState, "acknowledged");
    assert.deepEqual(retry, first);
    assert.deepEqual(port.counters(), { outcomeRequests: 2, statusReads: 0, providerDispatches: 1, reservations: 1 });
    assert.equal(JSON.stringify(first).includes(fixture.credential.token), false);
    const verified = await port.exportVerifiedGraph();
    assert.equal(verified.status, "verified");
    assert.equal(JSON.stringify(verified).includes(fixture.credential.token), false);
  } finally {
    await port.close();
    await fixture.close();
  }
});

test("loopback Path C port requires its minted client token", async () => {
  const fixture = await createGitHubIssueLabelsFixture();
  const port = await startPathCConformancePort({ fixture });
  try {
    const response = await fetch(`${port.url}/outcomes`, { method: "POST", headers: { "content-type": "application/json" }, body: outcomeBody("request_unauthorized") });
    assert.equal(response.status, 401);
    assert.deepEqual(port.counters(), { outcomeRequests: 0, statusReads: 0, providerDispatches: 0, reservations: 0 });
  } finally {
    await port.close();
    await fixture.close();
  }
});

test("loopback Path C status reads increment only statusReads", async () => {
  const fixture = await createGitHubIssueLabelsFixture();
  const port = await startPathCConformancePort({ fixture });
  try {
    const headers = { authorization: `Bearer ${port.clientToken}`, "content-type": "application/json" };
    await fetch(`${port.url}/outcomes`, { method: "POST", headers, body: outcomeBody("request_status") });
    const before = port.counters();
    const response = await fetch(`${port.url}/outcomes/request_status`, { headers }).then(value => value.json()) as Record<string, unknown>;
    assert.equal(response.lifecycleState, "acknowledged");
    assert.deepEqual(port.counters(), { ...before, statusReads: before.statusReads + 1 });
  } finally {
    await port.close();
    await fixture.close();
  }
});

test("loopback Path C binds a request ID to canonical request bytes before runner effects", async () => {
  const fixture = await createGitHubIssueLabelsFixture();
  const port = await startPathCConformancePort({ fixture });
  try {
    const headers = { authorization: `Bearer ${port.clientToken}`, "content-type": "application/json" };
    await fetch(`${port.url}/outcomes`, { method: "POST", headers, body: outcomeBody("request_conflict") });
    const response = await fetch(`${port.url}/outcomes`, { method: "POST", headers, body: outcomeBody("request_conflict", "changed") });
    const conflict = await response.json() as Record<string, unknown>;
    assert.equal(response.status, 409);
    assert.equal(conflict.reasonCode, "request-id-conflict");
    assert.deepEqual(port.counters(), { outcomeRequests: 2, statusReads: 0, providerDispatches: 1, reservations: 1 });
  } finally {
    await port.close();
    await fixture.close();
  }
});

test("loopback Path C retries one pre-dispatch failure only while durable truth shows zero effects", async () => {
  const fixture = await createGitHubIssueLabelsFixture();
  let attempts = 0;
  const port = await startPathCConformancePort({
    fixture,
    beforeRunnerAttemptForTest: () => {
      attempts += 1;
      if (attempts === 1) throw new Error("synthetic pre-dispatch unavailability");
    },
  });
  try {
    const headers = { authorization: `Bearer ${port.clientToken}`, "content-type": "application/json" };
    const response = await fetch(`${port.url}/outcomes`, { method: "POST", headers, body: outcomeBody("request_predispatch_retry") });
    assert.equal(response.status, 202);
    assert.equal(attempts, 2);
    assert.deepEqual(port.counters(), { outcomeRequests: 1, statusReads: 0, providerDispatches: 1, reservations: 1 });
  } finally {
    await port.close();
    await fixture.close();
  }
});

test("loopback Path C bounds persistent pre-dispatch failure to two attempts and zero effects", async () => {
  const fixture = await createGitHubIssueLabelsFixture();
  let attempts = 0;
  const port = await startPathCConformancePort({
    fixture,
    beforeRunnerAttemptForTest: () => {
      attempts += 1;
      throw new Error("synthetic persistent pre-dispatch unavailability");
    },
  });
  try {
    const headers = { authorization: `Bearer ${port.clientToken}`, "content-type": "application/json" };
    const response = await fetch(`${port.url}/outcomes`, { method: "POST", headers, body: outcomeBody("request_predispatch_bounded") });
    assert.equal(response.status, 500);
    assert.equal(attempts, 2);
    assert.deepEqual(port.counters(), { outcomeRequests: 1, statusReads: 0, providerDispatches: 0, reservations: 0 });
  } finally {
    await port.close();
    await fixture.close();
  }
});

for (const [mode, expected] of [
  ["cut-after-budget", { providerDispatches: 0, reservations: 1 }],
  ["cut-after-apply", { providerDispatches: 1, reservations: 1 }],
] as const) test(`${mode} failure counters expose real effects without duplicate action`, async () => {
  const fixture = await createGitHubIssueLabelsFixture(mode as never);
  const port = await startPathCConformancePort({ fixture });
  try {
    const headers = { authorization: `Bearer ${port.clientToken}`, "content-type": "application/json" };
    const response = await fetch(`${port.url}/outcomes`, { method: "POST", headers, body: outcomeBody(`request_${mode}`) });
    assert.equal(response.status, 500);
    assert.deepEqual(port.counters(), { outcomeRequests: 1, statusReads: 0, ...expected });
    const retry = await fetch(`${port.url}/outcomes`, { method: "POST", headers, body: outcomeBody(`request_${mode}`) });
    assert.equal(retry.status, 202);
    assert.deepEqual(port.counters(), { outcomeRequests: 2, statusReads: 0, ...expected });
  } finally {
    await port.close();
    await fixture.close();
  }
});

test("after-provider-apply latch withholds the first response until release", async () => {
  const fixture = await createGitHubIssueLabelsFixture();
  const port = await startPathCConformancePort({ fixture, fault: "after-provider-apply-before-response" });
  try {
    const headers = { authorization: `Bearer ${port.clientToken}`, "content-type": "application/json" };
    let responded = false;
    const pending = fetch(`${port.url}/outcomes`, { method: "POST", headers, body: outcomeBody("request_latched") }).then(value => { responded = true; return value.json(); });
    await port.faultReached;
    await setImmediate();
    assert.equal(responded, false);
    assert.deepEqual(port.counters(), { outcomeRequests: 1, statusReads: 0, providerDispatches: 1, reservations: 1 });
    port.release();
    const result = await pending as Record<string, unknown>;
    assert.equal(result.lifecycleState, "acknowledged");
    assert.deepEqual(port.counters(), { outcomeRequests: 1, statusReads: 0, providerDispatches: 1, reservations: 1 });
  } finally {
    await port.close();
    await fixture.close();
  }
});

test("closing the port releases an unreached fault latch", async () => {
  const fixture = await createGitHubIssueLabelsFixture();
  const port = await startPathCConformancePort({ fixture, fault: "after-provider-apply-before-response" });
  try {
    let settled = false;
    void port.faultReached.then(() => { settled = true; });
    await port.close();
    await setImmediate();
    assert.equal(settled, true);
  } finally {
    await port.close();
    await fixture.close();
  }
});
