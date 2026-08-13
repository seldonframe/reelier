import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runAuthorityCommand, parseAuthorityServeMode } from "../../src/authority/cli.js";
import { createLocalAuthorityRuntime } from "../../src/authority/host/local.js";
import { createAuthorityHostRuntime } from "../../src/authority/host/runtime.js";
import { createDispatchCoordinator } from "../../src/authority/host/dispatch.js";
import { createFileReceiptPublication } from "../../src/authority/host/receipts.js";
import { createAuthorityHostServer } from "../../src/authority/host/server.js";
import { createDelegationAuthority } from "../../src/authority/host/delegation-service.js";
import { createAuthorityEgressGateway } from "../../src/authority/host/egress-gateway.js";
import { validateAuthorityHostConfig } from "../../src/authority/host/config.js";
import { createCertificationCellHost, certificationTaskShapeDigest } from "../../src/authority/certification/cell.js";
import { createGitHubIssueLabelsHermeticComposition } from "../../src/authority/certification/github-issue-labels-runner.js";
import { __testSetAuthorityCellHostPlatform } from "../../src/authority/host/platform.js";
import * as host from "../../src/authority/host/index.js";

const LINUX_REQUIRED = "AUTHORITY_CELL_LINUX_REQUIRED";
const SUPPORTED_LINUX_HOST_ROOTS = ["createAuthorityEgressGateway", "createAuthorityHostRuntime", "createAuthorityHostServer", "createCertificationCellHost", "createDelegationAuthority", "createDispatchCoordinator", "createFileReceiptPublication", "createLocalAuthorityRuntime"] as const;

function assertLinuxRequired(error: unknown): boolean {
  assert.ok(error instanceof Error);
  assert.equal((error as Error & { code?: unknown }).code, LINUX_REQUIRED);
  assert.match(error.message, /Windows is supported as a client/i);
  assert.match(error.message, /WSL.*container.*remote Linux Authority Cell/i);
  return true;
}

async function onWindows(operation: () => Promise<void> | void): Promise<void> {
  const restore = __testSetAuthorityCellHostPlatform("win32");
  try { await operation(); } finally { restore(); }
}

