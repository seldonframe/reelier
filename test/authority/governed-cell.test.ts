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
type PublicOptionsHaveReleaseRunner = Assert<"githubReleaseRunner" extends keyof GovernedAuthorityCellOptionsV1 ? true : false>;
const publicOptionsHaveReleaseRunner: PublicOptionsHaveReleaseRunner = true;

type GovernedFactoryCase = "correct" | "wrong-write" | "wrong-read" | "provider-mismatch" | "extra-route"
  | "draft-only" | "conformance-only" | "activation-only" | "self-certified" | "revoked-activation"
  | "profile-pack-substitution" | "profile-contract-substitution" | "profile-job-card-substitution"
  | "profile-deployment-substitution" | "profile-route-scope-substitution"
  | "profile-authority-trust-head-substitution" | "profile-trust-head-substitution" | "configured-definition-substitution";

async function runPlatformNeutralFactoryCase(kind: GovernedFactoryCase) {
  const home = await mkdtemp(path.join(os.tmpdir(), `reelier-governed-route-${kind}-`));
  try {
    const fixtureUrl = new URL("./profile-governance-fixture.js", import.meta.url).href;
    const platformUrl = new URL("../../src/authority/host/platform.js", import.meta.url).href;
    const factoryUrl = new URL("../../src/authority/host/governed-cell.js", import.meta.url).href;
    const script = `import {createGovernedAuthorityCell} from ${JSON.stringify(factoryUrl)};import {__testSetAuthorityCellHostPlatform} from ${JSON.stringify(platformUrl)};import {writeGovernedPublicFactoryFixture} from ${JSON.stringify(fixtureUrl)};import {access,readFile,readdir,unlink,writeFile} from "node:fs/promises";import path from "node:path";const kind=${JSON.stringify(kind)};const restore=__testSetAuthorityCellHostPlatform("linux");const f=await writeGovernedPublicFactoryFixture(process.env.HOME,kind==="provider-mismatch"?{profileProvider:"gitlab"}:{});const counts={sourceReads:0,credentialReads:0,preparedSends:0,providerWrites:0,servers:0};const original=f.options;f.options={...original,sourceReadAdapter:{async execute(plans){counts.sourceReads++;return original.sourceReadAdapter.execute(plans)}},secretResolver:{async resolve(){counts.credentialReads++;throw new Error("credential access before admission")}},dispatchAdapter:{async prepare(value){counts.preparedSends++;const prepared=await original.dispatchAdapter.prepare(value);return{...prepared,send:async()=>{counts.providerWrites++;return prepared.send()}}},async dispatch(){counts.providerWrites++;return original.dispatchAdapter.dispatch()}},certifiedDispatch:original.certifiedDispatch};const remove=async name=>unlink(path.join(f.profile.root,name));const rewrite=async(file,mutate)=>{const value=JSON.parse(await readFile(file,"utf8"));mutate(value);await writeFile(file,JSON.stringify(value)+"\\n")};if(kind==="draft-only"){await remove("conformance-report.json");await remove("conformance.json");await remove("activation.json")}if(kind==="conformance-only")await remove("activation.json");if(kind==="activation-only"){await remove("conformance-report.json");await remove("conformance.json")}if(kind==="self-certified")await rewrite(path.join(f.profile.root,"trust-pin.json"),v=>{v.certifier=v.operator});if(kind==="revoked-activation")await rewrite(path.join(f.profile.root,"activation.json"),v=>{v.state="revoked"});if(kind==="profile-pack-substitution")f.config.definitions=["other_definition"];if(kind==="profile-contract-substitution")await rewrite(f.config.deploymentPath,v=>{v.states[0].candidates[0].contractEnvelope.advertisedDigest="sha256:"+"0".repeat(64)});if(kind==="profile-job-card-substitution")await rewrite(f.config.deploymentPath,v=>{v.jobCard.title="substituted"});if(kind==="profile-deployment-substitution")await rewrite(f.config.deploymentPath,v=>{v.enforcement.bypasses=["substituted"]});if(kind==="profile-route-scope-substitution")f.config.nativeHttpsRoutes=[f.routes[0],{...f.routes[1],credentialSlotId:"other_slot"}];if(kind==="profile-authority-trust-head-substitution")await rewrite(f.config.jobCardTrustPinPath,v=>{v.currentTrustEvents=v.currentTrustEvents.slice(0,-1)});if(kind==="profile-trust-head-substitution")f.reference.expectedTrustHeadDigest="sha256:"+"0".repeat(64);if(kind==="configured-definition-substitution")f.config.definitions=["configured_other"];if(kind==="wrong-write")f.config.nativeHttpsRoutes=[f.routes[0],{...f.routes[1],endpointId:"unlisted_write"}];if(kind==="wrong-read")f.config.nativeHttpsRoutes=[{...f.routes[0],endpointId:"unlisted_read"},f.routes[1]];if(kind==="extra-route")f.config.nativeHttpsRoutes=[...f.routes,{...f.routes[1],endpointId:"unrelated_write"}];let status="accepted";let message="";let host;try{host=await createGovernedAuthorityCell(f.config,f.reference,f.options);counts.servers++;}catch(error){status="refused";message=String(error?.message??error)}finally{await host?.close();restore()}const exists=async p=>{try{await access(p);return true}catch{return false}};const countFiles=async root=>{let total=0;const visit=async current=>{let entries;try{entries=await readdir(current,{withFileTypes:true})}catch(error){if(error&&error.code==='ENOENT')return;throw error}for(const entry of entries){const child=path.join(current,entry.name);if(entry.isDirectory())await visit(child);else if(entry.isFile())total++}};await visit(root);return total};const storage={ledgerWrites:await countFiles(f.config.ledgerDir),storeWrites:await countFiles(f.config.receiptDir)};process.stdout.write(JSON.stringify({status,message,counts,storage,created:{ledger:await exists(f.config.ledgerDir),decision:await exists(f.config.decisionDir),receipt:await exists(f.config.receiptDir)}}));`;
    const child = await promisify(execFile)(process.execPath, ["--input-type=module", "--eval", script], { cwd: process.cwd(), env: { ...process.env, HOME: home, USERPROFILE: home }, maxBuffer: 1024 * 1024 });
    return JSON.parse(child.stdout) as { status: string; message: string; counts: Record<string, number>; storage: Record<string, number>; created: Record<string, boolean> };
  } finally { await rm(home, { recursive: true, force: true }); }
}

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
  assert.equal(publicOptionsHaveReleaseRunner, true);
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

