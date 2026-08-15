import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createProfileGovernedAuthorityReceiptPublication, verifyProfileGovernedAuthorityReceipt, type ProfileGovernedAuthorityReceiptVerificationOptionsV1 } from "../../src/authority/host/profile-governed-receipt.js";
import { loadProfileGovernanceFromOperatorTrust } from "../../src/authority/host/profile-governance-loader.js";
import { validateLifecycleAuthorityReceiptSigningAuthority } from "../../src/authority/host/receipt-authority.js";
import { signJobCard } from "../../src/authority/job.js";
import { authorityDigest } from "../../src/authority/wire.js";
import { governanceRef, governedReceiptSigningFixture, profileGovernanceFixture, sha, tenant, verificationTime, writeGovernedPublicFactoryFixture, writeProfileGovernanceFixture } from "./profile-governance-fixture.js";

function lifecycleSigningAuthority() {
  return validateLifecycleAuthorityReceiptSigningAuthority(governedReceiptSigningFixture(verificationTime).material);
}

async function createStorePublication(root: string) {
  const profile = await writeProfileGovernanceFixture(root);
  const governance = await loadProfileGovernanceFromOperatorTrust({ tenant, governanceRef, expectedManifestDigest: profile.manifestDigest, expectedTrustHeadDigest: profile.manifest.trustHeadDigest, homedir: root, verificationTime });
  const jobKey = generateKeyPairSync("ed25519");
  const signedJobCard = signJobCard({ v: "reelier.signed-job-card/v1", jobId: "job_1", title: "Governed", taskShapeDigest: sha("1"), semanticClasses: ["record_state_set_v1"], definitionAliases: ["github_issue_labels_v1"], connectorIds: ["github"], accountIdentities: ["github:acct"], connectionDescriptorDigests: [sha("2")], adoptionCommitmentDigests: [sha("3")], sourceRefs: ["source"], audiences: ["operator"], limitsDigest: sha("4"), instructionsDigest: sha("5"), packDigests: [sha("6")], exceptionPolicy: ["ambiguous-reconcile"], coverage: "declared-surface" }, "human_job", jobKey.privateKey);
  const deploymentSnapshot = { v: "reelier.authority-deployment-snapshot/v1" as const, tenant, jobCardDigest: authorityDigest(signedJobCard), jobCardAuthorityDigest: sha("7"), authorityStateDigest: sha("8"), connectorRegistryDigest: sha("9"), trustRootSetDigest: sha("a"), connectionDescriptorsDigest: sha("b"), connectionAdoptionsDigest: sha("c"), enforcementDigest: sha("d"), routeScopeDigest: sha("e") };
  const input = { rootDir: root, governance, signedJobCard, deploymentSnapshot, expectedRouteScopeDigest: sha("e"), foundations: {} as never, signingAuthority: lifecycleSigningAuthority(), verification: {} as never };
  const independentModule = await import(new URL("../../src/authority/host/profile-governed-receipt.js", import.meta.url).href + `?publisher=${Math.random()}`) as typeof import("../../src/authority/host/profile-governed-receipt.js");
  return {
    publication: createProfileGovernedAuthorityReceiptPublication(input),
    independent: independentModule.createProfileGovernedAuthorityReceiptPublication(input),
  };
}

test("profile-governed receipt verifies the unchanged inner authority bundle before profile edges", () => {
  const fixture = profileGovernanceFixture();
  const wrapper = { v: "reelier.profile-governed-authority-receipt/v1", profileDraft: fixture.draft, profileConformanceReport: fixture.report, profileConformance: fixture.conformance, profileActivation: fixture.activation, authorityReceiptBundle: {}, edges: { profileDigest: fixture.manifest.profileDigest, conformanceReportDigest: fixture.manifest.conformanceReportDigest, conformanceDigest: fixture.manifest.conformanceDigest, activationDigest: fixture.manifest.activationDigest, innerReceiptDigest: `sha256:${"0".repeat(64)}` } };
  assert.throws(() => verifyProfileGovernedAuthorityReceipt(wrapper as never, { authority: { tenant: "tenant_1", trustRoots: [] }, governance: {} } as never), /authority receipt bundle/i);
});

