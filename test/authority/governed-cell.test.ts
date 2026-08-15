import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createGovernedAuthorityCell, type GovernedAuthorityCellOptionsV1 } from "../../src/authority/host/governed-cell.js";
import { __testSetAuthorityCellHostPlatform } from "../../src/authority/host/platform.js";
import { profileGovernanceFixture, writeGovernedPublicFactoryFixture } from "./profile-governance-fixture.js";

type Assert<T extends true> = T;
type PublicOptionsHaveNoSecondBindingSigner = Assert<"authorityBindingSigner" extends keyof GovernedAuthorityCellOptionsV1 ? false : true>;
const publicOptionsHaveNoSecondBindingSigner: PublicOptionsHaveNoSecondBindingSigner = true;

test("governed Cell refuses Windows before config, reference, options, or filesystem access", async () => {
  const restore = __testSetAuthorityCellHostPlatform("win32");
  let accesses = 0;
  const inaccessible = new Proxy({}, { get() { accesses += 1; throw new Error("dependency accessed"); }, ownKeys() { accesses += 1; throw new Error("dependency accessed"); } });
  try { await assert.rejects(() => createGovernedAuthorityCell(inaccessible as never, inaccessible as never, inaccessible as never), /AUTHORITY_CELL_LINUX_REQUIRED|requires Linux/i); }
  finally { restore(); }
  assert.equal(accesses, 0);
});

test("the public governed options expose one receipt signing authority and no second binding signer", async () => {
  assert.equal(publicOptionsHaveNoSecondBindingSigner, true);
  profileGovernanceFixture();
  const restore = __testSetAuthorityCellHostPlatform("linux");
  const config = { version: 1 as const, tenant: "tenant_1", requester: "operator", definitions: [], ledgerDir: "ledger", decisionDir: "decisions", receiptDir: "receipts", endpoints: [] };
  const reference = { v: "reelier.governed-authority-cell-reference/v1" as const, tenant: "tenant_1", governanceRef: "governance_1", expectedManifestDigest: `sha256:${"1".repeat(64)}`, expectedTrustHeadDigest: `sha256:${"2".repeat(64)}` };
  let signerReads = 0;
  const signing = new Proxy({}, { ownKeys() { signerReads += 1; return []; }, get() { signerReads += 1; throw new Error("signer read"); } });
  try {
    const supported: GovernedAuthorityCellOptionsV1 = { receiptSigningAuthority: signing as never };
    assert.equal(supported.receiptSigningAuthority, signing);
    // @ts-expect-error authorityBindingSigner is not a public option; the evidence signer in receiptSigningAuthority signs both domains.
    const unsupported: GovernedAuthorityCellOptionsV1 = { authorityBindingSigner: signing };
    await assert.rejects(() => createGovernedAuthorityCell(config, reference, unsupported as never), /unknown|exact fields|receipt signing/i);
  } finally { restore(); }
  assert.equal(signerReads, 0);
});

test("public governed Linux factory evidence is registered on every platform", { skip: process.platform === "linux" ? false : "requires an already-available Linux Node executor" }, async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "reelier-governed-public-"));
  try {
    const fixtureUrl = new URL("./profile-governance-fixture.js", import.meta.url).href;
    const script = `import {createGovernedAuthorityCell} from "reelier/authority/host";import {Client} from "@modelcontextprotocol/sdk/client/index.js";import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";import {readFile,readdir} from "node:fs/promises";import path from "node:path";import {writeGovernedPublicFactoryFixture} from ${JSON.stringify(fixtureUrl)};import {verifyProfileGovernedAuthorityReceipt} from ${JSON.stringify(new URL("../../src/authority/host/profile-governed-receipt.js", import.meta.url).href)};const f=await writeGovernedPublicFactoryFixture(process.env.HOME);const host=await createGovernedAuthorityCell(f.config,f.reference,f.options);const [ct,st]=InMemoryTransport.createLinkedPair();await host.mcp.connect(st);const client=new Client({name:"governed-public-test",version:"1"},{capabilities:{}});await client.connect(ct);const response=await client.callTool({name:"reelier_outcome_github_issue_labels_set_v1",arguments:f.request});const outcome=JSON.parse(response.content[0].text);const dirs=await readdir(path.join(f.config.receiptDir,"governed"));const names=await readdir(path.join(f.config.receiptDir,"governed",dirs[0]));const stored=JSON.parse(await readFile(path.join(f.config.receiptDir,"governed",dirs[0],names.sort().at(-1)),"utf8"));const verified=verifyProfileGovernedAuthorityReceipt(stored.receipt,{...f.verification,now:new Date(stored.receipt.authorityBindingEvidence.binding.observedAt)});await client.close();await host.close();process.stdout.write(JSON.stringify({verdict:outcome.verdict,receiptRef:outcome.receiptRef,verified:verified.inner.bundle.receipt.digest===stored.receipt.authorityReceiptBundle.receipt.digest}));`;
    const child = await promisify(execFile)(process.execPath, ["--input-type=module", "--eval", script], { cwd: process.cwd(), env: { ...process.env, HOME: home, USERPROFILE: home }, maxBuffer: 1024 * 1024 });
    const result = JSON.parse(child.stdout);
    assert.deepEqual(result, { verdict: "accepted", receiptRef: result.receiptRef, verified: true }); assert.match(result.receiptRef, /^sha256:/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("governed Cell rejects non-data and unpaired capabilities before invocation", async () => {
  const restore = __testSetAuthorityCellHostPlatform("linux");
  let getters = 0;
  const reference = Object.defineProperty({ v: "reelier.governed-authority-cell-reference/v1", tenant: "tenant_1", governanceRef: "governance_1", expectedManifestDigest: `sha256:${"0".repeat(64)}` }, "expectedTrustHeadDigest", { enumerable: true, get() { getters += 1; return `sha256:${"0".repeat(64)}`; } });
  const config = { version: 1 as const, tenant: "tenant_1", requester: "operator", definitions: [], ledgerDir: "ledger", decisionDir: "decisions", receiptDir: "receipts", endpoints: [] };
  try {
    await assert.rejects(() => createGovernedAuthorityCell(config, reference as never, {}), /own data|exact fields|plain record/i);
    await assert.rejects(() => createGovernedAuthorityCell(config, { v: "reelier.governed-authority-cell-reference/v1", tenant: "tenant_1", governanceRef: "governance_1", expectedManifestDigest: `sha256:${"0".repeat(64)}`, expectedTrustHeadDigest: `sha256:${"0".repeat(64)}` }, { signedTopologyEvidence: {} as never }), /topology signer|paired/i);
  } finally { restore(); }
  assert.equal(getters, 0);
});