test("Windows refuses authority CLI setup and serving before writing its workspace", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-linux-authority-cell-"));
  try {
    await onWindows(async () => {
      for (const positional of [["init"], ["bootstrap"], ["serve"]]) {
        await assert.rejects(
          () => runAuthorityCommand({ positional, flags: new Set(), opts: { path: root } }),
          assertLinuxRequired,
          positional[0],
        );
      }
    });
    assert.deepEqual(await readdir(root), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Windows refuses Codex activation before reading the certification config", async () => {
  let configReads = 0;
  const opts = new Proxy({} as Record<string, string>, { get(_target, key) { if (key === "config") configReads += 1; return "C:/nonexistent/certification.json"; } });
  await onWindows(async () => {
    await assert.rejects(() => runAuthorityCommand({ positional: ["certify", "activate-codex"], flags: new Set(), opts }), assertLinuxRequired);
  });
  assert.equal(configReads, 0);
});

test("Windows refuses Fly topology certification before config or live-provider access", async () => {
  let configReads = 0;
  const opts = new Proxy({} as Record<string, string>, { get(_target, key) { if (key === "adapter") return "fly-topology"; if (key === "config") { configReads += 1; throw new Error("configuration accessed"); } return undefined; } });
  await onWindows(async () => {
    await assert.rejects(() => runAuthorityCommand({ positional: ["certify", "run"], flags: new Set(), opts }), assertLinuxRequired);
  });
  assert.equal(configReads, 0);
});

test("native Windows refuses authority setup without a platform test seam", { skip: process.platform !== "win32" }, async () => {
  await assert.rejects(() => runAuthorityCommand({ positional: ["init"], flags: new Set(), opts: { path: "C:/nonexistent/authority" } }), assertLinuxRequired);
});

test("Windows refuses every authority host composition before touching host dependencies", async () => {
  for (const name of SUPPORTED_LINUX_HOST_ROOTS) {
    const root = await mkdtemp(path.join(os.tmpdir(), `reelier-linux-authority-${name}-`));
    let dependencyAccesses = 0, callbackInvocations = 0;
    const callback = () => { callbackInvocations += 1; throw new Error("authority callback invoked"); };
    const dependency = <T extends object>(value: T): T => new Proxy(value, { get(target, key, receiver) { dependencyAccesses += 1; return Reflect.get(target, key, receiver); } });
    try {
      await onWindows(async () => {
        const operations: Record<typeof name, () => unknown> = {
          createAuthorityEgressGateway: () => createAuthorityEgressGateway(dependency({ config: {}, secrets: dependency({ resolve: callback }) }) as never),
          createAuthorityHostRuntime: () => createAuthorityHostRuntime(dependency({}) as never),
          createAuthorityHostServer: () => createAuthorityHostServer(dependency({ ledgerDir: root }) as never, dependency({}) as never, dependency({ principalRegistry: dependency({ resolve: callback }) }) as never),
          createCertificationCellHost: () => createCertificationCellHost(dependency({ workspace: root, currentTrustPinPath: path.join(root, "trust.json"), delegationAuthority: dependency({ signGrant: callback }) }) as never),
          createDelegationAuthority: () => createDelegationAuthority(dependency({ root, signGrant: callback }) as never),
          createDispatchCoordinator: () => createDispatchCoordinator(dependency({}) as never, dependency({ dispatch: callback }) as never, dependency({ write: callback }) as never, dependency({ publish: callback }) as never, dependency({ reserve: callback }) as never),
          createFileReceiptPublication: () => createFileReceiptPublication(dependency({ root }) as never),
          createLocalAuthorityRuntime: () => createLocalAuthorityRuntime(dependency({ ledgerDir: root, decisionDir: root, receiptDir: root, tenant: "tenant", requester: "requester", definitions: [] }) as never, dependency({ dispatchAdapter: dependency({ dispatch: callback }) }) as never),
        };
        await assert.rejects(async () => operations[name](), assertLinuxRequired, name);
      });
      assert.equal(dependencyAccesses, 0, `${name}: dependency accesses`);
      assert.equal(callbackInvocations, 0, `${name}: callback invocations`);
      assert.deepEqual(await readdir(root), [], `${name}: empty root`);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
  await onWindows(async () => {
    const inaccessible = new Proxy({}, { get() { throw new Error("internal composition dependency accessed"); } });
    await assert.rejects(() => createGitHubIssueLabelsHermeticComposition(inaccessible as never), assertLinuxRequired);
  });
});

test("declared host namespace contains every supported Linux composition root", () => {
  for (const root of SUPPORTED_LINUX_HOST_ROOTS) assert.equal(Object.hasOwn(host, root), true, root);
  assert.equal(Object.hasOwn(host, "FsAuthorityLedger"), false);
});

test("Windows remains supported for Authority client parsing and offline preparation", async () => {
  await onWindows(() => {
    assert.deepEqual(parseAuthorityServeMode({ transport: "http", host: "127.0.0.1", port: "8080" }), { transport: "http", host: "127.0.0.1", port: 8080 });
    assert.doesNotThrow(() => validateAuthorityHostConfig({ version: 1, tenant: "tenant_1", requester: "operator", definitions: [], ledgerDir: "ledger", decisionDir: "decisions", receiptDir: "receipts", endpoints: [] }, "/authority"));
    assert.doesNotThrow(() => certificationTaskShapeDigest({ identifiers: { taskId: "task_1", jobCardId: "job_1", rootGrantId: "grant_1", authorityCellId: "cell_1", signerId: "signer_1" }, scenarios: ["github-issue-labels"], constraints: { definitionAliases: [], audiences: [], connectorAccounts: [], projectionPointers: [], riskClasses: [], limits: { maxEffectsPerWindow: 1, windowSeconds: 60, maxEffectsPerSourceTrigger: 1, maxBodyBytes: 1 } } }));
  });
});