test("offline governed verification requires an exact enumerable direct Authority root array", () => {
  const fixture = profileGovernanceFixture();
  const wrapper = { v: "reelier.profile-governed-authority-receipt/v1", profileDraft: fixture.draft, profileConformanceReport: fixture.report, profileConformance: fixture.conformance, profileActivation: fixture.activation, authorityReceiptBundle: {}, authorityBindingEvidence: {}, edges: { profileDigest: fixture.manifest.profileDigest, conformanceReportDigest: fixture.manifest.conformanceReportDigest, conformanceDigest: fixture.manifest.conformanceDigest, activationDigest: fixture.manifest.activationDigest, innerReceiptDigest: sha("1"), authorityBindingDigest: sha("2") } };
  const options = { profileTrustRoots: {} as never, profilePacks: fixture.packs, jobCardTrustPin: {} as never, currentAuthorityTrustEvents: [], directAuthorityRoots: [], expectedTenant: "tenant_1", expectedAuthorityCellId: "cell_1", expectedTaskId: "task_1", now: new Date("2026-08-14T12:00:00.000Z") } satisfies ProfileGovernedAuthorityReceiptVerificationOptionsV1;
  for (const mutated of [
    { ...options, directAuthorityRoots: {} },
    { ...options, directAuthorityRoots: [{ tenant: "tenant_2" }] },
    Object.assign(Object.create(null), options),
    Object.assign({ ...options }, { [Symbol("root")]: true }),
  ]) assert.throws(() => verifyProfileGovernedAuthorityReceipt(wrapper as never, mutated as never), /options|direct authority roots|closed|tenant|exact fields/i);
});

test("durable outer identity mutations cannot become an inner receipt prior", () => {
  const inner = sha("1");
  const outer = sha("2");
  assert.notEqual(inner, outer);
  const envelope = { receiptRef: inner, outerDigest: outer, priorReceiptDigest: inner };
  for (const field of ["receiptRef", "priorReceiptDigest"] as const) assert.notEqual({ ...envelope, [field]: outer }[field], inner);
});

test("durable governed store refuses a reservation directory redirected outside its physical root", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-governed-store-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "reelier-governed-outside-"));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]));
  await mkdir(path.join(root, "governed"), { recursive: true });
  await symlink(outside, path.join(root, "governed", "r1"), process.platform === "win32" ? "junction" : "dir");
  const { publication } = await createStorePublication(root);
  const identity = { v: "reelier.durable-dispatch-publication-identity/v1" as const, reservationId: "r1", tenant: "tenant_1", requestDigest: sha("1"), capabilityDigest: sha("2"), effectDigest: sha("3"), routeAuthorityDigest: sha("4"), expectedDispatchedRequestDigest: sha("5"), reservationIntentDigest: sha("6") };
  await assert.rejects(() => publication.loadDurableHead!({ v: "reelier.durable-dispatch-publication-query/v1", identity, ledgerState: "dispatched", sendStarted: true }), /physical|confined|link|junction|symlink|escape/i);
});

test("every governed store operation rejects noncanonical tenant and reservation path identities at its own boundary", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-governed-identities-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "reelier-governed-identities-outside-"));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]));
  const { publication, independent } = await createStorePublication(root);
  const base = { v: "reelier.durable-dispatch-publication-identity/v1" as const, reservationId: "reservation_1", tenant, requestDigest: sha("1"), capabilityDigest: sha("2"), effectDigest: sha("3"), routeAuthorityDigest: sha("4"), expectedDispatchedRequestDigest: sha("5"), reservationIntentDigest: sha("6") };
  const mutations = [
    { field: "reservationId", value: ".." },
    { field: "reservationId", value: "../outside" },
    { field: "reservationId", value: "..\\outside" },
    { field: "reservationId", value: "%2e%2e%2foutside" },
    { field: "reservationId", value: ".%2e/outside" },
    { field: "tenant", value: ".." },
    { field: "tenant", value: "tenant/other" },
    { field: "tenant", value: "tenant%2fother" },
  ] as const;
  for (const mutation of mutations) {
    const identity = { ...base, [mutation.field]: mutation.value };
    await assert.rejects(
      () => publication.loadDurableHead!({ v: "reelier.durable-dispatch-publication-query/v1", identity, ledgerState: "dispatched", sendStarted: true }),
      /identity|canonical|tenant|reservation|path|invalid/i,
      `${mutation.field}:${mutation.value}`,
    );
  }
  const equal = { v: "reelier.durable-dispatch-publication-query/v1" as const, identity: base, ledgerState: "dispatched" as const, sendStarted: true as const };
  assert.deepEqual(await Promise.all([publication.loadDurableHead!(equal), independent.loadDurableHead!(equal)]), [null, null], "independent publishers must agree on an absent equal semantic head");
  const unequal = { ...equal, identity: { ...base, tenant: `${tenant}/fork` } };
  await assert.rejects(() => Promise.all([publication.loadDurableHead!(equal), independent.loadDurableHead!(unequal)]), /identity|tenant|canonical|fork|conflict/i);
  assert.deepEqual(await (await import("node:fs/promises")).readdir(outside), [], "invalid store identities must not create or adopt outside nodes");
});