test("the public factory admits only the exact definition, connector, read route, and profile provider join", async () => {
  const correct = await runPlatformNeutralFactoryCase("correct");
  assert.equal(correct.status, "accepted", correct.message);
  for (const kind of ["wrong-write", "wrong-read", "provider-mismatch", "extra-route"] as const) {
    const result = await runPlatformNeutralFactoryCase(kind);
    assert.equal(result.status, "refused", `${kind}: ${result.message}`);
    assert.deepEqual(result.counts, { sourceReads: 0, credentialReads: 0, preparedSends: 0, providerWrites: 0, servers: 0 }, kind);
    assert.deepEqual(result.storage, { ledgerWrites: 0, storeWrites: 0 }, kind);
    assert.deepEqual(result.created, { ledger: false, decision: false, receipt: false }, kind);
  }
});

test("all thirteen governed admission mutations cross the public factory and stop every runtime boundary", async () => {
  const mutations = [
    "draft-only", "conformance-only", "activation-only", "self-certified", "revoked-activation",
    "profile-pack-substitution", "profile-contract-substitution", "profile-job-card-substitution",
    "profile-deployment-substitution", "profile-route-scope-substitution",
    "profile-authority-trust-head-substitution", "profile-trust-head-substitution", "configured-definition-substitution",
  ] as const;
  for (const mutation of mutations) {
    const result = await runPlatformNeutralFactoryCase(mutation);
    assert.equal(result.status, "refused", `${mutation}: ${result.message}`);
    assert.deepEqual(result.counts, { sourceReads: 0, credentialReads: 0, preparedSends: 0, providerWrites: 0, servers: 0 }, mutation);
    assert.deepEqual(result.storage, { ledgerWrites: 0, storeWrites: 0 }, mutation);
    assert.deepEqual(result.created, { ledger: false, decision: false, receipt: false }, mutation);
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
