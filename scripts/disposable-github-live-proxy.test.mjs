import assert from "node:assert/strict";
import test from "node:test";

import {
  CONFORMANCE_BRANCH,
  CONFORMANCE_PATH,
  CONFORMANCE_REPOSITORY,
  createIdempotentGithubTools,
} from "./disposable-github-mcp-server.mjs";
import {
  CONFORMANCE_CONTENT,
  CONFORMANCE_REQUEST_KEY,
  buildEvidenceArtifacts,
  checkEvidenceArtifacts,
} from "./disposable-github-live-proxy.mjs";

function state(head, tree, blob, content) {
  return { repository: CONFORMANCE_REPOSITORY, branch: CONFORMANCE_BRANCH, path: CONFORMANCE_PATH, head, tree, blob, content };
}

test("target fence refuses any repository, branch, or path outside the approved disposable cell", async () => {
  const tools = createIdempotentGithubTools({
    authStatus: async () => true,
    readState: async () => state("a".repeat(40), "b".repeat(40), "c".repeat(40), "before\n"),
    writeFile: async () => assert.fail("a refused target must never dispatch"),
  });

  for (const mutation of [
    { repository: "fixlyai/reelier" },
    { branch: "main" },
    { path: "README.md" },
  ]) {
    await assert.rejects(
      tools.put({
        repository: CONFORMANCE_REPOSITORY,
        branch: CONFORMANCE_BRANCH,
        path: CONFORMANCE_PATH,
        content: "after\n",
        requestKey: "github-live-proxy-20260816-1",
        ...mutation,
      }),
      /refused/i,
    );
  }
});

test("same request key returns the first exact readback without a second provider write", async () => {
  let current = state("1".repeat(40), "2".repeat(40), "3".repeat(40), "before\n");
  let writes = 0;
  const tools = createIdempotentGithubTools({
    authStatus: async () => true,
    readState: async () => current,
    writeFile: async ({ content }) => {
      writes += 1;
      current = state("4".repeat(40), "5".repeat(40), "6".repeat(40), content);
      return { commit: current.head };
    },
  });
  const request = {
    repository: CONFORMANCE_REPOSITORY,
    branch: CONFORMANCE_BRANCH,
    path: CONFORMANCE_PATH,
    content: "after\n",
    requestKey: "github-live-proxy-20260816-1",
  };

  const first = await tools.put(request);
  const retry = await tools.put(request);

  assert.equal(writes, 1);
  assert.equal(first.disposition, "written");
  assert.equal(retry.disposition, "duplicate");
  assert.equal(retry.effectDelta, 0);
  assert.deepEqual(retry.providerState, first.providerState);
  assert.deepEqual(first.providerState, state("4".repeat(40), "5".repeat(40), "6".repeat(40), "after\n"));
});

test("request-key reuse with different bytes refuses instead of aliasing a prior write", async () => {
  let current = state("1".repeat(40), "2".repeat(40), "3".repeat(40), "before\n");
  const tools = createIdempotentGithubTools({
    authStatus: async () => true,
    readState: async () => current,
    writeFile: async ({ content }) => {
      current = state("4".repeat(40), "5".repeat(40), "6".repeat(40), content);
      return { commit: current.head };
    },
  });
  const base = {
    repository: CONFORMANCE_REPOSITORY,
    branch: CONFORMANCE_BRANCH,
    path: CONFORMANCE_PATH,
    requestKey: "github-live-proxy-20260816-1",
  };

  await tools.put({ ...base, content: "first\n" });
  await assert.rejects(tools.put({ ...base, content: "different\n" }), /idempotency.*collision/i);
});

test("missing gh authentication refuses before either read or write reaches GitHub", async () => {
  const tools = createIdempotentGithubTools({
    authStatus: async () => false,
    readState: async () => assert.fail("auth refusal must happen first"),
    writeFile: async () => assert.fail("auth refusal must happen first"),
  });

  await assert.rejects(tools.read({ repository: CONFORMANCE_REPOSITORY, branch: CONFORMANCE_BRANCH, path: CONFORMANCE_PATH }), /gh auth/i);
});

test("evidence builder classifies Path A and binds one write plus a zero-effect retry", () => {
  const before = state("1".repeat(40), "2".repeat(40), "3".repeat(40), "before\n");
  const after = state("4".repeat(40), "5".repeat(40), "6".repeat(40), CONFORMANCE_CONTENT);
  const artifacts = buildEvidenceArtifacts({
    before,
    first: { disposition: "written", effectDelta: 1, requestKey: CONFORMANCE_REQUEST_KEY, before, dispatch: { commit: after.head }, providerState: after },
    retry: { disposition: "duplicate", effectDelta: 0, requestKey: CONFORMANCE_REQUEST_KEY, before, dispatch: { commit: after.head }, providerState: after },
    final: after,
    tools: ["github_read_conformance_state", "github_put_conformance_file", "reelier_start_recording", "reelier_stop_recording"],
    trace: [
      { t: "meta", seq: 0, wrapped: ["node scripts/disposable-github-mcp-server.mjs"], policy: { status: "absent" } },
      { t: "call", seq: 1, i: 0, tool: "github_read_conformance_state", args: {} },
      { t: "result", seq: 2, i: 0, ok: true, ms: 1, body: {} },
      { t: "call", seq: 3, i: 1, tool: "github_put_conformance_file", args: { requestKey: CONFORMANCE_REQUEST_KEY } },
      { t: "result", seq: 4, i: 1, ok: true, ms: 1, body: {} },
      { t: "call", seq: 5, i: 2, tool: "github_put_conformance_file", args: { requestKey: CONFORMANCE_REQUEST_KEY } },
      { t: "result", seq: 6, i: 2, ok: true, ms: 1, body: {} },
      { t: "call", seq: 7, i: 3, tool: "github_read_conformance_state", args: {} },
      { t: "result", seq: 8, i: 3, ok: true, ms: 1, body: {} },
    ],
  });

  assert.equal(checkEvidenceArtifacts(artifacts).status, "passed");
  assert.equal(artifacts.descriptor.classification, "path-a-live-proxy");
  assert.equal(artifacts.dispatch.providerWriteCount, 1);
  assert.equal(artifacts.dispatch.retry.effectDelta, 0);
  assert.equal(artifacts.finalReport.claims.pathCAuthorityCell, "not-proved");
  assert.equal(artifacts.finalReport.claims.completeWriteCoverage, "not-proved");
});

test("machine checker refuses a receipt whose retry claims another provider effect", () => {
  const after = state("4".repeat(40), "5".repeat(40), "6".repeat(40), CONFORMANCE_CONTENT);
  const artifacts = buildEvidenceArtifacts({
    before: state("1".repeat(40), "2".repeat(40), "3".repeat(40), "before\n"),
    first: { disposition: "written", effectDelta: 1, requestKey: CONFORMANCE_REQUEST_KEY, dispatch: { commit: after.head }, providerState: after },
    retry: { disposition: "duplicate", effectDelta: 0, requestKey: CONFORMANCE_REQUEST_KEY, dispatch: { commit: after.head }, providerState: after },
    final: after,
    tools: ["github_read_conformance_state", "github_put_conformance_file"],
    trace: [{ t: "meta", seq: 0 }, { t: "call", seq: 1, tool: "github_put_conformance_file" }, { t: "call", seq: 2, tool: "github_put_conformance_file" }],
  });
  artifacts.dispatch.retry.effectDelta = 1;

  assert.throws(() => checkEvidenceArtifacts(artifacts), /retry.*zero/i);
});