test("independent governed publishers deterministically adopt equal reservation bytes and refuse an unequal physical-store fork", async t => {
  const home = await mkdtemp(path.join(os.tmpdir(), "reelier-governed-cas-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const fixture = await writeGovernedPublicFactoryFixture(home);
  const rootDir = path.join(home, "shared-governed-receipts");
  await mkdir(rootDir);
  const governance = await loadProfileGovernanceFromOperatorTrust({ tenant, governanceRef, expectedManifestDigest: fixture.profile.manifestDigest, expectedTrustHeadDigest: fixture.profile.manifest.trustHeadDigest, homedir: home, verificationTime: new Date() });
  const signingAuthority = validateLifecycleAuthorityReceiptSigningAuthority(fixture.signing.material);
  const publicationInput = {
    rootDir,
    governance,
    signedJobCard: fixture.jobCard,
    deploymentSnapshot: fixture.deploymentSnapshot,
    expectedRouteScopeDigest: authorityDigest(fixture.routeScope),
    foundations: fixture.foundations,
    signingAuthority,
    currentAuthority: () => ({ signingAuthority, jobCardTrustPin: fixture.signing.pin, observedAt: fixture.signing.observedAt }),
    verification: fixture.verification,
  };
  const firstModule = await import(new URL("../../src/authority/host/profile-governed-receipt.js", import.meta.url).href + "?cas=first") as typeof import("../../src/authority/host/profile-governed-receipt.js");
  const secondModule = await import(new URL("../../src/authority/host/profile-governed-receipt.js", import.meta.url).href + "?cas=second") as typeof import("../../src/authority/host/profile-governed-receipt.js");
  const first = firstModule.createProfileGovernedAuthorityReceiptPublication(publicationInput);
  const second = secondModule.createProfileGovernedAuthorityReceiptPublication(publicationInput);
  const built = fixture.publicationState("reservation_governed_cas");
  const identity = { v: "reelier.durable-dispatch-publication-identity/v1" as const, reservationId: built.state.reservation.reservationId, tenant, requestDigest: built.requestDigest, capabilityDigest: built.capabilityDigest, effectDigest: built.effectDigest, routeAuthorityDigest: authorityDigest(fixture.routeAuthority), expectedDispatchedRequestDigest: sha("b"), reservationIntentDigest: sha("c") };
  const equal = { phase: "reservation" as const, identity, state: built.state, outcome: { kind: "ambiguous" as const, resultDigest: sha("d"), reconciliationStatus: "not-attempted" as const }, dispatchedRequestDigest: null, priorReceiptDigest: null };
  const adopted = await Promise.all([first.publishReservation!(equal), second.publishReservation!(equal)]);
  assert.deepEqual(adopted[0], adopted[1], "separate publisher lock maps must adopt identical deterministic receipt bytes");
  const unequal = { ...equal, identity: { ...identity, requestDigest: sha("e") } };
  await assert.rejects(() => Promise.all([first.publishReservation!(equal), second.publishReservation!(unequal)]), /identity|fork|conflict|root already exists|semantic CAS/i);
});

test("the offline verifier rejects mutations of every real outer evidence family and unchanged inner claims", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "reelier-governed-outer-mutations-"));
  try {
    const fixtureUrl = new URL("./profile-governance-fixture.js", import.meta.url).href;
    const factoryUrl = new URL("../../src/authority/host/governed-cell.js", import.meta.url).href;
    const platformUrl = new URL("../../src/authority/host/platform.js", import.meta.url).href;
    const verifierUrl = new URL("../../src/authority/host/profile-governed-receipt.js", import.meta.url).href;
    const script = `import {createGovernedAuthorityCell} from ${JSON.stringify(factoryUrl)};import {verifyProfileGovernedAuthorityReceipt} from ${JSON.stringify(verifierUrl)};import {__testSetAuthorityCellHostPlatform} from ${JSON.stringify(platformUrl)};import {writeGovernedPublicFactoryFixture} from ${JSON.stringify(fixtureUrl)};import {Client} from "@modelcontextprotocol/sdk/client/index.js";import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";import {readFile,readdir} from "node:fs/promises";import path from "node:path";const restore=__testSetAuthorityCellHostPlatform("linux");const f=await writeGovernedPublicFactoryFixture(process.env.HOME);const host=await createGovernedAuthorityCell(f.config,f.reference,f.options);const [ct,st]=InMemoryTransport.createLinkedPair();await host.mcp.connect(st);const client=new Client({name:"outer-mutations",version:"1"},{capabilities:{}});await client.connect(ct);const response=await client.callTool({name:"reelier_outcome_github_issue_labels_set_v1",arguments:f.request});if(response.isError)throw new Error(JSON.stringify(response));const dirs=await readdir(path.join(f.config.receiptDir,"governed"));const stored=JSON.parse(await readFile(path.join(f.config.receiptDir,"governed",dirs[0],"root.json"),"utf8"));const base=stored.receipt;const options={...f.verification,now:new Date(base.authorityBindingEvidence.binding.observedAt)};verifyProfileGovernedAuthorityReceipt(base,options);const mutations=[r=>{r.profileDraft.provider="gitlab"},r=>{r.profileActivation.contractDigest="sha256:"+"0".repeat(64)},r=>{r.authorityBindingEvidence.signedJobCard.title="changed"},r=>{r.authorityBindingEvidence.deploymentSnapshot.enforcementDigest="sha256:"+"0".repeat(64)},r=>{r.authorityBindingEvidence.routeScope.providerId="gitlab"},r=>{r.authorityBindingEvidence.routeAuthoritySnapshot.slotVersion="changed"},r=>{r.authorityBindingEvidence.binding.signerId="other"},r=>{r.edges.authorityBindingDigest="sha256:"+"0".repeat(64)},r=>{r.authorityReceiptBundle.receipt.value.claims.dispatch="verified"}];const rejected=[];for(const mutate of mutations){const changed=structuredClone(base);mutate(changed);try{verifyProfileGovernedAuthorityReceipt(changed,options);rejected.push(false)}catch{rejected.push(true)}}await client.close();await host.close();restore();process.stdout.write(JSON.stringify(rejected));`;
    const diagnosticScript = script
      .replace("const host=await createGovernedAuthorityCell", "const counts={source:0,route:0,identity:0,prepare:0,send:0};const original=f.options;f.options={...original,sourceReadAdapter:{async execute(...args){counts.source++;return original.sourceReadAdapter.execute(...args)}},routeAuthority:(...args)=>{counts.route++;return original.routeAuthority(...args)},authenticatedProviderIdentity:async(...args)=>{counts.identity++;return original.authenticatedProviderIdentity(...args)},dispatchAdapter:{...original.dispatchAdapter,async prepare(...args){counts.prepare++;const prepared=await original.dispatchAdapter.prepare(...args);return{...prepared,send:async()=>{counts.send++;return prepared.send()}}}}};const host=await createGovernedAuthorityCell")
      .replace("if(response.isError)throw new Error(JSON.stringify(response));", "const outcome=JSON.parse(response.content[0].text);if(response.isError||outcome.verdict!==\"accepted\")throw new Error(JSON.stringify({outcome,counts}));");
    const child = await promisify(execFile)(process.execPath, ["--input-type=module", "--eval", diagnosticScript], { cwd: process.cwd(), env: { ...process.env, HOME: home, USERPROFILE: home }, maxBuffer: 1024 * 1024 });
    assert.deepEqual(JSON.parse(child.stdout), Array(9).fill(true));
  } finally { await rm(home, { recursive: true, force: true }); }
});
