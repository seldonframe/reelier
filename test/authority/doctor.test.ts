import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runAuthorityCommand } from "../../src/authority/cli.js";

test("authority doctor reports non-secret preflight surfaces without calling providers", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-authority-doctor-"));
  const authority = path.join(root, "authority");
  const output: string[] = [];
  const original = console.log;
  console.log = (...values: unknown[]) => output.push(values.join(" "));
  try {
    await mkdir(path.join(authority, "contracts"), { recursive: true });
    await mkdir(path.join(authority, "trust"));
    await mkdir(path.join(authority, "connectors"));
    await mkdir(path.join(authority, "ledger"));
    await mkdir(path.join(authority, "decisions"));
    await mkdir(path.join(authority, "receipts"));
    await writeFile(path.join(authority, "contracts", "job.json"), "{}\n");
    await writeFile(path.join(authority, "trust", "operator.pub"), "public\n");
    await writeFile(path.join(authority, "connectors", "gmail.json"), JSON.stringify({ provider: "gmail" }));
    await writeFile(path.join(authority, "authority.yml"), JSON.stringify({ version: 1, tenant: "tenant_1", requester: "operator", definitions: ["gmail_reply_send_v1"], topology: "same-user", ledgerDir: "ledger", decisionDir: "decisions", receiptDir: "receipts", ingress: { allowedRequester: "operator" }, endpoints: [], cloud: { baseUrl: "https://cloud.example", tokenRef: "cloud-token" } }));
    assert.equal(await runAuthorityCommand({ positional: ["doctor"], flags: new Set(), opts: { path: path.join(authority, "authority.yml") } }), 0);
    const report = JSON.parse(output[0]) as { ok: boolean; checks: Record<string, string> };
    assert.equal(report.ok, true);
    assert.equal(report.checks.config, "verified");
    assert.equal(report.checks.contracts, "configured");
    assert.equal(report.checks.trust, "configured");
    assert.equal(report.checks.connectors, "configured");
    assert.equal(report.checks.cloud, "configured");
    assert.equal(report.checks.live, "not-run");
  } finally { console.log = original; await rm(root, { recursive: true, force: true }); }
});

test("authority doctor does not treat a topology declaration as isolation evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-authority-doctor-topology-"));
  const authority = path.join(root, "authority");
  const output: string[] = [];
  const original = console.log;
  console.log = (...values: unknown[]) => output.push(values.join(" "));
  try {
    await mkdir(authority, { recursive: true });
    await writeFile(path.join(authority, "authority.yml"), JSON.stringify({ version: 1, tenant: "tenant_1", requester: "operator", definitions: [], topology: "isolated", ledgerDir: "ledger", decisionDir: "decisions", receiptDir: "receipts", endpoints: [] }));
    assert.equal(await runAuthorityCommand({ positional: ["doctor"], flags: new Set(), opts: { path: path.join(authority, "authority.yml") } }), 0);
    const report = JSON.parse(output[0]) as { checks: Record<string, string> };
    assert.equal(report.checks.topology, "unchecked");
  } finally { console.log = original; await rm(root, { recursive: true, force: true }); }
});
