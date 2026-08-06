import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync,linkSync,lstatSync,mkdirSync,readFileSync,readdirSync,renameSync,rmSync,symlinkSync,writeFileSync } from "node:fs";
import { mkdtemp, open, rm, writeFile, mkdir, readFile, readdir, realpath, rename, symlink, unlink, link } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFile,spawn } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { connect, createServer } from "node:net";
import { authorityCanonicalBytes, authorityDigest } from "../../src/authority/wire.js";
import { authenticateOutcomeRequest, authenticatedOutcomeRequestState } from "../../src/authority/keys.js";
import * as authorityModule from "../../src/authority/index.js";
import {
  CAPABILITY_LIFETIME_MS,
  type LedgerState,
  type ReservationIntent,
  type ReservationSnapshot,
  type TransitionEvent,
} from "../../src/authority/ledger.js";
import {
  FsAuthorityLedger as RawFsAuthorityLedger,
  dispatchFaultPoints,
  ledgerFaultPoints,
  ledgerLockFaultPoints,
  reservationFaultPoints,
  resultFaultPoints,
  ingressFaultPoints,
  clockFaultPoints,
  __testAdmissionClockOption,
  __testPrepHousekeeperRuntimeOption,
} from "../../src/authority/host/fs-ledger.js";
import * as hostAuthorityModule from "../../src/authority/host/fs-ledger.js";

class FsAuthorityLedger extends RawFsAuthorityLedger {
  override async reserve(candidate: ReservationIntent) {
    try {
      const wire=JSON.parse(Buffer.from(candidate.canonicalRequestBytes).toString("utf8"));
      const authenticated=authenticateOutcomeRequest({tenant:candidate.tenant,requester:candidate.requester,definitionAlias:candidate.definitionAlias,request:wire});
      const binding=await this.bindIngress(authenticated);
      if("ingressClaimDigest" in binding)return super.reserve({...candidate,ingressClaimDigest:binding.ingressClaimDigest});
    } catch { /* malformed inputs remain direct integrity tests */ }
    return super.reserve(candidate);
  }
}

const t0 = Date.parse("2026-08-02T12:00:00.000Z");
const digest = (character: string) => `sha256:${character.repeat(64)}`;
type ExactFsIdentity=Readonly<{dev:bigint;ino:bigint;mode:bigint;nlink:bigint}>;
function exactFsIdentity(target:string):ExactFsIdentity{const value=lstatSync(target,{bigint:true});return {dev:value.dev,ino:value.ino,mode:value.mode,nlink:value.nlink};}
const kernelTimedTransition: TransitionEvent = { to: "dispatched" };
const callerTimedTransition: TransitionEvent = {
  to: "dispatched",
  // @ts-expect-error lifecycle time is kernel-owned, never caller-authored
  at: new Date(t0).toISOString(),
};
void kernelTimedTransition;
void callerTimedTransition;

test("ledger root accepts an existing Windows directory through its distinct DOS 8.3 alias",{skip:process.platform!=="win32"},async t=>{
  const root=await bindableTempRoot();
  try{
    let shortRoot:string;
    try{
      const {stdout}=await promisify(execFile)("cmd.exe",["/d","/c",`for %I in ("${root}") do @echo %~sI`],{windowsVerbatimArguments:true});
      shortRoot=stdout.trim();
    }catch(error){t.skip(`DOS 8.3 path lookup unavailable: ${(error as Error).message}`);return;}
    if(!shortRoot||shortRoot.toLowerCase()===root.toLowerCase()){
      const shortName=`RLR${process.pid.toString(16).slice(-5)}`.toUpperCase();
      try{await promisify(execFile)("fsutil.exe",["file","setshortname",root,shortName]);}
      catch{t.skip("this Windows filesystem exposes no distinct DOS 8.3 alias");return;}
      shortRoot=path.join(path.dirname(root),shortName);
    }
    if(!existsSync(shortRoot)){t.skip("this Windows filesystem exposes no resolvable distinct DOS 8.3 alias");return;}
    let ledger:RawFsAuthorityLedger|undefined;
    assert.doesNotThrow(()=>{ledger=new RawFsAuthorityLedger(shortRoot,{now:()=>t0,lockTimeoutMs:200});});
    assert.deepEqual(await ledger!.observeClock(),{ok:true,status:"advanced",observedAt:new Date(t0).toISOString()});
  }finally{await rm(root,{recursive:true,force:true});}
});

test("ledger root rejects symlink or junction traversal in an ancestor at construction",async t=>{
  const outer=await tempRoot(),real=path.join(outer,"real"),nested=path.join(real,"nested"),link=path.join(outer,"link");await mkdir(nested,{recursive:true});
  try{
    try{await symlink(real,link,process.platform==="win32"?"junction":"dir");}
    catch(error){if((error as {code?:string}).code==="EPERM"){t.skip("symlink creation unavailable on this host");return;}throw error;}
    assert.throws(()=>new RawFsAuthorityLedger(path.join(link,"nested"),{now:()=>t0}),/root|symlink|reparse/i);
  }finally{await rm(outer,{recursive:true,force:true});}
});


function intent(overrides: Partial<ReservationIntent> = {}): ReservationIntent {
  const limits = overrides.limits ?? { maxEffectsPerWindow: 2, windowSeconds: 3600, maxEffectsPerSourceTrigger: 1, maxBodyBytes: 4096 };
  const scalar = {
    tenant: "tenant_1",
    requester: "requester_1",
    definitionAlias: "definition_1",
    requestId: "request_1",
    requestKey: deriveRequestKey(overrides),
    ingressClaimDigest: digest("9"),
    decisionContextDigest: digest("7"),
    contractDigest: digest("a"), sourceBundleDigest: digest("b"), sourceSnapshotDigest: digest("c"), authorityStateDigest: digest("d"), limits,
    limitsDigest: "",
    capabilityId: "capability_1",
    outcomeKey: digest("3"),
    effectDigest: digest("4"),
    issuedAt: new Date(t0).toISOString(),
    expiresAt: new Date(t0 + CAPABILITY_LIFETIME_MS).toISOString(),
    limitSlots: [
      { kind: "contract-window" as const, key: digest("5"), maximum: limits.maxEffectsPerWindow },
      { kind: "source-trigger" as const, key: digest("6"), maximum: limits.maxEffectsPerSourceTrigger },
    ],
    ...overrides,
  };
  const canonicalRequestBytes = overrides.canonicalRequestBytes === undefined
    ? requestWireBytes(scalar.requestId)
    : Buffer.from(overrides.canonicalRequestBytes);
  const requestDigest = `sha256:${createHash("sha256").update(canonicalRequestBytes).digest("hex")}`;
  scalar.limitsDigest = authorityDigest({ v: "reelier.capability-limits/internal-v1", contractDigest: scalar.contractDigest, limits: scalar.limits });
  const capabilityBytes = overrides.capabilityBytes === undefined
    ? capabilityWireBytes({ ...scalar, requestDigest } as Parameters<typeof capabilityWireBytes>[0])
    : Buffer.from(overrides.capabilityBytes);
  return {
    ...scalar,
    canonicalRequestBytes,
    capabilityBytes,
    requestDigest, canonicalRequestDigest: requestDigest,
    capabilityDigest: `sha256:${createHash("sha256").update(capabilityBytes).digest("hex")}`,
  };
}

function deriveRequestKey(overrides:Partial<ReservationIntent>):string{return authenticatedOutcomeRequestState(authenticateOutcomeRequest({tenant:overrides.tenant??"tenant_1",requester:overrides.requester??"requester_1",definitionAlias:overrides.definitionAlias??"definition_1",request:{v:"reelier.outcome-request/v1",requestId:overrides.requestId??"request_1",sourceRefs:{source:"ref_1"},choices:{}}})).requestKey;}

function requestWireBytes(requestId: string, sourceRef = "ref_1"): Buffer {
  return authorityCanonicalBytes({ v: "reelier.outcome-request/v1", requestId, sourceRefs: { source: sourceRef }, choices: {} });
}

function capabilityWireBytes(value: Omit<ReservationIntent, "canonicalRequestBytes" | "capabilityBytes" | "canonicalRequestDigest" | "limitSlots">): Buffer {
  return authorityCanonicalBytes({ v: "reelier.compiled-capability/v1", tenant:value.tenant,requester:value.requester,definitionAlias:value.definitionAlias,requestDigest:value.requestDigest,requestKey:value.requestKey,contractDigest:value.contractDigest,sourceBundleDigest:value.sourceBundleDigest,sourceSnapshotDigest:value.sourceSnapshotDigest,authorityStateDigest:value.authorityStateDigest,limits:value.limits,limitsDigest:value.limitsDigest,capabilityId:value.capabilityId,outcomeKey:value.outcomeKey,effectDigest:value.effectDigest,issuedAt:value.issuedAt,expiresAt:value.expiresAt });
}

async function tempRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "reelier-authority-ledger-"));
}

async function bindableTempRoot(): Promise<string> {
  for (let attempt = 0; attempt < 64; attempt++) {
    const root = await tempRoot();
    try { const probe = await bindFenceEndpoint(await derivedFenceBinding(root)); await closeServer(probe); return root; } catch (error) {
      await rm(root, { recursive: true, force: true });
      const code = (error as NodeJS.ErrnoException).code; if (code === "EADDRINUSE" || code === "EACCES") continue; throw error;
    }
  }
  throw new Error("could not allocate a bindable deterministically derived ledger root endpoint");
}

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await bindableTempRoot();
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

async function spawnReserve(root: string, candidate: ReservationIntent): Promise<unknown> {
  const moduleUrl = pathToFileURL(path.join(process.cwd(), "dist-test/src/authority/host/fs-ledger.js")).href;
  const encoded = Buffer.from(JSON.stringify({
    ...candidate,
    canonicalRequestBytes: Buffer.from(candidate.canonicalRequestBytes).toString("base64"),
    capabilityBytes: Buffer.from(candidate.capabilityBytes).toString("base64"),
  })).toString("base64");
  const source = `
    import { FsAuthorityLedger } from ${JSON.stringify(moduleUrl)};
    import { authenticateOutcomeRequest } from ${JSON.stringify(new URL("../../src/authority/keys.js", pathToFileURL(path.join(process.cwd(), "dist-test/test/authority/ledger.test.js"))).href)};
    const value = JSON.parse(Buffer.from(process.argv[1], "base64").toString("utf8"));
    value.canonicalRequestBytes = Buffer.from(value.canonicalRequestBytes, "base64");
    value.capabilityBytes = Buffer.from(value.capabilityBytes, "base64");
    const ledger = new FsAuthorityLedger(process.argv[2], { now: () => ${t0} });
    const authenticated=authenticateOutcomeRequest({tenant:value.tenant,requester:value.requester,definitionAlias:value.definitionAlias,request:JSON.parse(Buffer.from(value.canonicalRequestBytes).toString("utf8"))});
    const binding=await ledger.bindIngress(authenticated);if(!binding.ok){process.stdout.write(JSON.stringify(binding));process.exit(0);}value.ingressClaimDigest=binding.ingressClaimDigest;
    const result = await ledger.reserve(value);
    process.stdout.write(JSON.stringify(result));
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", source, encoded, root], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", chunk => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(`child ${code}: ${stderr}`)));
  });
}

async function rewriteJournal(root: string, mutate: (event: Record<string, unknown>) => Record<string, unknown>): Promise<void> {
  const journal = path.join(root, "journal");
  const names = (await readdir(journal)).sort();
  const events = await Promise.all(names.map(async name => JSON.parse(await readFile(path.join(journal, name), "utf8")) as Record<string, unknown>));
  for (const name of names) await unlink(path.join(journal, name));
  let previousDigest: string | null = null;
  for (const original of events) {
    const event = mutate({ ...original, previousDigest });
    const bytes = authorityCanonicalBytes(event);
    const eventDigest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const name = `${String(event.sequence).padStart(16, "0")}-${eventDigest.slice(7)}`;
    await writeFile(path.join(journal, name), bytes);
    previousDigest = eventDigest;
  }
}

async function readJournalEvents(root:string):Promise<Record<string,unknown>[]>{const journal=path.join(root,"journal"),names=(await readdir(journal)).sort();return Promise.all(names.map(async name=>JSON.parse(await readFile(path.join(journal,name),"utf8")) as Record<string,unknown>));}

async function snapshotDurableSubtrees(root:string,subtrees:readonly string[]):Promise<ReadonlyArray<Readonly<{name:string;bytes:string}>>>{const snapshot:Array<Readonly<{name:string;bytes:string}>>=[];const walk=async(directory:string,relative:string):Promise<void>=>{for(const entry of (await readdir(directory,{withFileTypes:true})).sort((left,right)=>left.name.localeCompare(right.name))){const child=path.join(directory,entry.name),name=path.posix.join(relative,entry.name);if(entry.isDirectory())await walk(child,name);else{assert.equal(entry.isFile(),true,`durable snapshot contains only regular files: ${name}`);snapshot.push({name,bytes:(await readFile(child)).toString("base64")});}}};for(const subtree of [...subtrees].sort())await walk(path.join(root,subtree),subtree);return snapshot;}
async function snapshotRootArtifacts(root:string):Promise<ReadonlyArray<Readonly<{name:string;type:"directory"|"file";bytes?:string}>>>{const snapshot:Array<Readonly<{name:string;type:"directory"|"file";bytes?:string}>>=[];const walk=async(directory:string,relative:string):Promise<void>=>{for(const entry of (await readdir(directory,{withFileTypes:true})).sort((left,right)=>left.name.localeCompare(right.name))){const child=path.join(directory,entry.name),name=path.posix.join(relative,entry.name);if(entry.isDirectory()){snapshot.push({name,type:"directory"});await walk(child,name);}else{assert.equal(entry.isFile(),true,`root snapshot contains only regular files: ${name}`);snapshot.push({name,type:"file",bytes:(await readFile(child)).toString("base64")});}}};await walk(root,"");return snapshot;}

async function commitRawBoundIntent(root:string):Promise<Readonly<{candidate:ReservationIntent;reservation:ReservationSnapshot}>>{const candidate=intent(),ledger=new RawFsAuthorityLedger(root,{now:()=>t0}),request=JSON.parse(Buffer.from(candidate.canonicalRequestBytes).toString("utf8")),authenticated=authenticateOutcomeRequest({tenant:candidate.tenant,requester:candidate.requester,definitionAlias:candidate.definitionAlias,request}),binding=await ledger.bindIngress(authenticated);assert.equal(binding.ok,true);if(!binding.ok)throw new Error("fixture ingress bind refused");const boundCandidate:ReservationIntent={...candidate,ingressClaimDigest:binding.ingressClaimDigest},created=await ledger.reserve(boundCandidate);assert.equal(created.ok,true);if(!created.ok)throw new Error("fixture reservation refused");return {candidate:boundCandidate,reservation:created.reservation};}

test("100 real processes converge on one committed reservation and one dispatch eligibility", { timeout: 120_000 }, async () => {
  await withRoot(async root => {
    const results = await Promise.all(Array.from({ length: 100 }, () => spawnReserve(root, intent())));
    const successes = results as Array<{ ok: boolean; status: string; dispatchEligible: boolean; reservation: { reservationId: string } }>;
    assert.equal(successes.every(result => result.ok), true, JSON.stringify(successes.filter(result => !result.ok)));
    assert.equal(new Set(successes.map(result => result.reservation.reservationId)).size, 1);
    assert.equal(successes.filter(result => result.dispatchEligible).length, 1);
    const recovered = await new FsAuthorityLedger(root, { now: () => t0 }).recover();
    assert.equal(recovered.ok, true);
    if (recovered.ok) assert.equal(recovered.reservations.length, 1);
  });
});

test("cross-process collisions use ingress, semantic, capability, then limit precedence", { timeout: 60_000 }, async () => {
  await withRoot(async root => {
    const first = intent();
    const identical = await Promise.all([spawnReserve(root, first), spawnReserve(root, first)]) as Array<{ ok: boolean; reservation: { reservationId: string } }>;
    assert.equal(identical[0].reservation.reservationId, identical[1].reservation.reservationId);

    const requestConflict = await spawnReserve(root, intent({
      canonicalRequestBytes: requestWireBytes("request_1", "different_ref"),
      outcomeKey: digest("8"),
      capabilityId: "capability_2",
    })) as { ok: boolean; reason: string };
    assert.deepEqual({ ok: requestConflict.ok, reason: requestConflict.reason }, { ok: false, reason: "conflict" });

    const semantic = await spawnReserve(root, intent({
      requestId: "request_2",
      capabilityId: "capability_3",
    })) as { ok: boolean; reason: string };
    assert.deepEqual({ ok: semantic.ok, reason: semantic.reason }, { ok: false, reason: "semantic-duplicate" });

    const capability = await spawnReserve(root, intent({
      requestId: "request_3",
      outcomeKey: digest("d"),
    })) as { ok: boolean; reason: string };
    assert.deepEqual({ ok: capability.ok, reason: capability.reason }, { ok: false, reason: "capability-integrity" });

    const limited = await Promise.all(["4", "5"].map((suffix, index) => spawnReserve(root, intent({
      requestId: `request_${suffix}`,
      outcomeKey: digest(index ? "8" : "7"), capabilityId: `capability_${suffix}`,
      limits: { maxEffectsPerWindow: 1, windowSeconds: 3600, maxEffectsPerSourceTrigger: 1, maxBodyBytes: 4096 },
      limitSlots: [{ kind: "contract-window", key: digest("f"), maximum: 1 }, { kind: "source-trigger", key: digest("e"), maximum: 1 }],
    })))) as Array<{ ok: boolean; reason?: string }>;
    assert.equal(limited.filter(result => result.ok).length, 1);
    assert.deepEqual(limited.find(result => !result.ok)?.reason, "limit-exceeded");
  });
});

test("the global ingress key treats a different authenticated definition alias as conflict", async () => {
  await withRoot(async root => {
    const ledger = new FsAuthorityLedger(root, { now: () => t0 });
    assert.equal((await ledger.reserve(intent({ definitionAlias: "definition_1" }))).ok, true);
    const recovered = new FsAuthorityLedger(root, { now: () => t0 });
    const retry = await recovered.reserve(intent({ definitionAlias: "definition_1" }));
    assert.equal(retry.ok && retry.status, "existing");
    const conflictRequest=authenticateOutcomeRequest({tenant:"tenant_1",requester:"requester_1",definitionAlias:"definition_2",request:{v:"reelier.outcome-request/v1",requestId:"request_1",sourceRefs:{source:"ref_1"},choices:{}}});
    const conflict = await recovered.bindIngress(conflictRequest);
    assert.equal(conflict.ok,false);if(!conflict.ok)assert.equal(conflict.reason,"conflict");
  });
});

test("a caller cannot widen an already committed fixed-window maximum", async () => {
  await withRoot(async root => {
    const ledger = new FsAuthorityLedger(root, { now: () => t0 });
    const shared = digest("f");
    assert.equal((await ledger.reserve(intent({ limits: { maxEffectsPerWindow: 1, windowSeconds: 3600, maxEffectsPerSourceTrigger: 1, maxBodyBytes: 4096 }, limitSlots: [{ kind: "contract-window", key: shared, maximum: 1 }, { kind: "source-trigger", key: digest("6"), maximum: 1 }] }))).ok, true);
    const widened = await ledger.reserve(intent({
      requestId: "request_widen",
      outcomeKey: digest("e"), capabilityId: "capability_widen",
      limits: { maxEffectsPerWindow: 100, windowSeconds: 3600, maxEffectsPerSourceTrigger: 1, maxBodyBytes: 4096 },
      limitSlots: [{ kind: "contract-window", key: shared, maximum: 100 }, { kind: "source-trigger", key: digest("7"), maximum: 1 }],
    }));
    assert.deepEqual(widened, { ok: false, reason: "limit-exceeded" });
  });
});

test("recovery binds every committed limit assignment one-to-one to its signed intent slot", async () => {
  const mutations: Array<[string, (assignments: Array<{ key: string; index: number; maximum: number }>) => Array<{ key: string; index: number; maximum: number }>]> = [
    ["different key", assignments => [{ ...assignments[0], key: digest("9") }, assignments[1]]],
    ["larger maximum", assignments => [{ ...assignments[0], maximum: assignments[0].maximum + 1 }, assignments[1]]],
    ["smaller maximum", assignments => [{ ...assignments[0], maximum: assignments[0].maximum - 1, index: 0 }, assignments[1]]],
    ["duplicate and missing key", assignments => [assignments[0], { ...assignments[1], key: assignments[0].key, maximum: assignments[0].maximum }]],
    ["missing assignment", assignments => assignments.slice(0, 1)],
    ["extra assignment", assignments => [...assignments, { key: digest("9"), index: 0, maximum: 1 }]],
    ["negative index", assignments => [{ ...assignments[0], index: -1 }, assignments[1]]],
    ["index equal to maximum", assignments => [{ ...assignments[0], index: assignments[0].maximum }, assignments[1]]],
    ["noncanonical assignment order", assignments => [...assignments].reverse()],
  ];
  for (const [name, mutate] of mutations) await withRoot(async root => {
    assert.equal((await new FsAuthorityLedger(root, { now: () => t0 }).reserve(intent())).ok, true);
    await rewriteJournal(root, event => {
      if (event.type !== "reserve") return event;
      const reservation = event.reservation as ReservationSnapshot;
      return { ...event, reservation: { ...reservation, limitAssignments: mutate(reservation.limitAssignments.map(value => ({ ...value }))) } };
    });
    assert.deepEqual(await new FsAuthorityLedger(root, { now: () => t0 }).recover(), { ok: false, reason: "corruption" }, name);
  });
});

test("recovery refuses every new sealed scalar and canonical capability disagreement", async () => {
  const scalarMutations = ["definitionAlias", "contractDigest", "sourceBundleDigest", "sourceSnapshotDigest", "authorityStateDigest", "limitsDigest"] as const;
  for (const field of scalarMutations) await withRoot(async root => {
    assert.equal((await new FsAuthorityLedger(root, { now: () => t0 }).reserve(intent())).ok, true);
    await rewriteJournal(root, event => {
      if (event.type !== "reserve") return event;
      const reservation = event.reservation as ReservationSnapshot;
      const stored = { ...reservation.intent, [field]: field === "definitionAlias" ? "different_definition" : digest("9") };
      return { ...event, reservation: { ...reservation, intent: stored } };
    });
    assert.deepEqual(await new FsAuthorityLedger(root, { now: () => t0 }).recover(), { ok: false, reason: "corruption" }, field);
  });
  await withRoot(async root => {
    assert.equal((await new FsAuthorityLedger(root, { now: () => t0 }).reserve(intent())).ok, true);
    await rewriteJournal(root, event => {
      if (event.type !== "reserve") return event;
      const reservation = event.reservation as ReservationSnapshot;
      const capability = JSON.parse(Buffer.from(reservation.intent.capabilityBase64, "base64").toString("utf8"));
      capability.sourceSnapshotDigest = digest("9");
      return { ...event, reservation: { ...reservation, intent: { ...reservation.intent, capabilityBase64: authorityCanonicalBytes(capability).toString("base64") } } };
    });
    assert.deepEqual(await new FsAuthorityLedger(root, { now: () => t0 }).recover(), { ok: false, reason: "corruption" });
  });
});

test("transition timestamps are stamped from the single durable kernel observation", async () => {
  await withRoot(async root => {
    let now = t0;
    let transitionClockReads = 0;
    const ledger = new FsAuthorityLedger(root, { now: () => {
      if (now === t0) return now;
      transitionClockReads++;
      return now;
    } });
    const created = await ledger.reserve(intent());
    assert.equal(created.ok, true);
    if (!created.ok) return;
    now = t0 + 10;
    const transitioned = await ledger.transition(created.reservation.reservationId, "reserved", { to: "dispatched" });
    assert.equal(transitioned.ok, true);
    if (!transitioned.ok) return;
    assert.equal(transitionClockReads, 1);
    assert.equal(transitioned.reservation.updatedAt, new Date(t0 + 10).toISOString());
    assert.equal((await ledger.getHighWaterMark()).observedAt, transitioned.reservation.updatedAt);
  });
});

test("reservation time is stamped from the single durable kernel observation", async () => {
  await withRoot(async root => {
    let reads = 0;
    const ledger = new FsAuthorityLedger(root, { now: () => t0 + reads++ });
    const created = await ledger.reserve(intent());
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(reads, 1);
    assert.equal(created.reservation.updatedAt, new Date(t0).toISOString());
    assert.equal((await ledger.getHighWaterMark()).observedAt, created.reservation.updatedAt);
  });
});

test("recovery refuses a recomputed reservation timestamp that differs from durable high-water time", async () => {
  await withRoot(async root => {
    assert.equal((await new FsAuthorityLedger(root, { now: () => t0 }).reserve(intent())).ok, true);
    await rewriteJournal(root, event => {
      if (event.type !== "reserve") return event;
      const reservation = event.reservation as ReservationSnapshot;
      return { ...event, reservation: { ...reservation, updatedAt: new Date(t0 + 1).toISOString() } };
    });
    assert.deepEqual(await new FsAuthorityLedger(root, { now: () => t0 }).recover(), { ok: false, reason: "corruption" });
  });
});

test("recovery refuses recomputed transition timestamps that differ from durable high-water time", async () => {
  for (const offset of [-1, 1]) await withRoot(async root => {
    const ledger = new FsAuthorityLedger(root, { now: () => t0 });
    const created = await ledger.reserve(intent());
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal((await ledger.transition(created.reservation.reservationId, "reserved", { to: "dispatched" })).ok, true);
    await rewriteJournal(root, event => event.type === "transition" ? { ...event, at: new Date(t0 + offset).toISOString() } : event);
    assert.deepEqual(await new FsAuthorityLedger(root, { now: () => t0 }).recover(), { ok: false, reason: "corruption" }, String(offset));
  });
});

test("clock rollback recovery makes dispatched work ambiguous at the durable high-water instant", async () => {
  await withRoot(async root => {
    let now = t0;
    const ledger = new FsAuthorityLedger(root, { now: () => now });
    const created = await ledger.reserve(intent());
    assert.equal(created.ok, true);
    if (!created.ok) return;
    now = t0 + 10;
    assert.equal((await ledger.transition(created.reservation.reservationId, "reserved", { to: "dispatched" })).ok, true);
    const recovered = await new FsAuthorityLedger(root, { now: () => t0 - 1 }).recover();
    assert.equal(recovered.ok, true);
    if (!recovered.ok) return;
    assert.equal(recovered.reservations[0].state, "ambiguous");
    assert.equal(recovered.reservations[0].updatedAt, new Date(t0 + 10).toISOString());
    assert.equal(recovered.highWaterMark, new Date(t0 + 10).toISOString());
  });
});

test("result digest presence is enforced by target state before journal mutation", async () => {
  const cases = [
    { target: "dispatched", digest: digest("a"), valid: false },
    { target: "ambiguous", digest: digest("a"), valid: false },
    { target: "acknowledged", digest: undefined, valid: false },
    { target: "acknowledged", digest: digest("0"), valid: false },
    { target: "definitive-failure", digest: undefined, valid: false },
    { target: "definitive-failure", digest: digest("0"), valid: false },
    { target: "reconciled", digest: undefined, valid: false },
    { target: "reconciled", digest: digest("0"), valid: false },
  ] as const;
  for (const value of cases) await withRoot(async root => {
    const ledger = new FsAuthorityLedger(root, { now: () => t0 });
    const created = await ledger.reserve(intent());
    assert.equal(created.ok, true);
    if (!created.ok) return;
    let expected: LedgerState = "reserved";
    if (value.target !== "dispatched") {
      assert.equal((await ledger.transition(created.reservation.reservationId, "reserved", { to: "dispatched" })).ok, true);
      expected = "dispatched";
      if (value.target === "reconciled") {
        assert.equal((await ledger.transition(created.reservation.reservationId, "dispatched", { to: "acknowledged", resultDigest: digest("a") })).ok, true);
        expected = "acknowledged";
      }
    }
    const before = await readdir(path.join(root, "journal"));
    const invalidEvent = {
      to: value.target,
      ...(value.digest === undefined ? {} : { resultDigest: value.digest }),
    } as unknown as TransitionEvent;
    const result = await ledger.transition(created.reservation.reservationId, expected, invalidEvent);
    assert.deepEqual(result, { ok: false, reason: "corruption" }, value.target);
    assert.deepEqual(await readdir(path.join(root, "journal")), before, `${value.target} mutated the journal`);
  });
});

test("replay refuses target-specific result digest violations after canonical journal rewriting", async () => {
  const cases = [
    { target: "dispatched", resultDigest: digest("a") },
    { target: "ambiguous", resultDigest: digest("a") },
    { target: "acknowledged", resultDigest: undefined },
    { target: "definitive-failure", resultDigest: undefined },
    { target: "acknowledged", resultDigest: digest("0") },
    { target: "reconciled", resultDigest: undefined },
    { target: "reconciled", resultDigest: digest("0") },
  ] as const;
  for (const value of cases) await withRoot(async root => {
    const ledger = new FsAuthorityLedger(root, { now: () => t0 });
    const created = await ledger.reserve(intent());
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal((await ledger.transition(created.reservation.reservationId, "reserved", { to: "dispatched" })).ok, true);
    if (value.target === "reconciled") {
      assert.equal((await ledger.transition(created.reservation.reservationId, "dispatched", { to: "acknowledged", resultDigest: digest("a") })).ok, true);
      assert.equal((await ledger.transition(created.reservation.reservationId, "acknowledged", { to: "reconciled", resultDigest: digest("b") })).ok, true);
    } else if (value.target !== "dispatched") {
      const validEvent: TransitionEvent = value.target === "ambiguous"
        ? { to: "ambiguous" }
        : { to: value.target, resultDigest: digest("a") };
      assert.equal((await ledger.transition(created.reservation.reservationId, "dispatched", validEvent)).ok, true);
    }
    await rewriteJournal(root, event => event.type === "transition" && event.to === value.target
      ? { ...event, ...(value.resultDigest === undefined ? { resultDigest: undefined } : { resultDigest: value.resultDigest }) }
      : event);
    assert.deepEqual(await new FsAuthorityLedger(root, { now: () => t0 }).recover(), { ok: false, reason: "corruption" }, value.target);
  });
});

test("verified reservation history preserves distinct acknowledgement and reconciliation evidence immutably", async () => {
  await withRoot(async root => {
    let now = t0;
    const ledger = new FsAuthorityLedger(root, { now: () => now });
    const created = await ledger.reserve(intent());
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const id = created.reservation.reservationId;
    now += 1;
    assert.equal((await ledger.transition(id, "reserved", { to: "dispatched" })).ok, true);
    now += 1;
    assert.equal((await ledger.transition(id, "dispatched", { to: "acknowledged", resultDigest: digest("a") })).ok, true);
    now += 1;
    assert.equal((await ledger.transition(id, "acknowledged", { to: "reconciled", resultDigest: digest("b") })).ok, true);
    const historyLedger = ledger as unknown as { getReservationHistory(reservationId: string): Promise<{
      reservation: ReservationSnapshot;
      entries: ReadonlyArray<{ sequence: number; from: LedgerState; to: LedgerState; at: string; eventDigest: string; resultDigest?: string }>;
    } | undefined> };
    const history = await historyLedger.getReservationHistory(id);
    assert.ok(history);
    assert.deepEqual(history.entries.map(entry => ({ from: entry.from, to: entry.to, at: entry.at, resultDigest: entry.resultDigest })), [
      { from: "issued", to: "reserved", at: new Date(t0).toISOString(), resultDigest: undefined },
      { from: "reserved", to: "dispatched", at: new Date(t0 + 1).toISOString(), resultDigest: undefined },
      { from: "dispatched", to: "acknowledged", at: new Date(t0 + 2).toISOString(), resultDigest: digest("a") },
      { from: "acknowledged", to: "reconciled", at: new Date(t0 + 3).toISOString(), resultDigest: digest("b") },
    ]);
    assert.equal(history.entries.every(entry => /^sha256:[0-9a-f]{64}$/.test(entry.eventDigest)), true);
    assert.equal(Object.isFrozen(history), true);
    assert.equal(Object.isFrozen(history.entries), true);
    assert.equal(Object.isFrozen(history.entries[0]), true);
    assert.throws(() => { (history.entries[0] as { at: string }).at = "changed"; }, TypeError);
    assert.deepEqual(await historyLedger.getReservationHistory(id), history);
  });
});

test("identical ingress bytes with a different transaction digest reuse the committed reservation without dispatch eligibility", async () => {
  await withRoot(async root => {
    const ledger = new FsAuthorityLedger(root, { now: () => t0 });
    const first = await ledger.reserve(intent());
    assert.equal(first.ok, true);
    if (!first.ok) return;
    const divergent = intent({
      capabilityId: "different_capability",
      outcomeKey: digest("e"),
      effectDigest: digest("f"),
    });
    const retry = await ledger.reserve(divergent);
    assert.equal(retry.ok, true);
    if (!retry.ok) return;
    assert.equal(retry.status, "existing");
    assert.equal(retry.dispatchEligible, false);
    assert.equal(retry.reservation.reservationId, first.reservation.reservationId);
    assert.deepEqual(await ledger.reserve(divergent), retry, "the redundant transaction resolution must be durable");
    const recovered = await ledger.recover();
    assert.equal(recovered.ok, true);
    if (recovered.ok) assert.equal(recovered.reservations.length, 1);
  });
});

test("reservation scalar identities must equal the closed canonical request and capability preimages", async () => {
  const mutations: Array<[string, (value: ReservationIntent) => ReservationIntent]> = [
    ["definitionAlias", value => ({ ...value, definitionAlias: "detached_definition" })],
    ["requestDigest", value => ({ ...value, requestDigest: digest("8") })],
    ["requestId", value => ({ ...value, requestId: "detached_request" })],
    ["requestKey", value => ({ ...value, requestKey: digest("8") })],
    ["capabilityId", value => ({ ...value, capabilityId: "detached_capability" })],
    ["contractDigest", value => ({ ...value, contractDigest: digest("8") })],
    ["sourceBundleDigest", value => ({ ...value, sourceBundleDigest: digest("8") })],
    ["sourceSnapshotDigest", value => ({ ...value, sourceSnapshotDigest: digest("8") })],
    ["authorityStateDigest", value => ({ ...value, authorityStateDigest: digest("8") })],
    ["decisionContextDigest", value => ({ ...value, decisionContextDigest: "sha256:" + "0".repeat(64) })],
    ["limits", value => ({ ...value, limits: { ...value.limits!, maxBodyBytes: value.limits!.maxBodyBytes + 1 } })],
    ["limitsDigest", value => ({ ...value, limitsDigest: digest("8") })],
    ["outcomeKey", value => ({ ...value, outcomeKey: digest("8") })],
    ["effectDigest", value => ({ ...value, effectDigest: digest("8") })],
    ["issuedAt", value => ({ ...value, issuedAt: new Date(t0 + 1).toISOString(), expiresAt: new Date(t0 + CAPABILITY_LIFETIME_MS + 1).toISOString() })],
    ["expiresAt", value => ({ ...value, issuedAt: new Date(t0 - 1).toISOString(), expiresAt: new Date(t0 + CAPABILITY_LIFETIME_MS - 1).toISOString() })],
  ];
  for (const [field, mutate] of mutations) await withRoot(async root => {
    assert.deepEqual(await new FsAuthorityLedger(root, { now: () => t0 }).reserve(mutate(intent())), { ok: false, reason: "integrity-failure" }, field);
  });
  for (const [label, limitSlots] of [
    ["missing source-trigger", [{ kind: "contract-window", key: digest("5"), maximum: 2 }]],
    ["wrong order", [{ kind: "source-trigger", key: digest("6"), maximum: 1 }, { kind: "contract-window", key: digest("5"), maximum: 2 }]],
    ["widened maximum", [{ kind: "contract-window", key: digest("5"), maximum: 3 }, { kind: "source-trigger", key: digest("6"), maximum: 1 }]],
  ] as const) await withRoot(async root => {
    assert.deepEqual(await new FsAuthorityLedger(root, { now: () => t0 }).reserve(intent({ limitSlots })), { ok: false, reason: "integrity-failure" }, label);
  });
  await withRoot(async root => {
    const noncanonicalRequest = Buffer.from(JSON.stringify({ requestId: "request_1", v: "reelier.outcome-request/v1", sourceRefs: { source: "ref_1" }, choices: {} }));
    assert.deepEqual(await new FsAuthorityLedger(root, { now: () => t0 }).reserve(intent({ canonicalRequestBytes: noncanonicalRequest })), { ok: false, reason: "integrity-failure" });
  });
  await withRoot(async root => {
    const extraCapability = authorityCanonicalBytes({ v: "reelier.compiled-capability/v1", capabilityId: "capability_1", requestKey: digest("7"), outcomeKey: digest("3"), effectDigest: digest("4"), issuedAt: new Date(t0).toISOString(), expiresAt: new Date(t0 + CAPABILITY_LIFETIME_MS).toISOString(), extra: true });
    assert.deepEqual(await new FsAuthorityLedger(root, { now: () => t0 }).reserve(intent({ capabilityBytes: extraCapability })), { ok: false, reason: "integrity-failure" });
  });
});

test("lifetime boundaries and monotonic wall-clock high-water are exact", async () => {
  await withRoot(async root => {
    let now = t0 - 1;
    const ledger = new FsAuthorityLedger(root, { now: () => now });
    assert.deepEqual(await ledger.reserve(intent()), { ok: false, reason: "not-yet-valid" });
    now = t0;
    const reserved = await ledger.reserve(intent());
    assert.equal(reserved.ok, true);
    if (!reserved.ok) return;
    now = t0 + CAPABILITY_LIFETIME_MS;
    assert.deepEqual(await ledger.transition(reserved.reservation.reservationId, "reserved", { to: "dispatched" }), { ok: false, reason: "expired" });
    now = t0 - 1;
    assert.deepEqual(await ledger.reserve(intent({ requestId: "rollback" })), { ok: false, reason: "clock-rollback" });
    now = t0;
    assert.equal((await ledger.getHighWaterMark()).observedAt, new Date(t0).toISOString());
  });
  await withRoot(async root => {
    const ledger = new FsAuthorityLedger(root, { now: () => t0 + CAPABILITY_LIFETIME_MS });
    assert.deepEqual(await ledger.reserve(intent()), { ok: false, reason: "expired" });
  });
});

test("equal-time reservations reuse one durable high-water instant",async()=>{
  await withRoot(async root=>{
    const first=await new FsAuthorityLedger(root,{now:()=>t0}).reserve(intent());
    assert.equal(first.ok,true);if(!first.ok)return;
    const highWaterFaults:string[]=[];
    const secondIntent=intent({requestId:"request_2",capabilityId:"capability_2",outcomeKey:digest("8"),effectDigest:digest("9"),sourceBundleDigest:digest("e"),sourceSnapshotDigest:digest("f"),limitSlots:[{kind:"contract-window",key:digest("5"),maximum:2},{kind:"source-trigger",key:digest("2"),maximum:1}]});
    const second=await new FsAuthorityLedger(root,{now:()=>t0,faultInjector:point=>{if(point==="reservation-before-clock-high-water-write"||point==="reservation-after-clock-high-water-write")highWaterFaults.push(point);}}).reserve(secondIntent);
    assert.equal(second.ok,true);if(!second.ok)return;
    assert.equal(first.status,"reserved");assert.equal(first.dispatchEligible,true);
    assert.equal(second.status,"reserved");assert.equal(second.dispatchEligible,true);
    assert.notEqual(first.reservation.reservationId,second.reservation.reservationId,"distinct valid intents commit distinct reservations");
    const events=await readJournalEvents(root);
    assert.deepEqual(events.map(event=>event.type),["clock","reserve","reserve"]);
    assert.equal(events.filter(event=>event.type==="clock").length,1);
    assert.equal(first.reservation.updatedAt,new Date(t0).toISOString());
    assert.equal(second.reservation.updatedAt,new Date(t0).toISOString());
    assert.equal((await new FsAuthorityLedger(root,{now:()=>t0}).getHighWaterMark()).observedAt,new Date(t0).toISOString());
    assert.deepEqual(highWaterFaults,[],"equal durable time fires no reservation high-water write hooks");
  });
});

test("same-time exact committed retry returns before every durable reservation write",async()=>{
  await withRoot(async root=>{
    const candidate=intent(),first=await new FsAuthorityLedger(root,{now:()=>t0}).reserve(candidate);
    assert.equal(first.ok,true);if(!first.ok)return;
    const subtrees=["journal","transactions","claims","tombstones"] as const,before=await snapshotDurableSubtrees(root,subtrees),faults:string[]=[];
    const retry=await new FsAuthorityLedger(root,{now:()=>t0,faultInjector:point=>{if((reservationFaultPoints as readonly string[]).includes(point))faults.push(point);}}).reserve(candidate);
    assert.deepEqual(retry,{ok:true,status:"existing",dispatchEligible:false,reservation:first.reservation});
    assert.deepEqual(faults,["after-lock-acquire"],"exact committed retry reaches no clock, transaction, claim, or commit write boundary");
    assert.deepEqual(await snapshotDurableSubtrees(root,subtrees),before,"exact committed retry leaves every durable reservation subtree byte-identical");
  });
});

test("later-time exact committed retry advances only durable high-water",async()=>{
  await withRoot(async root=>{
    const candidate=intent(),first=await new FsAuthorityLedger(root,{now:()=>t0}).reserve(candidate);
    assert.equal(first.ok,true);if(!first.ok)return;
    const immutableSubtrees=["transactions","claims","tombstones"] as const,before=await snapshotDurableSubtrees(root,immutableSubtrees),eventsBefore=await readJournalEvents(root),faults:string[]=[];
    const retry=await new FsAuthorityLedger(root,{now:()=>t0+1,faultInjector:point=>{if((reservationFaultPoints as readonly string[]).includes(point))faults.push(point);}}).reserve(candidate);
    assert.deepEqual(retry,{ok:true,status:"existing",dispatchEligible:false,reservation:first.reservation});
    assert.equal((await new FsAuthorityLedger(root,{now:()=>t0+1}).getHighWaterMark()).observedAt,new Date(t0+1).toISOString());
    const eventsAfter=await readJournalEvents(root);
    assert.deepEqual(eventsAfter.map(event=>event.type),[...eventsBefore.map(event=>event.type),"clock"],"later exact retry appends exactly one clock event");
    assert.deepEqual(await snapshotDurableSubtrees(root,immutableSubtrees),before,"later exact retry does not touch transaction, claim, or tombstone bytes");
    assert.deepEqual(faults.filter(point=>point.includes("clock-high-water-write")),["reservation-before-clock-high-water-write","reservation-after-clock-high-water-write"]);
    assert.equal(faults.filter(point=>point==="reservation-before-create").length,1,"only the due clock event reaches immutable create");
    assert.equal(faults.some(point=>point.includes("claim-acquisition")||point.includes("commit-marker")),false);
  });
});

test("exact committed retry preserves prepare and validity refusal precedence",async t=>{
  const durableSubtrees=["ingress","journal","transactions","claims","tombstones"] as const;
  const assertClosedRetry=async(root:string,candidate:ReservationIntent,now:number,expected:Readonly<{ok:false;reason:string}>):Promise<void>=>{const before=await snapshotDurableSubtrees(root,durableSubtrees),result=await new RawFsAuthorityLedger(root,{now:()=>now}).reserve(candidate);assert.deepEqual(result,expected);assert.deepEqual(await snapshotDurableSubtrees(root,durableSubtrees),before,"refused exact retry performs no further durable mutation");};

  await t.test("expiry at the exact exclusive boundary",()=>withRoot(async root=>{const {candidate}=await commitRawBoundIntent(root);await assertClosedRetry(root,candidate,Date.parse(candidate.expiresAt),{ok:false,reason:"expired"});}));

  await t.test("rollback after a durable high-water advance",()=>withRoot(async root=>{const {candidate}=await commitRawBoundIntent(root),advanced=await new RawFsAuthorityLedger(root,{now:()=>t0+1}).observeClock();assert.deepEqual(advanced,{ok:true,status:"advanced",observedAt:new Date(t0+1).toISOString()});await assertClosedRetry(root,candidate,t0,{ok:false,reason:"clock-rollback"});}));

  for(const mutation of ["missing","tampered"] as const)await t.test(`${mutation} bound ingress`,()=>withRoot(async root=>{const {candidate}=await commitRawBoundIntent(root),ingressPath=path.join(root,"ingress",`${candidate.requestKey.slice(7)}.json`);if(mutation==="missing")await unlink(ingressPath);else{const stored=JSON.parse(await readFile(ingressPath,"utf8"));await writeFile(ingressPath,authorityCanonicalBytes({...stored,definitionAlias:"tampered_definition"}));}await assertClosedRetry(root,candidate,t0,{ok:false,reason:"corruption"});}));

  await t.test("corrupt committed claim",()=>withRoot(async root=>{const {candidate}=await commitRawBoundIntent(root),claims=path.join(root,"claims"),claim=(await readdir(claims)).sort()[0];await writeFile(path.join(claims,claim),"{");await assertClosedRetry(root,candidate,t0,{ok:false,reason:"corruption"});}));

  await t.test("corrupt committed journal",()=>withRoot(async root=>{const {candidate}=await commitRawBoundIntent(root),journal=path.join(root,"journal"),event=(await readdir(journal)).sort().at(-1)!;await writeFile(path.join(journal,event),"{");await assertClosedRetry(root,candidate,t0,{ok:false,reason:"corruption"});}));

  await t.test("committed transaction cannot coexist with a valid tombstone",()=>withRoot(async root=>{const {candidate,reservation}=await commitRawBoundIntent(root),transactionDigest=reservation.reservationId;await writeFile(path.join(root,"tombstones",transactionDigest.slice(7)),authorityCanonicalBytes({v:"reelier.authority-ledger-tombstone/v1",transactionDigest,reason:"semantic-duplicate"}));await assertClosedRetry(root,candidate,t0,{ok:false,reason:"corruption"});}));
});

test("transition is durable compare-and-transition over the exact legal graph", async () => {
  await withRoot(async root => {
    let now = t0;
    const ledger = new FsAuthorityLedger(root, { now: () => now });
    const created = await ledger.reserve(intent());
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const id = created.reservation.reservationId;
    assert.equal((await ledger.transition(id, "reserved", { to: "dispatched" })).ok, true);
    assert.deepEqual(await ledger.transition(id, "reserved", { to: "dispatched" }), { ok: false, reason: "state-conflict" });
    assert.deepEqual(await ledger.transition(id, "dispatched", { to: "reconciled", resultDigest: digest("a") }), { ok: false, reason: "illegal-transition" });
    assert.equal((await ledger.transition(id, "dispatched", { to: "acknowledged", resultDigest: digest("a") })).ok, true);
    assert.equal((await ledger.transition(id, "acknowledged", { to: "reconciled", resultDigest: digest("b") })).ok, true);
    assert.deepEqual(await ledger.transition(id, "reconciled", { to: "ambiguous" }), { ok: false, reason: "illegal-transition" });
    assert.equal((await ledger.getReservation(id))?.state, "reconciled");
  });

  const terminalTargets = ["acknowledged", "definitive-failure", "ambiguous"] as const;
  for (const target of terminalTargets) await withRoot(async root => {
    const ledger = new FsAuthorityLedger(root, { now: () => t0 });
    const created = await ledger.reserve(intent({ requestId: `for_${target}` }));
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const id = created.reservation.reservationId;
    assert.equal((await ledger.transition(id, "reserved", { to: "dispatched" })).ok, true);
    const event = target === "ambiguous" ? { to: target } : { to: target, resultDigest: digest("a") };
    assert.equal((await ledger.transition(id, "dispatched", event)).ok, true);
  });
});

test("recovery turns a durable dispatched reservation without a result into ambiguous", async () => {
  await withRoot(async root => {
    const ledger = new FsAuthorityLedger(root, { now: () => t0 });
    const created = await ledger.reserve(intent());
    assert.equal(created.ok, true);
    if (!created.ok) return;
    await ledger.transition(created.reservation.reservationId, "reserved", { to: "dispatched" });
    const recovered = await new FsAuthorityLedger(root, { now: () => t0 }).recover();
    assert.equal(recovered.ok, true);
    if (recovered.ok) assert.equal(recovered.reservations[0].state, "ambiguous");
  });
});

test("caller-owned bytes and returned snapshots are detached and immutable", async () => {
  await withRoot(async root => {
    const requestBytes = requestWireBytes("request_1");
    const capabilityBytes = capabilityWireBytes(intent());
    const requestBase64 = requestBytes.toString("base64");
    const capabilityBase64 = capabilityBytes.toString("base64");
    const slots = [{ kind: "contract-window" as const, key: digest("5"), maximum: 2 }, { kind: "source-trigger" as const, key: digest("6"), maximum: 1 }];
    const ledger = new FsAuthorityLedger(root, { now: () => t0 });
    const created = await ledger.reserve(intent({ canonicalRequestBytes: requestBytes, capabilityBytes, limitSlots: slots }));
    assert.equal(created.ok, true);
    if (!created.ok) return;
    requestBytes.fill(0); capabilityBytes.fill(0); slots[0].maximum = 999;
    const reread = await ledger.getReservation(created.reservation.reservationId);
    assert.equal(reread?.intent.canonicalRequestBase64, requestBase64);
    assert.equal(reread?.intent.capabilityBase64, capabilityBase64);
    assert.equal(reread?.intent.limitSlots[0].maximum, 2);
    assert.equal(Object.isFrozen(reread), true);
    assert.equal(Object.isFrozen(reread?.intent.limitSlots), true);
  });
});

test("faults at every durable reservation and transition point recover to prior state or safe committed state", { timeout: 120_000 }, async () => {
  const classified = [...reservationFaultPoints, ...dispatchFaultPoints, ...resultFaultPoints, ...ingressFaultPoints, ...clockFaultPoints, ...ledgerLockFaultPoints];
  assert.equal(new Set(classified).size, classified.length, "each fault point belongs to exactly one operation");
  assert.deepEqual([...classified].sort(), [...ledgerFaultPoints].sort(), "new fault points require an explicit operation classification");

  for (const point of reservationFaultPoints) await withRoot(async root => {
    let fired = false;
    const crashing = new FsAuthorityLedger(root, { now: () => t0, faultInjector: (observed: string) => {
      if (!fired && observed === point) { fired = true; throw new Error(`fault:${point}`); }
    } });
    try { await crashing.reserve(intent()); } catch (error) { assert.match(String(error), /fault:/); }
    assert.equal(fired, true, point);
    const recovered = await new FsAuthorityLedger(root, { now: () => t0 }).recover();
    if (!recovered.ok) assert.equal(recovered.reason, "corruption");
    else {
      assert.ok(recovered.reservations.length <= 1);
      if (recovered.reservations[0]) assert.equal(recovered.reservations[0].state, "reserved");
    }
  });

  for (const point of dispatchFaultPoints) await withRoot(async root => {
    const setup = new FsAuthorityLedger(root, { now: () => t0 });
    const created = await setup.reserve(intent());
    assert.equal(created.ok, true);
    if (!created.ok) return;
    let fired = false;
    const crashing = new FsAuthorityLedger(root, { now: () => t0 + 1, faultInjector: (observed: string) => {
      if (!fired && observed === point) { fired = true; throw new Error(`fault:${point}`); }
    } });
    try { await crashing.transition(created.reservation.reservationId, "reserved", { to: "dispatched" }); } catch (error) { assert.match(String(error), /fault:/); }
    assert.equal(fired, true, point);
    const recovered = await new FsAuthorityLedger(root, { now: () => t0 + 1 }).recover();
    if (recovered.ok) assert.ok(["reserved", "ambiguous"].includes(recovered.reservations[0].state));
    else assert.equal(recovered.reason, "corruption");
  });

  for (const point of resultFaultPoints) await withRoot(async root => {
    let setupNow=t0;
    const setup = new FsAuthorityLedger(root, { now: () => setupNow });
    const created = await setup.reserve(intent());
    assert.equal(created.ok, true);
    if (!created.ok) return;
    setupNow=t0+1;
    await setup.transition(created.reservation.reservationId, "reserved", { to: "dispatched" });
    let fired = false;
    const crashing = new FsAuthorityLedger(root, { now: () => t0 + 2, faultInjector: (observed: string) => {
      if (!fired && observed === point) { fired = true; throw new Error(`fault:${point}`); }
    } });
    try { await crashing.transition(created.reservation.reservationId, "dispatched", { to: "acknowledged", resultDigest: digest("a") }); } catch (error) { assert.match(String(error), /fault:/); }
    assert.equal(fired, true, point);
    const recovered = await new FsAuthorityLedger(root, { now: () => t0 + 2 }).recover();
    if (recovered.ok) assert.ok(["ambiguous", "acknowledged"].includes(recovered.reservations[0].state));
    else assert.equal(recovered.reason, "corruption");
  });
});

test("corruption, truncation, journal gaps, digest mismatch, traversal, and symlinks refuse", async () => {
  await withRoot(async root => {
    const ledger = new FsAuthorityLedger(root, { now: () => t0 });
    const created = await ledger.reserve(intent());
    assert.equal(created.ok, true);
    const journal = path.join(root, "journal");
    const [entry] = await readdir(journal);
    await writeFile(path.join(journal, entry), "{");
    assert.deepEqual(await new FsAuthorityLedger(root, { now: () => t0 }).recover(), { ok: false, reason: "corruption" });
  });
  await withRoot(async root => {
    const ledger = new FsAuthorityLedger(root, { now: () => t0 });
    assert.equal((await ledger.reserve(intent())).ok, true);
    const claims = path.join(root, "claims");
    const [claim] = await readdir(claims);
    await unlink(path.join(claims, claim));
    assert.deepEqual(await new FsAuthorityLedger(root, { now: () => t0 }).recover(), { ok: false, reason: "corruption" });
  });
  await withRoot(async root => {
    const ledger = new FsAuthorityLedger(root, { now: () => t0 });
    assert.equal((await ledger.reserve(intent())).ok, true);
    const claims = path.join(root, "claims");
    const [claim] = await readdir(claims);
    const original = await readFile(path.join(claims, claim), "utf8");
    const withExtra = original.replace(',"transactionDigest"', ',"extra":true,"transactionDigest"');
    await writeFile(path.join(claims, claim), withExtra);
    assert.deepEqual(await new FsAuthorityLedger(root, { now: () => t0 }).recover(), { ok: false, reason: "corruption" });
  });
  await withRoot(async root => {
    const ledger = new FsAuthorityLedger(root, { now: () => t0 });
    assert.equal((await ledger.reserve(intent())).ok, true);
    const journal = path.join(root, "journal");
    const [entry] = await readdir(journal);
    const [prefix] = entry.split("-");
    await rename(path.join(journal, entry), path.join(journal, `${prefix}-${"f".repeat(64)}`));
    assert.deepEqual(await new FsAuthorityLedger(root, { now: () => t0 }).recover(), { ok: false, reason: "corruption" });
  });
  await withRoot(async root => {
    await mkdir(path.join(root, "journal"), { recursive: true });
    await writeFile(path.join(root, "journal", `0000000000000002-${"a".repeat(64)}`), "{}\n");
    assert.deepEqual(await new FsAuthorityLedger(root, { now: () => t0 }).recover(), { ok: false, reason: "corruption" });
  });
  await withRoot(async root => {
    assert.throws(() => new FsAuthorityLedger(path.join(root, "..", "escape"), { now: () => t0 }), /root|exist|directory/i);
  });
  await withRoot(async root => {
    const outside = await tempRoot();
    try {
      await symlink(outside, path.join(root, "journal"), process.platform === "win32" ? "junction" : "dir");
      assert.deepEqual(await new FsAuthorityLedger(root, { now: () => t0 }).recover(), { ok: false, reason: "corruption" });
    } finally { await rm(outside, { recursive: true, force: true }); }
  });
});

test("clean-root recovery is empty and topology makes directory-sync honesty explicit", async () => {
  await withRoot(async root => {
    const recovered = await new FsAuthorityLedger(root, { now: () => t0 }).recover();
    assert.equal(recovered.ok, true);
    if (recovered.ok) {
      assert.deepEqual(recovered.reservations, []);
      assert.equal(recovered.topology.directorySync, process.platform === "win32" ? "best-effort" : "verified");
    }
  });
});

test("pre-release v1 transaction records fail closed without inferred migration", async () => {
  await withRoot(async root => {
    assert.equal((await new FsAuthorityLedger(root, { now: () => t0 }).recover()).ok, true);
    const bytes = authorityCanonicalBytes({ v: "reelier.authority-ledger-transaction/v1", intent: {} });
    const name = createHash("sha256").update(bytes).digest("hex");
    await writeFile(path.join(root, "transactions", name), bytes);
    assert.deepEqual(await new FsAuthorityLedger(root, { now: () => t0 }).recover(), { ok: false, reason: "corruption" });
  });
});

test("the process lock is bounded, never lease-stolen, and refuses foreign or corrupt owners", { timeout: 30_000 }, async () => {
  await withRoot(async root => {
    const lock = path.join(root, "lock");
    await mkdir(lock);
    const liveOwner = JSON.stringify({ host: hostname(), nonce: "a".repeat(64), pid: process.pid, v: 1 });
    await writeFile(path.join(lock, "owner.json"), liveOwner);
    const started = Date.now();
    const result = await new FsAuthorityLedger(root, { now: () => t0, lockTimeoutMs: 75 }).recover();
    assert.deepEqual(result, { ok: false, reason: "busy" });
    assert.ok(Date.now() - started < 2_000, "lock acquisition must be bounded");
    assert.equal(await readFile(path.join(lock, "owner.json"), "utf8"), liveOwner);
  });
  await withRoot(async root => {
    await mkdir(path.join(root, "lock"));
    await writeFile(path.join(root, "lock", "owner.json"), "{");
    assert.deepEqual(await new FsAuthorityLedger(root, { now: () => t0, lockTimeoutMs: 20 }).recover(), { ok: false, reason: "corruption" });
  });
  await withRoot(async root => {
    await mkdir(path.join(root, "lock"));
    await writeFile(path.join(root, "lock", "owner.json"), JSON.stringify({ host: "another-host", nonce: "b".repeat(64), pid: 999999, v: 1 }));
    assert.deepEqual(await new FsAuthorityLedger(root, { now: () => t0, lockTimeoutMs: 20 }).recover(), { ok: false, reason: "lock-owner-unverifiable" });
  });
});

test("ledger lock acquisition remains bounded when the ambient wall clock rolls backward",{timeout:10_000},async()=>{
  await withRoot(async root=>{
    const lock=path.join(root,"lock");await mkdir(lock);await writeFile(path.join(lock,"owner.json"),JSON.stringify({host:hostname(),nonce:"d".repeat(64),pid:process.pid,v:1}));
    const moduleUrl=pathToFileURL(path.resolve("dist-test/src/authority/host/fs-ledger.js")).href,run=promisify(execFile);
    const source='const {FsAuthorityLedger}=await import(process.argv[1]);let wall=1000;Date.now=()=>--wall;const result=await new FsAuthorityLedger(process.argv[2],{now:()=>1768478430000,lockTimeoutMs:1}).recover();process.stdout.write(JSON.stringify(result));';
    const output=await run(process.execPath,["--input-type=module","-e",source,moduleUrl,root],{timeout:2_000});assert.deepEqual(JSON.parse(output.stdout),{ok:false,reason:"busy"});
  });
});

test("volatile decisions-subtree audit retries never consult the ambient wall clock",async()=>{
  await withRoot(async root=>{
    await mkdir(path.join(root,"decisions"));const original=Date.now;let semanticClockCalls=0;Date.now=()=>{throw new Error("ambient wall clock consulted by retry deadline");};
    try{const result=await new RawFsAuthorityLedger(root,{now:()=>{semanticClockCalls++;return t0;},lockTimeoutMs:20}).recover();assert.equal(result.ok,true);assert.equal(semanticClockCalls,0,"recovery/audit has no legitimate semantic-time read");}
    finally{Date.now=original;}
  });
});

const ledgerLockDurabilityPoints=["after-owner-file-sync","after-lock-directory-sync","before-lock-retire","after-lock-retire"] as const;

async function seedDeadActiveLock(root:string):Promise<Readonly<{host:string;nonce:string;pid:number;v:1}>>{
  for(const name of await readdir(root))if(/^\.authority-ledger-lock-/.test(name))await rm(path.join(root,name),{recursive:true});
  const moduleUrl=pathToFileURL(path.resolve("dist-test/src/authority/host/fs-ledger.js")).href,source=`import {FsAuthorityLedger} from ${JSON.stringify(moduleUrl)};const ledger=new FsAuthorityLedger(process.argv[1],{now:()=>${t0},faultInjector(point){if(point==="after-lock-acquire")process.exit(91);}});await ledger.recover();process.exit(92);`;
  let childPid:number|undefined;
  const code=await new Promise<number|null>((resolve,reject)=>{const child=spawn(process.execPath,["--input-type=module","-e",source,root],{stdio:"ignore"});childPid=child.pid;child.on("error",reject);child.on("close",resolve);});
  assert.equal(code,91,"product child hard-exits only after acquiring its real ledger lock");
  assert.ok(Number.isSafeInteger(childPid));
  const ownerBytes=await readFile(path.join(root,"lock","owner.json")),owner=JSON.parse(ownerBytes.toString("utf8"));
  assert.deepEqual(Object.keys(owner).sort(),["host","nonce","pid","v"]);assert.deepEqual(ownerBytes,authorityCanonicalBytes(owner));assert.equal(owner.host,hostname());assert.equal(owner.pid,childPid);assert.match(owner.nonce,/^[0-9a-f]{64}$/);
  return owner;
}

type TestRetirementDisposition="released"|"recovery-pending"|"publication-aborted";
function retirementMarkerName(owner:Readonly<{pid:number;nonce:string}>,disposition:TestRetirementDisposition):string{return `.authority-ledger-lock-${owner.pid}-${owner.nonce}.${disposition}`;}
function cleanupAck(owner:Readonly<{host:string;nonce:string;pid:number;v:1}>,markerName:string,disposition:TestRetirementDisposition,journalHead:string|null){const closedOwner={host:owner.host,nonce:owner.nonce,pid:owner.pid,v:1 as const};return {disposition,journalHead,markerName,owner:closedOwner,ownerDigest:authorityDigest(closedOwner),v:"reelier.authority-ledger-lock-cleanup-ack/v1"};}
function cleanupAckName(ack:ReturnType<typeof cleanupAck>):string{return `.authority-ledger-lock-cleanup-${authorityDigest(ack).slice(7)}.ack`;}
function cleanupStageName(owner:Readonly<{pid:number;nonce:string}>,ack:ReturnType<typeof cleanupAck>):string{return `.authority-ledger-lock-cleanup-stage-${owner.pid}-${owner.nonce}-${authorityDigest(ack).slice(7)}.tmp`;}
function publicationHostDigest(host:string):string{return createHash("sha256").update(host,"utf8").digest("hex");}
type PublicationFixtureOwner=Readonly<{host:string;pid:number;nonce:string;ticket?:string}>;
function publicationTicket(owner:PublicationFixtureOwner):string{const ticket=owner.ticket??owner.pid.toString(16).padStart(16,"0");assert.match(ticket,/^[0-9a-f]{16}$/);return ticket;}
function publicationStageName(owner:PublicationFixtureOwner):string{return `.authority-ledger-lock-publication-${publicationHostDigest(owner.host)}-${publicationTicket(owner)}-${owner.pid}-${owner.nonce}.tmp`;}
function publicationOwnerBytes(owner:Readonly<{host:string;nonce:string;pid:number;v:1}>):Buffer{return authorityCanonicalBytes({host:owner.host,nonce:owner.nonce,pid:owner.pid,v:owner.v});}
async function writePublicationStage(root:string,owner:Readonly<{host:string;nonce:string;pid:number;v:1;ticket?:string}>,ownerBytes:Buffer|null):Promise<string>{const stage=path.join(root,publicationStageName(owner));await mkdir(stage);if(ownerBytes!==null)await writeFile(path.join(stage,"owner.json"),ownerBytes);return stage;}

async function writeAdmissionSlot(root:string,owner:Readonly<{host:string;nonce:string;pid:number;v:1}>):Promise<string>{const slot=path.join(root,".authority-ledger-admission-0");await mkdir(slot);await writeFile(path.join(slot,"owner.json"),publicationOwnerBytes(owner));return slot;}

test("one fixed admission slot bounds all paused publishers to one publication stage",{timeout:15_000},()=>withRoot(async root=>{
  const control=await tempRoot(),moduleUrl=pathToFileURL(path.resolve("dist-test/src/authority/host/fs-ledger.js")).href,source=`
    import {existsSync,writeFileSync} from "node:fs";
    import path from "node:path";
    import {FsAuthorityLedger} from ${JSON.stringify(moduleUrl)};
    const root=process.argv[1],control=process.argv[2],index=process.argv[3],wait=new Int32Array(new SharedArrayBuffer(4)),status=path.join(control,"status-"+index+".json");
    process.stdout.write("READY\\n");while(!existsSync(path.join(control,"go")))Atomics.wait(wait,0,0,5);
    let callbacks=0;const result=await new FsAuthorityLedger(root,{now:()=>${t0},lockTimeoutMs:500,faultInjector(point){if(point==="after-lock-publication-stage-sync"){writeFileSync(status,JSON.stringify({status:"staged",callbacks}));while(!existsSync(path.join(control,"release")))Atomics.wait(wait,0,0,5);}if(point==="before-ledger-operation-callback")callbacks++;}}).observeClock();
    writeFileSync(status,JSON.stringify({status:result.ok?result.status:result.reason,callbacks}));
  `;
  const children=Array.from({length:8},(_,index)=>spawn(process.execPath,["--input-type=module","-e",source,root,control,String(index)],{stdio:["ignore","pipe","ignore"]})),closed=children.map(child=>new Promise<void>((resolve,reject)=>{child.once("error",reject);child.once("close",()=>resolve());}));
  try{
    await Promise.all(children.map(child=>new Promise<void>((resolve,reject)=>{let output="";child.stdout!.setEncoding("utf8");child.stdout!.on("data",chunk=>{output+=chunk;if(output.includes("READY\n"))resolve();});child.once("error",reject);child.once("close",code=>{if(!output.includes("READY\n"))reject(new Error(`publisher exited before barrier: ${code}`));});})));
    await writeFile(path.join(control,"go"),"");const deadline=Date.now()+8_000;let statusNames:string[]=[];while(Date.now()<deadline){statusNames=(await readdir(control)).filter(name=>name.startsWith("status-"));if(statusNames.length===8)break;await new Promise(resolve=>setTimeout(resolve,10));}assert.equal(statusNames.length,8,"every publisher is staged or terminal before the snapshot");
    const statuses=await Promise.all(statusNames.map(async name=>JSON.parse(await readFile(path.join(control,name),"utf8")) as {status:string;callbacks:number}));assert.equal(statuses.filter(value=>value.status==="staged").length,1);assert.equal(statuses.filter(value=>value.status==="busy").length,7);assert.equal(statuses.every(value=>value.callbacks===0),true);
    const names=await readdir(root);assert.deepEqual(names.filter(name=>name.startsWith(".authority-ledger-admission-")),[".authority-ledger-admission-0"]);assert.equal(names.filter(name=>name.startsWith(".authority-ledger-lock-publication-")).length,1);
  }finally{await writeFile(path.join(control,"release"),"").catch(()=>{});await Promise.all(children.map(async(child,index)=>{await Promise.race([closed[index],new Promise(resolve=>setTimeout(resolve,1_000))]);if(child.exitCode===null)child.kill();}));await rm(control,{recursive:true,force:true});}
}));

test("two ledger instances in one PID wait through admission and converge",()=>withRoot(async root=>{
  let secondPromise:Promise<unknown>|undefined,staged=false,firstCallbacks=0,secondCallbacks=0;
  const first=new RawFsAuthorityLedger(root,{[k1AdmissionPreparationOption()]:K1_ADMISSION_PREPARATION_LEGACY,now:()=>t0,lockTimeoutMs:40,faultInjector:(point:string)=>{
    if(point==="after-lock-publication-stage-sync"&&!secondPromise){staged=true;secondPromise=new RawFsAuthorityLedger(root,{[k1AdmissionPreparationOption()]:K1_ADMISSION_PREPARATION_LEGACY,now:()=>t0,lockTimeoutMs:500,faultInjector:(observed:string)=>{if(observed==="before-ledger-operation-callback")secondCallbacks++;}} as never).observeClock();}
    if(staged&&point==="before-lock-publication-rename")throw Object.assign(new Error("sharing"),{code:"EBUSY"});
    if(point==="before-ledger-operation-callback")firstCallbacks++;
  }} as never);
  const firstResult=await first.observeClock();assert.ok(secondPromise,"the second instance starts while the first owns admission");const secondResult=await secondPromise!;
  assert.deepEqual(firstResult,{ok:false,reason:"busy"});assert.deepEqual(secondResult,{ok:true,status:"advanced",observedAt:new Date(t0).toISOString()});assert.deepEqual({firstCallbacks,secondCallbacks},{firstCallbacks:0,secondCallbacks:1});
  const artifacts=(await readdir(root)).filter(name=>name.startsWith(".authority-ledger-admission-")||name.startsWith(".authority-ledger-lock-publication-"));assert.deepEqual(artifacts,[]);
}));

test("a concrete valid live fixed admission slot denies publication only after complete classification",async t=>{
  await t.test("valid slot alone is busy and unchanged",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"1".repeat(64),pid:process.pid,v:1 as const};await writeAdmissionSlot(root,owner);const before=await snapshotRootArtifacts(root);let publicationHooks=0,publicationRenames=0,callbackEntries=0;const result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20,faultInjector:(point:string)=>{if((publicationCrashPoints as readonly string[]).includes(point))publicationHooks++;if(point==="after-lock-publication-rename")publicationRenames++;if(point==="before-ledger-operation-callback")callbackEntries++;}} as never).observeClock();assert.deepEqual(result,{ok:false,reason:"busy"});assert.deepEqual({publicationHooks,publicationRenames,callbackEntries},{publicationHooks:0,publicationRenames:0,callbackEntries:0});assert.deepEqual(await snapshotRootArtifacts(root),before);}));
  await t.test("valid slot never masks malformed publication membership",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"2".repeat(64),pid:process.pid,v:1 as const};await writeAdmissionSlot(root,owner);const malformed=path.join(root,".authority-ledger-lock-publication-malformed.tmp");await mkdir(malformed);await writeFile(path.join(malformed,"owner.json"),"malformed");const before=await snapshotRootArtifacts(root);let publicationHooks=0,callbackEntries=0;const result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20,faultInjector:(point:string)=>{if((publicationCrashPoints as readonly string[]).includes(point))publicationHooks++;if(point==="before-ledger-operation-callback")callbackEntries++;}} as never).observeClock();assert.deepEqual(result,{ok:false,reason:"corruption"});assert.deepEqual({publicationHooks,callbackEntries},{publicationHooks:0,callbackEntries:0});assert.deepEqual(await snapshotRootArtifacts(root),before);}));
});

test("complete creator withdrawal reaches publication-aborted before cleanup",()=>withRoot(async root=>{
  const terminalError={kind:"stable-terminal-error"};let ownStage="",ownerBytes=Buffer.alloc(0),owner:{host:string;nonce:string;pid:number;v:1}|undefined,withdrawalActive=false,originalAbsent=false,markerPresent=false,markerBytes=Buffer.alloc(0),callbackEntries=0,thrown:unknown;
  const ledger=new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="after-lock-publication-stage-sync"){const name=readdirSync(root).find(value=>value.startsWith(".authority-ledger-lock-publication-"));assert.ok(name);ownStage=path.join(root,name);ownerBytes=readFileSync(path.join(ownStage,"owner.json"));owner=JSON.parse(ownerBytes.toString("utf8"));throw terminalError;}if(point==="before-creator-withdrawal-seal")withdrawalActive=true;if(withdrawalActive&&point==="after-creator-withdrawal-root-sync"&&owner){const marker=path.join(root,`.authority-ledger-lock-${owner.pid}-${owner.nonce}.publication-aborted`);originalAbsent=!existsSync(ownStage);markerPresent=existsSync(marker);if(markerPresent)markerBytes=readFileSync(path.join(marker,"owner.json"));}if(point==="before-ledger-operation-callback")callbackEntries++;}} as never);
  try{await ledger.observeClock();}catch(error){thrown=error;}
  assert.equal(thrown,terminalError);assert.equal(withdrawalActive,true);assert.equal(originalAbsent,true);assert.equal(markerPresent,true);assert.deepEqual(markerBytes,ownerBytes);assert.equal(callbackEntries,0);
}));

test("active owner treats atomic complete withdrawal as membership change, never corruption",()=>withRoot(async root=>{
  const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});assert.ok(child.pid);const owner={host:hostname(),nonce:"3".repeat(64),pid:child.pid,v:1 as const,ticket:"0000000000000001"},bytes=publicationOwnerBytes(owner),stage=path.join(root,publicationStageName(owner)),marker=path.join(root,`.authority-ledger-lock-${owner.pid}-${owner.nonce}.publication-aborted`);let installed=false,renamed=false,callbackEntries=0;
  try{const result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:200,faultInjector:(point:string)=>{if(point==="after-lock-publication-root-sync"&&!installed){installed=true;mkdirSync(stage);writeFileSync(path.join(stage,"owner.json"),bytes);}if(point==="after-pre-callback-coordination-generation-closed"&&installed&&!renamed){renamed=true;renameSync(stage,marker);}if(point==="before-ledger-operation-callback")callbackEntries++;}} as never).observeClock();assert.deepEqual(result,{ok:true,status:"advanced",observedAt:new Date(t0).toISOString()});assert.equal(installed,true);assert.equal(renamed,true);assert.equal(callbackEntries,1);assert.equal(existsSync(stage),false);assert.equal(existsSync(marker),false,"the active owner services the authenticated publication-aborted marker");}finally{child.kill();}
}));

type AdmissionOwner=Readonly<{host:string;nonce:string;pid:number;v:1}>;
type AdmissionPartialState="empty"|"zero"|"partial"|"complete";
type CoordinationPurpose="prep-retired"|"slot-retired"|"creator-withdrawal";
const coordinationAckVersion="reelier.authority-ledger-coordination-cleanup-ack/v1" as const;
function rawDigest(bytes:Buffer):string{return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;}
function decimalIdentity(target:string):Readonly<{dev:string;ino:string;mode:string;nlink:string}>{const value=exactFsIdentity(target);return {dev:value.dev.toString(),ino:value.ino.toString(),mode:value.mode.toString(),nlink:value.nlink.toString()};}
function admissionPrepName(owner:AdmissionOwner):string{return `.authority-ledger-admission-prep-${publicationHostDigest(owner.host)}-${owner.pid}-${owner.nonce}.tmp`;}
function admissionPrepRetiredName(owner:AdmissionOwner,state:AdmissionPartialState):string{return `.authority-ledger-admission-prep-retired-${publicationHostDigest(owner.host)}-${owner.pid}-${owner.nonce}.${state}`;}
function admissionRetiredName(owner:AdmissionOwner,disposition:"published"|"withdrawn"|"abandoned"):string{return `.authority-ledger-admission-retired-${publicationHostDigest(owner.host)}-${owner.pid}-${owner.nonce}.${disposition}`;}
function creatorWithdrawalName(owner:AdmissionOwner,state:Exclude<AdmissionPartialState,"complete">,ticket="0000000000000001"):string{return `.authority-ledger-creator-withdrawal-${publicationHostDigest(owner.host)}-${ticket}-${owner.pid}-${owner.nonce}.${state}`;}
function ownerStateBytes(owner:AdmissionOwner,state:AdmissionPartialState):Buffer{const complete=publicationOwnerBytes(owner);return state==="zero"?Buffer.alloc(0):state==="partial"?complete.subarray(0,Math.max(1,complete.length-1)):complete;}
async function writeAdmissionPrep(root:string,owner:AdmissionOwner,state:AdmissionPartialState):Promise<string>{const prep=path.join(root,admissionPrepName(owner));await mkdir(prep);if(state!=="empty")await writeFile(path.join(prep,"owner.json"),ownerStateBytes(owner,state));return prep;}
async function writeCreatorWithdrawal(root:string,owner:AdmissionOwner,state:Exclude<AdmissionPartialState,"complete">):Promise<string>{const marker=path.join(root,creatorWithdrawalName(owner,state));await mkdir(marker);if(state!=="empty")await writeFile(path.join(marker,"owner.json"),ownerStateBytes(owner,state));return marker;}
function coordinationAckName(record:Readonly<Record<string,unknown>>):string{return `.authority-ledger-coordination-cleanup-${authorityDigest(record).slice(7)}.ack`;}
function coordinationStageName(record:Readonly<Record<string,unknown>>,purpose:CoordinationPurpose):string{const code:Readonly<Record<CoordinationPurpose,"p"|"s"|"w">>={"prep-retired":"p","slot-retired":"s","creator-withdrawal":"w"};return `.authority-ledger-coordination-cleanup-stage-${code[purpose]}-${authorityDigest(record).slice(7)}.tmp`;}
function incompleteCoordinationAck(owner:AdmissionOwner,purpose:"prep-retired"|"creator-withdrawal",markerName:string,originalName:string,state:AdmissionPartialState,marker:string,slotRetirementAck?:Readonly<Record<string,unknown>>){const bytes=state==="empty"?Buffer.alloc(0):readFileSync(path.join(marker,"owner.json")),base={directoryIdentity:decimalIdentity(marker),kind:purpose==="prep-retired"?"admission-prep-retired":"creator-withdrawal",markerName,originalName,owner,ownerBytesDigest:rawDigest(bytes),ownerBytesLength:String(bytes.length),ownerDigest:authorityDigest(owner),ownerIdentity:state==="empty"?null:decimalIdentity(path.join(marker,"owner.json")),purpose,recoveryAuthority:purpose==="prep-retired"?"dead-owner-or-exact-creator":"exact-slot-retirement-ack",state,v:coordinationAckVersion};if(purpose==="prep-retired")return base;assert.ok(slotRetirementAck,"creator withdrawal fixture requires the exact slot-retirement ack");return {...base,slotRetirementAckDigest:authorityDigest(slotRetirementAck),slotRetirementAckName:coordinationAckName(slotRetirementAck)};}
function slotCoordinationAck(owner:AdmissionOwner,markerName:string,marker:string,disposition:"published"|"withdrawn"|"abandoned",terminalArtifactName=markerName,terminalBytes=publicationOwnerBytes(owner)){const ownerPath=path.join(marker,"owner.json"),bytes=readFileSync(ownerPath),recoveryAuthority=disposition==="abandoned"?"dead-owner-or-exact-creator":disposition==="withdrawn"?"exact-withdrawal-marker":"active-owner-or-exact-lock-successor";return {disposition,kind:"admission-slot-retired",markerName,owner,ownerBytesDigest:rawDigest(bytes),ownerBytesLength:String(bytes.length),ownerDigest:authorityDigest(owner),ownerIdentity:decimalIdentity(ownerPath),originalName:".authority-ledger-admission-0",purpose:"slot-retired",recoveryAuthority,slotIdentity:decimalIdentity(marker),terminalArtifactDigest:rawDigest(terminalBytes),terminalArtifactName,v:coordinationAckVersion};}

type HybridEpochCounters={readonly k1Initial:number;readonly k1Closed:number;readonly legacyMutations:number;readonly semanticNow:number;readonly callbacks:number};
const legacyMutationBoundaries=new Set([
  "after-lock-publication-stage-create","after-lock-publication-owner-create","after-lock-publication-owner-partial-write","after-lock-publication-owner-sync","after-lock-publication-stage-sync","after-owner-file-sync","after-lock-directory-sync","before-staged-publication-settlement",
  "before-lock-retire","after-lock-retire","before-lock-publication-rename","after-lock-publication-rename","after-lock-publication-root-sync",
  "before-publication-stage-remove-attempt","before-creator-stage-withdrawal-validation","after-publication-stage-cleanup-root-sync","before-creator-withdrawal-seal","after-creator-withdrawal-root-sync",
  "after-admission-slot-retire-rename","after-admission-slot-retire-root-sync","after-coordination-cleanup-marker-owner-remove","after-coordination-cleanup-marker-remove","after-coordination-cleanup-marker-root-sync",
]);
async function writeLegacyRetiredLock(root:string,owner:AdmissionOwner,disposition:TestRetirementDisposition):Promise<string>{const marker=path.join(root,retirementMarkerName(owner,disposition));await mkdir(marker);await writeFile(path.join(marker,"owner.json"),publicationOwnerBytes(owner));return marker;}

test("hybrid epoch guard classifies K1 before every legacy compatibility mutation",async t=>{
  const publicAuthority=await import("../../src/authority/index.js") as Record<string,unknown>;
  assert.deepEqual(Object.keys(publicAuthority).filter(name=>/(?:k1|epoch|root.?generation)/i.test(name)),[],"the migration guard requires no public classifier export under any name");
  const cases=[
    {name:"live exact prep plus same-owner stage is impossible",expected:{ok:false,reason:"corruption"} as const,dead:[] as number[],setup:async(root:string)=>{const owner={host:hostname(),nonce:"1".repeat(64),pid:process.pid,v:1 as const,ticket:"0000000000000001"};await writeAdmissionPrep(root,owner,"complete");await writePublicationStage(root,owner,publicationOwnerBytes(owner));}},
    {name:"live exact slot plus same-owner stage is valid in-flight",expected:{ok:false,reason:"busy"} as const,dead:[] as number[],setup:async(root:string)=>{const owner={host:hostname(),nonce:"2".repeat(64),pid:process.pid,v:1 as const,ticket:"0000000000000001"};await writeAdmissionSlot(root,owner);await writePublicationStage(root,owner,publicationOwnerBytes(owner));}},
    {name:"live exact slot plus same-owner empty stage is valid in-flight",expected:{ok:false,reason:"busy"} as const,dead:[] as number[],setup:async(root:string)=>{const owner={host:hostname(),nonce:"d".repeat(64),pid:process.pid,v:1 as const,ticket:"0000000000000001"};await writeAdmissionSlot(root,owner);await writePublicationStage(root,owner,null);}},
    {name:"live exact slot plus same-owner zero stage is valid in-flight",expected:{ok:false,reason:"busy"} as const,dead:[] as number[],setup:async(root:string)=>{const owner={host:hostname(),nonce:"e".repeat(64),pid:process.pid,v:1 as const,ticket:"0000000000000001"};await writeAdmissionSlot(root,owner);await writePublicationStage(root,owner,Buffer.alloc(0));}},
    {name:"live exact slot plus same-owner strict-prefix stage is valid in-flight",expected:{ok:false,reason:"busy"} as const,dead:[] as number[],setup:async(root:string)=>{const owner={host:hostname(),nonce:"f".repeat(64),pid:process.pid,v:1 as const,ticket:"0000000000000001"},bytes=publicationOwnerBytes(owner);await writeAdmissionSlot(root,owner);await writePublicationStage(root,owner,bytes.subarray(0,bytes.length-1));}},
    {name:"dead exact slot plus same-owner stage is recoverable but unsupported",expected:{ok:false,reason:"busy"} as const,dead:[49401],setup:async(root:string)=>{const owner={host:hostname(),nonce:"3".repeat(64),pid:49401,v:1 as const,ticket:"0000000000000001"};await writeAdmissionSlot(root,owner);await writePublicationStage(root,owner,publicationOwnerBytes(owner));}},
    {name:"live exact slot plus same-owner active lock is post-publish pre-retire",expected:{ok:false,reason:"busy"} as const,dead:[] as number[],setup:async(root:string)=>{const owner={host:hostname(),nonce:"4".repeat(64),pid:process.pid,v:1 as const};await writeAdmissionSlot(root,owner);const lock=path.join(root,"lock");await mkdir(lock);await writeFile(path.join(lock,"owner.json"),publicationOwnerBytes(owner));}},
    {name:"withdrawn slot graph bound to publication-aborted is valid crash residue",expected:{ok:false,reason:"busy"} as const,dead:[] as number[],setup:async(root:string)=>{const owner={host:hostname(),nonce:"0".repeat(64),pid:process.pid,v:1 as const},terminalName=retirementMarkerName(owner,"publication-aborted"),terminal=path.join(root,terminalName),slotName=admissionRetiredName(owner,"withdrawn"),slot=path.join(root,slotName);await mkdir(terminal);await writeFile(path.join(terminal,"owner.json"),publicationOwnerBytes(owner));await mkdir(slot);await writeFile(path.join(slot,"owner.json"),publicationOwnerBytes(owner));const ack=slotCoordinationAck(owner,slotName,slot,"withdrawn",terminalName,publicationOwnerBytes(owner));await writeFile(path.join(root,coordinationAckName(ack)),authorityCanonicalBytes(ack));}},
    {name:"prep-retired bound ack plus unrelated publication-aborted is impossible",expected:{ok:false,reason:"corruption"} as const,dead:[] as number[],setup:async(root:string)=>{const owner={host:hostname(),nonce:"5".repeat(64),pid:process.pid,v:1 as const},markerName=admissionPrepRetiredName(owner,"complete"),marker=path.join(root,markerName);await mkdir(marker);await writeFile(path.join(marker,"owner.json"),publicationOwnerBytes(owner));const ack=incompleteCoordinationAck(owner,"prep-retired",markerName,admissionPrepName(owner),"complete",marker);await writeFile(path.join(root,coordinationAckName(ack)),authorityCanonicalBytes(ack));await writeLegacyRetiredLock(root,{host:hostname(),nonce:"6".repeat(64),pid:process.pid,v:1},"publication-aborted");}},
    {name:"K1 activation plus multiple valid publication stages is corruption",expected:{ok:false,reason:"corruption"} as const,dead:[] as number[],setup:async(root:string)=>{const slotOwner={host:hostname(),nonce:"1".repeat(64),pid:process.pid,v:1 as const,ticket:"0000000000000001"},otherOwner={host:hostname(),nonce:"2".repeat(64),pid:process.pid,v:1 as const,ticket:"0000000000000002"};await writeAdmissionSlot(root,slotOwner);await writePublicationStage(root,slotOwner,publicationOwnerBytes(slotOwner));await writePublicationStage(root,otherOwner,publicationOwnerBytes(otherOwner));}},
    {name:"malformed K1 lookalike precedes a canonical dead publication stage",expected:{ok:false,reason:"corruption"} as const,dead:[49402],setup:async(root:string)=>{await mkdir(path.join(root,".authority-ledger-admission-prep-malformed.tmp"));const owner={host:hostname(),nonce:"7".repeat(64),pid:49402,v:1 as const,ticket:"0000000000000001"};await writePublicationStage(root,owner,publicationOwnerBytes(owner));}},
    {name:"malformed K1 lookalike precedes publication-aborted compatibility cleanup",expected:{ok:false,reason:"corruption"} as const,dead:[] as number[],setup:async(root:string)=>{await mkdir(path.join(root,".authority-ledger-coordination-cleanup-malformed.ack"));await writeLegacyRetiredLock(root,{host:hostname(),nonce:"8".repeat(64),pid:process.pid,v:1},"publication-aborted");}},
  ];
  for(const fixture of cases)await t.test(fixture.name,()=>withRoot(async root=>{
    await fixture.setup(root);const before=await snapshotRootArtifacts(root),originalKill=process.kill;let k1Initial=0,k1Closed=0,legacyMutations=0,semanticNow=0,callbacks=0;
    Object.defineProperty(process,"kill",{configurable:true,value:(pid:number)=>fixture.dead.includes(pid)?(()=>{throw Object.assign(new Error("dead"),{code:"ESRCH"});})():originalKill.call(process,pid,0)});
    let result;try{result=await new RawFsAuthorityLedger(root,{now:()=>{semanticNow++;return t0;},lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="after-pre-admission-housekeeping-initial-enumeration")k1Initial++;if(point==="after-pre-admission-housekeeping-generation-closed")k1Closed++;if(legacyMutationBoundaries.has(point))legacyMutations++;if(point==="before-ledger-operation-callback")callbacks++;}} as never).observeClock();}finally{Object.defineProperty(process,"kill",{configurable:true,value:originalKill});}
    const after=await snapshotRootArtifacts(root),counters:HybridEpochCounters={k1Initial,k1Closed,legacyMutations,semanticNow,callbacks};
    assert.deepEqual({result,after,k1Classified:counters.k1Initial>0,k1SnapshotsClose:counters.k1Initial>0&&counters.k1Closed===counters.k1Initial,legacyMutations:counters.legacyMutations,semanticNow:counters.semanticNow,callbacks:counters.callbacks},{result:fixture.expected,after:before,k1Classified:true,k1SnapshotsClose:true,legacyMutations:0,semanticNow:0,callbacks:0},`${fixture.name}: closed K1 classification is byte-identical and precedes every legacy/semantic authority`);
  }));
});

test("K1 acknowledgment prerequisites and same-digest stages fail closed unchanged",async t=>{
  const assertCorruptionUnchanged=async(root:string)=>{const before=await snapshotRootArtifacts(root);let semanticNow=0,callbacks=0,publicationCreates=0;const result=await new RawFsAuthorityLedger(root,{now:()=>{semanticNow++;return t0;},lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="before-ledger-operation-callback")callbacks++;if(point==="after-lock-publication-stage-create")publicationCreates++;}} as never).observeClock();assert.deepEqual(result,{ok:false,reason:"corruption"});assert.deepEqual(await snapshotRootArtifacts(root),before);assert.deepEqual({semanticNow,callbacks,publicationCreates},{semanticNow:0,callbacks:0,publicationCreates:0});};
  await t.test("creator-withdrawal cannot cite a present digest-valid prep-retired acknowledgment",()=>withRoot(async root=>{
    const owner={host:hostname(),nonce:"9".repeat(64),pid:process.pid,v:1 as const},prepMarkerName=admissionPrepRetiredName(owner,"complete"),prepMarker=path.join(root,prepMarkerName);
    await mkdir(prepMarker);await writeFile(path.join(prepMarker,"owner.json"),publicationOwnerBytes(owner));
    const wrongPurposeAck=incompleteCoordinationAck(owner,"prep-retired",prepMarkerName,admissionPrepName(owner),"complete",prepMarker),wrongPurposeAckPath=path.join(root,coordinationAckName(wrongPurposeAck));
    await writeFile(wrongPurposeAckPath,authorityCanonicalBytes(wrongPurposeAck));await rm(prepMarker,{recursive:true});
    const withdrawalMarker=await writeCreatorWithdrawal(root,owner,"partial"),withdrawalMarkerName=path.basename(withdrawalMarker),withdrawalAck=incompleteCoordinationAck(owner,"creator-withdrawal",withdrawalMarkerName,publicationStageName({...owner,ticket:"0000000000000001"}),"partial",withdrawalMarker,wrongPurposeAck);
    await writeFile(path.join(root,coordinationAckName(withdrawalAck)),authorityCanonicalBytes(withdrawalAck));
    await assertCorruptionUnchanged(root);assert.deepEqual(await readFile(wrongPurposeAckPath),authorityCanonicalBytes(wrongPurposeAck),"the wrong-purpose referenced acknowledgment remains exact");
  }));
  await t.test("creator-withdrawal cannot cite another owner's valid withdrawn slot acknowledgment",()=>withRoot(async root=>{
    const creator={host:hostname(),nonce:"c".repeat(64),pid:process.pid,v:1 as const},other={host:hostname(),nonce:"d".repeat(64),pid:process.pid,v:1 as const},terminalName=retirementMarkerName(other,"publication-aborted"),terminal=path.join(root,terminalName),slotName=admissionRetiredName(other,"withdrawn"),slot=path.join(root,slotName);
    await mkdir(terminal);await writeFile(path.join(terminal,"owner.json"),publicationOwnerBytes(other));await mkdir(slot);await writeFile(path.join(slot,"owner.json"),publicationOwnerBytes(other));const slotAck=slotCoordinationAck(other,slotName,slot,"withdrawn",terminalName,publicationOwnerBytes(other));await writeFile(path.join(root,coordinationAckName(slotAck)),authorityCanonicalBytes(slotAck));
    const withdrawal=await writeCreatorWithdrawal(root,creator,"partial"),withdrawalName=path.basename(withdrawal),withdrawalAck=incompleteCoordinationAck(creator,"creator-withdrawal",withdrawalName,publicationStageName({...creator,ticket:"0000000000000001"}),"partial",withdrawal,slotAck);await writeFile(path.join(root,coordinationAckName(withdrawalAck)),authorityCanonicalBytes(withdrawalAck));await assertCorruptionUnchanged(root);
  }));
  await t.test("creator-withdrawal requires the withdrawn slot terminal to be its exact marker",()=>withRoot(async root=>{
    const owner={host:hostname(),nonce:"e".repeat(64),pid:process.pid,v:1 as const},terminalName=retirementMarkerName(owner,"publication-aborted"),terminal=path.join(root,terminalName),slotName=admissionRetiredName(owner,"withdrawn"),slot=path.join(root,slotName);
    await mkdir(terminal);await writeFile(path.join(terminal,"owner.json"),publicationOwnerBytes(owner));await mkdir(slot);await writeFile(path.join(slot,"owner.json"),publicationOwnerBytes(owner));const slotAck=slotCoordinationAck(owner,slotName,slot,"withdrawn",terminalName,publicationOwnerBytes(owner));await rm(slot,{recursive:true});await writeFile(path.join(root,coordinationAckName(slotAck)),authorityCanonicalBytes(slotAck));
    const withdrawal=await writeCreatorWithdrawal(root,owner,"partial"),withdrawalName=path.basename(withdrawal),withdrawalAck=incompleteCoordinationAck(owner,"creator-withdrawal",withdrawalName,publicationStageName({...owner,ticket:"0000000000000001"}),"partial",withdrawal,slotAck);await writeFile(path.join(root,coordinationAckName(withdrawalAck)),authorityCanonicalBytes(withdrawalAck));await assertCorruptionUnchanged(root);
  }));
  await t.test("creator-withdrawal cannot cite a valid published slot acknowledgment",()=>withRoot(async root=>{
    const owner={host:hostname(),nonce:"f".repeat(64),pid:process.pid,v:1 as const},lock=path.join(root,"lock"),slotName=admissionRetiredName(owner,"published"),slot=path.join(root,slotName);
    await mkdir(lock);await writeFile(path.join(lock,"owner.json"),publicationOwnerBytes(owner));await mkdir(slot);await writeFile(path.join(slot,"owner.json"),publicationOwnerBytes(owner));const slotAck=slotCoordinationAck(owner,slotName,slot,"published","lock",publicationOwnerBytes(owner));await rm(slot,{recursive:true});await writeFile(path.join(root,coordinationAckName(slotAck)),authorityCanonicalBytes(slotAck));
    const withdrawal=await writeCreatorWithdrawal(root,owner,"partial"),withdrawalName=path.basename(withdrawal),withdrawalAck=incompleteCoordinationAck(owner,"creator-withdrawal",withdrawalName,publicationStageName({...owner,ticket:"0000000000000001"}),"partial",withdrawal,slotAck);await writeFile(path.join(root,coordinationAckName(withdrawalAck)),authorityCanonicalBytes(withdrawalAck));await assertCorruptionUnchanged(root);
  }));
  for(const stageState of ["complete","strict-prefix","zero"] as const)await t.test(`prep-retired final acknowledgment plus same-digest ${stageState} stage is corruption`,()=>withRoot(async root=>{
    const owner={host:hostname(),nonce:(stageState==="complete"?"a":stageState==="strict-prefix"?"b":"0").repeat(64),pid:process.pid,v:1 as const},markerName=admissionPrepRetiredName(owner,"complete"),marker=path.join(root,markerName);
    await mkdir(marker);await writeFile(path.join(marker,"owner.json"),publicationOwnerBytes(owner));
    const ack=incompleteCoordinationAck(owner,"prep-retired",markerName,admissionPrepName(owner),"complete",marker),ackBytes=authorityCanonicalBytes(ack),stageBytes=stageState==="complete"?ackBytes:stageState==="strict-prefix"?ackBytes.subarray(0,ackBytes.length-1):Buffer.alloc(0);
    await writeFile(path.join(root,coordinationAckName(ack)),ackBytes);await writeFile(path.join(root,coordinationStageName(ack,"prep-retired")),stageBytes);
    const before=await snapshotRootArtifacts(root),result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20}).observeClock();
    assert.deepEqual(result,{ok:false,reason:"corruption"},stageState);assert.deepEqual(await snapshotRootArtifacts(root),before,stageState);
  }));
});

test("K1 creator-withdrawal lifecycle requires final prerequisite acknowledgments",async t=>{
  const assertCorruptionUnchanged=async(root:string)=>{const before=await snapshotRootArtifacts(root);let semanticNow=0,callbacks=0,publicationCreates=0;const result=await new RawFsAuthorityLedger(root,{now:()=>{semanticNow++;return t0;},lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="before-ledger-operation-callback")callbacks++;if(point==="after-lock-publication-stage-create")publicationCreates++;}} as never).observeClock();assert.deepEqual(result,{ok:false,reason:"corruption"});assert.deepEqual(await snapshotRootArtifacts(root),before);assert.deepEqual({semanticNow,callbacks,publicationCreates},{semanticNow:0,callbacks:0,publicationCreates:0});};
  for(const slotStageState of ["zero","strict-prefix","complete"] as const)await t.test(`final creator-withdrawal ack cannot cite an absent slot ack with only a ${slotStageState} stage`,()=>withRoot(async root=>{
    const owner={host:hostname(),nonce:(slotStageState==="zero"?"1":slotStageState==="strict-prefix"?"2":"3").repeat(64),pid:process.pid,v:1 as const},withdrawal=await writeCreatorWithdrawal(root,owner,"partial"),withdrawalName=path.basename(withdrawal),slotName=admissionRetiredName(owner,"withdrawn"),slot=path.join(root,slotName);
    await mkdir(slot);await writeFile(path.join(slot,"owner.json"),publicationOwnerBytes(owner));const slotAck=slotCoordinationAck(owner,slotName,slot,"withdrawn",withdrawalName,ownerStateBytes(owner,"partial")),slotAckBytes=authorityCanonicalBytes(slotAck),slotStageBytes=slotStageState==="zero"?Buffer.alloc(0):slotStageState==="strict-prefix"?slotAckBytes.subarray(0,slotAckBytes.length-1):slotAckBytes,slotFinal=path.join(root,coordinationAckName(slotAck));await writeFile(path.join(root,coordinationStageName(slotAck,"slot-retired")),slotStageBytes);
    const withdrawalAck=incompleteCoordinationAck(owner,"creator-withdrawal",withdrawalName,publicationStageName({...owner,ticket:"0000000000000001"}),"partial",withdrawal,slotAck);await writeFile(path.join(root,coordinationAckName(withdrawalAck)),authorityCanonicalBytes(withdrawalAck));assert.equal(existsSync(slotFinal),false,"the referenced final slot acknowledgment is absent");await assertCorruptionUnchanged(root);
  }));
  await t.test("complete creator-withdrawal stage is not final bound authority for an absent slot ack",()=>withRoot(async root=>{
    const owner={host:hostname(),nonce:"4".repeat(64),pid:process.pid,v:1 as const},withdrawal=await writeCreatorWithdrawal(root,owner,"partial"),withdrawalName=path.basename(withdrawal),slotName=admissionRetiredName(owner,"withdrawn"),slot=path.join(root,slotName);
    await mkdir(slot);await writeFile(path.join(slot,"owner.json"),publicationOwnerBytes(owner));const slotAck=slotCoordinationAck(owner,slotName,slot,"withdrawn",withdrawalName,ownerStateBytes(owner,"partial"));await rm(slot,{recursive:true});const slotFinal=path.join(root,coordinationAckName(slotAck)),withdrawalAck=incompleteCoordinationAck(owner,"creator-withdrawal",withdrawalName,publicationStageName({...owner,ticket:"0000000000000001"}),"partial",withdrawal,slotAck);await writeFile(path.join(root,coordinationStageName(withdrawalAck,"creator-withdrawal")),authorityCanonicalBytes(withdrawalAck));assert.equal(existsSync(slotFinal),false,"the referenced final slot acknowledgment is absent");assert.equal(existsSync(path.join(root,coordinationAckName(withdrawalAck))),false,"the creator-withdrawal record is staging, not final authority");await assertCorruptionUnchanged(root);
  }));
});

test("K1 prep cleanup residue distinguishes recoverable partial stages from corrupt orphan multiplicity and provenance",async t=>{
  const assertDecisionUnchanged=async(root:string,expected:{ok:false;reason:"busy"|"corruption"})=>{const before=await snapshotRootArtifacts(root);let semanticNow=0,callbacks=0,publicationCreates=0;const result=await new RawFsAuthorityLedger(root,{now:()=>{semanticNow++;return t0;},lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="before-ledger-operation-callback")callbacks++;if(point==="after-lock-publication-stage-create")publicationCreates++;}} as never).observeClock();assert.deepEqual(result,expected);assert.deepEqual(await snapshotRootArtifacts(root),before);assert.deepEqual({semanticNow,callbacks,publicationCreates},{semanticNow:0,callbacks:0,publicationCreates:0});};
  await t.test("orphan zero-byte prep-retired stage is corruption",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"5".repeat(64),pid:process.pid,v:1 as const},markerName=admissionPrepRetiredName(owner,"complete"),marker=path.join(root,markerName);await mkdir(marker);await writeFile(path.join(marker,"owner.json"),publicationOwnerBytes(owner));const ack=incompleteCoordinationAck(owner,"prep-retired",markerName,admissionPrepName(owner),"complete",marker);await rm(marker,{recursive:true});await writeFile(path.join(root,coordinationStageName(ack,"prep-retired")),Buffer.alloc(0));await assertDecisionUnchanged(root,{ok:false,reason:"corruption"});}));
  for(const stageState of ["zero","one-byte","longer-prefix"] as const)await t.test(`marker-present exact ${stageState} prep stage remains non-authorizing busy`,()=>withRoot(async root=>{const owner={host:hostname(),nonce:(stageState==="zero"?"6":stageState==="one-byte"?"7":"8").repeat(64),pid:process.pid,v:1 as const},markerName=admissionPrepRetiredName(owner,"complete"),marker=path.join(root,markerName);await mkdir(marker);await writeFile(path.join(marker,"owner.json"),publicationOwnerBytes(owner));const ack=incompleteCoordinationAck(owner,"prep-retired",markerName,admissionPrepName(owner),"complete",marker),ackBytes=authorityCanonicalBytes(ack),stageBytes=stageState==="zero"?Buffer.alloc(0):stageState==="one-byte"?ackBytes.subarray(0,1):ackBytes.subarray(0,Math.min(17,ackBytes.length-1));assert.equal(stageBytes.length<ackBytes.length,true);if(stageBytes.length)assert.deepEqual(stageBytes,ackBytes.subarray(0,stageBytes.length));await writeFile(path.join(root,coordinationStageName(ack,"prep-retired")),stageBytes);await assertDecisionUnchanged(root,{ok:false,reason:"busy"});}));
  await t.test("marker-present same-digest non-prefix prep stage beginning with an object byte is corruption",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"9".repeat(64),pid:process.pid,v:1 as const},markerName=admissionPrepRetiredName(owner,"complete"),marker=path.join(root,markerName);await mkdir(marker);await writeFile(path.join(marker,"owner.json"),publicationOwnerBytes(owner));const ack=incompleteCoordinationAck(owner,"prep-retired",markerName,admissionPrepName(owner),"complete",marker),ackBytes=authorityCanonicalBytes(ack),bad=Buffer.from("{garbage");assert.equal(bad.equals(ackBytes.subarray(0,bad.length)),false,"fixture is not a canonical strict prefix");await writeFile(path.join(root,coordinationStageName(ack,"prep-retired")),bad);await assertDecisionUnchanged(root,{ok:false,reason:"corruption"});}));
  await t.test("two distinct-digest local-host orphan prep final acknowledgments are corruption",()=>withRoot(async root=>{const names:string[]=[];for(const nonce of ["c","d"]){const owner={host:hostname(),nonce:nonce.repeat(64),pid:process.pid,v:1 as const},markerName=admissionPrepRetiredName(owner,"complete"),marker=path.join(root,markerName);await mkdir(marker);await writeFile(path.join(marker,"owner.json"),publicationOwnerBytes(owner));const ack=incompleteCoordinationAck(owner,"prep-retired",markerName,admissionPrepName(owner),"complete",marker),ackName=coordinationAckName(ack);await rm(marker,{recursive:true});await writeFile(path.join(root,ackName),authorityCanonicalBytes(ack));names.push(ackName);}assert.notEqual(names[0],names[1],"duplicate final acknowledgments have distinct canonical record digests");await assertDecisionUnchanged(root,{ok:false,reason:"corruption"});}));
  await t.test("canonically digest-valid foreign-host orphan prep final acknowledgment is corruption",()=>withRoot(async root=>{const owner={host:"foreign.invalid",nonce:"e".repeat(64),pid:process.pid,v:1 as const},markerName=admissionPrepRetiredName(owner,"complete"),marker=path.join(root,markerName);assert.notEqual(publicationHostDigest(owner.host),publicationHostDigest(hostname()));await mkdir(marker);await writeFile(path.join(marker,"owner.json"),publicationOwnerBytes(owner));const ack=incompleteCoordinationAck(owner,"prep-retired",markerName,admissionPrepName(owner),"complete",marker),ackName=coordinationAckName(ack);await rm(marker,{recursive:true});await writeFile(path.join(root,ackName),authorityCanonicalBytes(ack));assert.equal(ackName,coordinationAckName(ack),"foreign record filename matches its own canonical digest");await assertDecisionUnchanged(root,{ok:false,reason:"corruption"});}));
});

test("K1 all-purpose cleanup stages require exact predecessors prefixes and one lifecycle per purpose",async t=>{
  const assertDecisionUnchanged=async(root:string,expected:{ok:false;reason:"busy"|"corruption"})=>{const before=await snapshotRootArtifacts(root);let semanticNow=0,callbacks=0,legacyMutations=0;const result=await new RawFsAuthorityLedger(root,{now:()=>{semanticNow++;return t0;},lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="before-ledger-operation-callback")callbacks++;if(legacyMutationBoundaries.has(point))legacyMutations++;}} as never).observeClock();assert.deepEqual(result,expected);assert.deepEqual(await snapshotRootArtifacts(root),before);assert.deepEqual({semanticNow,callbacks,legacyMutations},{semanticNow:0,callbacks:0,legacyMutations:0});};
  const writeWithdrawnChain=async(root:string,owner:AdmissionOwner)=>{const withdrawal=await writeCreatorWithdrawal(root,owner,"partial"),withdrawalName=path.basename(withdrawal),slotName=admissionRetiredName(owner,"withdrawn"),slot=path.join(root,slotName);await mkdir(slot);await writeFile(path.join(slot,"owner.json"),publicationOwnerBytes(owner));const slotAck=slotCoordinationAck(owner,slotName,slot,"withdrawn",withdrawalName,ownerStateBytes(owner,"partial"));return {slot,slotAck,slotAckBytes:authorityCanonicalBytes(slotAck),slotName,withdrawal,withdrawalName};};
  for(const stageState of ["zero","strict-prefix","complete"] as const)await t.test(`marker-bound exact ${stageState} slot-retired stage remains non-authorizing busy`,()=>withRoot(async root=>{const owner={host:hostname(),nonce:(stageState==="zero"?"1":stageState==="strict-prefix"?"2":"3").repeat(64),pid:process.pid,v:1 as const},chain=await writeWithdrawnChain(root,owner),stageBytes=stageState==="zero"?Buffer.alloc(0):stageState==="strict-prefix"?chain.slotAckBytes.subarray(0,chain.slotAckBytes.length-1):chain.slotAckBytes;assert.equal(stageState==="complete"||stageBytes.length<chain.slotAckBytes.length,true);if(stageBytes.length<chain.slotAckBytes.length)assert.deepEqual(stageBytes,chain.slotAckBytes.subarray(0,stageBytes.length));await writeFile(path.join(root,coordinationStageName(chain.slotAck,"slot-retired")),stageBytes);await assertDecisionUnchanged(root,{ok:false,reason:"busy"});}));
  for(const stageState of ["zero","strict-prefix","complete"] as const)await t.test(`exact slot-retired final plus marker-bound ${stageState} creator-withdrawal stage remains cross-purpose busy`,()=>withRoot(async root=>{const owner={host:hostname(),nonce:(stageState==="zero"?"4":stageState==="strict-prefix"?"5":"6").repeat(64),pid:process.pid,v:1 as const},chain=await writeWithdrawnChain(root,owner);await writeFile(path.join(root,coordinationAckName(chain.slotAck)),chain.slotAckBytes);await rm(chain.slot,{recursive:true});const withdrawalAck=incompleteCoordinationAck(owner,"creator-withdrawal",chain.withdrawalName,publicationStageName({...owner,ticket:"0000000000000001"}),"partial",chain.withdrawal,chain.slotAck),ackBytes=authorityCanonicalBytes(withdrawalAck),stageBytes=stageState==="zero"?Buffer.alloc(0):stageState==="strict-prefix"?ackBytes.subarray(0,ackBytes.length-1):ackBytes;assert.equal(stageState==="complete"||stageBytes.length<ackBytes.length,true);if(stageBytes.length<ackBytes.length)assert.deepEqual(stageBytes,ackBytes.subarray(0,stageBytes.length));await writeFile(path.join(root,coordinationStageName(withdrawalAck,"creator-withdrawal")),stageBytes);await assertDecisionUnchanged(root,{ok:false,reason:"busy"});}));
  await t.test("orphan zero-byte slot-retired stage with its exact reconstructed digest is corruption",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"7".repeat(64),pid:process.pid,v:1 as const},chain=await writeWithdrawnChain(root,owner),stageName=coordinationStageName(chain.slotAck,"slot-retired");await rm(chain.slot,{recursive:true});await writeFile(path.join(root,stageName),Buffer.alloc(0));assert.equal(stageName,coordinationStageName(chain.slotAck,"slot-retired"));await assertDecisionUnchanged(root,{ok:false,reason:"corruption"});}));
  await t.test("marker-bound same-digest non-prefix slot-retired stage is corruption",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"8".repeat(64),pid:process.pid,v:1 as const},chain=await writeWithdrawnChain(root,owner),bad=Buffer.from("{garbage");assert.equal(bad.equals(chain.slotAckBytes.subarray(0,bad.length)),false,"fixture is not a canonical strict prefix");await writeFile(path.join(root,coordinationStageName(chain.slotAck,"slot-retired")),bad);await assertDecisionUnchanged(root,{ok:false,reason:"corruption"});}));
  await t.test("orphan zero-byte creator-withdrawal stage with its exact reconstructed digest is corruption",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"9".repeat(64),pid:process.pid,v:1 as const},chain=await writeWithdrawnChain(root,owner),withdrawalAck=incompleteCoordinationAck(owner,"creator-withdrawal",chain.withdrawalName,publicationStageName({...owner,ticket:"0000000000000001"}),"partial",chain.withdrawal,chain.slotAck),stageName=coordinationStageName(withdrawalAck,"creator-withdrawal");await writeFile(path.join(root,coordinationAckName(chain.slotAck)),chain.slotAckBytes);await rm(chain.slot,{recursive:true});await rm(chain.withdrawal,{recursive:true});await writeFile(path.join(root,stageName),Buffer.alloc(0));assert.equal(stageName,coordinationStageName(withdrawalAck,"creator-withdrawal"));await assertDecisionUnchanged(root,{ok:false,reason:"corruption"});}));
  await t.test("exact predecessor chain plus same-digest non-prefix creator-withdrawal stage is corruption",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"a".repeat(64),pid:process.pid,v:1 as const},chain=await writeWithdrawnChain(root,owner);await writeFile(path.join(root,coordinationAckName(chain.slotAck)),chain.slotAckBytes);await rm(chain.slot,{recursive:true});const withdrawalAck=incompleteCoordinationAck(owner,"creator-withdrawal",chain.withdrawalName,publicationStageName({...owner,ticket:"0000000000000001"}),"partial",chain.withdrawal,chain.slotAck),ackBytes=authorityCanonicalBytes(withdrawalAck),bad=Buffer.from("{garbage");assert.equal(bad.equals(ackBytes.subarray(0,bad.length)),false,"fixture is not a canonical strict prefix");await writeFile(path.join(root,coordinationStageName(withdrawalAck,"creator-withdrawal")),bad);await assertDecisionUnchanged(root,{ok:false,reason:"corruption"});}));
  await t.test("independently valid prep final and distinct marker-bound prep stage cannot share one cleanup purpose",async()=>{const finalOwner={host:hostname(),nonce:"b".repeat(64),pid:process.pid,v:1 as const},stageOwner={host:hostname(),nonce:"c".repeat(64),pid:process.pid,v:1 as const},writeFinal=async(root:string)=>{const markerName=admissionPrepRetiredName(finalOwner,"complete"),marker=path.join(root,markerName);await mkdir(marker);await writeFile(path.join(marker,"owner.json"),publicationOwnerBytes(finalOwner));const ack=incompleteCoordinationAck(finalOwner,"prep-retired",markerName,admissionPrepName(finalOwner),"complete",marker);await rm(marker,{recursive:true});await writeFile(path.join(root,coordinationAckName(ack)),authorityCanonicalBytes(ack));return ack;},writeStage=async(root:string)=>{const markerName=admissionPrepRetiredName(stageOwner,"complete"),marker=path.join(root,markerName);await mkdir(marker);await writeFile(path.join(marker,"owner.json"),publicationOwnerBytes(stageOwner));const ack=incompleteCoordinationAck(stageOwner,"prep-retired",markerName,admissionPrepName(stageOwner),"complete",marker);await writeFile(path.join(root,coordinationStageName(ack,"prep-retired")),Buffer.alloc(0));return ack;};await withRoot(async root=>{await writeFinal(root);await assertDecisionUnchanged(root,{ok:false,reason:"busy"});});await withRoot(async root=>{await writeStage(root);await assertDecisionUnchanged(root,{ok:false,reason:"busy"});});await withRoot(async root=>{const finalAck=await writeFinal(root),stageAck=await writeStage(root);assert.notEqual(coordinationAckName(finalAck),coordinationAckName(stageAck));await assertDecisionUnchanged(root,{ok:false,reason:"corruption"});});});
});

test("K1 published slot binds exactly one same-owner active or retired successor",async t=>{
  type PublishedSuccessor="active"|TestRetirementDisposition;
  const assertDecisionUnchanged=async(root:string,expected:{ok:false;reason:"busy"|"corruption"})=>{const before=await snapshotRootArtifacts(root);let semanticNow=0,callbacks=0,legacyMutations=0;const result=await new RawFsAuthorityLedger(root,{now:()=>{semanticNow++;return t0;},lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="before-ledger-operation-callback")callbacks++;if(legacyMutationBoundaries.has(point))legacyMutations++;}} as never).observeClock();assert.deepEqual(result,expected);assert.deepEqual(await snapshotRootArtifacts(root),before);assert.deepEqual({semanticNow,callbacks,legacyMutations},{semanticNow:0,callbacks:0,legacyMutations:0});};
  const writePublishedSlot=async(root:string,owner:AdmissionOwner)=>{const name=admissionRetiredName(owner,"published"),marker=path.join(root,name);await mkdir(marker);await writeFile(path.join(marker,"owner.json"),publicationOwnerBytes(owner));return {marker,name};};
  const writeSuccessor=async(root:string,owner:AdmissionOwner,kind:PublishedSuccessor)=>{const name=kind==="active"?"lock":retirementMarkerName(owner,kind),directory=path.join(root,name),bytes=publicationOwnerBytes(owner);await mkdir(directory);await writeFile(path.join(directory,"owner.json"),bytes);return {bytes,directory,kind,name};};
  for(const successor of ["active","released","recovery-pending","publication-aborted"] as const)await t.test(`published marker plus one exact same-owner ${successor} successor remains busy`,()=>withRoot(async root=>{const owner={host:hostname(),nonce:({active:"1",released:"2","recovery-pending":"3","publication-aborted":"4"} as const)[successor].repeat(64),pid:process.pid,v:1 as const};await writePublishedSlot(root,owner);await writeSuccessor(root,owner,successor);await assertDecisionUnchanged(root,{ok:false,reason:"busy"});}));
  for(const successor of ["active","released","recovery-pending"] as const)await t.test(`published marker plus exact ${successor} proof and zero-byte cleanup stage remains busy`,()=>withRoot(async root=>{const owner={host:hostname(),nonce:({active:"5",released:"6","recovery-pending":"7"} as const)[successor].repeat(64),pid:process.pid,v:1 as const},slot=await writePublishedSlot(root,owner),terminal=await writeSuccessor(root,owner,successor),ack=slotCoordinationAck(owner,slot.name,slot.marker,"published",terminal.name,terminal.bytes);await writeFile(path.join(root,coordinationStageName(ack,"slot-retired")),Buffer.alloc(0));await assertDecisionUnchanged(root,{ok:false,reason:"busy"});}));
  for(const stageState of ["zero","strict-prefix","complete"] as const)await t.test(`published marker plus publication-aborted proof and exact ${stageState} cleanup stage remains busy`,()=>withRoot(async root=>{const owner={host:hostname(),nonce:(stageState==="zero"?"8":stageState==="strict-prefix"?"9":"a").repeat(64),pid:process.pid,v:1 as const},slot=await writePublishedSlot(root,owner),terminal=await writeSuccessor(root,owner,"publication-aborted"),ack=slotCoordinationAck(owner,slot.name,slot.marker,"published",terminal.name,terminal.bytes),ackBytes=authorityCanonicalBytes(ack),stageBytes=stageState==="zero"?Buffer.alloc(0):stageState==="strict-prefix"?ackBytes.subarray(0,ackBytes.length-1):ackBytes;assert.equal(stageState==="complete"||stageBytes.length<ackBytes.length,true);if(stageBytes.length<ackBytes.length)assert.deepEqual(stageBytes,ackBytes.subarray(0,stageBytes.length));await writeFile(path.join(root,coordinationStageName(ack,"slot-retired")),stageBytes);await assertDecisionUnchanged(root,{ok:false,reason:"busy"});}));
  await t.test("published marker plus wrong-owner active successor is corruption",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"b".repeat(64),pid:process.pid,v:1 as const},wrong={host:hostname(),nonce:"c".repeat(64),pid:process.pid,v:1 as const};await writePublishedSlot(root,owner);await writeSuccessor(root,wrong,"active");await assertDecisionUnchanged(root,{ok:false,reason:"corruption"});}));
  await t.test("published marker plus wrong-owner retired successor is corruption",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"d".repeat(64),pid:process.pid,v:1 as const},wrong={host:hostname(),nonce:"e".repeat(64),pid:process.pid,v:1 as const};await writePublishedSlot(root,owner);await writeSuccessor(root,wrong,"released");await assertDecisionUnchanged(root,{ok:false,reason:"corruption"});}));
  await t.test("published marker plus same-owner active and retired successors is corruption",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"f".repeat(64),pid:process.pid,v:1 as const};await writePublishedSlot(root,owner);await writeSuccessor(root,owner,"active");await writeSuccessor(root,owner,"released");await assertDecisionUnchanged(root,{ok:false,reason:"corruption"});}));
  await t.test("published marker plus two same-owner retired dispositions is corruption",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"0".repeat(64),pid:process.pid,v:1 as const};await writePublishedSlot(root,owner);await writeSuccessor(root,owner,"released");await writeSuccessor(root,owner,"recovery-pending");await assertDecisionUnchanged(root,{ok:false,reason:"corruption"});}));
  await t.test("published marker plus one exact and one unrelated wrong-owner retired successor is corruption",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"1".repeat(64),pid:process.pid,v:1 as const},wrong={host:hostname(),nonce:"2".repeat(64),pid:process.pid,v:1 as const};await writePublishedSlot(root,owner);await writeSuccessor(root,owner,"released");await writeSuccessor(root,wrong,"recovery-pending");await assertDecisionUnchanged(root,{ok:false,reason:"corruption"});}));
});

test("K1 marker-absent final acknowledgments require one coherent whole-generation crash graph",async t=>{
  const assertDecisionUnchanged=async(root:string,expected:{ok:false;reason:"busy"|"corruption"})=>{const before=await snapshotRootArtifacts(root);let semanticNow=0,callbacks=0,legacyMutations=0;const result=await new RawFsAuthorityLedger(root,{now:()=>{semanticNow++;return t0;},lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="before-ledger-operation-callback")callbacks++;if(legacyMutationBoundaries.has(point))legacyMutations++;}} as never).observeClock();assert.deepEqual(result,expected);assert.deepEqual(await snapshotRootArtifacts(root),before);assert.deepEqual({semanticNow,callbacks,legacyMutations},{semanticNow:0,callbacks:0,legacyMutations:0});};
  const writeOwnerDirectory=async(root:string,name:string,owner:AdmissionOwner)=>{const directory=path.join(root,name);await mkdir(directory);await writeFile(path.join(directory,"owner.json"),publicationOwnerBytes(owner));return directory;};
  const writePrepOrphan=async(root:string,owner:AdmissionOwner)=>{const markerName=admissionPrepRetiredName(owner,"complete"),marker=await writeOwnerDirectory(root,markerName,owner),ack=incompleteCoordinationAck(owner,"prep-retired",markerName,admissionPrepName(owner),"complete",marker),ackPath=path.join(root,coordinationAckName(ack));await writeFile(ackPath,authorityCanonicalBytes(ack));await rm(marker,{recursive:true});return {ack,ackPath};};
  const writeSlotOrphan=async(root:string,owner:AdmissionOwner,disposition:"published"|"withdrawn"|"abandoned",terminalName:string,terminalBytes:Buffer)=>{const markerName=admissionRetiredName(owner,disposition),marker=await writeOwnerDirectory(root,markerName,owner),ack=slotCoordinationAck(owner,markerName,marker,disposition,terminalName,terminalBytes),ackPath=path.join(root,coordinationAckName(ack));await writeFile(ackPath,authorityCanonicalBytes(ack));await rm(marker,{recursive:true});return {ack,ackPath};};
  const writePublishedOrphan=async(root:string,owner:AdmissionOwner)=>{const terminalName=retirementMarkerName(owner,"released"),terminal=await writeOwnerDirectory(root,terminalName,owner),orphan=await writeSlotOrphan(root,owner,"published",terminalName,publicationOwnerBytes(owner));return {...orphan,terminal,terminalName};};
  const writeWithdrawnOrphan=async(root:string,owner:AdmissionOwner)=>{const withdrawal=await writeCreatorWithdrawal(root,owner,"partial"),withdrawalName=path.basename(withdrawal),orphan=await writeSlotOrphan(root,owner,"withdrawn",withdrawalName,ownerStateBytes(owner,"partial"));return {...orphan,withdrawal,withdrawalName};};
  const writeWithdrawalFinalOrphan=async(root:string,owner:AdmissionOwner)=>{const withdrawal=await writeCreatorWithdrawal(root,owner,"partial"),withdrawalName=path.basename(withdrawal),slotName=admissionRetiredName(owner,"withdrawn"),slot=await writeOwnerDirectory(root,slotName,owner),slotAck=slotCoordinationAck(owner,slotName,slot,"withdrawn",withdrawalName,ownerStateBytes(owner,"partial")),slotAckPath=path.join(root,coordinationAckName(slotAck)),withdrawalAck=incompleteCoordinationAck(owner,"creator-withdrawal",withdrawalName,publicationStageName({...owner,ticket:"0000000000000001"}),"partial",withdrawal,slotAck),withdrawalAckPath=path.join(root,coordinationAckName(withdrawalAck));await writeFile(slotAckPath,authorityCanonicalBytes(slotAck));await rm(slot,{recursive:true});await writeFile(withdrawalAckPath,authorityCanonicalBytes(withdrawalAck));await rm(slotAckPath);await rm(withdrawal,{recursive:true});return {withdrawalAck,withdrawalAckPath};};
  await t.test("orphan prep-retired final alone remains busy",()=>withRoot(async root=>{await writePrepOrphan(root,{host:hostname(),nonce:"1".repeat(64),pid:process.pid,v:1 as const});await assertDecisionUnchanged(root,{ok:false,reason:"busy"});}));
  await t.test("valid orphan prep-retired final plus unrelated active lock is corruption",()=>withRoot(async root=>{await writePrepOrphan(root,{host:hostname(),nonce:"2".repeat(64),pid:process.pid,v:1 as const});await writeOwnerDirectory(root,"lock",{host:hostname(),nonce:"3".repeat(64),pid:process.pid,v:1 as const});await assertDecisionUnchanged(root,{ok:false,reason:"corruption"});}));
  await t.test("orphan published-slot final plus its exact released successor remains busy",()=>withRoot(async root=>{await writePublishedOrphan(root,{host:hostname(),nonce:"4".repeat(64),pid:process.pid,v:1 as const});await assertDecisionUnchanged(root,{ok:false,reason:"busy"});}));
  await t.test("orphan published-slot final plus second same-owner retired successor is corruption",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"5".repeat(64),pid:process.pid,v:1 as const};await writePublishedOrphan(root,owner);await writeOwnerDirectory(root,retirementMarkerName(owner,"recovery-pending"),owner);await assertDecisionUnchanged(root,{ok:false,reason:"corruption"});}));
  await t.test("orphan published-slot final plus wrong-owner successor is corruption",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"6".repeat(64),pid:process.pid,v:1 as const},wrong={host:hostname(),nonce:"7".repeat(64),pid:process.pid,v:1 as const};await writePublishedOrphan(root,owner);await writeOwnerDirectory(root,retirementMarkerName(wrong,"recovery-pending"),wrong);await assertDecisionUnchanged(root,{ok:false,reason:"corruption"});}));
  await t.test("orphan withdrawn-slot final plus its exact partial withdrawal marker remains busy",()=>withRoot(async root=>{await writeWithdrawnOrphan(root,{host:hostname(),nonce:"8".repeat(64),pid:process.pid,v:1 as const});await assertDecisionUnchanged(root,{ok:false,reason:"busy"});}));
  await t.test("orphan withdrawn-slot final plus second same-owner publication-aborted terminal is corruption",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"9".repeat(64),pid:process.pid,v:1 as const};await writeWithdrawnOrphan(root,owner);await writeOwnerDirectory(root,retirementMarkerName(owner,"publication-aborted"),owner);await assertDecisionUnchanged(root,{ok:false,reason:"corruption"});}));
  await t.test("dead-owner orphan abandoned-slot final remains busy",async()=>{const owner={host:hostname(),nonce:"a".repeat(64),pid:await exitedProcessPid(),v:1 as const};await withRoot(async root=>{const markerName=admissionRetiredName(owner,"abandoned"),marker=await writeOwnerDirectory(root,markerName,owner),ack=slotCoordinationAck(owner,markerName,marker,"abandoned"),ackPath=path.join(root,coordinationAckName(ack));await writeFile(ackPath,authorityCanonicalBytes(ack));await rm(marker,{recursive:true});await assertDecisionUnchanged(root,{ok:false,reason:"busy"});});});
  await t.test("live-owner orphan abandoned-slot final is corruption",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"b".repeat(64),pid:process.pid,v:1 as const},markerName=admissionRetiredName(owner,"abandoned"),marker=await writeOwnerDirectory(root,markerName,owner),ack=slotCoordinationAck(owner,markerName,marker,"abandoned"),ackPath=path.join(root,coordinationAckName(ack));await writeFile(ackPath,authorityCanonicalBytes(ack));await rm(marker,{recursive:true});await assertDecisionUnchanged(root,{ok:false,reason:"corruption"});}));
  await t.test("dead-valid orphan abandoned-slot final plus unrelated successor is corruption",async()=>{const owner={host:hostname(),nonce:"c".repeat(64),pid:await exitedProcessPid(),v:1 as const};await withRoot(async root=>{const markerName=admissionRetiredName(owner,"abandoned"),marker=await writeOwnerDirectory(root,markerName,owner),ack=slotCoordinationAck(owner,markerName,marker,"abandoned"),ackPath=path.join(root,coordinationAckName(ack));await writeFile(ackPath,authorityCanonicalBytes(ack));await rm(marker,{recursive:true});await writeOwnerDirectory(root,retirementMarkerName(owner,"released"),owner);await assertDecisionUnchanged(root,{ok:false,reason:"corruption"});});});
  await t.test("orphan creator-withdrawal final with its completed referenced chain remains busy",()=>withRoot(async root=>{await writeWithdrawalFinalOrphan(root,{host:hostname(),nonce:"d".repeat(64),pid:process.pid,v:1 as const});await assertDecisionUnchanged(root,{ok:false,reason:"busy"});}));
  for(const residue of ["active","retired","k1"] as const)await t.test(`orphan creator-withdrawal final plus unrelated ${residue} residue is ${residue==="retired"?"inert-tolerated busy":"corruption"}`,()=>withRoot(async root=>{await writeWithdrawalFinalOrphan(root,{host:hostname(),nonce:"e".repeat(64),pid:process.pid,v:1 as const});const unrelated={host:hostname(),nonce:(residue==="active"?"f":residue==="retired"?"0":"1").repeat(64),pid:process.pid,v:1 as const};if(residue==="active")await writeOwnerDirectory(root,"lock",unrelated);else if(residue==="retired")await writeOwnerDirectory(root,retirementMarkerName(unrelated,"released"),unrelated);else await writeAdmissionPrep(root,unrelated,"complete");await assertDecisionUnchanged(root,{ok:false,reason:residue==="retired"?"busy":"corruption"});}));
  await t.test("two independently valid orphan lineages cannot share one generation",async()=>{const prepOwner={host:hostname(),nonce:"2".repeat(64),pid:process.pid,v:1 as const},slotOwner={host:hostname(),nonce:"3".repeat(64),pid:process.pid,v:1 as const};await withRoot(async root=>{await writePrepOrphan(root,prepOwner);await assertDecisionUnchanged(root,{ok:false,reason:"busy"});});await withRoot(async root=>{await writePublishedOrphan(root,slotOwner);await assertDecisionUnchanged(root,{ok:false,reason:"busy"});});await withRoot(async root=>{await writePrepOrphan(root,prepOwner);await writePublishedOrphan(root,slotOwner);await assertDecisionUnchanged(root,{ok:false,reason:"corruption"});});});
  for(const lifecycle of ["stage","final"] as const)await t.test(`coherent withdrawal plus slot final plus withdrawal ${lifecycle} remains busy`,()=>withRoot(async root=>{const owner={host:hostname(),nonce:(lifecycle==="stage"?"4":"5").repeat(64),pid:process.pid,v:1 as const},withdrawal=await writeCreatorWithdrawal(root,owner,"partial"),withdrawalName=path.basename(withdrawal),slotName=admissionRetiredName(owner,"withdrawn"),slot=await writeOwnerDirectory(root,slotName,owner),slotAck=slotCoordinationAck(owner,slotName,slot,"withdrawn",withdrawalName,ownerStateBytes(owner,"partial")),slotAckPath=path.join(root,coordinationAckName(slotAck));await writeFile(slotAckPath,authorityCanonicalBytes(slotAck));await rm(slot,{recursive:true});const withdrawalAck=incompleteCoordinationAck(owner,"creator-withdrawal",withdrawalName,publicationStageName({...owner,ticket:"0000000000000001"}),"partial",withdrawal,slotAck),target=lifecycle==="stage"?coordinationStageName(withdrawalAck,"creator-withdrawal"):coordinationAckName(withdrawalAck);await writeFile(path.join(root,target),authorityCanonicalBytes(withdrawalAck));await assertDecisionUnchanged(root,{ok:false,reason:"busy"});}));
});

test("K1 cleanup generations reject legacy debris and non-monotonic creator closure",async t=>{
  const assertDecisionUnchanged=async(root:string,expected:{ok:false;reason:"busy"|"corruption"})=>{const before=await snapshotRootArtifacts(root);let semanticNow=0,callbacks=0,legacyMutations=0;const result=await new RawFsAuthorityLedger(root,{now:()=>{semanticNow++;return t0;},lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="before-ledger-operation-callback")callbacks++;if(legacyMutationBoundaries.has(point))legacyMutations++;}} as never).observeClock();assert.deepEqual(result,expected);assert.deepEqual(await snapshotRootArtifacts(root),before);assert.deepEqual({semanticNow,callbacks,legacyMutations},{semanticNow:0,callbacks:0,legacyMutations:0});};
  const writeOwnerDirectory=async(root:string,name:string,owner:AdmissionOwner)=>{const directory=path.join(root,name);await mkdir(directory);await writeFile(path.join(directory,"owner.json"),publicationOwnerBytes(owner));return directory;};
  const writePrepOrphan=async(root:string,owner:AdmissionOwner)=>{const markerName=admissionPrepRetiredName(owner,"complete"),marker=await writeOwnerDirectory(root,markerName,owner),ack=incompleteCoordinationAck(owner,"prep-retired",markerName,admissionPrepName(owner),"complete",marker);await writeFile(path.join(root,coordinationAckName(ack)),authorityCanonicalBytes(ack));await rm(marker,{recursive:true});};
  const writeWithdrawalBase=async(root:string,owner:AdmissionOwner)=>{const withdrawal=await writeCreatorWithdrawal(root,owner,"partial"),withdrawalName=path.basename(withdrawal),slotName=admissionRetiredName(owner,"withdrawn"),slot=await writeOwnerDirectory(root,slotName,owner),slotAck=slotCoordinationAck(owner,slotName,slot,"withdrawn",withdrawalName,ownerStateBytes(owner,"partial")),slotAckPath=path.join(root,coordinationAckName(slotAck)),creatorAck=incompleteCoordinationAck(owner,"creator-withdrawal",withdrawalName,publicationStageName({...owner,ticket:"0000000000000001"}),"partial",withdrawal,slotAck),creatorAckPath=path.join(root,coordinationAckName(creatorAck));return {creatorAck,creatorAckPath,slot,slotAck,slotAckPath,withdrawal,withdrawalName};};
  for(const artifact of ["malformed-ack","malformed-stage","ack-directory"] as const)await t.test(`orphan prep final plus exact-name legacy ${artifact} is corruption`,()=>withRoot(async root=>{await writePrepOrphan(root,{host:hostname(),nonce:"1".repeat(64),pid:process.pid,v:1 as const});const owner={host:hostname(),nonce:(artifact==="malformed-ack"?"2":artifact==="malformed-stage"?"3":"4").repeat(64),pid:process.pid,v:1 as const},markerName=retirementMarkerName(owner,"released"),ack=cleanupAck(owner,markerName,"released",null),target=artifact==="malformed-stage"?cleanupStageName(owner,ack):cleanupAckName(ack),absolute=path.join(root,target);if(artifact==="ack-directory")await mkdir(absolute);else await writeFile(absolute,Buffer.from("{garbage"));await assertDecisionUnchanged(root,{ok:false,reason:"corruption"});}));
  await t.test("orphan prep final plus a separate valid legacy retired-marker acknowledgment lineage is corruption",()=>withRoot(async root=>{await writePrepOrphan(root,{host:hostname(),nonce:"5".repeat(64),pid:process.pid,v:1 as const});const owner={host:hostname(),nonce:"6".repeat(64),pid:process.pid,v:1 as const},markerName=retirementMarkerName(owner,"released");await writeOwnerDirectory(root,markerName,owner);const ack=cleanupAck(owner,markerName,"released",null);await writeFile(path.join(root,cleanupAckName(ack)),authorityCanonicalBytes(ack));await assertDecisionUnchanged(root,{ok:false,reason:"corruption"});}));
  for(const lifecycle of ["ack","stage"] as const)await t.test(`published slot and released successor may coexist with that successor's exact legacy cleanup ${lifecycle}`,()=>withRoot(async root=>{const owner={host:hostname(),nonce:(lifecycle==="ack"?"7":"8").repeat(64),pid:process.pid,v:1 as const},slotName=admissionRetiredName(owner,"published");await writeOwnerDirectory(root,slotName,owner);const markerName=retirementMarkerName(owner,"released");await writeOwnerDirectory(root,markerName,owner);const ack=cleanupAck(owner,markerName,"released",null),target=lifecycle==="ack"?cleanupAckName(ack):cleanupStageName(owner,ack);await writeFile(path.join(root,target),authorityCanonicalBytes(ack));await assertDecisionUnchanged(root,{ok:false,reason:"busy"});}));
  await t.test("withdrawal plus slot final plus creator final is busy only after slot marker absence",()=>withRoot(async root=>{const graph=await writeWithdrawalBase(root,{host:hostname(),nonce:"9".repeat(64),pid:process.pid,v:1 as const});await writeFile(graph.slotAckPath,authorityCanonicalBytes(graph.slotAck));await rm(graph.slot,{recursive:true});await writeFile(graph.creatorAckPath,authorityCanonicalBytes(graph.creatorAck));await assertDecisionUnchanged(root,{ok:false,reason:"busy"});}));
  await t.test("creator final while its withdrawn slot marker remains present is corruption",()=>withRoot(async root=>{const graph=await writeWithdrawalBase(root,{host:hostname(),nonce:"a".repeat(64),pid:process.pid,v:1 as const});await writeFile(graph.slotAckPath,authorityCanonicalBytes(graph.slotAck));await writeFile(graph.creatorAckPath,authorityCanonicalBytes(graph.creatorAck));await assertDecisionUnchanged(root,{ok:false,reason:"corruption"});}));
  await t.test("step-five withdrawal plus creator final remains busy",()=>withRoot(async root=>{const graph=await writeWithdrawalBase(root,{host:hostname(),nonce:"b".repeat(64),pid:process.pid,v:1 as const});await writeFile(graph.slotAckPath,authorityCanonicalBytes(graph.slotAck));await rm(graph.slot,{recursive:true});await writeFile(graph.creatorAckPath,authorityCanonicalBytes(graph.creatorAck));await rm(graph.slotAckPath);await assertDecisionUnchanged(root,{ok:false,reason:"busy"});}));
  for(const residue of ["active","retired","publication-stage"] as const)await t.test(`step-five creator final plus unrelated ${residue} residue is ${residue==="retired"?"inert-tolerated busy":"corruption"}`,()=>withRoot(async root=>{const owner={host:hostname(),nonce:(residue==="active"?"c":residue==="retired"?"d":"e").repeat(64),pid:process.pid,v:1 as const},graph=await writeWithdrawalBase(root,owner);await writeFile(graph.slotAckPath,authorityCanonicalBytes(graph.slotAck));await rm(graph.slot,{recursive:true});await writeFile(graph.creatorAckPath,authorityCanonicalBytes(graph.creatorAck));await rm(graph.slotAckPath);if(residue==="publication-stage")await writePublicationStage(root,{...owner,ticket:"0000000000000001"},publicationOwnerBytes(owner));else{const unrelated={host:hostname(),nonce:(residue==="active"?"f":"0").repeat(64),pid:process.pid,v:1 as const},name=residue==="active"?"lock":retirementMarkerName(unrelated,"released");await writeOwnerDirectory(root,name,unrelated);}await assertDecisionUnchanged(root,{ok:false,reason:residue==="retired"?"busy":"corruption"});}));
  await t.test("withdrawn slot plus withdrawal plus slot final remains busy",()=>withRoot(async root=>{const graph=await writeWithdrawalBase(root,{host:hostname(),nonce:"1".repeat(64),pid:process.pid,v:1 as const});await writeFile(graph.slotAckPath,authorityCanonicalBytes(graph.slotAck));await assertDecisionUnchanged(root,{ok:false,reason:"busy"});}));
  await t.test("withdrawn slot lineage plus unrelated released retirement is inert-tolerated busy",()=>withRoot(async root=>{const graph=await writeWithdrawalBase(root,{host:hostname(),nonce:"2".repeat(64),pid:process.pid,v:1 as const});await writeFile(graph.slotAckPath,authorityCanonicalBytes(graph.slotAck));const unrelated={host:hostname(),nonce:"3".repeat(64),pid:process.pid,v:1 as const};await writeOwnerDirectory(root,retirementMarkerName(unrelated,"released"),unrelated);await assertDecisionUnchanged(root,{ok:false,reason:"busy"});}));
});

test("K1 final acknowledgments preserve prerequisite order and reconstructible historical commitments",async t=>{
  const assertDecisionUnchanged=async(root:string,expected:{ok:false;reason:"busy"|"corruption"})=>{const before=await snapshotRootArtifacts(root);let semanticNow=0,callbacks=0,legacyMutations=0;const result=await new RawFsAuthorityLedger(root,{now:()=>{semanticNow++;return t0;},lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="before-ledger-operation-callback")callbacks++;if(legacyMutationBoundaries.has(point))legacyMutations++;}} as never).observeClock();assert.deepEqual(result,expected);assert.deepEqual(await snapshotRootArtifacts(root),before);assert.deepEqual({semanticNow,callbacks,legacyMutations},{semanticNow:0,callbacks:0,legacyMutations:0});};
  const writeOwnerDirectory=async(root:string,name:string,owner:AdmissionOwner)=>{const directory=path.join(root,name);await mkdir(directory);await writeFile(path.join(directory,"owner.json"),publicationOwnerBytes(owner));return directory;};
  const writeWithdrawalBase=async(root:string,owner:AdmissionOwner)=>{const withdrawal=await writeCreatorWithdrawal(root,owner,"partial"),withdrawalName=path.basename(withdrawal),slotName=admissionRetiredName(owner,"withdrawn"),slot=await writeOwnerDirectory(root,slotName,owner),slotAck=slotCoordinationAck(owner,slotName,slot,"withdrawn",withdrawalName,ownerStateBytes(owner,"partial")),slotAckPath=path.join(root,coordinationAckName(slotAck)),creatorAck=incompleteCoordinationAck(owner,"creator-withdrawal",withdrawalName,publicationStageName({...owner,ticket:"0000000000000001"}),"partial",withdrawal,slotAck),creatorAckPath=path.join(root,coordinationAckName(creatorAck));return {creatorAck,creatorAckPath,slot,slotAck,slotAckPath,withdrawal};};
  const writeSlotOrphan=async(root:string,owner:AdmissionOwner,disposition:"published"|"withdrawn"|"abandoned",mutate:(ack:Readonly<Record<string,unknown>>)=>Readonly<Record<string,unknown>>=ack=>ack)=>{let terminalName:string,terminalBytes:Buffer;if(disposition==="published"){terminalName=retirementMarkerName(owner,"released");await writeOwnerDirectory(root,terminalName,owner);terminalBytes=publicationOwnerBytes(owner);}else if(disposition==="withdrawn"){const terminal=await writeCreatorWithdrawal(root,owner,"partial");terminalName=path.basename(terminal);terminalBytes=ownerStateBytes(owner,"partial");}else{terminalName=admissionRetiredName(owner,"abandoned");terminalBytes=publicationOwnerBytes(owner);}const markerName=admissionRetiredName(owner,disposition),marker=await writeOwnerDirectory(root,markerName,owner),exact=slotCoordinationAck(owner,markerName,marker,disposition,terminalName,terminalBytes),record=mutate(exact),ackPath=path.join(root,coordinationAckName(record));await writeFile(ackPath,authorityCanonicalBytes(record));await rm(marker,{recursive:true});return {ackPath,exact,record};};
  await t.test("slot-absent step-five creator final remains busy",()=>withRoot(async root=>{const graph=await writeWithdrawalBase(root,{host:hostname(),nonce:"1".repeat(64),pid:process.pid,v:1 as const});await writeFile(graph.slotAckPath,authorityCanonicalBytes(graph.slotAck));await rm(graph.slot,{recursive:true});await writeFile(graph.creatorAckPath,authorityCanonicalBytes(graph.creatorAck));await rm(graph.slotAckPath);await assertDecisionUnchanged(root,{ok:false,reason:"busy"});}));
  await t.test("creator final with exact withdrawn slot marker but absent referenced slot final is corruption",()=>withRoot(async root=>{const graph=await writeWithdrawalBase(root,{host:hostname(),nonce:"2".repeat(64),pid:process.pid,v:1 as const});assert.equal(existsSync(graph.slotAckPath),false,"the referenced final slot acknowledgment is absent");await writeFile(graph.creatorAckPath,authorityCanonicalBytes(graph.creatorAck));await assertDecisionUnchanged(root,{ok:false,reason:"corruption"});}));
  for(const lifecycle of ["ack","zero-stage","prefix-stage","complete-stage"] as const)await t.test(`published slot with publication-aborted successor and exact legacy cleanup ${lifecycle} remains busy`,()=>withRoot(async root=>{const owner={host:hostname(),nonce:({ack:"3","zero-stage":"4","prefix-stage":"5","complete-stage":"6"} as const)[lifecycle].repeat(64),pid:process.pid,v:1 as const},slotName=admissionRetiredName(owner,"published");await writeOwnerDirectory(root,slotName,owner);const terminalName=retirementMarkerName(owner,"publication-aborted");await writeOwnerDirectory(root,terminalName,owner);const ack=cleanupAck(owner,terminalName,"publication-aborted",null),ackBytes=authorityCanonicalBytes(ack),target=lifecycle==="ack"?cleanupAckName(ack):cleanupStageName(owner,ack),bytes=lifecycle==="ack"||lifecycle==="complete-stage"?ackBytes:lifecycle==="zero-stage"?Buffer.alloc(0):ackBytes.subarray(0,Math.min(17,ackBytes.length-1));if(lifecycle==="prefix-stage")assert.deepEqual(bytes,ackBytes.subarray(0,bytes.length));await writeFile(path.join(root,target),bytes);await assertDecisionUnchanged(root,{ok:false,reason:"busy"});}));
  for(const disposition of ["published","withdrawn"] as const)await t.test(`valid ${disposition} slot orphan final remains busy`,()=>withRoot(async root=>{await writeSlotOrphan(root,{host:hostname(),nonce:(disposition==="published"?"7":"8").repeat(64),pid:process.pid,v:1 as const},disposition);await assertDecisionUnchanged(root,{ok:false,reason:"busy"});}));
  await t.test("valid dead-owner abandoned slot orphan final remains busy",async()=>{const owner={host:hostname(),nonce:"9".repeat(64),pid:await exitedProcessPid(),v:1 as const};await withRoot(async root=>{await writeSlotOrphan(root,owner,"abandoned");await assertDecisionUnchanged(root,{ok:false,reason:"busy"});});});
  for(const disposition of ["published","withdrawn"] as const)for(const field of ["ownerBytesDigest","ownerBytesLength"] as const)await t.test(`${disposition} slot orphan rejects wrong historical ${field}`,()=>withRoot(async root=>{const owner={host:hostname(),nonce:(disposition==="published"?(field==="ownerBytesDigest"?"a":"b"):(field==="ownerBytesDigest"?"c":"d")).repeat(64),pid:process.pid,v:1 as const};await writeSlotOrphan(root,owner,disposition,ack=>({...ack,[field]:field==="ownerBytesDigest"?digest("f"):"999"}));await assertDecisionUnchanged(root,{ok:false,reason:"corruption"});}));
  for(const field of ["ownerBytesDigest","ownerBytesLength","terminalArtifactDigest"] as const)await t.test(`dead-owner abandoned slot orphan rejects wrong historical ${field}`,async()=>{const owner={host:hostname(),nonce:(field==="ownerBytesDigest"?"e":field==="ownerBytesLength"?"f":"0").repeat(64),pid:await exitedProcessPid(),v:1 as const};await withRoot(async root=>{await writeSlotOrphan(root,owner,"abandoned",ack=>({...ack,[field]:field==="ownerBytesLength"?"999":digest("f")}));await assertDecisionUnchanged(root,{ok:false,reason:"corruption"});});});
});

test("K1 prep and creator orphan finals preserve exact raw owner-byte commitments",async t=>{
  type OrphanState="empty"|"zero"|"partial"|"complete";
  const assertDecisionUnchanged=async(root:string,expected:{ok:false;reason:"busy"|"corruption"})=>{const before=await snapshotRootArtifacts(root);let semanticNow=0,callbacks=0,legacyMutations=0;const result=await new RawFsAuthorityLedger(root,{now:()=>{semanticNow++;return t0;},lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="before-ledger-operation-callback")callbacks++;if(legacyMutationBoundaries.has(point))legacyMutations++;}} as never).observeClock();assert.deepEqual(result,expected);assert.deepEqual(await snapshotRootArtifacts(root),before);assert.deepEqual({semanticNow,callbacks,legacyMutations},{semanticNow:0,callbacks:0,legacyMutations:0});};
  const validateRawCommitment=(owner:AdmissionOwner,state:OrphanState,ack:Readonly<Record<string,unknown>>)=>{const complete=publicationOwnerBytes(owner),bytes=state==="empty"||state==="zero"?Buffer.alloc(0):ownerStateBytes(owner,state);assert.equal(ack.ownerBytesLength,String(bytes.length));assert.equal(ack.ownerBytesDigest,rawDigest(bytes));assert.equal(ack.ownerIdentity===null,state==="empty");if(state==="partial")assert.equal(bytes.length>0&&bytes.length<complete.length,true,"partial fixture is a nonzero strict canonical-owner prefix");};
  const mutateRawCommitment=(owner:AdmissionOwner,state:OrphanState,ack:Readonly<Record<string,unknown>>,mutation:"digest"|"length")=>{const complete=publicationOwnerBytes(owner),actual=state==="empty"||state==="zero"?Buffer.alloc(0):ownerStateBytes(owner,state);if(mutation==="length")return {...ack,ownerBytesLength:state==="empty"||state==="zero"?"1":"0"};const wrong=state==="empty"||state==="zero"?digest("f"):state==="complete"?rawDigest(complete.subarray(0,complete.length-1)):rawDigest(complete.subarray(0,Math.max(1,actual.length-1)));assert.notEqual(wrong,rawDigest(actual));return {...ack,ownerBytesDigest:wrong};};
  const writePrepOrphan=async(root:string,owner:AdmissionOwner,state:OrphanState,mutation:"none"|"digest"|"length")=>{const markerName=admissionPrepRetiredName(owner,state),marker=path.join(root,markerName);await mkdir(marker);if(state!=="empty")await writeFile(path.join(marker,"owner.json"),ownerStateBytes(owner,state));const exact=incompleteCoordinationAck(owner,"prep-retired",markerName,admissionPrepName(owner),state,marker);validateRawCommitment(owner,state,exact);const record=mutation==="none"?exact:mutateRawCommitment(owner,state,exact,mutation),ackPath=path.join(root,coordinationAckName(record));await writeFile(ackPath,authorityCanonicalBytes(record));await rm(marker,{recursive:true});return {ackPath,record};};
  const writeCreatorOrphan=async(root:string,owner:AdmissionOwner,state:Exclude<OrphanState,"complete">,mutation:"none"|"digest"|"length")=>{const withdrawal=await writeCreatorWithdrawal(root,owner,state),withdrawalName=path.basename(withdrawal),slotName=admissionRetiredName(owner,"withdrawn"),slot=path.join(root,slotName);await mkdir(slot);await writeFile(path.join(slot,"owner.json"),publicationOwnerBytes(owner));const terminalBytes=state==="empty"||state==="zero"?Buffer.alloc(0):ownerStateBytes(owner,state),slotAck=slotCoordinationAck(owner,slotName,slot,"withdrawn",withdrawalName,terminalBytes),slotAckPath=path.join(root,coordinationAckName(slotAck));await writeFile(slotAckPath,authorityCanonicalBytes(slotAck));await rm(slot,{recursive:true});const exact=incompleteCoordinationAck(owner,"creator-withdrawal",withdrawalName,publicationStageName({...owner,ticket:"0000000000000001"}),state,withdrawal,slotAck);validateRawCommitment(owner,state,exact);const record=mutation==="none"?exact:mutateRawCommitment(owner,state,exact,mutation),ackPath=path.join(root,coordinationAckName(record));await writeFile(ackPath,authorityCanonicalBytes(record));await rm(slotAckPath);await rm(withdrawal,{recursive:true});return {ackPath,record};};
  for(const state of ["empty","zero","partial","complete"] as const){await t.test(`canonical prep-retired ${state} orphan final remains busy`,()=>withRoot(async root=>{await writePrepOrphan(root,{host:hostname(),nonce:({empty:"1",zero:"2",partial:"3",complete:"4"} as const)[state].repeat(64),pid:process.pid,v:1 as const},state,"none");await assertDecisionUnchanged(root,{ok:false,reason:"busy"});}));for(const mutation of ["digest","length"] as const)await t.test(`prep-retired ${state} orphan rejects wrong raw owner ${mutation}`,()=>withRoot(async root=>{await writePrepOrphan(root,{host:hostname(),nonce:({empty:"5",zero:"6",partial:"7",complete:"8"} as const)[state].repeat(64),pid:process.pid,v:1 as const},state,mutation);await assertDecisionUnchanged(root,{ok:false,reason:"corruption"});}));}
  for(const state of ["empty","zero","partial"] as const){await t.test(`canonical creator-withdrawal ${state} orphan final remains busy`,()=>withRoot(async root=>{await writeCreatorOrphan(root,{host:hostname(),nonce:({empty:"9",zero:"a",partial:"b"} as const)[state].repeat(64),pid:process.pid,v:1 as const},state,"none");await assertDecisionUnchanged(root,{ok:false,reason:"busy"});}));for(const mutation of ["digest","length"] as const)await t.test(`creator-withdrawal ${state} orphan rejects wrong raw owner ${mutation}`,()=>withRoot(async root=>{await writeCreatorOrphan(root,{host:hostname(),nonce:({empty:"c",zero:"d",partial:"e"} as const)[state].repeat(64),pid:process.pid,v:1 as const},state,mutation);await assertDecisionUnchanged(root,{ok:false,reason:"corruption"});}));}
});

test("K1 creator final binds the exact referenced withdrawn-slot final",async t=>{
  const assertDecisionUnchanged=async(root:string,expected:{ok:false;reason:"busy"|"corruption"})=>{const before=await snapshotRootArtifacts(root);let semanticNow=0,callbacks=0,legacyMutations=0;const result=await new RawFsAuthorityLedger(root,{now:()=>{semanticNow++;return t0;},lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="before-ledger-operation-callback")callbacks++;if(legacyMutationBoundaries.has(point))legacyMutations++;}} as never).observeClock();assert.deepEqual(result,expected);assert.deepEqual(await snapshotRootArtifacts(root),before);assert.deepEqual({semanticNow,callbacks,legacyMutations},{semanticNow:0,callbacks:0,legacyMutations:0});};
  const buildDistinctSlotFinals=async(root:string,owner:AdmissionOwner)=>{const withdrawal=await writeCreatorWithdrawal(root,owner,"partial"),withdrawalName=path.basename(withdrawal),slotName=admissionRetiredName(owner,"withdrawn"),slot=path.join(root,slotName),writeSlot=async()=>{await mkdir(slot);await writeFile(path.join(slot,"owner.json"),publicationOwnerBytes(owner));return slotCoordinationAck(owner,slotName,slot,"withdrawn",withdrawalName,ownerStateBytes(owner,"partial"));};const x=await writeSlot();await rm(slot,{recursive:true});const spacer=path.join(root,"identity-spacer");await mkdir(spacer);await writeFile(path.join(spacer,"spacer"),"identity-allocation-spacer");const y=await writeSlot();await rm(spacer,{recursive:true});await rm(slot,{recursive:true});const xBytes=authorityCanonicalBytes(x),yBytes=authorityCanonicalBytes(y),xName=coordinationAckName(x),yName=coordinationAckName(y);assert.notEqual(authorityDigest(x),authorityDigest(y),"recreated exact slot marker produces a distinct record digest");assert.notEqual(xName,yName,"recreated exact slot marker produces a distinct final name");assert.deepEqual(x.owner,y.owner);assert.equal(x.terminalArtifactName,y.terminalArtifactName);assert.equal(x.terminalArtifactDigest,y.terminalArtifactDigest);assert.equal(x.disposition,"withdrawn");assert.equal(y.disposition,"withdrawn");assert.equal(xName,`.authority-ledger-coordination-cleanup-${authorityDigest(x).slice(7)}.ack`);assert.equal(yName,`.authority-ledger-coordination-cleanup-${authorityDigest(y).slice(7)}.ack`);return {withdrawal,withdrawalName,x,xBytes,xName,y,yBytes,yName};};
  await t.test("recreated withdrawn-slot finals X and Y are independently valid",async()=>{const owner={host:hostname(),nonce:"1".repeat(64),pid:process.pid,v:1 as const};for(const selected of ["x","y"] as const)await withRoot(async root=>{const graph=await buildDistinctSlotFinals(root,owner),record=graph[selected],bytes=graph[`${selected}Bytes`],name=graph[`${selected}Name`];await writeFile(path.join(root,name),bytes);assert.equal(name,coordinationAckName(record));await assertDecisionUnchanged(root,{ok:false,reason:"busy"});});});
  await t.test("creator final citing present Y with present Y remains busy",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"2".repeat(64),pid:process.pid,v:1 as const},graph=await buildDistinctSlotFinals(root,owner);await writeFile(path.join(root,graph.yName),graph.yBytes);const creator=incompleteCoordinationAck(owner,"creator-withdrawal",graph.withdrawalName,publicationStageName({...owner,ticket:"0000000000000001"}),"partial",graph.withdrawal,graph.y);await writeFile(path.join(root,coordinationAckName(creator)),authorityCanonicalBytes(creator));await assertDecisionUnchanged(root,{ok:false,reason:"busy"});}));
  await t.test("creator final citing absent X with no slot final remains later-step busy",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"3".repeat(64),pid:process.pid,v:1 as const},graph=await buildDistinctSlotFinals(root,owner),creator=incompleteCoordinationAck(owner,"creator-withdrawal",graph.withdrawalName,publicationStageName({...owner,ticket:"0000000000000001"}),"partial",graph.withdrawal,graph.x);assert.equal(existsSync(path.join(root,graph.xName)),false);assert.equal(existsSync(path.join(root,graph.yName)),false);await writeFile(path.join(root,coordinationAckName(creator)),authorityCanonicalBytes(creator));await assertDecisionUnchanged(root,{ok:false,reason:"busy"});}));
  await t.test("creator final citing absent X while different valid Y is present is corruption",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"4".repeat(64),pid:process.pid,v:1 as const},graph=await buildDistinctSlotFinals(root,owner);await writeFile(path.join(root,graph.yName),graph.yBytes);const creator=incompleteCoordinationAck(owner,"creator-withdrawal",graph.withdrawalName,publicationStageName({...owner,ticket:"0000000000000001"}),"partial",graph.withdrawal,graph.x),creatorPath=path.join(root,coordinationAckName(creator)),creatorReference=creator as Readonly<Record<string,unknown>>;await writeFile(creatorPath,authorityCanonicalBytes(creator));assert.equal(existsSync(path.join(root,graph.xName)),false);assert.equal(existsSync(path.join(root,graph.yName)),true);assert.equal(creatorReference.slotRetirementAckName,graph.xName);assert.notEqual(creatorReference.slotRetirementAckName,graph.yName);await assertDecisionUnchanged(root,{ok:false,reason:"corruption"});}));
});

test("K1 construction churn distinguishes same-identity canonical progress from corruption",async t=>{
  const runClassification=async(root:string,mutateAt:string,mutate:()=>void)=>{let mutated=false,snapshots=0,semanticNow=0,callbacks=0,legacyMutations=0;const result=await new RawFsAuthorityLedger(root,{now:()=>{semanticNow++;return t0;},lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="after-pre-admission-housekeeping-initial-enumeration")snapshots++;if(!mutated&&point===mutateAt){mutated=true;mutate();}if(point==="before-ledger-operation-callback")callbacks++;if(legacyMutationBoundaries.has(point))legacyMutations++;}} as never).observeClock();assert.equal(mutated,true,`${mutateAt} is a live closed-snapshot seam`);assert.deepEqual({semanticNow,callbacks,legacyMutations},{semanticNow:0,callbacks:0,legacyMutations:0});return {result,snapshots};};
  const writePrepStage=async(root:string,owner:AdmissionOwner,stageState:"zero"|"prefix")=>{const markerName=admissionPrepRetiredName(owner,"complete"),marker=path.join(root,markerName);await mkdir(marker);await writeFile(path.join(marker,"owner.json"),publicationOwnerBytes(owner));const ack=incompleteCoordinationAck(owner,"prep-retired",markerName,admissionPrepName(owner),"complete",marker),ackBytes=authorityCanonicalBytes(ack),stage=path.join(root,coordinationStageName(ack,"prep-retired")),initial=stageState==="zero"?Buffer.alloc(0):ackBytes.subarray(0,ackBytes.length-1);await writeFile(stage,initial);assert.equal(initial.length<ackBytes.length,true);assert.deepEqual(initial,ackBytes.subarray(0,initial.length));return {ackBytes,initial,marker,stage};};
  for(const initial of ["zero","prefix"] as const)await t.test(`live prep same-inode ${initial} bytes may grow to complete canonical owner`,()=>withRoot(async root=>{const owner={host:hostname(),nonce:(initial==="zero"?"1":"2").repeat(64),pid:process.pid,v:1 as const},prep=await writeAdmissionPrep(root,owner,initial==="zero"?"zero":"partial"),ownerPath=path.join(prep,"owner.json"),complete=publicationOwnerBytes(owner),before=exactFsIdentity(ownerPath),initialBytes=await readFile(ownerPath);assert.equal(initialBytes.length<complete.length,true);assert.deepEqual(initialBytes,complete.subarray(0,initialBytes.length));let after:ExactFsIdentity|undefined;const observed=await runClassification(root,"after-admission-prep-enumeration",()=>{writeFileSync(ownerPath,complete.subarray(initialBytes.length),{flag:"a"});after=exactFsIdentity(ownerPath);});assert.deepEqual(after,before,"canonical progress preserves the exact owner-file identity");assert.deepEqual(observed.result,{ok:false,reason:"busy"});assert.equal(observed.snapshots>=2,true,"same-identity canonical progress restarts classification");assert.deepEqual(await readFile(ownerPath),complete);}));
  for(const initial of ["zero","prefix"] as const)await t.test(`prep-retired stage same-inode ${initial} bytes may grow to complete canonical ack`,()=>withRoot(async root=>{const owner={host:hostname(),nonce:(initial==="zero"?"3":"4").repeat(64),pid:process.pid,v:1 as const},fixture=await writePrepStage(root,owner,initial),before=exactFsIdentity(fixture.stage);let after:ExactFsIdentity|undefined;const observed=await runClassification(root,"after-coordination-cleanup-marker-enumeration",()=>{writeFileSync(fixture.stage,fixture.ackBytes.subarray(fixture.initial.length),{flag:"a"});after=exactFsIdentity(fixture.stage);});assert.deepEqual(after,before,"canonical stage progress preserves the exact stage-file identity");assert.deepEqual(observed.result,{ok:false,reason:"busy"});assert.equal(observed.snapshots>=2,true,"same-identity canonical stage progress restarts classification");assert.deepEqual(await readFile(fixture.stage),fixture.ackBytes);}));
  for(const target of ["prep","stage"] as const)await t.test(`same-name ${target} identity replacement remains corruption`,()=>withRoot(async root=>{const external=await tempRoot();try{const owner={host:hostname(),nonce:(target==="prep"?"5":"6").repeat(64),pid:process.pid,v:1 as const},fixture=target==="prep"?await (async()=>{const prep=await writeAdmissionPrep(root,owner,"zero"),file=path.join(prep,"owner.json");return {file,finalBytes:publicationOwnerBytes(owner),hook:"after-admission-prep-enumeration"};})():await (async()=>{const stage=await writePrepStage(root,owner,"zero");return {file:stage.stage,finalBytes:stage.ackBytes,hook:"after-coordination-cleanup-marker-enumeration"};})(),before=exactFsIdentity(fixture.file),displaced=path.join(external,"displaced"),replacement=path.join(external,"replacement");await writeFile(replacement,fixture.finalBytes);let after:ExactFsIdentity|undefined;const observed=await runClassification(root,fixture.hook,()=>{renameSync(fixture.file,displaced);renameSync(replacement,fixture.file);after=exactFsIdentity(fixture.file);});assert.notDeepEqual(after,before,"replacement changes exact file identity");assert.deepEqual(observed.result,{ok:false,reason:"corruption"});assert.deepEqual(await readFile(fixture.file),fixture.finalBytes);}finally{await rm(external,{recursive:true,force:true});}}));
  for(const target of ["prep","stage"] as const)await t.test(`same-identity ${target} non-prefix mutation remains corruption`,()=>withRoot(async root=>{const owner={host:hostname(),nonce:(target==="prep"?"7":"8").repeat(64),pid:process.pid,v:1 as const},fixture=target==="prep"?await (async()=>{const prep=await writeAdmissionPrep(root,owner,"zero"),file=path.join(prep,"owner.json");return {canonical:publicationOwnerBytes(owner),file,hook:"after-admission-prep-enumeration"};})():await (async()=>{const stage=await writePrepStage(root,owner,"zero");return {canonical:stage.ackBytes,file:stage.stage,hook:"after-coordination-cleanup-marker-enumeration"};})(),bad=Buffer.from("{garbage"),before=exactFsIdentity(fixture.file);assert.equal(bad.equals(fixture.canonical.subarray(0,bad.length)),false,"mutation is not a canonical prefix");let after:ExactFsIdentity|undefined;const observed=await runClassification(root,fixture.hook,()=>{writeFileSync(fixture.file,bad);after=exactFsIdentity(fixture.file);});assert.deepEqual(after,before,"invalid mutation preserves exact file identity");assert.deepEqual(observed.result,{ok:false,reason:"corruption"});assert.equal(observed.snapshots,1,"same-identity non-prefix corruption terminates on the first closed snapshot");assert.deepEqual(await readFile(fixture.file),bad);}));
  for(const target of ["prep","stage"] as const)await t.test(`same-identity ${target} canonical shrink remains corruption`,()=>withRoot(async root=>{const owner={host:hostname(),nonce:(target==="prep"?"d":"e").repeat(64),pid:process.pid,v:1 as const},fixture=target==="prep"?await (async()=>{const prep=await writeAdmissionPrep(root,owner,"partial");return {file:path.join(prep,"owner.json"),hook:"after-admission-prep-enumeration"};})():await (async()=>{const stage=await writePrepStage(root,owner,"prefix");return {file:stage.stage,hook:"after-coordination-cleanup-marker-enumeration"};})(),before=exactFsIdentity(fixture.file),initial=await readFile(fixture.file);assert.equal(initial.length>0,true);let after:ExactFsIdentity|undefined;const observed=await runClassification(root,fixture.hook,()=>{writeFileSync(fixture.file,Buffer.alloc(0));after=exactFsIdentity(fixture.file);});assert.deepEqual(after,before,"canonical shrink preserves exact file identity");assert.deepEqual(observed.result,{ok:false,reason:"corruption"});assert.equal(observed.snapshots,1,"same-identity shrink terminates on the first closed snapshot");assert.deepEqual(await readFile(fixture.file),Buffer.alloc(0));}));
  for(const finalState of ["zero","prefix","complete"] as const)await t.test(`prep owner publication from absent to ${finalState} is bounded construction`,()=>withRoot(async root=>{const owner={host:hostname(),nonce:({zero:"f",prefix:"0",complete:"1"} as const)[finalState].repeat(64),pid:process.pid,v:1 as const},prep=await writeAdmissionPrep(root,owner,"empty"),ownerPath=path.join(prep,"owner.json"),complete=publicationOwnerBytes(owner),finalBytes=finalState==="zero"?Buffer.alloc(0):finalState==="prefix"?complete.subarray(0,complete.length-1):complete,beforeDirectory=exactFsIdentity(prep);assert.equal(existsSync(ownerPath),false);const observed=await runClassification(root,"after-admission-prep-enumeration",()=>{writeFileSync(ownerPath,finalBytes);});assert.deepEqual(exactFsIdentity(prep),beforeDirectory,"owner publication preserves the constructing directory identity");assert.deepEqual(observed.result,{ok:false,reason:"busy"});assert.equal(observed.snapshots>=2,true,"new owner publication restarts classification");assert.deepEqual(await readFile(ownerPath),finalBytes);}));
  await t.test("prep owner publication from absent to noncanonical bytes is terminal corruption",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"7".repeat(64),pid:process.pid,v:1 as const},prep=await writeAdmissionPrep(root,owner,"empty"),ownerPath=path.join(prep,"owner.json"),canonical=publicationOwnerBytes(owner),bad=Buffer.from("{garbage"),beforeDirectory=exactFsIdentity(prep);assert.equal(existsSync(ownerPath),false);assert.equal(bad.equals(canonical.subarray(0,bad.length)),false);const observed=await runClassification(root,"after-admission-prep-enumeration",()=>{writeFileSync(ownerPath,bad);});assert.deepEqual(exactFsIdentity(prep),beforeDirectory);assert.equal(lstatSync(ownerPath).isFile(),true);assert.deepEqual(observed.result,{ok:false,reason:"corruption"});assert.equal(observed.snapshots,1,"invalid owner creation terminates on the first closed snapshot");assert.deepEqual(await readFile(ownerPath),bad);}));
  await t.test("lock-publication owner prefix growth is bounded construction",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"2".repeat(64),pid:process.pid,v:1 as const,ticket:"0000000000000001"},complete=publicationOwnerBytes(owner),initial=complete.subarray(0,complete.length-1);await writeAdmissionSlot(root,owner);const stage=await writePublicationStage(root,owner,initial),ownerPath=path.join(stage,"owner.json"),beforeDirectory=exactFsIdentity(stage),beforeOwner=exactFsIdentity(ownerPath),observed=await runClassification(root,"after-admission-prep-enumeration",()=>{writeFileSync(ownerPath,complete.subarray(initial.length),{flag:"a"});});assert.deepEqual(exactFsIdentity(stage),beforeDirectory);assert.deepEqual(exactFsIdentity(ownerPath),beforeOwner);assert.deepEqual(observed.result,{ok:false,reason:"busy"});assert.equal(observed.snapshots>=2,true,"lock-publication owner progress restarts classification");assert.deepEqual(await readFile(ownerPath),complete);}));
  await t.test("lock-publication owner same-identity non-prefix mutation is terminal corruption",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"8".repeat(64),pid:process.pid,v:1 as const,ticket:"0000000000000001"},complete=publicationOwnerBytes(owner),initial=complete.subarray(0,complete.length-1),bad=Buffer.from("{garbage");await writeAdmissionSlot(root,owner);const stage=await writePublicationStage(root,owner,initial),ownerPath=path.join(stage,"owner.json"),before=exactFsIdentity(ownerPath);assert.equal(bad.equals(complete.subarray(0,bad.length)),false);const observed=await runClassification(root,"after-admission-prep-enumeration",()=>{writeFileSync(ownerPath,bad);});assert.deepEqual(exactFsIdentity(ownerPath),before);assert.deepEqual(observed.result,{ok:false,reason:"corruption"});assert.equal(observed.snapshots,1,"invalid lock-publication mutation terminates on the first closed snapshot");assert.deepEqual(await readFile(ownerPath),bad);}));
  await t.test("typed slot-retired stage zero growth is bounded construction",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"3".repeat(64),pid:process.pid,v:1 as const},markerName=admissionRetiredName(owner,"published"),marker=path.join(root,markerName),terminalName=retirementMarkerName(owner,"released");await mkdir(marker);await writeFile(path.join(marker,"owner.json"),publicationOwnerBytes(owner));await writeLegacyRetiredLock(root,owner,"released");const ack=slotCoordinationAck(owner,markerName,marker,"published",terminalName,publicationOwnerBytes(owner)),complete=authorityCanonicalBytes(ack),stage=path.join(root,coordinationStageName(ack,"slot-retired"));await writeFile(stage,Buffer.alloc(0));const before=exactFsIdentity(stage),observed=await runClassification(root,"after-coordination-cleanup-marker-enumeration",()=>{writeFileSync(stage,complete,{flag:"a"});});assert.deepEqual(exactFsIdentity(stage),before);assert.deepEqual(observed.result,{ok:false,reason:"busy"});assert.equal(observed.snapshots>=2,true,"typed slot-retired stage progress restarts classification");assert.deepEqual(await readFile(stage),complete);}));
  await t.test("typed slot-retired stage same-identity non-prefix mutation is terminal corruption",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"9".repeat(64),pid:process.pid,v:1 as const},markerName=admissionRetiredName(owner,"published"),marker=path.join(root,markerName),terminalName=retirementMarkerName(owner,"released"),bad=Buffer.from("{garbage");await mkdir(marker);await writeFile(path.join(marker,"owner.json"),publicationOwnerBytes(owner));await writeLegacyRetiredLock(root,owner,"released");const ack=slotCoordinationAck(owner,markerName,marker,"published",terminalName,publicationOwnerBytes(owner)),complete=authorityCanonicalBytes(ack),stage=path.join(root,coordinationStageName(ack,"slot-retired"));await writeFile(stage,Buffer.alloc(0));const before=exactFsIdentity(stage);assert.equal(bad.equals(complete.subarray(0,bad.length)),false);const observed=await runClassification(root,"after-coordination-cleanup-marker-enumeration",()=>{writeFileSync(stage,bad);});assert.deepEqual(exactFsIdentity(stage),before);assert.deepEqual(observed.result,{ok:false,reason:"corruption"});assert.equal(observed.snapshots,1,"invalid slot-retired stage mutation terminates on the first closed snapshot");assert.deepEqual(await readFile(stage),bad);}));
  await t.test("typed creator-withdrawal stage zero growth is bounded construction",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"4".repeat(64),pid:process.pid,v:1 as const},withdrawal=await writeCreatorWithdrawal(root,owner,"partial"),withdrawalName=path.basename(withdrawal),slotName=admissionRetiredName(owner,"withdrawn"),slot=path.join(root,slotName);await mkdir(slot);await writeFile(path.join(slot,"owner.json"),publicationOwnerBytes(owner));const slotAck=slotCoordinationAck(owner,slotName,slot,"withdrawn",withdrawalName,ownerStateBytes(owner,"partial")),slotAckPath=path.join(root,coordinationAckName(slotAck));await writeFile(slotAckPath,authorityCanonicalBytes(slotAck));await rm(slot,{recursive:true});const ack=incompleteCoordinationAck(owner,"creator-withdrawal",withdrawalName,publicationStageName({...owner,ticket:"0000000000000001"}),"partial",withdrawal,slotAck),complete=authorityCanonicalBytes(ack),stage=path.join(root,coordinationStageName(ack,"creator-withdrawal"));await writeFile(stage,Buffer.alloc(0));const before=exactFsIdentity(stage),observed=await runClassification(root,"after-coordination-cleanup-marker-enumeration",()=>{writeFileSync(stage,complete,{flag:"a"});});assert.deepEqual(exactFsIdentity(stage),before);assert.deepEqual(observed.result,{ok:false,reason:"busy"});assert.equal(observed.snapshots>=2,true,"typed creator-withdrawal stage progress restarts classification");assert.deepEqual(await readFile(stage),complete);}));
  await t.test("typed creator-withdrawal stage same-identity non-prefix mutation is terminal corruption",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"a".repeat(64),pid:process.pid,v:1 as const},withdrawal=await writeCreatorWithdrawal(root,owner,"partial"),withdrawalName=path.basename(withdrawal),slotName=admissionRetiredName(owner,"withdrawn"),slot=path.join(root,slotName),bad=Buffer.from("{garbage");await mkdir(slot);await writeFile(path.join(slot,"owner.json"),publicationOwnerBytes(owner));const slotAck=slotCoordinationAck(owner,slotName,slot,"withdrawn",withdrawalName,ownerStateBytes(owner,"partial")),slotAckPath=path.join(root,coordinationAckName(slotAck));await writeFile(slotAckPath,authorityCanonicalBytes(slotAck));await rm(slot,{recursive:true});const ack=incompleteCoordinationAck(owner,"creator-withdrawal",withdrawalName,publicationStageName({...owner,ticket:"0000000000000001"}),"partial",withdrawal,slotAck),complete=authorityCanonicalBytes(ack),stage=path.join(root,coordinationStageName(ack,"creator-withdrawal"));await writeFile(stage,Buffer.alloc(0));const before=exactFsIdentity(stage);assert.equal(bad.equals(complete.subarray(0,bad.length)),false);const observed=await runClassification(root,"after-coordination-cleanup-marker-enumeration",()=>{writeFileSync(stage,bad);});assert.deepEqual(exactFsIdentity(stage),before);assert.deepEqual(observed.result,{ok:false,reason:"corruption"});assert.equal(observed.snapshots,1,"invalid creator-withdrawal stage mutation terminates on the first closed snapshot");assert.deepEqual(await readFile(stage),bad);}));
  await t.test("legacy cleanup stage prefix growth is bounded construction",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"5".repeat(64),pid:process.pid,v:1 as const},slotName=admissionRetiredName(owner,"published"),slot=path.join(root,slotName),terminalName=retirementMarkerName(owner,"released");await mkdir(slot);await writeFile(path.join(slot,"owner.json"),publicationOwnerBytes(owner));await writeLegacyRetiredLock(root,owner,"released");const ack=cleanupAck(owner,terminalName,"released",null),complete=authorityCanonicalBytes(ack),initial=complete.subarray(0,complete.length-1),stage=path.join(root,cleanupStageName(owner,ack));await writeFile(stage,initial);const before=exactFsIdentity(stage),observed=await runClassification(root,"after-admission-prep-enumeration",()=>{writeFileSync(stage,complete.subarray(initial.length),{flag:"a"});});assert.deepEqual(exactFsIdentity(stage),before);assert.deepEqual(observed.result,{ok:false,reason:"busy"});assert.equal(observed.snapshots>=2,true,"legacy cleanup-stage progress restarts classification");assert.deepEqual(await readFile(stage),complete);}));
  await t.test("legacy cleanup stage same-identity non-prefix mutation is terminal corruption",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"b".repeat(64),pid:process.pid,v:1 as const},slotName=admissionRetiredName(owner,"published"),slot=path.join(root,slotName),terminalName=retirementMarkerName(owner,"released"),bad=Buffer.from("{garbage");await mkdir(slot);await writeFile(path.join(slot,"owner.json"),publicationOwnerBytes(owner));await writeLegacyRetiredLock(root,owner,"released");const ack=cleanupAck(owner,terminalName,"released",null),complete=authorityCanonicalBytes(ack),initial=complete.subarray(0,complete.length-1),stage=path.join(root,cleanupStageName(owner,ack));await writeFile(stage,initial);const before=exactFsIdentity(stage);assert.equal(bad.equals(complete.subarray(0,bad.length)),false);const observed=await runClassification(root,"after-admission-prep-enumeration",()=>{writeFileSync(stage,bad);});assert.deepEqual(exactFsIdentity(stage),before);assert.deepEqual(observed.result,{ok:false,reason:"corruption"});assert.equal(observed.snapshots,1,"invalid legacy cleanup-stage mutation terminates on the first closed snapshot");assert.deepEqual(await readFile(stage),bad);}));
  await t.test("immutable final ack canonical truncation remains terminal corruption",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"6".repeat(64),pid:process.pid,v:1 as const},markerName=admissionPrepRetiredName(owner,"complete"),marker=path.join(root,markerName);await mkdir(marker);await writeFile(path.join(marker,"owner.json"),publicationOwnerBytes(owner));const ack=incompleteCoordinationAck(owner,"prep-retired",markerName,admissionPrepName(owner),"complete",marker),ackPath=path.join(root,coordinationAckName(ack)),complete=authorityCanonicalBytes(ack);await writeFile(ackPath,complete);await rm(marker,{recursive:true});const before=exactFsIdentity(ackPath),truncated=complete.subarray(0,complete.length-1),observed=await runClassification(root,"after-admission-prep-enumeration",()=>{writeFileSync(ackPath,truncated);});assert.equal(truncated.length<complete.length,true);assert.deepEqual(truncated,complete.subarray(0,truncated.length));assert.deepEqual(exactFsIdentity(ackPath),before,"immutable ack truncation preserves exact file identity");assert.deepEqual(observed.result,{ok:false,reason:"corruption"});assert.equal(observed.snapshots,1,"immutable canonical truncation terminates on the first closed snapshot");assert.deepEqual(await readFile(ackPath),truncated);}));
  for(const target of ["prep-zero","prep-prefix","stage-zero","stage-prefix"] as const)await t.test(`unchanged ${target} snapshot retains busy classification`,()=>withRoot(async root=>{const owner={host:hostname(),nonce:({"prep-zero":"9","prep-prefix":"a","stage-zero":"b","stage-prefix":"c"} as const)[target].repeat(64),pid:process.pid,v:1 as const},isPrep=target.startsWith("prep"),fixture=isPrep?await (async()=>{const prep=await writeAdmissionPrep(root,owner,target.endsWith("zero")?"zero":"partial"),file=path.join(prep,"owner.json");return {file,hook:"after-admission-prep-enumeration"};})():await (async()=>{const stage=await writePrepStage(root,owner,target.endsWith("zero")?"zero":"prefix");return {file:stage.stage,hook:"after-coordination-cleanup-marker-enumeration"};})(),beforeIdentity=exactFsIdentity(fixture.file),beforeBytes=await readFile(fixture.file),observed=await runClassification(root,fixture.hook,()=>{});assert.deepEqual(observed.result,{ok:false,reason:"busy"});assert.deepEqual(exactFsIdentity(fixture.file),beforeIdentity);assert.deepEqual(await readFile(fixture.file),beforeBytes);}));
});

test("prep-only housekeeper runtime scaffold remains host-private",async t=>{
  type PrepRuntime=Readonly<{monotonicNow:()=>number;delay:(milliseconds:number)=>Promise<void>;observeBoundary:(point:string)=>void}>;
  type HostModule=typeof import("../../src/authority/host/fs-ledger.js")&Readonly<{__testPrepHousekeeperRuntimeOption?:symbol}>;
  const hostModule=await import("../../src/authority/host/fs-ledger.js") as HostModule,runtimeKey=hostModule.__testPrepHousekeeperRuntimeOption;
  await t.test("direct host import exposes a computed-option symbol",()=>{assert.equal(typeof runtimeKey,"symbol","the prep-only runtime scaffold is a real host-private symbol");if(typeof runtimeKey!=="symbol")return;const runtime:PrepRuntime={monotonicNow:()=>0,delay:async()=>{},observeBoundary:()=>{}},options={[runtimeKey]:runtime};assert.deepEqual(Object.getOwnPropertySymbols(options),[runtimeKey]);assert.equal(options[runtimeKey],runtime);});
  await t.test("authority barrel exposes no prep-housekeeper runtime service or authority types",()=>{for(const name of ["__testPrepHousekeeperRuntimeOption","__testServicePrepHousekeepingOnce","PrepCreatorToken","PrepRetirementAuthority","PrepRetiredCleanupAuthority"])assert.equal(name in authorityModule,false,`${name} remains absent from reelier/authority`);});
  await t.test("package export map adds no prep-housekeeper or host-private mutation path",async()=>{const packageJson=JSON.parse(await readFile(path.resolve("package.json"),"utf8")) as {exports:Record<string,unknown>},authorityPaths=Object.keys(packageJson.exports).filter(name=>name.includes("authority")),privatePaths=Object.keys(packageJson.exports).filter(name=>/(?:prep|housekeep|runtime|host)/i.test(name));assert.deepEqual(authorityPaths,["./authority"]);assert.deepEqual(privatePaths,[]);assert.equal(packageJson.exports["./authority"],"./dist/authority/index.js");});
  await t.test("runtime option is accepted without widening classifier-only busy behavior",()=>withRoot(async root=>{if(typeof runtimeKey!=="symbol"){assert.equal(runtimeKey,undefined,"missing scaffold is isolated to the intentional presence RED");return;}const owner={host:hostname(),nonce:"d".repeat(64),pid:process.pid,v:1 as const};await writeAdmissionPrep(root,owner,"zero");const before=await snapshotRootArtifacts(root),runtimeCalls={monotonicNow:0,delay:0,boundary:0},runtime:PrepRuntime={monotonicNow:()=>{runtimeCalls.monotonicNow++;return 0;},delay:async()=>{runtimeCalls.delay++;},observeBoundary:()=>{runtimeCalls.boundary++;}};let callbacks=0;const result=await new RawFsAuthorityLedger(root,{[runtimeKey]:runtime,now:()=>t0,lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="before-ledger-operation-callback")callbacks++;}} as never).observeClock();assert.deepEqual(result,{ok:false,reason:"busy"});assert.equal(callbacks,0);assert.deepEqual(await snapshotRootArtifacts(root),before);assert.deepEqual({delay:runtimeCalls.delay,boundary:runtimeCalls.boundary},{delay:0,boundary:0},"classifier-only busy does not enter prep-housekeeping mutation runtime");}));
});

test("prep-only housekeeper routes stable authority without mutation",async t=>{
  const tokenPoint="prep-only-creator-token-carried",nonePoint="prep-only-no-authority",deadPoint="prep-only-prep-retirement-authority-dead-owner",beforePoint="prep-only-before-transition",refusedPoint="prep-only-transition-refused",authorityPoints=[tokenPoint,nonePoint,deadPoint,beforePoint,refusedPoint] as const;
  const containsPublicLiteral=(root:unknown,literal:string):boolean=>{const seen=new Set<object>(),visit=(value:unknown):boolean=>{if(typeof value==="string")return value===literal;if(value===null||typeof value!=="object")return false;if(seen.has(value))return false;seen.add(value);if(Array.isArray(value))return value.some(visit);if(value instanceof Set)return [...value].some(visit);if(value instanceof Map)return [...value].some(([key,item])=>visit(key)||visit(item));const prototype=Object.getPrototypeOf(value);return (prototype===Object.prototype||prototype===null)&&Object.values(value as Record<string,unknown>).some(visit);};return visit(root);};
  const exercise=async(root:string,events:string[],operation:"observeClock"|"recover"="observeClock")=>{let semanticNow=0,callbacks=0,monotonicCalls=0,delays=0;const runtime={monotonicNow:()=>{monotonicCalls++;return 0;},delay:async()=>{delays++;},observeBoundary:(point:string)=>{events.push(point);}},ledger=new RawFsAuthorityLedger(root,{[__testPrepHousekeeperRuntimeOption]:runtime,now:()=>{semanticNow++;return t0;},lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="before-ledger-operation-callback")callbacks++;}} as never),result=await ledger[operation]();return {result,semanticNow,callbacks,monotonicCalls,delays};};
  await t.test("live exact slot routes exactly no-authority and remains byte-identical busy",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"1".repeat(64),pid:process.pid,v:1 as const},slot=await writeAdmissionSlot(root,owner),before=await snapshotRootArtifacts(root),events:string[]=[],observed=await exercise(root,events);assert.deepEqual(observed.result,{ok:false,reason:"busy"});assert.deepEqual(events,[nonePoint]);assert.deepEqual({semanticNow:observed.semanticNow,callbacks:observed.callbacks},{semanticNow:0,callbacks:0});assert.deepEqual(await snapshotRootArtifacts(root),before);assert.equal(existsSync(slot),true);}));
  await t.test("stable withdrawal lineage routes exactly no-authority and remains byte-identical busy",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"2".repeat(64),pid:process.pid,v:1 as const},withdrawal=await writeCreatorWithdrawal(root,owner,"partial"),withdrawalName=path.basename(withdrawal),slotName=admissionRetiredName(owner,"withdrawn"),slot=path.join(root,slotName);await mkdir(slot);await writeFile(path.join(slot,"owner.json"),publicationOwnerBytes(owner));const slotAck=slotCoordinationAck(owner,slotName,slot,"withdrawn",withdrawalName,ownerStateBytes(owner,"partial")),ackPath=path.join(root,coordinationAckName(slotAck));await writeFile(ackPath,authorityCanonicalBytes(slotAck));await rm(slot,{recursive:true});const before=await snapshotRootArtifacts(root),events:string[]=[],observed=await exercise(root,events);assert.deepEqual(observed.result,{ok:false,reason:"busy"});assert.deepEqual(events,[nonePoint]);assert.deepEqual({semanticNow:observed.semanticNow,callbacks:observed.callbacks},{semanticNow:0,callbacks:0});assert.deepEqual(await snapshotRootArtifacts(root),before);}));
  await t.test("live prep states remain unchanged busy with no positive authority",async()=>{for(const [index,state] of (["empty","zero","partial","complete"] as const).entries())await withRoot(async root=>{const owner={host:hostname(),nonce:(index+3).toString(16).repeat(64),pid:process.pid,v:1 as const},prep=await writeAdmissionPrep(root,owner,state),before=await snapshotRootArtifacts(root),events:string[]=[],observed=await exercise(root,events);assert.deepEqual(observed.result,{ok:false,reason:"busy"},state);assert.equal(events.includes(tokenPoint)||events.includes(deadPoint),false,state);assert.deepEqual({semanticNow:observed.semanticNow,callbacks:observed.callbacks},{semanticNow:0,callbacks:0},state);assert.deepEqual(await snapshotRootArtifacts(root),before,state);assert.equal(existsSync(prep),true,state);});});
  await t.test("same-PID sibling cannot emit creator or dead-owner authority",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"7".repeat(64),pid:process.pid,v:1 as const};await writeAdmissionPrep(root,owner,"complete");const before=await snapshotRootArtifacts(root),firstEvents:string[]=[],siblingEvents:string[]=[],first=await exercise(root,firstEvents),sibling=await exercise(root,siblingEvents);assert.deepEqual(first.result,{ok:false,reason:"busy"});assert.deepEqual(sibling.result,{ok:false,reason:"busy"});for(const events of [firstEvents,siblingEvents])assert.equal(events.includes(tokenPoint)||events.includes(deadPoint),false);assert.deepEqual({semanticNow:first.semanticNow+sibling.semanticNow,callbacks:first.callbacks+sibling.callbacks},{semanticNow:0,callbacks:0});assert.deepEqual(await snapshotRootArtifacts(root),before);}));
  await t.test("restarted ledger cannot reconstruct authority over the same live prep",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"8".repeat(64),pid:process.pid,v:1 as const};await writeAdmissionPrep(root,owner,"partial");const before=await snapshotRootArtifacts(root),events:string[]=[],observed=await exercise(root,events,"recover");assert.deepEqual(observed.result,{ok:false,reason:"busy"});assert.equal(events.includes(tokenPoint)||events.includes(deadPoint),false);assert.deepEqual({semanticNow:observed.semanticNow,callbacks:observed.callbacks},{semanticNow:0,callbacks:0});assert.deepEqual(await snapshotRootArtifacts(root),before);}));
  await t.test("same-host final ESRCH prep routes token-carried then dead-owner authority",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"9".repeat(64),pid:await exitedProcessPid(),v:1 as const};await writeAdmissionPrep(root,owner,"complete");const before=await snapshotRootArtifacts(root),events:string[]=[],observed=await exercise(root,events);assert.deepEqual(observed.result,{ok:false,reason:"busy"});assert.deepEqual(events,[tokenPoint,deadPoint,beforePoint,refusedPoint]);assert.deepEqual({semanticNow:observed.semanticNow,callbacks:observed.callbacks},{semanticNow:0,callbacks:0});assert.deepEqual(await snapshotRootArtifacts(root),before);}));
  await t.test("canonical same-identity prep construction routes only after a later unchanged epoch",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"d".repeat(64),pid:await exitedProcessPid(),v:1 as const},prep=await writeAdmissionPrep(root,owner,"zero"),ownerPath=path.join(prep,"owner.json"),complete=publicationOwnerBytes(owner),beforeIdentity=exactFsIdentity(ownerPath);let snapshots=0,progressed=false,semanticNow=0,callbacks=0;const events:Array<Readonly<{point:string;snapshot:number}>>=[],runtime={monotonicNow:()=>0,delay:async()=>{},observeBoundary:(point:string)=>{events.push({point,snapshot:snapshots});}},result=await new RawFsAuthorityLedger(root,{[__testPrepHousekeeperRuntimeOption]:runtime,now:()=>{semanticNow++;return t0;},lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="after-pre-admission-housekeeping-initial-enumeration")snapshots++;if(point==="after-admission-prep-enumeration"&&!progressed){assert.equal(snapshots,1);assert.deepEqual(events,[],"provisional monotonic progress emits no routing authority");writeFileSync(ownerPath,complete,{flag:"a"});progressed=true;}if(point==="before-ledger-operation-callback")callbacks++;}} as never).observeClock();assert.equal(progressed,true);assert.equal(snapshots>=2,true,"canonical progress is retried through a subsequent epoch");assert.deepEqual(exactFsIdentity(ownerPath),beforeIdentity);assert.deepEqual(await readFile(ownerPath),complete);assert.deepEqual(result,{ok:false,reason:"busy"});assert.deepEqual(events,[{point:tokenPoint,snapshot:2},{point:deadPoint,snapshot:2},{point:beforePoint,snapshot:2},{point:refusedPoint,snapshot:2}],"routing begins only in the first fully unchanged epoch");assert.deepEqual({semanticNow,callbacks},{semanticNow:0,callbacks:0});}));
  await t.test("token-carried observer sentinel is rethrown before later routing or mutation",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"a".repeat(64),pid:await exitedProcessPid(),v:1 as const};await writeAdmissionPrep(root,owner,"complete");const before=await snapshotRootArtifacts(root),sentinel={kind:"prep-token-boundary"},events:string[]=[];let semanticNow=0,callbacks=0,thrown:unknown;const runtime={monotonicNow:()=>0,delay:async()=>{},observeBoundary:(point:string)=>{events.push(point);if(point===tokenPoint)throw sentinel;}};try{await new RawFsAuthorityLedger(root,{[__testPrepHousekeeperRuntimeOption]:runtime,now:()=>{semanticNow++;return t0;},lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="before-ledger-operation-callback")callbacks++;}} as never).observeClock();}catch(error){thrown=error;}assert.equal(thrown,sentinel);assert.deepEqual(events,[tokenPoint]);assert.deepEqual({semanticNow,callbacks},{semanticNow:0,callbacks:0});assert.deepEqual(await snapshotRootArtifacts(root),before);}));
  await t.test("malformed prep is corruption unchanged and emits no routing point",()=>withRoot(async root=>{const malformed=path.join(root,".authority-ledger-admission-prep-malformed.tmp");await mkdir(malformed);const before=await snapshotRootArtifacts(root),events:string[]=[],observed=await exercise(root,events);assert.deepEqual(observed.result,{ok:false,reason:"corruption"});assert.deepEqual(events,[]);assert.deepEqual({semanticNow:observed.semanticNow,callbacks:observed.callbacks},{semanticNow:0,callbacks:0});assert.deepEqual(await snapshotRootArtifacts(root),before);}));
  await t.test("same-name prep identity replacement is corruption preserved and emits no routing point",()=>withRoot(async root=>{const external=await tempRoot(),owner={host:hostname(),nonce:"b".repeat(64),pid:process.pid,v:1 as const},prep=await writeAdmissionPrep(root,owner,"complete"),replacement=path.join(external,"replacement"),displaced=path.join(external,"displaced"),beforeIdentity=exactFsIdentity(prep),events:string[]=[];try{await mkdir(replacement);await writeFile(path.join(replacement,"owner.json"),publicationOwnerBytes(owner));let replaced=false,replacementIdentity:ExactFsIdentity|undefined,semanticNow=0,callbacks=0;const runtime={monotonicNow:()=>0,delay:async()=>{},observeBoundary:(point:string)=>{events.push(point);}},result=await new RawFsAuthorityLedger(root,{[__testPrepHousekeeperRuntimeOption]:runtime,now:()=>{semanticNow++;return t0;},lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="after-admission-prep-enumeration"&&!replaced){replaced=true;renameSync(prep,displaced);renameSync(replacement,prep);replacementIdentity=exactFsIdentity(prep);}if(point==="before-ledger-operation-callback")callbacks++;}} as never).observeClock();assert.equal(replaced,true);assert.notDeepEqual(replacementIdentity,beforeIdentity);assert.deepEqual(result,{ok:false,reason:"corruption"});assert.deepEqual(events,[]);assert.deepEqual({semanticNow,callbacks},{semanticNow:0,callbacks:0});assert.deepEqual(exactFsIdentity(prep),replacementIdentity);assert.deepEqual(await readFile(path.join(prep,"owner.json")),publicationOwnerBytes(owner));assert.deepEqual(await readdir(root),[path.basename(prep)]);}finally{await rm(external,{recursive:true,force:true});}}));
  await t.test("injected runtime drives one stable acquisition deadline while routing stays private",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"c".repeat(64),pid:process.pid,v:1 as const};await writeAdmissionSlot(root,owner);const before=await snapshotRootArtifacts(root),calls={monotonic:0,delay:0},observerArgs:unknown[][]=[];let semanticNow=0,callbacks=0;const runtime={monotonicNow:()=>{calls.monotonic++;return 100;},delay:async()=>{calls.delay++;},observeBoundary:(...args:unknown[])=>{observerArgs.push(args);}},result=await new RawFsAuthorityLedger(root,{[__testPrepHousekeeperRuntimeOption]:runtime,now:()=>{semanticNow++;return t0;},lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="before-ledger-operation-callback")callbacks++;}} as never).observeClock();assert.deepEqual(result,{ok:false,reason:"busy"});assert.deepEqual(calls,{monotonic:1,delay:0});assert.deepEqual(observerArgs,[[nonePoint]]);for(const args of observerArgs){assert.equal(args.length,1);assert.equal(typeof args[0],"string");}for(const literal of authorityPoints){assert.equal((ledgerFaultPoints as readonly string[]).includes(literal),false);assert.equal(containsPublicLiteral(authorityModule,literal),false,`${literal} is absent from every safe public-barrel value container`);}assert.deepEqual({semanticNow,callbacks},{semanticNow:0,callbacks:0});assert.deepEqual(await snapshotRootArtifacts(root),before);}));
});

test("prep-only housekeeper revalidates one-use authority before mutation",async t=>{
  const tokenPoint="prep-only-creator-token-carried",nonePoint="prep-only-no-authority",deadPoint="prep-only-prep-retirement-authority-dead-owner",exactCreatorPoint="prep-only-prep-retirement-authority-exact-creator",cleanupPoint="prep-only-prep-retired-cleanup-authority",beforePoint="prep-only-before-transition",refusedPoint="prep-only-transition-refused",privateLiterals=[tokenPoint,nonePoint,deadPoint,exactCreatorPoint,cleanupPoint,beforePoint,refusedPoint] as const;
  const containsPublicLiteral=(root:unknown,literal:string):boolean=>{const seen=new Set<object>(),visit=(value:unknown):boolean=>{if(typeof value==="string")return value===literal;if(value===null||typeof value!=="object")return false;if(seen.has(value))return false;seen.add(value);if(Array.isArray(value))return value.some(visit);if(value instanceof Set)return [...value].some(visit);if(value instanceof Map)return [...value].some(([key,item])=>visit(key)||visit(item));const prototype=Object.getPrototypeOf(value);return (prototype===Object.prototype||prototype===null)&&Object.values(value as Record<string,unknown>).some(visit);};return visit(root);};
  const execute=async(root:string,mode:"observeClock"|"recover"="observeClock",onPoint?:(point:string)=>void)=>{const events:string[]=[],observerArgs:unknown[][]=[];let semanticNow=0,callbacks=0,monotonic=0,delays=0,result:unknown,thrown:unknown;const runtime={monotonicNow:()=>{monotonic++;return 0;},delay:async()=>{delays++;},observeBoundary:(...args:unknown[])=>{observerArgs.push(args);const point=String(args[0]);events.push(point);onPoint?.(point);}},ledger=new RawFsAuthorityLedger(root,{[__testPrepHousekeeperRuntimeOption]:runtime,now:()=>{semanticNow++;return t0;},lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="before-ledger-operation-callback")callbacks++;}} as never);try{result=await ledger[mode]();}catch(error){thrown=error;}return {events,observerArgs,semanticNow,callbacks,monotonic,delays,result,thrown};};
  const assertRoutingOnly=(observed:Awaited<ReturnType<typeof execute>>)=>{assert.deepEqual({semanticNow:observed.semanticNow,callbacks:observed.callbacks,delays:observed.delays},{semanticNow:0,callbacks:0,delays:0});for(const args of observed.observerArgs){assert.equal(args.length,1);assert.equal(typeof args[0],"string");}};
  const prepRetired=async(root:string,suffix:string,variant:"marker"|"stage-zero"|"stage-prefix"|"stage-complete"|"marker-final"|"orphan-final")=>{assert.match(suffix,/^[0-9a-f]$/,"fixture suffix is one lowercase hex character");const owner={host:hostname(),nonce:suffix.repeat(64),pid:process.pid,v:1 as const};assert.equal(owner.nonce.length,64);assert.match(owner.nonce,/^[0-9a-f]{64}$/);const markerName=admissionPrepRetiredName(owner,"complete"),marker=path.join(root,markerName);await mkdir(marker);await writeFile(path.join(marker,"owner.json"),publicationOwnerBytes(owner));const ack=incompleteCoordinationAck(owner,"prep-retired",markerName,admissionPrepName(owner),"complete",marker),ackBytes=authorityCanonicalBytes(ack),stage=path.join(root,coordinationStageName(ack,"prep-retired")),finalAck=path.join(root,coordinationAckName(ack));if(variant.startsWith("stage-")){const bytes=variant==="stage-zero"?Buffer.alloc(0):variant==="stage-prefix"?ackBytes.subarray(0,17):ackBytes;await writeFile(stage,bytes);}if(variant==="marker-final"||variant==="orphan-final")await writeFile(finalAck,ackBytes);if(variant==="orphan-final")await rm(marker,{recursive:true});return {owner,markerName,marker,ack,ackBytes,stage,finalAck,original:path.join(root,admissionPrepName(owner))};};
  await t.test("legacy publication snapshot never emits exact-creator K1 authority",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"1".repeat(64),pid:process.pid,v:1 as const,ticket:"0000000000000001"};await writePublicationStage(root,owner,publicationOwnerBytes(owner));const before=await snapshotRootArtifacts(root),observed=await execute(root);assert.deepEqual(observed.result,{ok:false,reason:"busy"});assert.equal(observed.events.includes(exactCreatorPoint),false);assertRoutingOnly(observed);assert.deepEqual(await snapshotRootArtifacts(root),before);}));
  await t.test("same-PID external live prep cannot emit exact-creator authority",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"2".repeat(64),pid:process.pid,v:1 as const};await writeAdmissionPrep(root,owner,"complete");const before=await snapshotRootArtifacts(root),observed=await execute(root);assert.deepEqual(observed.result,{ok:false,reason:"busy"});assert.equal(observed.events.includes(exactCreatorPoint)||observed.events.includes(deadPoint),false);assertRoutingOnly(observed);assert.deepEqual(await snapshotRootArtifacts(root),before);}));
  await t.test("restarted ledger cannot reconstruct exact-creator authority",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"3".repeat(64),pid:process.pid,v:1 as const};await writeAdmissionPrep(root,owner,"complete");const before=await snapshotRootArtifacts(root),observed=await execute(root,"recover");assert.deepEqual(observed.result,{ok:false,reason:"busy"});assert.equal(observed.events.includes(exactCreatorPoint)||observed.events.includes(deadPoint),false);assertRoutingOnly(observed);assert.deepEqual(await snapshotRootArtifacts(root),before);}));
  await t.test("slot remains confined to exactly no-authority",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"4".repeat(64),pid:process.pid,v:1 as const};await writeAdmissionSlot(root,owner);const before=await snapshotRootArtifacts(root),observed=await execute(root);assert.deepEqual(observed.result,{ok:false,reason:"busy"});assert.deepEqual(observed.events,[nonePoint]);assertRoutingOnly(observed);assert.deepEqual(await snapshotRootArtifacts(root),before);}));
  await t.test("withdrawal remains confined to exactly no-authority",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"5".repeat(64),pid:process.pid,v:1 as const},withdrawal=await writeCreatorWithdrawal(root,owner,"partial"),withdrawalName=path.basename(withdrawal),slotName=admissionRetiredName(owner,"withdrawn"),slot=path.join(root,slotName);await mkdir(slot);await writeFile(path.join(slot,"owner.json"),publicationOwnerBytes(owner));const slotAck=slotCoordinationAck(owner,slotName,slot,"withdrawn",withdrawalName,ownerStateBytes(owner,"partial"));await writeFile(path.join(root,coordinationAckName(slotAck)),authorityCanonicalBytes(slotAck));await rm(slot,{recursive:true});const before=await snapshotRootArtifacts(root),observed=await execute(root);assert.deepEqual(observed.result,{ok:false,reason:"busy"});assert.deepEqual(observed.events,[nonePoint]);assertRoutingOnly(observed);assert.deepEqual(await snapshotRootArtifacts(root),before);}));
  await t.test("handoff literals and token authority service names remain unexported",async()=>{const publicModule=authorityModule as Record<string,unknown>,packageJson=JSON.parse(await readFile(path.resolve("package.json"),"utf8")) as {exports:Record<string,unknown>},typeNames=["PrepCreatorToken","PrepRetirementAuthority","PrepRetiredCleanupAuthority"] as const;for(const name of [...typeNames,"__testServicePrepHousekeepingOnce"])assert.equal(name in publicModule,false);for(const literal of privateLiterals){assert.equal((ledgerFaultPoints as readonly string[]).includes(literal),false);assert.equal(containsPublicLiteral(publicModule,literal),false);assert.equal(containsPublicLiteral(packageJson.exports,literal),false);}assert.deepEqual(Object.keys(packageJson.exports).filter(name=>/(?:prep|housekeep|runtime|host)/i.test(name)),[]);const probeRoot=await tempRoot();try{let modulePath=path.relative(probeRoot,path.resolve("src/authority/index.js")).replaceAll("\\","/");if(!modulePath.startsWith("."))modulePath=`./${modulePath}`;const probe=path.join(probeRoot,"probe.ts"),source=`import type { ${typeNames.join(", ")} } from ${JSON.stringify(modulePath)};\nexport type Probe = [${typeNames.join(", ")}];\n`;await writeFile(probe,source);let diagnostics="",exitCode=0;try{await promisify(execFile)(process.execPath,[path.resolve("node_modules/typescript/bin/tsc"),"--noEmit","--skipLibCheck","--module","NodeNext","--moduleResolution","NodeNext","--target","ES2022","--typeRoots",path.resolve("node_modules/@types"),probe],{cwd:path.resolve(".")});}catch(error){const failure=error as Error&{code?:number;stdout?:string;stderr?:string};exitCode=typeof failure.code==="number"?failure.code:1;diagnostics=`${failure.stdout??""}\n${failure.stderr??""}`;}assert.notEqual(exitCode,0,"type-only authority imports must fail compilation");for(const name of typeNames){assert.match(diagnostics,new RegExp(`error TS2305:[^\\r\\n]*has no exported member ['\"]${name}['\"]`),`${name} has an explicit missing-export diagnostic`);}}finally{await rm(probeRoot,{recursive:true,force:true});}});
  await t.test("dead-owner prep happy handoff consumes authority once then refuses without mutation",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"6".repeat(64),pid:await exitedProcessPid(),v:1 as const};await writeAdmissionPrep(root,owner,"complete");const before=await snapshotRootArtifacts(root),observed=await execute(root);assert.deepEqual(observed.result,{ok:false,reason:"busy"});assert.deepEqual(observed.events,[tokenPoint,deadPoint,beforePoint,refusedPoint]);assert.equal(observed.events.filter(point=>point===deadPoint).length,1);assertRoutingOnly(observed);assert.deepEqual(await snapshotRootArtifacts(root),before);}));
  await t.test("dead-owner liveness loss before final revalidation remains busy and consumes once",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"7".repeat(64),pid:49771,v:1 as const},originalKill=process.kill;await writeAdmissionPrep(root,owner,"complete");const before=await snapshotRootArtifacts(root);let probes=0,live=false;Object.defineProperty(process,"kill",{configurable:true,value:(pid:number)=>{if(pid!==owner.pid)return originalKill.call(process,pid,0);probes++;if(!live)throw Object.assign(new Error("dead"),{code:"ESRCH"});return true;}});let observed;try{observed=await execute(root,"observeClock",point=>{if(point===deadPoint)live=true;});}finally{Object.defineProperty(process,"kill",{configurable:true,value:originalKill});}assert.deepEqual(observed.result,{ok:false,reason:"busy"});assert.deepEqual(observed.events,[tokenPoint,deadPoint,beforePoint,refusedPoint]);assert.equal(observed.events.filter(point=>point===deadPoint).length,1);assert.ok(probes>=2);assertRoutingOnly(observed);assert.deepEqual(await snapshotRootArtifacts(root),before);}));
  await t.test("prep identity replacement before transition is corruption preserved",()=>withRoot(async root=>{const external=await tempRoot(),owner={host:hostname(),nonce:"8".repeat(64),pid:await exitedProcessPid(),v:1 as const},prep=await writeAdmissionPrep(root,owner,"complete"),replacement=path.join(external,"replacement"),displaced=path.join(external,"displaced"),beforeIdentity=exactFsIdentity(prep);try{await mkdir(replacement);await writeFile(path.join(replacement,"owner.json"),publicationOwnerBytes(owner));let replaced=false,replacementIdentity:ExactFsIdentity|undefined;const observed=await execute(root,"observeClock",point=>{if(point===beforePoint&&!replaced){renameSync(prep,displaced);renameSync(replacement,prep);replacementIdentity=exactFsIdentity(prep);replaced=true;}});assert.equal(replaced,true);assert.notDeepEqual(replacementIdentity,beforeIdentity);assert.deepEqual(observed.result,{ok:false,reason:"corruption"});assert.deepEqual(observed.events,[tokenPoint,deadPoint,beforePoint,refusedPoint]);assert.equal(observed.events.filter(point=>point===deadPoint).length,1);assertRoutingOnly(observed);assert.deepEqual(exactFsIdentity(prep),replacementIdentity);assert.deepEqual(await readFile(path.join(prep,"owner.json")),publicationOwnerBytes(owner));}finally{await rm(external,{recursive:true,force:true});}}));
  for(const [index,variant] of (["marker","stage-zero","stage-prefix","stage-complete","marker-final","orphan-final"] as const).entries())await t.test(`prep-retired ${variant} consumes cleanup authority once and refuses unchanged`,()=>withRoot(async root=>{const fixture=await prepRetired(root,(index+9).toString(16),variant),before=await snapshotRootArtifacts(root),observed=await execute(root);assert.deepEqual(observed.result,{ok:false,reason:"busy"});assert.deepEqual(observed.events,[cleanupPoint,beforePoint,refusedPoint]);assert.equal(observed.events.filter(point=>point===cleanupPoint).length,1);assertRoutingOnly(observed);assert.deepEqual(await snapshotRootArtifacts(root),before);assert.equal(existsSync(fixture.stage)||existsSync(fixture.finalAck)||existsSync(fixture.marker),true);}));
  for(const [index,target] of (["marker","stage","final","original-reappearance"] as const).entries())await t.test(`prep-retired ${target} replacement before transition is corruption preserved`,()=>withRoot(async root=>{const external=await tempRoot(),variant=target==="marker"?"marker":target==="stage"?"stage-complete":target==="final"?"marker-final":"orphan-final",fixture=await prepRetired(root,("f012" as const)[index]!,variant),bad=Buffer.from("{garbage");let mutated=false,mutatedIdentity:ExactFsIdentity|undefined;try{const observed=await execute(root,"observeClock",point=>{if(point!==beforePoint||mutated)return;mutated=true;if(target==="marker"){const replacement=path.join(external,"marker");mkdirSync(replacement);writeFileSync(path.join(replacement,"owner.json"),publicationOwnerBytes(fixture.owner));renameSync(fixture.marker,path.join(external,"old-marker"));renameSync(replacement,fixture.marker);mutatedIdentity=exactFsIdentity(fixture.marker);}else if(target==="stage"){writeFileSync(fixture.stage,bad);mutatedIdentity=exactFsIdentity(fixture.stage);}else if(target==="final"){writeFileSync(fixture.finalAck,bad);mutatedIdentity=exactFsIdentity(fixture.finalAck);}else{mkdirSync(fixture.original);writeFileSync(path.join(fixture.original,"owner.json"),publicationOwnerBytes(fixture.owner));mutatedIdentity=exactFsIdentity(fixture.original);}});assert.equal(mutated,true);assert.deepEqual(observed.result,{ok:false,reason:"corruption"});assert.deepEqual(observed.events,[cleanupPoint,beforePoint,refusedPoint]);assert.equal(observed.events.filter(point=>point===cleanupPoint).length,1);assertRoutingOnly(observed);const targetPath=target==="marker"?fixture.marker:target==="stage"?fixture.stage:target==="final"?fixture.finalAck:fixture.original;assert.deepEqual(exactFsIdentity(targetPath),mutatedIdentity);if(target==="stage"||target==="final")assert.deepEqual(await readFile(targetPath),bad);else assert.deepEqual(await readFile(path.join(targetPath,"owner.json")),publicationOwnerBytes(fixture.owner));}finally{await rm(external,{recursive:true,force:true});}}));
  for(const [index,boundary] of ([cleanupPoint,beforePoint] as const).entries())await t.test(`observer sentinel at ${boundary} is rethrown exactly before mutation`,()=>withRoot(async root=>{await prepRetired(root,("34" as const)[index]!,"marker");const before=await snapshotRootArtifacts(root),sentinel={boundary},observed=await execute(root,"observeClock",point=>{if(point===boundary)throw sentinel;});assert.equal(observed.thrown,sentinel);assert.deepEqual(observed.events,boundary===cleanupPoint?[cleanupPoint]:[cleanupPoint,beforePoint]);assert.equal(observed.events.filter(point=>point===cleanupPoint).length,1);assertRoutingOnly(observed);assert.deepEqual(await snapshotRootArtifacts(root),before);}));
});

test("prep-only dead-owner writer retires a complete prep after final revalidation",()=>withRoot(async root=>{
  const tokenPoint="prep-only-creator-token-carried",deadPoint="prep-only-prep-retirement-authority-dead-owner",beforePoint="prep-only-before-transition",afterFinalPoint="prep-only-after-final-revalidation",retiredPoint="prep-only-prep-retirement-root-synced",cleanupStagePoint="prep-only-cleanup-stage-zero",cleanupFinalPoint="prep-only-cleanup-stage-complete",sentinel={kind:"prep-retirement-root-synced"};
  const owner={host:hostname(),nonce:"a".repeat(64),pid:await exitedProcessPid(),v:1 as const},original=await writeAdmissionPrep(root,owner,"complete"),originalOwner=path.join(original,"owner.json"),markerName=admissionPrepRetiredName(owner,"complete"),marker=path.join(root,markerName),markerOwner=path.join(marker,"owner.json"),directoryIdentity=exactFsIdentity(original),ownerIdentity=exactFsIdentity(originalOwner),ownerBytes=await readFile(originalOwner),events:string[]=[];
  let semanticNow=0,callbacks=0,delays=0,thrown:unknown;
  const runtime={monotonicNow:()=>0,delay:async()=>{delays++;},observeBoundary:(point:string)=>{events.push(point);if(point===retiredPoint)throw sentinel;}};
  try{await new RawFsAuthorityLedger(root,{[__testPrepHousekeeperRuntimeOption]:runtime,now:()=>{semanticNow++;return t0;},lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="before-ledger-operation-callback")callbacks++;}} as never).recover();}catch(error){thrown=error;}
  assert.equal(thrown,sentinel,"the retirement writer reaches its final private durability boundary");
  assert.deepEqual(events,[tokenPoint,deadPoint,beforePoint,afterFinalPoint,retiredPoint]);
  assert.equal(existsSync(original),false);
  assert.equal(existsSync(marker),true);
  assert.deepEqual(exactFsIdentity(marker),directoryIdentity,"the exact prep directory identity survives atomic retirement");
  assert.deepEqual(exactFsIdentity(markerOwner),ownerIdentity,"the exact owner identity survives atomic retirement");
  assert.deepEqual(await readFile(markerOwner),ownerBytes,"retirement preserves the exact canonical owner bytes");
  const ack=incompleteCoordinationAck(owner,"prep-retired",markerName,admissionPrepName(owner),"complete",marker);
  assert.equal(existsSync(path.join(root,coordinationStageName(ack,"prep-retired"))),false,"retirement stops before cleanup staging");
  assert.equal(existsSync(path.join(root,coordinationAckName(ack))),false,"retirement stops before the final cleanup acknowledgment");
  assert.equal(events.includes(cleanupStagePoint)||events.includes(cleanupFinalPoint),false);
  assert.deepEqual({semanticNow,callbacks,delays},{semanticNow:0,callbacks:0,delays:0});
}));

test("prep-only cleanup writer resumes one prep-retired stage from zero through prefix to complete",()=>withRoot(async root=>{
  const cleanupPoint="prep-only-prep-retired-cleanup-authority",beforePoint="prep-only-before-transition",afterFinalPoint="prep-only-after-final-revalidation",zeroPoint="prep-only-cleanup-stage-zero",prefixPoint="prep-only-cleanup-stage-prefix",completePoint="prep-only-cleanup-stage-complete";
  const owner={host:hostname(),nonce:"b".repeat(64),pid:await exitedProcessPid(),v:1 as const},markerName=admissionPrepRetiredName(owner,"complete"),marker=path.join(root,markerName),markerOwner=path.join(marker,"owner.json");
  await mkdir(marker);await writeFile(markerOwner,publicationOwnerBytes(owner));
  const markerIdentity=exactFsIdentity(marker),markerOwnerIdentity=exactFsIdentity(markerOwner),markerOwnerBytes=await readFile(markerOwner),ack=incompleteCoordinationAck(owner,"prep-retired",markerName,admissionPrepName(owner),"complete",marker),ackBytes=authorityCanonicalBytes(ack),stage=path.join(root,coordinationStageName(ack,"prep-retired")),finalAck=path.join(root,coordinationAckName(ack));
  const runPhase=async(point:string,index:number)=>{const sentinel={kind:"prep-cleanup-stage",index,point},events:string[]=[];let semanticNow=0,callbacks=0,delays=0,thrown:unknown;const runtime={monotonicNow:()=>0,delay:async()=>{delays++;},observeBoundary:(observed:string)=>{events.push(observed);if(observed===point)throw sentinel;}};try{await new RawFsAuthorityLedger(root,{[__testPrepHousekeeperRuntimeOption]:runtime,now:()=>{semanticNow++;return t0;},lockTimeoutMs:20,faultInjector:(boundary:string)=>{if(boundary==="before-ledger-operation-callback")callbacks++;}} as never).recover();}catch(error){thrown=error;}assert.equal(thrown,sentinel,`${point} is a live private writer boundary`);assert.deepEqual(events,[cleanupPoint,beforePoint,afterFinalPoint,point],point);assert.deepEqual({semanticNow,callbacks,delays},{semanticNow:0,callbacks:0,delays:0},point);assert.equal(existsSync(marker),true,point);assert.deepEqual(exactFsIdentity(marker),markerIdentity,point);assert.deepEqual(exactFsIdentity(markerOwner),markerOwnerIdentity,point);assert.deepEqual(await readFile(markerOwner),markerOwnerBytes,point);assert.equal(existsSync(finalAck),false,point);};
  await runPhase(zeroPoint,0);
  const zeroStat=lstatSync(stage,{bigint:true}),stageIdentity=exactFsIdentity(stage);
  assert.equal(zeroStat.isFile(),true,"the zero stage is a regular file");assert.equal(zeroStat.isSymbolicLink(),false);assert.equal(zeroStat.nlink,1n,"the zero stage has exactly one link");assert.deepEqual(await readFile(stage),Buffer.alloc(0));
  await runPhase(prefixPoint,1);
  const prefix=await readFile(stage);assert.deepEqual(exactFsIdentity(stage),stageIdentity,"prefix append preserves the exact stage identity");assert.ok(prefix.length>0&&prefix.length<ackBytes.length,"the deterministic prefix is nonempty and strict");assert.deepEqual(prefix,ackBytes.subarray(0,prefix.length));
  await runPhase(completePoint,2);
  assert.deepEqual(exactFsIdentity(stage),stageIdentity,"completion append preserves the exact stage identity");assert.deepEqual(await readFile(stage),ackBytes,"the completed stage is the exact canonical prep-retired acknowledgment");assert.equal(existsSync(finalAck),false);
}));

test("prep-only legitimate peer progress reclassifies retirement and stage collisions",async t=>{
  const tokenPoint="prep-only-creator-token-carried",deadPoint="prep-only-prep-retirement-authority-dead-owner",cleanupPoint="prep-only-prep-retired-cleanup-authority",beforePoint="prep-only-before-transition",afterFinalPoint="prep-only-after-final-revalidation",retiredPoint="prep-only-prep-retirement-root-synced",zeroPoint="prep-only-cleanup-stage-zero",prefixPoint="prep-only-cleanup-stage-prefix";
  await t.test("retirement collision adopts the peer marker and continues from it",()=>withRoot(async root=>{
    const owner={host:hostname(),nonce:"c".repeat(64),pid:await exitedProcessPid(),v:1 as const},prep=await writeAdmissionPrep(root,owner,"complete"),prepOwner=path.join(prep,"owner.json"),markerName=admissionPrepRetiredName(owner,"complete"),marker=path.join(root,markerName),markerOwner=path.join(marker,"owner.json"),prepIdentity=exactFsIdentity(prep),ownerIdentity=exactFsIdentity(prepOwner),ownerBytes=await readFile(prepOwner),sentinel={kind:"peer-retirement-reclassified"},events:string[]=[];
    let injections=0,semanticNow=0,callbacks=0,delays=0,thrown:unknown;
    const runtime={monotonicNow:()=>0,delay:async()=>{delays++;},observeBoundary:(point:string)=>{events.push(point);if(point===afterFinalPoint&&injections===0){injections++;renameSync(prep,marker);}if(point===zeroPoint)throw sentinel;}};
    try{await new RawFsAuthorityLedger(root,{[__testPrepHousekeeperRuntimeOption]:runtime,now:()=>{semanticNow++;return t0;},lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="before-ledger-operation-callback")callbacks++;}} as never).recover();}catch(error){thrown=error;}
    assert.equal(thrown,sentinel,"peer retirement is reclassified through the next writer phase");assert.equal(injections,1,"the peer rename occurs only at the post-revalidation seam");
    assert.deepEqual(events,[tokenPoint,deadPoint,beforePoint,afterFinalPoint,cleanupPoint,beforePoint,afterFinalPoint,zeroPoint]);assert.equal(events.includes(retiredPoint),false,"the collision loser does not claim the peer's root sync");
    assert.equal(existsSync(prep),false);assert.equal(existsSync(marker),true);assert.deepEqual(exactFsIdentity(marker),prepIdentity);assert.deepEqual(exactFsIdentity(markerOwner),ownerIdentity);assert.deepEqual(await readFile(markerOwner),ownerBytes);
    const ack=incompleteCoordinationAck(owner,"prep-retired",markerName,admissionPrepName(owner),"complete",marker),stage=path.join(root,coordinationStageName(ack,"prep-retired"));assert.deepEqual(await readFile(stage),Buffer.alloc(0));assert.equal(existsSync(path.join(root,coordinationAckName(ack))),false);assert.deepEqual({semanticNow,callbacks,delays},{semanticNow:0,callbacks:0,delays:0});
  }));
  await t.test("stage-create collision adopts the peer zero stage and appends in place",()=>withRoot(async root=>{
    const owner={host:hostname(),nonce:"d".repeat(64),pid:await exitedProcessPid(),v:1 as const},markerName=admissionPrepRetiredName(owner,"complete"),marker=path.join(root,markerName),markerOwner=path.join(marker,"owner.json");await mkdir(marker);await writeFile(markerOwner,publicationOwnerBytes(owner));
    const markerIdentity=exactFsIdentity(marker),ownerIdentity=exactFsIdentity(markerOwner),ownerBytes=await readFile(markerOwner),ack=incompleteCoordinationAck(owner,"prep-retired",markerName,admissionPrepName(owner),"complete",marker),ackBytes=authorityCanonicalBytes(ack),stage=path.join(root,coordinationStageName(ack,"prep-retired")),finalAck=path.join(root,coordinationAckName(ack)),sentinel={kind:"peer-stage-reclassified"},events:string[]=[];
    let injections=0,semanticNow=0,callbacks=0,delays=0,thrown:unknown,peerStageIdentity:ExactFsIdentity|undefined;
    const runtime={monotonicNow:()=>0,delay:async()=>{delays++;},observeBoundary:(point:string)=>{events.push(point);if(point===afterFinalPoint&&injections===0){injections++;writeFileSync(stage,Buffer.alloc(0),{flag:"wx",mode:0o600});peerStageIdentity=exactFsIdentity(stage);}if(point===prefixPoint)throw sentinel;}};
    try{await new RawFsAuthorityLedger(root,{[__testPrepHousekeeperRuntimeOption]:runtime,now:()=>{semanticNow++;return t0;},lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="before-ledger-operation-callback")callbacks++;}} as never).recover();}catch(error){thrown=error;}
    assert.equal(thrown,sentinel,"peer zero stage is reclassified through its prefix append");assert.equal(injections,1,"the peer stage is created only at the post-revalidation seam");assert.ok(peerStageIdentity);
    assert.deepEqual(events,[cleanupPoint,beforePoint,afterFinalPoint,cleanupPoint,beforePoint,afterFinalPoint,prefixPoint]);assert.deepEqual(exactFsIdentity(stage),peerStageIdentity,"the collision loser appends to the peer's exact stage identity");
    const prefix=await readFile(stage);assert.ok(prefix.length>0&&prefix.length<ackBytes.length);assert.deepEqual(prefix,ackBytes.subarray(0,prefix.length));assert.deepEqual(exactFsIdentity(marker),markerIdentity);assert.deepEqual(exactFsIdentity(markerOwner),ownerIdentity);assert.deepEqual(await readFile(markerOwner),ownerBytes);assert.equal(existsSync(finalAck),false);assert.deepEqual({semanticNow,callbacks,delays},{semanticNow:0,callbacks:0,delays:0});
  }));
});

test("prep-only progress respects the original deadline before another transition",()=>withRoot(async root=>{
  const retiredPoint="prep-only-prep-retirement-root-synced",zeroPoint="prep-only-cleanup-stage-zero",prefixPoint="prep-only-cleanup-stage-prefix",completePoint="prep-only-cleanup-stage-complete",owner={host:hostname(),nonce:"e".repeat(64),pid:await exitedProcessPid(),v:1 as const},prep=await writeAdmissionPrep(root,owner,"complete"),prepOwner=path.join(prep,"owner.json"),markerName=admissionPrepRetiredName(owner,"complete"),marker=path.join(root,markerName),markerOwner=path.join(marker,"owner.json"),prepIdentity=exactFsIdentity(prep),ownerIdentity=exactFsIdentity(prepOwner),ownerBytes=await readFile(prepOwner),events:string[]=[];
  let monotonic=0,monotonicCalls=0,semanticNow=0,callbacks=0,delays=0;
  const runtime={monotonicNow:()=>{monotonicCalls++;return monotonic;},delay:async()=>{delays++;},observeBoundary:(point:string)=>{events.push(point);if(point===retiredPoint)monotonic=21;}};
  const result=await new RawFsAuthorityLedger(root,{[__testPrepHousekeeperRuntimeOption]:runtime,now:()=>{semanticNow++;return t0;},lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="before-ledger-operation-callback")callbacks++;}} as never).recover();
  assert.deepEqual(result,{ok:false,reason:"busy"});assert.ok(monotonicCalls>=2,"the original acquisition deadline is re-read after proved progress");assert.equal(events.includes(retiredPoint),true);assert.equal(events.includes(zeroPoint)||events.includes(prefixPoint)||events.includes(completePoint),false,"expired progress cannot authorize another transition");
  assert.equal(existsSync(prep),false);assert.equal(existsSync(marker),true);assert.deepEqual(exactFsIdentity(marker),prepIdentity);assert.deepEqual(exactFsIdentity(markerOwner),ownerIdentity);assert.deepEqual(await readFile(markerOwner),ownerBytes);
  const ack=incompleteCoordinationAck(owner,"prep-retired",markerName,admissionPrepName(owner),"complete",marker);assert.equal(existsSync(path.join(root,coordinationStageName(ack,"prep-retired"))),false);assert.equal(existsSync(path.join(root,coordinationAckName(ack))),false);assert.deepEqual({semanticNow,callbacks,delays},{semanticNow:0,callbacks:0,delays:0});
}));

test("prep-only cleanup finalization renames a complete stage to its exact synced ack",()=>withRoot(async root=>{
  const cleanupPoint="prep-only-prep-retired-cleanup-authority",beforePoint="prep-only-before-transition",afterFinalPoint="prep-only-after-final-revalidation",ackRootPoint="prep-only-cleanup-ack-root-synced",owner={host:hostname(),nonce:"1".repeat(64),pid:await exitedProcessPid(),v:1 as const},markerName=admissionPrepRetiredName(owner,"complete"),marker=path.join(root,markerName),markerOwner=path.join(marker,"owner.json"),original=path.join(root,admissionPrepName(owner));await mkdir(marker);await writeFile(markerOwner,publicationOwnerBytes(owner));
  const markerIdentity=exactFsIdentity(marker),ownerIdentity=exactFsIdentity(markerOwner),ownerBytes=await readFile(markerOwner),ack=incompleteCoordinationAck(owner,"prep-retired",markerName,admissionPrepName(owner),"complete",marker),ackBytes=authorityCanonicalBytes(ack),stage=path.join(root,coordinationStageName(ack,"prep-retired")),finalAck=path.join(root,coordinationAckName(ack));await writeFile(stage,ackBytes);const stageIdentity=exactFsIdentity(stage),sentinel={kind:"prep-cleanup-ack-root-synced"},events:string[]=[];let semanticNow=0,callbacks=0,delays=0,thrown:unknown;
  const runtime={monotonicNow:()=>0,delay:async()=>{delays++;},observeBoundary:(point:string)=>{events.push(point);if(point===ackRootPoint)throw sentinel;}};try{await new RawFsAuthorityLedger(root,{[__testPrepHousekeeperRuntimeOption]:runtime,now:()=>{semanticNow++;return t0;},lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="before-ledger-operation-callback")callbacks++;}} as never).recover();}catch(error){thrown=error;}
  assert.equal(thrown,sentinel);assert.deepEqual(events,[cleanupPoint,beforePoint,afterFinalPoint,ackRootPoint]);assert.equal(existsSync(stage),false);assert.equal(existsSync(finalAck),true);assert.deepEqual(exactFsIdentity(finalAck),stageIdentity);assert.deepEqual(await readFile(finalAck),ackBytes);assert.deepEqual(exactFsIdentity(marker),markerIdentity);assert.deepEqual(exactFsIdentity(markerOwner),ownerIdentity);assert.deepEqual(await readFile(markerOwner),ownerBytes);assert.equal(existsSync(original),false);assert.deepEqual({semanticNow,callbacks,delays},{semanticNow:0,callbacks:0,delays:0});
}));

test("prep-only cleanup finalization removes an acknowledged marker and syncs",()=>withRoot(async root=>{
  const cleanupPoint="prep-only-prep-retired-cleanup-authority",beforePoint="prep-only-before-transition",afterFinalPoint="prep-only-after-final-revalidation",markerRootPoint="prep-only-cleanup-marker-root-synced",owner={host:hostname(),nonce:"2".repeat(64),pid:await exitedProcessPid(),v:1 as const},markerName=admissionPrepRetiredName(owner,"complete"),marker=path.join(root,markerName),markerOwner=path.join(marker,"owner.json"),original=path.join(root,admissionPrepName(owner));await mkdir(marker);await writeFile(markerOwner,publicationOwnerBytes(owner));
  const ack=incompleteCoordinationAck(owner,"prep-retired",markerName,admissionPrepName(owner),"complete",marker),ackBytes=authorityCanonicalBytes(ack),stage=path.join(root,coordinationStageName(ack,"prep-retired")),finalAck=path.join(root,coordinationAckName(ack));await writeFile(finalAck,ackBytes);const ackIdentity=exactFsIdentity(finalAck),sentinel={kind:"prep-cleanup-marker-root-synced"},events:string[]=[];let semanticNow=0,callbacks=0,delays=0,thrown:unknown;
  const runtime={monotonicNow:()=>0,delay:async()=>{delays++;},observeBoundary:(point:string)=>{events.push(point);if(point===markerRootPoint)throw sentinel;}};try{await new RawFsAuthorityLedger(root,{[__testPrepHousekeeperRuntimeOption]:runtime,now:()=>{semanticNow++;return t0;},lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="before-ledger-operation-callback")callbacks++;}} as never).recover();}catch(error){thrown=error;}
  assert.equal(thrown,sentinel);assert.deepEqual(events,[cleanupPoint,beforePoint,afterFinalPoint,markerRootPoint]);assert.equal(existsSync(marker),false);assert.equal(existsSync(finalAck),true);assert.deepEqual(exactFsIdentity(finalAck),ackIdentity);assert.deepEqual(await readFile(finalAck),ackBytes);assert.equal(existsSync(original),false);assert.equal(existsSync(stage),false);assert.deepEqual({semanticNow,callbacks,delays},{semanticNow:0,callbacks:0,delays:0});
}));

test("prep-only cleanup finalization removes an orphan ack and syncs admission-ready",()=>withRoot(async root=>{
  const cleanupPoint="prep-only-prep-retired-cleanup-authority",beforePoint="prep-only-before-transition",afterFinalPoint="prep-only-after-final-revalidation",finalRootPoint="prep-only-cleanup-final-root-synced",owner={host:hostname(),nonce:"3".repeat(64),pid:await exitedProcessPid(),v:1 as const},markerName=admissionPrepRetiredName(owner,"complete"),marker=path.join(root,markerName),markerOwner=path.join(marker,"owner.json"),original=path.join(root,admissionPrepName(owner));await mkdir(marker);await writeFile(markerOwner,publicationOwnerBytes(owner));const ack=incompleteCoordinationAck(owner,"prep-retired",markerName,admissionPrepName(owner),"complete",marker),ackBytes=authorityCanonicalBytes(ack),stage=path.join(root,coordinationStageName(ack,"prep-retired")),finalAck=path.join(root,coordinationAckName(ack));await writeFile(finalAck,ackBytes);await rm(marker,{recursive:true});
  const sentinel={kind:"prep-cleanup-final-root-synced"},events:string[]=[];let semanticNow=0,callbacks=0,delays=0,thrown:unknown;const runtime={monotonicNow:()=>0,delay:async()=>{delays++;},observeBoundary:(point:string)=>{events.push(point);if(point===finalRootPoint)throw sentinel;}};try{await new RawFsAuthorityLedger(root,{[__testPrepHousekeeperRuntimeOption]:runtime,now:()=>{semanticNow++;return t0;},lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="before-ledger-operation-callback")callbacks++;}} as never).recover();}catch(error){thrown=error;}
  assert.equal(thrown,sentinel);assert.deepEqual(events,[cleanupPoint,beforePoint,afterFinalPoint,finalRootPoint]);assert.equal(existsSync(finalAck),false);assert.equal(existsSync(marker),false);assert.equal(existsSync(original),false);assert.equal(existsSync(stage),false);assert.deepEqual((await readdir(root)).filter(name=>name.startsWith(".authority-ledger-admission-")||name.startsWith(".authority-ledger-creator-withdrawal-")||name.startsWith(".authority-ledger-coordination-cleanup-")),[]);assert.deepEqual({semanticNow,callbacks,delays},{semanticNow:0,callbacks:0,delays:0});
}));

test("prep-only cleanup finalization reclassifies an exact peer ack collision without widening the deadline",()=>withRoot(async root=>{
  const cleanupPoint="prep-only-prep-retired-cleanup-authority",beforePoint="prep-only-before-transition",afterFinalPoint="prep-only-after-final-revalidation",refusedPoint="prep-only-transition-refused",markerRootPoint="prep-only-cleanup-marker-root-synced",owner={host:hostname(),nonce:"4".repeat(64),pid:await exitedProcessPid(),v:1 as const},markerName=admissionPrepRetiredName(owner,"complete"),marker=path.join(root,markerName),markerOwner=path.join(marker,"owner.json");await mkdir(marker);await writeFile(markerOwner,publicationOwnerBytes(owner));
  const markerIdentity=exactFsIdentity(marker),ownerIdentity=exactFsIdentity(markerOwner),ownerBytes=await readFile(markerOwner),ack=incompleteCoordinationAck(owner,"prep-retired",markerName,admissionPrepName(owner),"complete",marker),ackBytes=authorityCanonicalBytes(ack),stage=path.join(root,coordinationStageName(ack,"prep-retired")),finalAck=path.join(root,coordinationAckName(ack));await writeFile(stage,ackBytes);const stageIdentity=exactFsIdentity(stage),events:string[]=[];let monotonic=0,monotonicCalls=0,injections=0,semanticNow=0,callbacks=0,delays=0;
  const runtime={monotonicNow:()=>{monotonicCalls++;return monotonic;},delay:async()=>{delays++;},observeBoundary:(point:string)=>{events.push(point);if(point===afterFinalPoint&&injections===0){injections++;renameSync(stage,finalAck);monotonic=21;}}};const result=await new RawFsAuthorityLedger(root,{[__testPrepHousekeeperRuntimeOption]:runtime,now:()=>{semanticNow++;return t0;},lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="before-ledger-operation-callback")callbacks++;}} as never).recover();
  assert.deepEqual(result,{ok:false,reason:"busy"});assert.equal(injections,1);assert.ok(monotonicCalls>=2);assert.deepEqual(events,[cleanupPoint,beforePoint,afterFinalPoint,cleanupPoint,beforePoint,refusedPoint]);assert.equal(events.includes(markerRootPoint),false);assert.equal(existsSync(stage),false);assert.equal(existsSync(finalAck),true);assert.deepEqual(exactFsIdentity(finalAck),stageIdentity);assert.deepEqual(await readFile(finalAck),ackBytes);assert.equal(existsSync(marker),true);assert.deepEqual(exactFsIdentity(marker),markerIdentity);assert.deepEqual(exactFsIdentity(markerOwner),ownerIdentity);assert.deepEqual(await readFile(markerOwner),ownerBytes);assert.deepEqual({semanticNow,callbacks,delays},{semanticNow:0,callbacks:0,delays:0});
}));

test("prep-only cleanup finalization resumes an authenticated partial marker removal",()=>withRoot(async root=>{
  const cleanupPoint="prep-only-prep-retired-cleanup-authority",beforePoint="prep-only-before-transition",afterFinalPoint="prep-only-after-final-revalidation",markerRootPoint="prep-only-cleanup-marker-root-synced",owner={host:hostname(),nonce:"5".repeat(64),pid:await exitedProcessPid(),v:1 as const},markerName=admissionPrepRetiredName(owner,"complete"),marker=path.join(root,markerName),markerOwner=path.join(marker,"owner.json"),original=path.join(root,admissionPrepName(owner));await mkdir(marker);await writeFile(markerOwner,publicationOwnerBytes(owner));
  const markerIdentity=exactFsIdentity(marker),markerWire=decimalIdentity(marker),ownerWire=decimalIdentity(markerOwner),ownerBytes=await readFile(markerOwner),ack=incompleteCoordinationAck(owner,"prep-retired",markerName,admissionPrepName(owner),"complete",marker),ackBytes=authorityCanonicalBytes(ack),stage=path.join(root,coordinationStageName(ack,"prep-retired")),finalAck=path.join(root,coordinationAckName(ack));await writeFile(finalAck,ackBytes);const ackIdentity=exactFsIdentity(finalAck);await unlink(markerOwner);assert.deepEqual(exactFsIdentity(marker),markerIdentity,"interrupted removal preserves the authenticated marker directory identity");assert.equal(existsSync(markerOwner),false);assert.deepEqual(ack.directoryIdentity,markerWire);assert.deepEqual(ack.ownerIdentity,ownerWire);
  const sentinel={kind:"prep-cleanup-marker-root-synced"},events:string[]=[];let semanticNow=0,callbacks=0,delays=0,thrown:unknown;const runtime={monotonicNow:()=>0,delay:async()=>{delays++;},observeBoundary:(point:string)=>{events.push(point);if(point===markerRootPoint)throw sentinel;}};try{await new RawFsAuthorityLedger(root,{[__testPrepHousekeeperRuntimeOption]:runtime,now:()=>{semanticNow++;return t0;},lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="before-ledger-operation-callback")callbacks++;}} as never).recover();}catch(error){thrown=error;}
  assert.equal(thrown,sentinel);assert.deepEqual(events,[cleanupPoint,beforePoint,afterFinalPoint,markerRootPoint]);assert.equal(existsSync(marker),false);assert.equal(existsSync(finalAck),true);assert.deepEqual(exactFsIdentity(finalAck),ackIdentity);assert.deepEqual(await readFile(finalAck),ackBytes);assert.equal(existsSync(original),false);assert.equal(existsSync(stage),false);assert.equal(ack.ownerBytesDigest,rawDigest(ownerBytes));assert.equal(ack.ownerBytesLength,String(ownerBytes.length));assert.deepEqual(ack.ownerIdentity,ownerWire);assert.deepEqual({semanticNow,callbacks,delays},{semanticNow:0,callbacks:0,delays:0});
}));

test("slot-only dead-owner writer retires the exact fixed slot as abandoned after final revalidation",()=>withRoot(async root=>{
  const authorityPoint="slot-only-slot-retirement-authority-dead-owner",beforePoint="slot-only-before-transition",afterFinalPoint="slot-only-after-final-revalidation",retiredPoint="slot-only-slot-retirement-root-synced",owner={host:hostname(),nonce:"6".repeat(64),pid:await exitedProcessPid(),v:1 as const},slot=await writeAdmissionSlot(root,owner),slotOwner=path.join(slot,"owner.json"),markerName=admissionRetiredName(owner,"abandoned"),marker=path.join(root,markerName),markerOwner=path.join(marker,"owner.json"),directoryIdentity=exactFsIdentity(slot),ownerIdentity=exactFsIdentity(slotOwner),ownerBytes=await readFile(slotOwner),sentinel={kind:"slot-retirement-root-synced"},events:string[]=[];let semanticNow=0,callbacks=0,delays=0,thrown:unknown;
  const runtime={monotonicNow:()=>0,delay:async()=>{delays++;},observeBoundary:(point:string)=>{events.push(point);if(point===retiredPoint)throw sentinel;}};try{await new RawFsAuthorityLedger(root,{[__testPrepHousekeeperRuntimeOption]:runtime,now:()=>{semanticNow++;return t0;},lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="before-ledger-operation-callback")callbacks++;}} as never).recover();}catch(error){thrown=error;}
  assert.equal(thrown,sentinel);assert.deepEqual(events,[authorityPoint,beforePoint,afterFinalPoint,retiredPoint]);assert.equal(existsSync(slot),false);assert.equal(existsSync(marker),true);assert.deepEqual(exactFsIdentity(marker),directoryIdentity);assert.deepEqual(exactFsIdentity(markerOwner),ownerIdentity);assert.deepEqual(await readFile(markerOwner),ownerBytes);
  const ack=slotCoordinationAck(owner,markerName,marker,"abandoned"),stage=path.join(root,coordinationStageName(ack,"slot-retired")),finalAck=path.join(root,coordinationAckName(ack));assert.equal(ack.purpose,"slot-retired");assert.equal(ack.disposition,"abandoned");assert.equal(ack.terminalArtifactName,markerName);assert.equal(ack.terminalArtifactDigest,rawDigest(ownerBytes));assert.equal(existsSync(stage),false);assert.equal(existsSync(finalAck),false);for(const point of [authorityPoint,beforePoint,afterFinalPoint,retiredPoint]){assert.equal((ledgerFaultPoints as readonly string[]).includes(point),false);assert.equal(Object.values(authorityModule as Record<string,unknown>).includes(point),false);}assert.deepEqual({semanticNow,callbacks,delays},{semanticNow:0,callbacks:0,delays:0});
}));

test("slot-only cleanup writer resumes abandoned slot-retired evidence through stage final marker and orphan-final cleanup",async()=>{
  const cleanupPoint="slot-only-slot-retired-cleanup-authority",beforePoint="slot-only-before-transition",afterFinalPoint="slot-only-after-final-revalidation",zeroPoint="slot-only-cleanup-stage-zero",prefixPoint="slot-only-cleanup-stage-prefix",completePoint="slot-only-cleanup-stage-complete",ackRootPoint="slot-only-cleanup-ack-root-synced",markerRootPoint="slot-only-cleanup-marker-root-synced",finalRootPoint="slot-only-cleanup-final-root-synced",owner={host:hostname(),nonce:"7".repeat(64),pid:await exitedProcessPid(),v:1 as const};
  const runPhase=(initial:"marker-only"|"zero-stage"|"prefix-stage"|"complete-stage"|"marker-final"|"orphan-final",point:string,index:number)=>withRoot(async root=>{const markerName=admissionRetiredName(owner,"abandoned"),marker=path.join(root,markerName),markerOwner=path.join(marker,"owner.json"),original=path.join(root,".authority-ledger-admission-0");await mkdir(marker);await writeFile(markerOwner,publicationOwnerBytes(owner));const markerIdentity=exactFsIdentity(marker),ownerIdentity=exactFsIdentity(markerOwner),ownerBytes=await readFile(markerOwner),markerWire=decimalIdentity(marker),ownerWire=decimalIdentity(markerOwner),ack=slotCoordinationAck(owner,markerName,marker,"abandoned"),ackBytes=authorityCanonicalBytes(ack),stage=path.join(root,coordinationStageName(ack,"slot-retired")),finalAck=path.join(root,coordinationAckName(ack));if(initial==="zero-stage")await writeFile(stage,Buffer.alloc(0));if(initial==="prefix-stage")await writeFile(stage,ackBytes.subarray(0,1));if(initial==="complete-stage")await writeFile(stage,ackBytes);if(initial==="marker-final"||initial==="orphan-final")await writeFile(finalAck,ackBytes);if(initial==="orphan-final")await rm(marker,{recursive:true});const stageIdentity=existsSync(stage)?exactFsIdentity(stage):undefined,ackIdentity=existsSync(finalAck)?exactFsIdentity(finalAck):undefined,sentinel={kind:"slot-cleanup",index,point},events:string[]=[];let semanticNow=0,callbacks=0,delays=0,thrown:unknown;const runtime={monotonicNow:()=>0,delay:async()=>{delays++;},observeBoundary:(observed:string)=>{events.push(observed);if(observed===point)throw sentinel;}};try{await new RawFsAuthorityLedger(root,{[__testPrepHousekeeperRuntimeOption]:runtime,now:()=>{semanticNow++;return t0;},lockTimeoutMs:20,faultInjector:(boundary:string)=>{if(boundary==="before-ledger-operation-callback")callbacks++;}} as never).recover();}catch(error){thrown=error;}assert.equal(thrown,sentinel,`${point} is a live private slot writer boundary`);assert.deepEqual(events,[cleanupPoint,beforePoint,afterFinalPoint,point],point);assert.deepEqual({semanticNow,callbacks,delays},{semanticNow:0,callbacks:0,delays:0},point);assert.equal(existsSync(original),false,point);assert.equal(ack.purpose,"slot-retired");assert.equal(ack.disposition,"abandoned");assert.equal(ack.originalName,".authority-ledger-admission-0");assert.equal(ack.terminalArtifactName,markerName);assert.equal(ack.terminalArtifactDigest,rawDigest(ownerBytes));assert.deepEqual(ack.slotIdentity,markerWire);assert.deepEqual(ack.ownerIdentity,ownerWire);assert.equal(ack.ownerBytesDigest,rawDigest(ownerBytes));assert.equal(ack.ownerBytesLength,String(ownerBytes.length));if(point===zeroPoint){const stat=lstatSync(stage,{bigint:true});assert.equal(stat.isFile(),true);assert.equal(stat.isSymbolicLink(),false);assert.equal(stat.nlink,1n);assert.deepEqual(await readFile(stage),Buffer.alloc(0));assert.equal(existsSync(finalAck),false);}if(point===prefixPoint){const prefix=await readFile(stage);assert.deepEqual(exactFsIdentity(stage),stageIdentity);assert.ok(prefix.length>0&&prefix.length<ackBytes.length);assert.deepEqual(prefix,ackBytes.subarray(0,prefix.length));assert.equal(existsSync(finalAck),false);}if(point===completePoint){assert.deepEqual(exactFsIdentity(stage),stageIdentity);assert.deepEqual(await readFile(stage),ackBytes);assert.equal(existsSync(finalAck),false);}if(point===ackRootPoint){assert.equal(existsSync(stage),false);assert.equal(existsSync(finalAck),true);assert.deepEqual(exactFsIdentity(finalAck),stageIdentity);assert.deepEqual(await readFile(finalAck),ackBytes);assert.equal(existsSync(marker),true);assert.deepEqual(exactFsIdentity(marker),markerIdentity);assert.deepEqual(exactFsIdentity(markerOwner),ownerIdentity);assert.deepEqual(await readFile(markerOwner),ownerBytes);}if(point===markerRootPoint){assert.equal(existsSync(marker),false);assert.equal(existsSync(finalAck),true);assert.deepEqual(exactFsIdentity(finalAck),ackIdentity);assert.deepEqual(await readFile(finalAck),ackBytes);}if(point===finalRootPoint){assert.equal(existsSync(marker),false);assert.equal(existsSync(stage),false);assert.equal(existsSync(finalAck),false);}});
  await runPhase("marker-only",zeroPoint,0);await runPhase("zero-stage",prefixPoint,1);await runPhase("prefix-stage",completePoint,2);await runPhase("complete-stage",ackRootPoint,3);await runPhase("marker-final",markerRootPoint,4);await runPhase("orphan-final",finalRootPoint,5);for(const point of [cleanupPoint,beforePoint,afterFinalPoint,zeroPoint,prefixPoint,completePoint,ackRootPoint,markerRootPoint,finalRootPoint]){assert.equal((ledgerFaultPoints as readonly string[]).includes(point),false);assert.equal(Object.values(authorityModule as Record<string,unknown>).includes(point),false);}
});

test("slot-only cleanup reclassifies an exact peer ack collision without widening the original deadline",()=>withRoot(async root=>{
  const cleanupPoint="slot-only-slot-retired-cleanup-authority",beforePoint="slot-only-before-transition",afterFinalPoint="slot-only-after-final-revalidation",refusedPoint="slot-only-transition-refused",markerRootPoint="slot-only-cleanup-marker-root-synced",owner={host:hostname(),nonce:"8".repeat(64),pid:await exitedProcessPid(),v:1 as const},markerName=admissionRetiredName(owner,"abandoned"),marker=path.join(root,markerName),markerOwner=path.join(marker,"owner.json");await mkdir(marker);await writeFile(markerOwner,publicationOwnerBytes(owner));
  const markerIdentity=exactFsIdentity(marker),ownerIdentity=exactFsIdentity(markerOwner),ownerBytes=await readFile(markerOwner),ack=slotCoordinationAck(owner,markerName,marker,"abandoned"),ackBytes=authorityCanonicalBytes(ack),stage=path.join(root,coordinationStageName(ack,"slot-retired")),finalAck=path.join(root,coordinationAckName(ack));await writeFile(stage,ackBytes);const stageIdentity=exactFsIdentity(stage),events:string[]=[];let monotonic=0,monotonicCalls=0,injections=0,semanticNow=0,callbacks=0,delays=0;
  const runtime={monotonicNow:()=>{monotonicCalls++;return monotonic;},delay:async()=>{delays++;},observeBoundary:(point:string)=>{events.push(point);if(point===afterFinalPoint&&injections===0){injections++;renameSync(stage,finalAck);monotonic=21;}}};const result=await new RawFsAuthorityLedger(root,{[__testPrepHousekeeperRuntimeOption]:runtime,now:()=>{semanticNow++;return t0;},lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="before-ledger-operation-callback")callbacks++;}} as never).recover();
  assert.deepEqual(result,{ok:false,reason:"busy"});assert.equal(injections,1);assert.ok(monotonicCalls>=2);assert.deepEqual(events,[cleanupPoint,beforePoint,afterFinalPoint,cleanupPoint,beforePoint,refusedPoint]);assert.equal(events.includes(markerRootPoint),false);assert.equal(existsSync(stage),false);assert.equal(existsSync(finalAck),true);assert.deepEqual(exactFsIdentity(finalAck),stageIdentity);assert.deepEqual(await readFile(finalAck),ackBytes);assert.equal(existsSync(marker),true);assert.deepEqual(exactFsIdentity(marker),markerIdentity);assert.deepEqual(exactFsIdentity(markerOwner),ownerIdentity);assert.deepEqual(await readFile(markerOwner),ownerBytes);assert.deepEqual({semanticNow,callbacks,delays},{semanticNow:0,callbacks:0,delays:0});
}));

test("slot-only stale retirement authority preserves an exact new live fixed slot installed after final revalidation",()=>withRoot(async root=>{
  const authorityPoint="slot-only-slot-retirement-authority-dead-owner",beforePoint="slot-only-before-transition",afterFinalPoint="slot-only-after-final-revalidation",retiredPoint="slot-only-slot-retirement-root-synced",oldOwner={host:hostname(),nonce:"9".repeat(64),pid:await exitedProcessPid(),v:1 as const},newOwner={host:hostname(),nonce:"a".repeat(64),pid:process.pid,v:1 as const},slot=await writeAdmissionSlot(root,oldOwner),oldMarkerName=admissionRetiredName(oldOwner,"abandoned"),oldMarker=path.join(root,oldMarkerName),oldAck=slotCoordinationAck(oldOwner,oldMarkerName,slot,"abandoned"),oldStage=path.join(root,coordinationStageName(oldAck,"slot-retired")),oldFinal=path.join(root,coordinationAckName(oldAck)),events:string[]=[];let injections=0,semanticNow=0,callbacks=0,delays=0,newDirectoryIdentity:ExactFsIdentity|undefined,newOwnerIdentity:ExactFsIdentity|undefined;
  const newOwnerBytes=publicationOwnerBytes(newOwner),runtime={monotonicNow:()=>0,delay:async()=>{delays++;},observeBoundary:(point:string)=>{events.push(point);if(point===afterFinalPoint&&injections===0){injections++;renameSync(slot,oldMarker);rmSync(oldMarker,{recursive:true});mkdirSync(slot);writeFileSync(path.join(slot,"owner.json"),newOwnerBytes);newDirectoryIdentity=exactFsIdentity(slot);newOwnerIdentity=exactFsIdentity(path.join(slot,"owner.json"));}}};const result=await new RawFsAuthorityLedger(root,{[__testPrepHousekeeperRuntimeOption]:runtime,now:()=>{semanticNow++;return t0;},lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="before-ledger-operation-callback")callbacks++;}} as never).recover();
  assert.equal(injections,1);assert.equal(existsSync(slot),true,"stale retirement cannot rename the peer's new fixed slot");assert.deepEqual(exactFsIdentity(slot),newDirectoryIdentity);assert.deepEqual(exactFsIdentity(path.join(slot,"owner.json")),newOwnerIdentity);assert.deepEqual(await readFile(path.join(slot,"owner.json")),newOwnerBytes);assert.equal(existsSync(oldMarker),false);assert.equal(existsSync(oldStage),false);assert.equal(existsSync(oldFinal),false);assert.deepEqual(result,{ok:false,reason:"busy"});assert.deepEqual(events.slice(0,3),[authorityPoint,beforePoint,afterFinalPoint]);assert.equal(events.includes(retiredPoint),false);assert.deepEqual({semanticNow,callbacks,delays},{semanticNow:0,callbacks:0,delays:0});
}));

test("slot-only stale cleanup authority leaves no orphan residue after a peer removes the bound generation",()=>withRoot(async root=>{
  const cleanupPoint="slot-only-slot-retired-cleanup-authority",beforePoint="slot-only-before-transition",afterFinalPoint="slot-only-after-final-revalidation",zeroPoint="slot-only-cleanup-stage-zero",owner={host:hostname(),nonce:"b".repeat(64),pid:await exitedProcessPid(),v:1 as const},markerName=admissionRetiredName(owner,"abandoned"),marker=path.join(root,markerName),markerOwner=path.join(marker,"owner.json");await mkdir(marker);await writeFile(markerOwner,publicationOwnerBytes(owner));const ack=slotCoordinationAck(owner,markerName,marker,"abandoned"),ackBytes=authorityCanonicalBytes(ack),stage=path.join(root,coordinationStageName(ack,"slot-retired")),finalAck=path.join(root,coordinationAckName(ack)),events:string[]=[];let monotonic=0,monotonicCalls=0,injections=0,semanticNow=0,callbacks=0,delays=0;
  const runtime={monotonicNow:()=>{monotonicCalls++;return monotonic;},delay:async()=>{delays++;},observeBoundary:(point:string)=>{events.push(point);if(point===afterFinalPoint&&injections===0){injections++;writeFileSync(finalAck,ackBytes);rmSync(marker,{recursive:true});rmSync(finalAck);monotonic=21;}}};const result=await new RawFsAuthorityLedger(root,{[__testPrepHousekeeperRuntimeOption]:runtime,now:()=>{semanticNow++;return t0;},lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="before-ledger-operation-callback")callbacks++;}} as never).recover();
  assert.equal(injections,1);assert.ok(monotonicCalls>=2);assert.equal(existsSync(marker),false);assert.equal(existsSync(stage),false,"stale cleanup cannot create an orphan stage after its marker generation disappeared");assert.equal(existsSync(finalAck),false);assert.deepEqual(result,{ok:false,reason:"busy"});assert.deepEqual(events,[cleanupPoint,beforePoint,afterFinalPoint]);assert.equal(events.includes(zeroPoint),false);assert.deepEqual({semanticNow,callbacks,delays},{semanticNow:0,callbacks:0,delays:0});
}));

test("slot-only stale stage authority reclassifies exact peer prefix growth without widening the original deadline",async()=>{
  const cleanupPoint="slot-only-slot-retired-cleanup-authority",beforePoint="slot-only-before-transition",afterFinalPoint="slot-only-after-final-revalidation",refusedPoint="slot-only-transition-refused";for(const [index,initialLength] of [0,1].entries())await withRoot(async root=>{const owner={host:hostname(),nonce:(index===0?"c":"d").repeat(64),pid:await exitedProcessPid(),v:1 as const},markerName=admissionRetiredName(owner,"abandoned"),marker=path.join(root,markerName),markerOwner=path.join(marker,"owner.json");await mkdir(marker);await writeFile(markerOwner,publicationOwnerBytes(owner));const markerIdentity=exactFsIdentity(marker),ownerIdentity=exactFsIdentity(markerOwner),ownerBytes=await readFile(markerOwner),ack=slotCoordinationAck(owner,markerName,marker,"abandoned"),ackBytes=authorityCanonicalBytes(ack),stage=path.join(root,coordinationStageName(ack,"slot-retired")),finalAck=path.join(root,coordinationAckName(ack)),initial=ackBytes.subarray(0,initialLength),peerPrefix=ackBytes.subarray(0,initialLength+2);await writeFile(stage,initial);const stageIdentity=exactFsIdentity(stage),events:string[]=[];let monotonic=0,monotonicCalls=0,injections=0,semanticNow=0,callbacks=0,delays=0;
    const runtime={monotonicNow:()=>{monotonicCalls++;return monotonic;},delay:async()=>{delays++;},observeBoundary:(point:string)=>{events.push(point);if(point===afterFinalPoint&&injections===0){injections++;writeFileSync(stage,peerPrefix.subarray(initial.length),{flag:"a"});monotonic=21;}}};const result=await new RawFsAuthorityLedger(root,{[__testPrepHousekeeperRuntimeOption]:runtime,now:()=>{semanticNow++;return t0;},lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="before-ledger-operation-callback")callbacks++;}} as never).recover();
    assert.equal(injections,1);assert.deepEqual(result,{ok:false,reason:"busy"});assert.ok(monotonicCalls>=2);assert.deepEqual(events,[cleanupPoint,beforePoint,afterFinalPoint,cleanupPoint,beforePoint,refusedPoint]);assert.deepEqual(exactFsIdentity(stage),stageIdentity);assert.deepEqual(await readFile(stage),peerPrefix);assert.equal(existsSync(finalAck),false);assert.equal(existsSync(marker),true);assert.deepEqual(exactFsIdentity(marker),markerIdentity);assert.deepEqual(exactFsIdentity(markerOwner),ownerIdentity);assert.deepEqual(await readFile(markerOwner),ownerBytes);assert.deepEqual({semanticNow,callbacks,delays},{semanticNow:0,callbacks:0,delays:0});});
});

type K1OperationFenceCapability=Readonly<{attemptBoundTransition:()=>Promise<"progress"|"refused">}>;
type K1OperationFenceTopology=Readonly<{filesystem:string;networkNamespace:string;identity:string}>;
type K1OperationFenceBinding=Readonly<{canonicalRoot:string;rootIdentity:Readonly<{dev:string;ino:string;mode:string}>;materialDigest:string;endpoint:Readonly<{host:"127.0.0.1";port:number}>}>;
const supportedK1OperationFenceTopology=Object.freeze({filesystem:"local-fs",networkNamespace:"same-network-namespace",identity:"isolated"}) satisfies K1OperationFenceTopology;
function k1OperationFenceOption():symbol{const option=(hostAuthorityModule as Record<string,unknown>).__testK1OperationFenceRuntimeOption;assert.equal(typeof option,"symbol","the host module exposes the private K1 operation-fence runtime option");return option as symbol;}
function normalizedFenceRealpath(value:string):string{const normalized=path.normalize(value);return process.platform==="win32"?normalized.replaceAll("\\","/").toLowerCase():normalized;}
async function derivedFenceBinding(root:string):Promise<K1OperationFenceBinding>{const canonicalRoot=normalizedFenceRealpath(await realpath(root)),identity=exactFsIdentity(root),material=Buffer.from(`${canonicalRoot}\0${identity.dev}\0${identity.ino}`,"utf8"),digest=createHash("sha256").update(material).digest(),materialDigest=`sha256:${digest.toString("hex")}`,port=20_000+digest.readUInt32BE(0)%30_000;return Object.freeze({canonicalRoot,rootIdentity:Object.freeze({dev:String(identity.dev),ino:String(identity.ino),mode:String(identity.mode)}),materialDigest,endpoint:Object.freeze({host:"127.0.0.1" as const,port})});}
async function bindFenceEndpoint(binding:K1OperationFenceBinding){const server=createServer();await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen({host:"127.0.0.1",port:binding.endpoint.port,exclusive:true,reusePort:false},resolve);});return server;}
async function closeServer(server:ReturnType<typeof createServer>):Promise<void>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
async function withFenceRoot<T>(operation:(root:string,binding:K1OperationFenceBinding)=>Promise<T>):Promise<T>{for(let attempt=0;attempt<64;attempt++){const root=await tempRoot(),binding=await derivedFenceBinding(root);try{const probe=await bindFenceEndpoint(binding);await closeServer(probe);try{return await operation(root,binding);}finally{await rm(root,{recursive:true,force:true});}}catch(error){await rm(root,{recursive:true,force:true});const code=(error as NodeJS.ErrnoException).code;if(code!=="EADDRINUSE"&&code!=="EACCES")throw error;}}throw new Error("could not allocate a preflight-free deterministically derived fence endpoint");}
function hasLegacyWriterFinalByContent(root:string):boolean{return readdirSync(root).some(name=>{if(!/^\.authority-ledger-coordination-cleanup-[0-9a-f]{64}\.ack$/.test(name))return false;try{return JSON.parse(readFileSync(path.join(root,name),"utf8")).purpose==="k1-writer-released";}catch{return false;}});}
function hasLegacyWriterArtifact(root:string):boolean{return readdirSync(root).some(name=>name===".authority-ledger-k1-writer"||name.startsWith(".authority-ledger-k1-writer-")||name.startsWith(".authority-ledger-coordination-cleanup-stage-k-"))||hasLegacyWriterFinalByContent(root);}
async function waitForPath(target:string,label:string):Promise<void>{for(let attempt=0;attempt<400&&!existsSync(target);attempt++)await new Promise<void>(resolve=>setTimeout(resolve,5));assert.equal(existsSync(target),true,label);}
function fenceRuntime(binding:K1OperationFenceBinding,observe:(point:string,capability?:K1OperationFenceCapability)=>void|Promise<void>,overrides:Readonly<Record<string,unknown>>={}):Readonly<Record<string,unknown>>{return {topology:supportedK1OperationFenceTopology,expectedBinding:binding,monotonicNow:()=>0,delay:async()=>{},observeK1OperationFenceBoundary:observe,...overrides};}
function assertStableRootIdentity(root:string,expected:K1OperationFenceBinding["rootIdentity"]):void{const actual=exactFsIdentity(root);assert.deepEqual({dev:String(actual.dev),ino:String(actual.ino),mode:String(actual.mode)},expected);}

test("k1-operation-fence-only acquisition precedes K1 classification and serializes two same-process ledgers through target root sync",async()=>withFenceRoot(async(root,binding)=>{
  const option=k1OperationFenceOption(),owner={host:hostname(),nonce:"1".repeat(64),pid:await exitedProcessPid(),v:1 as const},slot=await writeAdmissionSlot(root,owner),order:string[]=[],eventsB:string[]=[];binding=await derivedFenceBinding(root);let release!:()=>void,entered!:()=>void,fsA=0,fsB=0;const held=new Promise<void>(resolve=>{release=resolve;}),atTarget=new Promise<void>(resolve=>{entered=resolve;});
  const a=new RawFsAuthorityLedger(root,{[option]:fenceRuntime(binding,async point=>{order.push(point);if(point==="k1-operation-fence-only-root-captured")assertStableRootIdentity(root,binding.rootIdentity);if(point==="k1-operation-fence-only-target-final-revalidated"){entered();await held;}}),now:()=>t0,lockTimeoutMs:200,faultInjector:(point:string)=>{if(point==="after-pre-admission-housekeeping-initial-enumeration"){fsA++;order.push("first-filesystem-hook");}}} as never).recover();
  await Promise.race([atTarget,a.then(()=>assert.fail("A completed before its target-root-sync fence was released"))]);await assert.rejects(bindFenceEndpoint(binding),error=>(error as NodeJS.ErrnoException).code==="EADDRINUSE","the held authority owns the exact exclusive loopback endpoint");const beforeB=await snapshotRootArtifacts(root),b=await new RawFsAuthorityLedger(root,{[option]:fenceRuntime(binding,point=>{eventsB.push(point);}),now:()=>t0,lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="after-pre-admission-housekeeping-initial-enumeration")fsB++;}} as never).recover();assert.deepEqual(b,{ok:false,reason:"busy"});assert.equal(fsB,0);assert.deepEqual(await snapshotRootArtifacts(root),beforeB);assert.equal(eventsB.includes("k1-operation-fence-only-root-captured"),false);assert.equal(hasLegacyWriterArtifact(root),false);release();assert.equal((await a).ok,true);assert.equal(existsSync(slot),false);assert.equal(fsA>0,true);const immediate=await bindFenceEndpoint(binding);await closeServer(immediate);
  for(const [left,right] of [["k1-operation-fence-only-topology-accepted","k1-operation-fence-only-root-captured"],["k1-operation-fence-only-root-captured","k1-operation-fence-only-endpoint-bound"],["k1-operation-fence-only-endpoint-bound","k1-operation-fence-only-root-revalidated"],["k1-operation-fence-only-root-revalidated","first-filesystem-hook"],["first-filesystem-hook","k1-operation-fence-only-target-final-revalidated"],["k1-operation-fence-only-target-final-revalidated","k1-operation-fence-only-target-root-synced"],["k1-operation-fence-only-target-root-synced","k1-operation-fence-only-closed"]] as const)assert.ok(order.indexOf(left)>=0&&order.indexOf(left)<order.indexOf(right),`${left} precedes ${right}`);assert.equal(order.filter(point=>point==="k1-operation-fence-only-closed").length,1);assert.equal(hasLegacyWriterArtifact(root),false);
  for(const expectedBinding of [{...binding,endpoint:{host:"127.0.0.1" as const,port:binding.endpoint.port===49_999?20_000:binding.endpoint.port+1}},{...binding,canonicalRoot:`${binding.canonicalRoot}#mismatched`}]){const before=await snapshotRootArtifacts(root),events:string[]=[];let hooks=0;const result=await new RawFsAuthorityLedger(root,{[option]:fenceRuntime(expectedBinding,point=>{events.push(point);}),now:()=>t0,lockTimeoutMs:20,faultInjector:()=>{hooks++;}} as never).recover();assert.equal(result.ok,false);assert.equal(events.includes("k1-operation-fence-only-root-captured"),false,"a mismatched private binding refuses before root capture");assert.equal(hooks,0);assert.deepEqual(await snapshotRootArtifacts(root),before);}
}));

test("k1-operation-fence-only rapid close and rebind invalidate every stale operation capability",async()=>withFenceRoot(async(root,binding)=>{
  const option=k1OperationFenceOption(),capabilities:K1OperationFenceCapability[]=[],closed:number[]=[];let realFsHooks=0;
  for(let generation=0;generation<4;generation++){
    await writeAdmissionSlot(root,{host:hostname(),nonce:(generation+2).toString(16).repeat(64),pid:await exitedProcessPid(),v:1 as const});binding=await derivedFenceBinding(root);let fresh:K1OperationFenceCapability|undefined,invocationActive=false,protectedEvents=0,invocationResult:"progress"|"refused"|undefined;const before=realFsHooks,dummy=Object.freeze({attemptBoundTransition:async()=>"refused" as const});assert.equal(await dummy.attemptBoundTransition(),"refused");
    const result=await new RawFsAuthorityLedger(root,{[option]:fenceRuntime(binding,async(point,capability)=>{if(point==="k1-operation-fence-only-acquired"){assert.ok(capability);fresh=capability;assert.equal(Object.isFrozen(capability),true);assert.deepEqual(Object.keys(capability),["attemptBoundTransition"]);assert.equal(Object.getOwnPropertyDescriptor(capability,"attemptBoundTransition")?.enumerable,true);assert.equal(JSON.stringify(capability),"{}");const serialized=String(capability)+JSON.stringify(capability);assert.equal(serialized.includes(root),false);assert.equal(serialized.includes(String(binding.endpoint.port)),false);assert.equal(/owner|nonce|pid/i.test(serialized),false);if(capabilities.length){const stale=capabilities.at(-1)!;assert.equal(await stale.attemptBoundTransition(),"refused");assert.equal(realFsHooks,before,"stale authority refuses before a filesystem read");}assert.equal(await dummy.attemptBoundTransition(),"refused");assert.equal(realFsHooks,before,"an unrelated always-refused transition cannot enter the filesystem");invocationActive=true;try{invocationResult=await capability.attemptBoundTransition();}finally{invocationActive=false;}return;}if(["k1-operation-fence-only-first-filesystem-hook","k1-operation-fence-only-target-final-revalidated","k1-operation-fence-only-target-mutation","k1-operation-fence-only-target-root-synced"].includes(point)){assert.equal(invocationActive,true,`${point} occurs only inside the explicit fresh invocation`);assert.equal(capability,fresh,`${point} carries the identical fresh capability`);protectedEvents++;}if(point==="k1-operation-fence-only-closed")closed.push(generation);}),now:()=>t0,lockTimeoutMs:200,faultInjector:(point:string)=>{if(point==="after-pre-admission-housekeeping-initial-enumeration"){assert.equal(invocationActive,true,"the real first filesystem hook is inside the fresh invocation");realFsHooks++;}}} as never).recover();
    assert.equal(invocationResult,"progress","the explicitly invoked fresh capability performs the exact transition");assert.equal(result.ok,true);assert.ok(fresh);assert.equal(protectedEvents,4,"all protected phases are causally attributed to the fresh invocation");capabilities.push(fresh);assert.equal(realFsHooks,before+1,"exactly the fresh invocation reaches the first filesystem hook");assert.equal(hasLegacyWriterArtifact(root),false);
  }
  assert.deepEqual(closed,[0,1,2,3]);for(const capability of capabilities)assert.equal(await capability.attemptBoundTransition(),"refused");
}));

test("k1-operation-fence-only two child processes serialize and child crash auto-releases",async()=>withFenceRoot(async(root,binding)=>{
  const option=k1OperationFenceOption();assert.equal(typeof option,"symbol");const control=await tempRoot(),moduleUrl=pathToFileURL(path.resolve("dist-test/src/authority/host/fs-ledger.js")).href,source=`import{appendFileSync,existsSync,writeFileSync}from"node:fs";import*as host from ${JSON.stringify(moduleUrl)};const[root,bindingWire,control,id,hold]=process.argv.slice(1),option=host.__testK1OperationFenceRuntimeOption,binding=JSON.parse(bindingWire);if(typeof option!=="symbol")process.exit(80);const emit=p=>appendFileSync(control+"/order",id+":"+p+"\\n"),ledger=new host.FsAuthorityLedger(root,{[option]:{topology:{filesystem:"local-fs",networkNamespace:"same-network-namespace",identity:"isolated"},expectedBinding:binding,monotonicNow:()=>0,delay:()=>new Promise(r=>setTimeout(r,5)),async observeK1OperationFenceBoundary(point){emit(point);if(point===hold){writeFileSync(control+"/entered-"+id,"1");while(!existsSync(control+"/release-"+id))await new Promise(r=>setTimeout(r,5));}}},now:()=>${t0},lockTimeoutMs:1000,faultInjector(point){if(point==="after-pre-admission-housekeeping-initial-enumeration")emit("first-filesystem-hook");}});writeFileSync(control+"/result-"+id,JSON.stringify(await ledger.recover()));`;
  const launch=(id:string,hold:string)=>{const child=spawn(process.execPath,["--input-type=module","-e",source,root,JSON.stringify(binding),control,id,hold],{stdio:"ignore"});child.once("error",error=>{throw error;});return child;},closeOf=(child:ReturnType<typeof spawn>)=>new Promise<number|null>(resolve=>child.once("close",resolve));
  try{await writeAdmissionSlot(root,{host:hostname(),nonce:"6".repeat(64),pid:await exitedProcessPid(),v:1 as const});binding=await derivedFenceBinding(root);const a=launch("a","k1-operation-fence-only-root-revalidated"),aClosed=closeOf(a);await waitForPath(path.join(control,"entered-a"),"child A holds the derived endpoint");const b=launch("b","never"),bClosed=closeOf(b);await new Promise<void>(resolve=>setTimeout(resolve,50));assert.equal(existsSync(path.join(control,"result-b")),false);await writeFile(path.join(control,"release-a"),"");assert.equal(await aClosed,0);assert.equal(await bClosed,0);let order=await readFile(path.join(control,"order"),"utf8");assert.ok(order.indexOf("a:k1-operation-fence-only-closed")<order.indexOf("b:k1-operation-fence-only-endpoint-bound"));
    await writeAdmissionSlot(root,{host:hostname(),nonce:"7".repeat(64),pid:await exitedProcessPid(),v:1 as const});binding=await derivedFenceBinding(root);const crashed=launch("crash","k1-operation-fence-only-target-final-revalidated"),crashedClosed=closeOf(crashed);await waitForPath(path.join(control,"entered-crash"),"crash child holds exact target authority");crashed.kill();await crashedClosed;const immediate=await bindFenceEndpoint(binding);await closeServer(immediate);const fresh=launch("fresh","never");assert.equal(await closeOf(fresh),0);order=await readFile(path.join(control,"order"),"utf8");assert.equal(order.split("\n").filter(line=>line==="fresh:k1-operation-fence-only-target-root-synced").length,1);assert.equal(hasLegacyWriterArtifact(root),false);
  }finally{await rm(control,{recursive:true,force:true});}
}));

test("k1-operation-fence-only dead target admits exactly one contender to the first filesystem hook",async()=>withFenceRoot(async(root,binding)=>{
  const option=k1OperationFenceOption(),slot=await writeAdmissionSlot(root,{host:hostname(),nonce:"8".repeat(64),pid:await exitedProcessPid(),v:1 as const}),events:[string[],string[]]=[[],[]],fs=[0,0],roots=[0,0];binding=await derivedFenceBinding(root);let release!:()=>void,entered!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{entered=resolve;}),run=(index:0|1)=>new RawFsAuthorityLedger(root,{[option]:fenceRuntime(binding,async point=>{events[index].push(point);if(point==="k1-operation-fence-only-root-revalidated"&&events.flat().filter(value=>value==="k1-operation-fence-only-root-revalidated").length===1){entered();await held;}if(point==="k1-operation-fence-only-target-root-synced")roots[index]++;}),now:()=>t0,lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="after-pre-admission-housekeeping-initial-enumeration")fs[index]++;}} as never).recover();const a=run(0),b=run(1);await ready;await new Promise<void>(resolve=>setTimeout(resolve,30));release();const results=await Promise.all([a,b]),winner=results.findIndex(result=>result.ok),loser=winner===0?1:0;assert.equal(results.filter(result=>result.ok).length,1);assert.deepEqual(results[loser],{ok:false,reason:"busy"});assert.equal(fs[winner]>0,true);assert.equal(fs[loser],0);assert.equal(events[loser].some(point=>point.includes("root-captured")||point.includes("target-")),false);assert.deepEqual(roots,winner===0?[1,0]:[0,1]);assert.equal(existsSync(slot),false);assert.equal(hasLegacyWriterArtifact(root),false);
}));

test("k1-operation-fence-only root replacement and foreign filesystem-writer residue refuse byte-exact",async()=>{
  const option=k1OperationFenceOption();await withFenceRoot(async(root,binding)=>{const external=await tempRoot();try{const slot=await writeAdmissionSlot(root,{host:hostname(),nonce:"9".repeat(64),pid:await exitedProcessPid(),v:1 as const}),slotOwner=path.join(slot,"owner.json"),slotIdentity=exactFsIdentity(slot),slotOwnerIdentity=exactFsIdentity(slotOwner),slotBytes=await readFile(slotOwner),original=path.join(external,"original");binding=await derivedFenceBinding(root);let replacementIdentity:ExactFsIdentity|undefined;const result=await new RawFsAuthorityLedger(root,{[option]:fenceRuntime(binding,point=>{if(point==="k1-operation-fence-only-endpoint-bound"){renameSync(root,original);mkdirSync(root);replacementIdentity=exactFsIdentity(root);}}),now:()=>t0,lockTimeoutMs:20,faultInjector:()=>assert.fail("root replacement refuses before filesystem inspection") } as never).recover();assert.equal(result.ok,false);assert.deepEqual(exactFsIdentity(path.join(original,path.basename(slot))),slotIdentity);assert.deepEqual(exactFsIdentity(path.join(original,path.basename(slot),"owner.json")),slotOwnerIdentity);assert.deepEqual(await readFile(path.join(original,path.basename(slot),"owner.json")),slotBytes);assert.deepEqual(exactFsIdentity(root),replacementIdentity);assert.deepEqual(await snapshotRootArtifacts(root),[]);}finally{await rm(external,{recursive:true,force:true});}});
  const shapes=["attempt","held","released","stage","final"] as const;for(const [index,shape] of shapes.entries())await withFenceRoot(async(root,binding)=>{const owner={host:"foreign.invalid",nonce:(index+10).toString(16).repeat(64),pid:process.pid,v:1 as const},ownerBytes=publicationOwnerBytes(owner),releasedName=`.authority-ledger-k1-writer-released-${owner.pid}-${owner.nonce}`,writerName=shape==="attempt"?`.authority-ledger-k1-writer-attempt-${owner.pid}-${owner.nonce}.tmp`:shape==="held"?".authority-ledger-k1-writer":releasedName,tracked:string[]=[];if(shape==="attempt"||shape==="held"||shape==="released"){const directory=path.join(root,writerName);await mkdir(directory);await writeFile(path.join(directory,"owner.json"),ownerBytes);tracked.push(directory,path.join(directory,"owner.json"));}else{const marker=path.join(root,releasedName),markerOwner=path.join(marker,"owner.json");await mkdir(marker);await writeFile(markerOwner,ownerBytes);const ack={disposition:"released",kind:"k1-writer-retired",markerName:releasedName,originalName:".authority-ledger-k1-writer",owner,ownerBytesDigest:rawDigest(ownerBytes),ownerBytesLength:String(ownerBytes.length),ownerDigest:authorityDigest(owner),ownerIdentity:decimalIdentity(markerOwner),purpose:"k1-writer-released",recoveryAuthority:"exact-writer-lease-or-dead-owner",v:"reelier.authority-ledger-coordination-cleanup-ack/v1",writerIdentity:decimalIdentity(marker)},bytes=authorityCanonicalBytes(ack),digest=rawDigest(bytes).slice(7),lifecycle=path.join(root,shape==="stage"?`.authority-ledger-coordination-cleanup-stage-k-${digest}.tmp`:`.authority-ledger-coordination-cleanup-${digest}.ack`);await writeFile(lifecycle,bytes);tracked.push(marker,markerOwner,lifecycle);}binding=await derivedFenceBinding(root);const exact=tracked.map(target=>({target,identity:exactFsIdentity(target),bytes:lstatSync(target).isFile()?readFileSync(target):undefined})),before=await snapshotRootArtifacts(root);let hooks=0,pidProbes=0,directPidProbes=0;const originalKill=process.kill;Object.defineProperty(process,"kill",{configurable:true,value:(pid:number)=>{directPidProbes++;return originalKill.call(process,pid,0);}});let result;try{result=await new RawFsAuthorityLedger(root,{[option]:fenceRuntime(binding,()=>{},{probeProcessLiveness:()=>{pidProbes++;return "dead";}}),now:()=>t0,lockTimeoutMs:20,faultInjector:()=>{hooks++;}} as never).recover();}finally{Object.defineProperty(process,"kill",{configurable:true,value:originalKill});}assert.equal(result.ok,false,shape);for(const item of exact){assert.deepEqual(exactFsIdentity(item.target),item.identity,shape);if(item.bytes)assert.deepEqual(readFileSync(item.target),item.bytes,shape);}assert.deepEqual(await snapshotRootArtifacts(root),before,shape);assert.deepEqual({hooks,pidProbes,directPidProbes},{hooks:0,pidProbes:0,directPidProbes:0},shape);assert.equal(hasLegacyWriterArtifact(root),true,`${shape} remains visible`);assert.equal(hasLegacyWriterFinalByContent(root),shape==="final","generic final detection is content-based and independent of its paired marker");});
});

test("k1-operation-fence-only endpoint collision and wait retain one original deadline without filesystem mutation",async()=>{
  const option=k1OperationFenceOption();await withFenceRoot(async(root,binding)=>{await writeAdmissionSlot(root,{host:hostname(),nonce:"f".repeat(64),pid:await exitedProcessPid(),v:1 as const});binding=await derivedFenceBinding(root);const listener=await bindFenceEndpoint(binding);try{const before=await snapshotRootArtifacts(root),reads:number[]=[],delays:number[]=[];let monotonic=100,hooks=0;const result=await new RawFsAuthorityLedger(root,{[option]:fenceRuntime(binding,()=>{},{monotonicNow:()=>{reads.push(monotonic);return monotonic;},delay:async(ms:number)=>{delays.push(ms);monotonic=121;}}),now:()=>t0,lockTimeoutMs:20,faultInjector:()=>{hooks++;}} as never).recover();assert.deepEqual(result,{ok:false,reason:"busy"});assert.deepEqual([reads[0],reads.at(-1)],[100,121]);assert.equal(delays.length>=1,true);assert.equal(hooks,0);assert.deepEqual(await snapshotRootArtifacts(root),before);}finally{await closeServer(listener);}});
  await withFenceRoot(async(root,binding)=>{const terminal={kind:"release-held-fence"},before=await snapshotRootArtifacts(root);let release!:()=>void,entered!:()=>void,monotonic=200,hooksA=0,hooksB=0;const gate=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{entered=resolve;}),a=new RawFsAuthorityLedger(root,{[option]:fenceRuntime(binding,async point=>{if(point==="k1-operation-fence-only-root-revalidated"){entered();await gate;throw terminal;}}),now:()=>t0,lockTimeoutMs:50,faultInjector:()=>{hooksA++;}} as never).recover();await ready;const reads:number[]=[],resultB=await new RawFsAuthorityLedger(root,{[option]:fenceRuntime(binding,()=>{},{monotonicNow:()=>{reads.push(monotonic);return monotonic;},delay:async()=>{monotonic=251;}}),now:()=>t0,lockTimeoutMs:50,faultInjector:()=>{hooksB++;}} as never).recover();assert.deepEqual(resultB,{ok:false,reason:"busy"});assert.deepEqual([reads[0],reads.at(-1)],[200,251]);assert.equal(hooksB,0);assert.deepEqual(await snapshotRootArtifacts(root),before);release();await assert.rejects(a,error=>error===terminal);assert.equal(hooksA,0);assert.deepEqual(await snapshotRootArtifacts(root),before);});
});

test("k1-operation-fence-only topology declaration is closed host-private and public APIs unchanged",async()=>{
  const option=k1OperationFenceOption();assert.equal(option in authorityModule,false);const packageJson=JSON.parse(await readFile(path.resolve("package.json"),"utf8")) as {exports?:Record<string,unknown>};assert.equal(Object.keys(packageJson.exports??{}).some(name=>name.includes("fence")||name.includes("host")),false);for(const point of [...ledgerFaultPoints,...dispatchFaultPoints,...ledgerLockFaultPoints,...reservationFaultPoints,...resultFaultPoints,...ingressFaultPoints,...clockFaultPoints])assert.equal(point.startsWith("k1-operation-fence-only-"),false);for(const value of Object.values(authorityModule as Record<string,unknown>))assert.notEqual(value,option);
  const declarations:readonly unknown[]=[{filesystem:"shared-fs",networkNamespace:"same-network-namespace",identity:"isolated"},{filesystem:"network-fs",networkNamespace:"same-network-namespace",identity:"isolated"},{filesystem:"local-fs",networkNamespace:"shared-network-namespace",identity:"isolated"},{filesystem:"local-fs",networkNamespace:"unknown",identity:"isolated"},undefined,null,{},"local-fs",{...supportedK1OperationFenceTopology,extra:true}];for(const [index,topology] of declarations.entries()){const sentinel=path.join(tmpdir(),`.reelier-inaccessible-nonexistent-${process.pid}-${Date.now()}-${index}`);await rm(sentinel,{recursive:true,force:true});const events:string[]=[],runtime:Record<string,unknown>={expectedBinding:{canonicalRoot:sentinel,rootIdentity:{dev:"0",ino:"0",mode:"0"},endpoint:{host:"127.0.0.1",port:20_000}},monotonicNow:()=>0,delay:async()=>{},observeK1OperationFenceBoundary:(point:string)=>events.push(point)};if(topology!==undefined)runtime.topology=topology;let hooks=0;const result=await new RawFsAuthorityLedger(sentinel,{[option]:runtime,now:()=>t0,lockTimeoutMs:20,faultInjector:()=>{hooks++;}} as never).recover();assert.equal(result.ok,false,String(index));assert.equal(events.some(point=>point.includes("root-captured")||point.includes("filesystem")||point.includes("endpoint-bound")),false,String(index));assert.equal(hooks,0,String(index));assert.equal(existsSync(sentinel),false,String(index));}
  await withFenceRoot(async(root,binding)=>{const topology=supportedK1OperationFenceTopology,alternatePort=binding.endpoint.port===49_999?20_000:binding.endpoint.port+1,invalid:ReadonlyArray<Readonly<{label:string;runtime:Record<string,unknown>}>>=[{label:"absent expectedBinding",runtime:{topology}},{label:"legacy endpoint-only",runtime:{topology,endpoint:binding.endpoint}},{label:"partial binding",runtime:{topology,expectedBinding:{canonicalRoot:binding.canonicalRoot}}},{label:"extra binding key",runtime:{topology,expectedBinding:{...binding,extra:true}}},{label:"wrong host",runtime:{topology,expectedBinding:{...binding,endpoint:{...binding.endpoint,host:"0.0.0.0"}}}},{label:"port below range",runtime:{topology,expectedBinding:{...binding,endpoint:{...binding.endpoint,port:19_999}}}},{label:"port above range",runtime:{topology,expectedBinding:{...binding,endpoint:{...binding.endpoint,port:50_000}}}},{label:"port inconsistent with digest",runtime:{topology,expectedBinding:{...binding,endpoint:{...binding.endpoint,port:alternatePort}}}},{label:"wrong canonical root",runtime:{topology,expectedBinding:{...binding,canonicalRoot:`${binding.canonicalRoot}#wrong`}}},{label:"wrong root dev",runtime:{topology,expectedBinding:{...binding,rootIdentity:{...binding.rootIdentity,dev:String(BigInt(binding.rootIdentity.dev)+1n)}}}},{label:"wrong root ino",runtime:{topology,expectedBinding:{...binding,rootIdentity:{...binding.rootIdentity,ino:String(BigInt(binding.rootIdentity.ino)+1n)}}}},{label:"wrong digest material",runtime:{topology,expectedBinding:{...binding,materialDigest:`sha256:${binding.materialDigest.slice(7).startsWith("0")?"1":"0"}${binding.materialDigest.slice(8)}`}}}];for(const {label,runtime} of invalid){const events:string[]=[],before=await snapshotRootArtifacts(root);let delays=0,hooks=0;runtime.monotonicNow=()=>0;runtime.delay=async()=>{delays++;};runtime.observeK1OperationFenceBoundary=(point:string)=>events.push(point);const result=await new RawFsAuthorityLedger(root,{[option]:runtime,now:()=>t0,lockTimeoutMs:20,faultInjector:()=>{hooks++;}} as never).recover();assert.equal(result.ok,false,label);assert.equal(events.some(point=>point.includes("root-captured")||point.includes("endpoint-bound")||point.includes("filesystem")),false,label);assert.deepEqual({delays,hooks},{delays:0,hooks:0},label);assert.deepEqual(await snapshotRootArtifacts(root),before,label);}});
  await withFenceRoot(async(root,binding)=>{let accepted=0,bound=0;const result=await new RawFsAuthorityLedger(root,{[option]:fenceRuntime(binding,point=>{if(point==="k1-operation-fence-only-topology-accepted")accepted++;if(point==="k1-operation-fence-only-endpoint-bound")bound++;}),now:()=>t0,lockTimeoutMs:200} as never).recover();assert.equal(result.ok,true);assert.deepEqual({accepted,bound},{accepted:1,bound:1});assert.equal(hasLegacyWriterArtifact(root),false);});
});

test("k1-operation-fence-only externally held endpoint keeps refusal-only corruption precedence",async()=>{
  await withRoot(async root=>{
    const owner={host:hostname(),nonce:"e".repeat(64),pid:process.pid,v:1 as const},withdrawal=await writeCreatorWithdrawal(root,owner,"partial"),binding=await derivedFenceBinding(root),squatter=await bindFenceEndpoint(binding),before=await snapshotRootArtifacts(root);let semanticNow=0,callbacks=0,prepCreates=0;
    try{const result=await new RawFsAuthorityLedger(root,{now:()=>{semanticNow++;return t0;},lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="after-admission-prep-create")prepCreates++;if(point==="before-ledger-operation-callback")callbacks++;}} as never).observeClock();assert.deepEqual(result,{ok:false,reason:"corruption"});}finally{await closeServer(squatter);}
    assert.deepEqual(await snapshotRootArtifacts(root),before);assert.deepEqual({semanticNow,callbacks,prepCreates},{semanticNow:0,callbacks:0,prepCreates:0});assert.equal(existsSync(withdrawal),true);
  });
  await withRoot(async root=>{
    const binding=await derivedFenceBinding(root),squatter=await bindFenceEndpoint(binding);let semanticNow=0,callbacks=0,publicationCreates=0,k1Initial=0;
    try{const result=await new RawFsAuthorityLedger(root,{now:()=>{semanticNow++;return t0;},lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="after-pre-admission-housekeeping-initial-enumeration")k1Initial++;if(point==="after-lock-publication-stage-create")publicationCreates++;if(point==="before-ledger-operation-callback")callbacks++;}} as never).observeClock();assert.deepEqual(result,{ok:false,reason:"busy"});}finally{await closeServer(squatter);}
    assert.deepEqual(await snapshotRootArtifacts(root),[]);assert.deepEqual({semanticNow,callbacks,publicationCreates,k1Initial},{semanticNow:0,callbacks:0,publicationCreates:0,k1Initial:0});
  });
});

test("k1-operation-fence-only inbound connections are severed and cannot wedge fence close",async()=>{
  const option=k1OperationFenceOption(),failAfter=(milliseconds:number,message:string)=>new Promise<never>((_,reject)=>{setTimeout(()=>reject(new Error(message)),milliseconds).unref();});
  await withFenceRoot(async(root,binding)=>{
    const events:string[]=[];let client:ReturnType<typeof connect>|undefined,clientClosed:Promise<void>|undefined,pending:Promise<unknown>|undefined;
    try{
      pending=new RawFsAuthorityLedger(root,{[option]:fenceRuntime(binding,async point=>{events.push(point);if(point==="k1-operation-fence-only-endpoint-bound"){await new Promise<void>((resolve,reject)=>{client=connect({host:"127.0.0.1",port:binding.endpoint.port},resolve);client.once("error",reject);});client!.on("error",()=>{});clientClosed=new Promise<void>(resolve=>client!.once("close",resolve));}}),now:()=>t0,lockTimeoutMs:200} as never).recover();
      const result=await Promise.race([pending,failAfter(2_000,"a held inbound connection wedged the fence close")]);
      assert.equal((result as Readonly<{ok:boolean}>).ok,true);
      assert.equal(events.at(-1),"k1-operation-fence-only-closed");
      await Promise.race([clientClosed!,failAfter(2_000,"the fence accepted and retained an inbound connection")]);
      assert.equal(client!.destroyed,true);
    }finally{client?.destroy();await pending?.catch(()=>{});}
  });
});

async function withHeldPublicationFence(root:string,binding:K1OperationFenceBinding,contend:(release:()=>void)=>Promise<void>,options:Readonly<Record<string,unknown>>={}):Promise<Readonly<{ok:boolean}>>{
  let release!:()=>void,entered!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{entered=resolve;});
  let monotonic=0;const yielding={monotonicNow:()=>monotonic,delay:async(ms:number)=>{monotonic+=Math.max(ms,1);await new Promise<void>(resolve=>{setTimeout(resolve,1);});}};
  const operation=new RawFsAuthorityLedger(root,{[k1OperationFenceOption()]:fenceRuntime(binding,async point=>{if(point==="k1-operation-fence-only-root-revalidated"){entered();await held;}},yielding),now:()=>t0,lockTimeoutMs:20_000,...options} as never).observeClock();
  let settled:unknown,holderFailure:unknown;
  try{await Promise.race([ready,operation.then(()=>{throw new Error("the fence holder completed before it held the fence");})]);await contend(release);}
  finally{release();settled=await operation.catch((error:unknown)=>{holderFailure=error;return undefined;});}
  if(holderFailure!==undefined)throw holderFailure;
  return settled as Readonly<{ok:boolean}>;
}

test("k1-operation-fence-only same-process publication contenders converge in drawn-ticket order",{timeout:30_000},async()=>withFenceRoot(async(root,binding)=>{
  binding=await derivedFenceBinding(root);const callbacks:string[]=[],pending:Array<Promise<unknown>>=[];
  const waiter=(label:string)=>{const operation=new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20_000,faultInjector:(point:string)=>{if(point==="before-ledger-operation-callback")callbacks.push(label);}} as never).observeClock();pending.push(operation);return operation;};
  try{
    let waiters:ReadonlyArray<Readonly<{ok:boolean}>>=[];
    const holder=await withHeldPublicationFence(root,binding,async release=>{
      const queued:Array<Promise<unknown>>=[];
      for(const label of ["first","second","third"]){queued.push(waiter(label));await new Promise<void>(resolve=>{setTimeout(resolve,50);});}
      assert.deepEqual(callbacks,[],"a held fence admits no same-process contender to a callback");
      release();
      waiters=await Promise.all(queued) as ReadonlyArray<Readonly<{ok:boolean}>>;
    },{faultInjector:(point:string)=>{if(point==="before-ledger-operation-callback")callbacks.push("holder");}});
    assert.deepEqual([holder.ok,...waiters.map(result=>result.ok)],[true,true,true,true],"every waiting publication contender converges");
    assert.deepEqual(callbacks,["holder","first","second","third"],"waiters are admitted in drawn-ticket order, which within one process is fence-arrival order; a held fence starves no publication contender");
    assert.deepEqual((await readdir(root)).filter(name=>name.startsWith(".authority-ledger-admission-")||name.startsWith(".authority-ledger-lock-publication-")),[]);
    assert.equal(hasLegacyWriterArtifact(root),false);
  }finally{await Promise.allSettled(pending);}
}));

test("k1-operation-fence-only a housekeeping episode refuses one-shot while a publication contender waits",{timeout:30_000},async()=>withFenceRoot(async(root,binding)=>{
  const option=k1OperationFenceOption();binding=await derivedFenceBinding(root);const pending:Array<Promise<unknown>>=[];
  try{
    let waiting:Readonly<{ok:boolean}>={ok:false};
    const holder=await withHeldPublicationFence(root,binding,async release=>{
      const before=await snapshotRootArtifacts(root),episodeEvents:string[]=[];let episodeHooks=0,episodeDelays=0;
      const episode=await new RawFsAuthorityLedger(root,{[option]:fenceRuntime(binding,point=>{episodeEvents.push(point);},{delay:async()=>{episodeDelays++;}}),now:()=>t0,lockTimeoutMs:20,faultInjector:()=>{episodeHooks++;}} as never).recover();
      assert.deepEqual(episode,{ok:false,reason:"busy"});
      assert.deepEqual({episodeHooks,boundedDelay:episodeDelays<=1},{episodeHooks:0,boundedDelay:true},"a housekeeping episode refuses after at most one bounded delay and never awaits release");
      assert.deepEqual(episodeEvents,[],"a housekeeping episode acquires no fence and observes no fence boundary");
      assert.deepEqual(await snapshotRootArtifacts(root),before);
      const contender=new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20_000} as never).observeClock();pending.push(contender);
      await new Promise<void>(resolve=>{setTimeout(resolve,50);});
      release();
      waiting=await contender;
    });
    assert.deepEqual([holder.ok,waiting.ok],[true,true],"a publication contender still converges behind the same held fence");
  }finally{await Promise.allSettled(pending);}
}));

test("k1-operation-fence-only a waiting publication contender exhausts one original deadline without observing the filesystem",{timeout:30_000},async()=>withFenceRoot(async(root,binding)=>{
  const option=k1OperationFenceOption();binding=await derivedFenceBinding(root);
  const holder=await withHeldPublicationFence(root,binding,async()=>{
    const before=await snapshotRootArtifacts(root),events:string[]=[];let monotonic=0,hooks=0,delays=0,semanticNow=0;
    const waiter=await new RawFsAuthorityLedger(root,{[option]:fenceRuntime(binding,point=>{events.push(point);},{monotonicNow:()=>monotonic,delay:async(ms:number)=>{delays++;monotonic+=Math.max(ms,1);await new Promise<void>(resolve=>{setTimeout(resolve,1);});}}),now:()=>{semanticNow++;return t0;},lockTimeoutMs:40,faultInjector:()=>{hooks++;}} as never).observeClock();
    assert.deepEqual(waiter,{ok:false,reason:"busy"});
    assert.equal(monotonic>=40,true,"a waiting publication contender consumes its one original acquisition deadline rather than refusing one-shot");
    assert.equal(monotonic<=45,true,"and never widens that deadline");
    assert.equal(delays>=1,true);
    assert.deepEqual({hooks,semanticNow},{hooks:0,semanticNow:0},"zero fault-bearing work and zero semantic clock reads");
    assert.equal(events.some(point=>point.includes("root-captured")||point.includes("endpoint-bound")),false,"a deadline-exhausted waiter never acquires the fence, so it never observes the filesystem");
    assert.deepEqual(await snapshotRootArtifacts(root),before);
  });
  assert.equal(holder.ok,true);
}));

test("k1-operation-fence-only draws exactly one lifted admission ticket before any filesystem observation",async t=>{
  const option=k1OperationFenceOption();
  await t.test("a zero reading is lifted and the operation converges",()=>withFenceRoot(async(root,binding)=>{
    binding=await derivedFenceBinding(root);const order:string[]=[];let draws=0;
    const result=await new RawFsAuthorityLedger(root,{[__testAdmissionClockOption]:()=>{draws++;order.push("draw");return 0n;},[option]:fenceRuntime(binding,point=>{order.push(point);}),now:()=>t0,lockTimeoutMs:2_000} as never).observeClock();
    assert.deepEqual(result,{ok:true,status:"advanced",observedAt:new Date(t0).toISOString()},"a zero reading is lifted, never corruption");
    assert.equal(draws,1);
    assert.equal(order[0],"draw","the admission reading precedes every fence phase");
    assert.equal(order.indexOf("k1-operation-fence-only-root-captured")>0,true);
  }));
  await t.test("an operation that mints no stage still draws exactly once",()=>withFenceRoot(async(root,binding)=>{
    binding=await derivedFenceBinding(root);const squatter=await bindFenceEndpoint(binding),order:string[]=[];let draws=0,monotonic=0;
    try{
      const result=await new RawFsAuthorityLedger(root,{[__testAdmissionClockOption]:()=>{draws++;order.push("draw");return 0n;},[option]:fenceRuntime(binding,point=>{order.push(point);},{monotonicNow:()=>monotonic,delay:async()=>{monotonic=1_000;}}),now:()=>t0,lockTimeoutMs:20} as never).observeClock();
      assert.deepEqual(result,{ok:false,reason:"busy"});
    }finally{await closeServer(squatter);}
    assert.deepEqual({draws,first:order[0]},{draws:1,first:"draw"},"every ledger-lock operation draws at fence arrival");
  }));
  await t.test("minted stage tickets strictly increase within one process under a constant clock",async()=>{
    const minted:string[]=[],mint=async(target:string)=>{
      const result=await new RawFsAuthorityLedger(target,{[__testAdmissionClockOption]:()=>7n,now:()=>t0,lockTimeoutMs:2_000,faultInjector:(point:string)=>{if(point==="after-lock-publication-stage-create"){const name=readdirSync(target).find(value=>value.startsWith(".authority-ledger-lock-publication-"));assert.ok(name,"the creator publication stage is visible at its creation boundary");minted.push(name);}}} as never).observeClock();
      assert.equal(result.ok,true);
    };
    await withFenceRoot(async first=>{await mint(first);await withFenceRoot(async second=>{await mint(second);});});
    assert.equal(minted.length,2);
    const tickets=minted.map(name=>{const parsed=/^\.authority-ledger-lock-publication-[0-9a-f]{64}-([0-9a-f]{16})-[1-9][0-9]*-[0-9a-f]{64}\.tmp$/.exec(name);assert.ok(parsed,`minted stage name is canonical: ${name}`);return BigInt(`0x${parsed[1]}`);});
    assert.equal(tickets.every(ticket=>ticket>=1n),true,"a constant zero-floor reading is lifted into the closed ticket range");
    assert.equal(tickets[1]>tickets[0],true,"the in-process floor lifts a repeated reading, so minted tickets never repeat in one process");
  });
  await t.test("a non-uint64 reading is corruption before the fence observes the root",()=>withFenceRoot(async(root,binding)=>{
    binding=await derivedFenceBinding(root);const before=await snapshotRootArtifacts(root),order:string[]=[];let draws=0,hooks=0;
    const result=await new RawFsAuthorityLedger(root,{[__testAdmissionClockOption]:()=>{draws++;order.push("draw");return 1;},[option]:fenceRuntime(binding,point=>{order.push(point);}),now:()=>t0,lockTimeoutMs:20,faultInjector:()=>{hooks++;}} as never).observeClock();
    assert.deepEqual(result,{ok:false,reason:"corruption"});
    assert.deepEqual({draws,hooks},{draws:1,hooks:0});
    assert.deepEqual(order,["draw"],"a corrupt reading refuses before any fence phase or filesystem observation");
    assert.deepEqual(await snapshotRootArtifacts(root),before);
  }));
});

test("ledger-lock publication rename attempt declares and emits its before boundary",async t=>{
  const points=ledgerLockFaultPoints as readonly string[];
  await t.test("the before boundary sits immediately before its success successor",()=>{
    assert.equal(points.includes("before-lock-publication-rename"),true,"the spec's publication rename attempt group opens with this boundary");
    assert.equal(points.indexOf("after-lock-publication-rename"),points.indexOf("before-lock-publication-rename")+1,"it sits immediately before its success successor");
  });
  await t.test("the success branch emits before, then after, then root sync, each exactly once",()=>withRoot(async root=>{
    const order:string[]=[];
    const result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:200,faultInjector:(point:string)=>{if(point==="before-lock-publication-rename"||point==="after-lock-publication-rename"||point==="after-lock-publication-root-sync"||point==="after-lock-publication-rename-collision")order.push(point);}} as never).observeClock();
    assert.deepEqual(result,{ok:true,status:"advanced",observedAt:new Date(t0).toISOString()});
    assert.deepEqual(order,["before-lock-publication-rename","after-lock-publication-rename","after-lock-publication-root-sync"]);
  }));
  await t.test("the collision branch emits before, then the collision successor, and never the success successor",()=>withRoot(async root=>{
    const squatter={host:hostname(),nonce:"a".repeat(64),pid:process.pid,v:1 as const},order:string[]=[];let planted=false;
    const result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20,faultInjector:(point:string)=>{
      if(point==="after-lock-publication-stage-sync"&&!planted){planted=true;mkdirSync(path.join(root,"lock"));writeFileSync(path.join(root,"lock","owner.json"),publicationOwnerBytes(squatter));}
      if(point==="before-lock-publication-rename"||point==="after-lock-publication-rename"||point==="after-lock-publication-rename-collision")order.push(point);
    }} as never).observeClock();
    assert.equal(planted,true,"the fixture occupies the published name before the rename attempt");
    assert.deepEqual(result,{ok:false,reason:"busy"});
    assert.equal(order[0],"before-lock-publication-rename","the before boundary precedes the rename on the collision branch too");
    assert.equal(order.filter(point=>point==="before-lock-publication-rename").length,order.filter(point=>point==="after-lock-publication-rename-collision").length,"every rename attempt pairs its before boundary with the collision successor");
    assert.equal(order.includes("after-lock-publication-rename"),false,"the success successor is mutually exclusive with the collision branch");
  }));
  // Placement discriminator. The boundary must sit INSIDE the rename's failure envelope: a transient
  // injected there has to be absorbed by the rename catch and become a collision. Emitted one line
  // earlier the same throw escapes acquireLock entirely, which is the defect this subtest owns.
  await t.test("a transient injected at the before boundary is absorbed by the rename attempt",()=>withRoot(async root=>{
    let collisions=0;
    const result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20,faultInjector:(point:string)=>{
      if(point==="after-lock-publication-rename-collision")collisions++;
      if(point==="before-lock-publication-rename")throw Object.assign(new Error("sharing"),{code:"EBUSY"});
    }} as never).observeClock();
    assert.deepEqual(result,{ok:false,reason:"busy"},"the transient becomes a bounded collision rather than propagating out of acquisition");
    assert.equal(collisions>=1,true,"the injected transient is observed as a rename collision");
  }));
});

test("legacy-only authority residue retains exact compatibility behavior",async t=>{
  await t.test("clean root publishes retires and enters the callback",()=>withRoot(async root=>{const before=await snapshotRootArtifacts(root);let k1Initial=0,semanticNow=0,callbacks=0,published=0,retired=0;const result=await new RawFsAuthorityLedger(root,{now:()=>{semanticNow++;return t0;},lockTimeoutMs:200,faultInjector:(point:string)=>{if(point==="after-pre-admission-housekeeping-initial-enumeration")k1Initial++;if(point==="after-lock-publication-root-sync")published++;if(point==="after-lock-retire")retired++;if(point==="before-ledger-operation-callback")callbacks++;}} as never).observeClock(),after=await snapshotRootArtifacts(root);assert.deepEqual(before,[]);assert.deepEqual(result,{ok:true,status:"advanced",observedAt:new Date(t0).toISOString()});assert.deepEqual({k1Initial,semanticNow,callbacks,published,retired},{k1Initial:0,semanticNow:1,callbacks:1,published:1,retired:1});assert.equal(after.length>0,true,"legacy clean admission leaves only semantic ledger state");assert.equal(after.some(entry=>/^\.authority-ledger-(?:admission|creator-withdrawal|coordination-cleanup|lock-publication)/.test(entry.name)||entry.name==="lock"),false);}));
  await t.test("one live publication stage remains busy and byte-identical",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"9".repeat(64),pid:49403,v:1 as const,ticket:"0000000000000001"};await writePublicationStage(root,owner,publicationOwnerBytes(owner));const before=await snapshotRootArtifacts(root),originalKill=process.kill;let k1Initial=0,semanticNow=0,callbacks=0,enumerations=0;Object.defineProperty(process,"kill",{configurable:true,value:(pid:number)=>pid===owner.pid?true:originalKill.call(process,pid,0)});let result;try{result=await new RawFsAuthorityLedger(root,{now:()=>{semanticNow++;return t0;},lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="after-pre-admission-housekeeping-initial-enumeration")k1Initial++;if(point==="after-publication-stage-enumeration")enumerations++;if(point==="before-ledger-operation-callback")callbacks++;}} as never).observeClock();}finally{Object.defineProperty(process,"kill",{configurable:true,value:originalKill});}assert.deepEqual(result,{ok:false,reason:"busy"});assert.deepEqual(await snapshotRootArtifacts(root),before);assert.deepEqual({k1Initial,semanticNow,callbacks},{k1Initial:0,semanticNow:0,callbacks:0});assert.equal(enumerations>0,true,"legacy publication classifier remains active");}));
  await t.test("two live publication stages retain legacy busy parity",()=>withRoot(async root=>{const owners=[{host:hostname(),nonce:"a".repeat(64),pid:49404,v:1 as const,ticket:"0000000000000001"},{host:hostname(),nonce:"b".repeat(64),pid:49405,v:1 as const,ticket:"0000000000000002"}];for(const owner of owners)await writePublicationStage(root,owner,publicationOwnerBytes(owner));const before=await snapshotRootArtifacts(root),originalKill=process.kill;let k1Initial=0,semanticNow=0,callbacks=0,enumerations=0;Object.defineProperty(process,"kill",{configurable:true,value:(pid:number)=>owners.some(owner=>owner.pid===pid)?true:originalKill.call(process,pid,0)});let result;try{result=await new RawFsAuthorityLedger(root,{now:()=>{semanticNow++;return t0;},lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="after-pre-admission-housekeeping-initial-enumeration")k1Initial++;if(point==="after-publication-stage-enumeration"||point==="after-mutating-admission-enumeration")enumerations++;if(point==="before-ledger-operation-callback")callbacks++;}} as never).observeClock();}finally{Object.defineProperty(process,"kill",{configurable:true,value:originalKill});}assert.deepEqual(result,{ok:false,reason:"busy"});assert.deepEqual(await snapshotRootArtifacts(root),before);assert.deepEqual({k1Initial,semanticNow,callbacks},{k1Initial:0,semanticNow:0,callbacks:0});assert.equal(enumerations>0,true,"legacy multi-stage wait remains the compatibility classifier's decision");}));
  await t.test("lone valid publication-aborted remains legacy-serviceable",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"c".repeat(64),pid:process.pid,v:1 as const},marker=await writeLegacyRetiredLock(root,owner,"publication-aborted"),before=await snapshotRootArtifacts(root);let k1Initial=0,semanticNow=0,callbacks=0,published=0,retired=0;const result=await new RawFsAuthorityLedger(root,{now:()=>{semanticNow++;return t0;},lockTimeoutMs:200,faultInjector:(point:string)=>{if(point==="after-pre-admission-housekeeping-initial-enumeration")k1Initial++;if(point==="after-lock-publication-root-sync")published++;if(point==="after-lock-retire")retired++;if(point==="before-ledger-operation-callback")callbacks++;}} as never).observeClock(),after=await snapshotRootArtifacts(root);assert.equal(before.some(entry=>entry.name===path.basename(marker)),true);assert.deepEqual(result,{ok:true,status:"advanced",observedAt:new Date(t0).toISOString()});assert.equal(existsSync(marker),false,"legacy cleanup services publication-aborted");assert.deepEqual({k1Initial,semanticNow,callbacks,published,retired},{k1Initial:0,semanticNow:1,callbacks:1,published:1,retired:1});assert.equal(after.some(entry=>entry.name===path.basename(marker)),false);}));
  await t.test("live active lock remains legacy busy and byte-identical",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"d".repeat(64),pid:process.pid,v:1 as const},lock=path.join(root,"lock");await mkdir(lock);await writeFile(path.join(lock,"owner.json"),publicationOwnerBytes(owner));const before=await snapshotRootArtifacts(root);let k1Initial=0,semanticNow=0,callbacks=0,activeSnapshots=0;const result=await new RawFsAuthorityLedger(root,{now:()=>{semanticNow++;return t0;},lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="after-pre-admission-housekeeping-initial-enumeration")k1Initial++;if(point==="after-active-lock-metadata")activeSnapshots++;if(point==="before-ledger-operation-callback")callbacks++;}} as never).observeClock();assert.deepEqual(result,{ok:false,reason:"busy"});assert.deepEqual(await snapshotRootArtifacts(root),before);assert.deepEqual({k1Initial,semanticNow,callbacks},{k1Initial:0,semanticNow:0,callbacks:0});assert.equal(activeSnapshots>0,true,"legacy active-lock classifier remains active");}));
  await t.test("valid legacy cleanup marker and ack drain then continue",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"e".repeat(64),pid:process.pid,v:1 as const},markerName=retirementMarkerName(owner,"released"),marker=await writeLegacyRetiredLock(root,owner,"released"),ack=cleanupAck(owner,markerName,"released",null),ackPath=path.join(root,cleanupAckName(ack));await writeFile(ackPath,authorityCanonicalBytes(ack));const before=await snapshotRootArtifacts(root);let k1Initial=0,semanticNow=0,callbacks=0,published=0,retired=0;const result=await new RawFsAuthorityLedger(root,{now:()=>{semanticNow++;return t0;},lockTimeoutMs:200,faultInjector:(point:string)=>{if(point==="after-pre-admission-housekeeping-initial-enumeration")k1Initial++;if(point==="after-lock-publication-root-sync")published++;if(point==="after-lock-retire")retired++;if(point==="before-ledger-operation-callback")callbacks++;}} as never).observeClock(),after=await snapshotRootArtifacts(root);assert.equal(before.some(entry=>entry.name===path.basename(marker)||entry.name===path.basename(ackPath)),true);assert.deepEqual(result,{ok:true,status:"advanced",observedAt:new Date(t0).toISOString()});assert.equal(existsSync(marker),false);assert.equal(existsSync(ackPath),false);assert.deepEqual({k1Initial,semanticNow,callbacks,published,retired},{k1Initial:0,semanticNow:1,callbacks:1,published:1,retired:1});assert.equal(after.some(entry=>entry.name===path.basename(marker)||entry.name===path.basename(ackPath)),false);}));
});

test("authority-ledger generated component names remain within NAME_MAX",()=>{const owner={host:"h".repeat(255),nonce:"f".repeat(64),pid:Number.MAX_SAFE_INTEGER,v:1 as const,ticket:"f".repeat(16)},record={purpose:"slot-retired",v:coordinationAckVersion},ack=cleanupAck(owner,retirementMarkerName(owner,"recovery-pending"),"recovery-pending",digest("f")),names=[admissionPrepName(owner),admissionPrepRetiredName(owner,"complete"),admissionRetiredName(owner,"withdrawn"),creatorWithdrawalName(owner,"partial",owner.ticket),publicationStageName(owner),retirementMarkerName(owner,"recovery-pending"),cleanupAckName(ack),cleanupStageName(owner,ack),coordinationAckName(record),...(["prep-retired","slot-retired","creator-withdrawal"] as const).map(purpose=>coordinationStageName(record,purpose))],lengths=names.map(name=>Buffer.byteLength(name,"utf8"));assert.equal(Buffer.byteLength(coordinationStageName(record,"creator-withdrawal"),"utf8"),115);assert.equal(Math.max(...lengths),208);assert.equal(lengths.every(length=>length<=255),true);});

test("slot-retired wire authority is strictly disposition-discriminated",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"a".repeat(64),pid:49999,v:1 as const},records=[] as Array<Readonly<Record<string,unknown>>>;for(const [disposition,recoveryAuthority,terminalArtifactName] of [["abandoned","dead-owner-or-exact-creator",admissionRetiredName(owner,"abandoned")],["withdrawn","exact-withdrawal-marker",creatorWithdrawalName(owner,"partial")],["published","active-owner-or-exact-lock-successor",retirementMarkerName(owner,"released")]] as const){const markerName=admissionRetiredName(owner,disposition),marker=path.join(root,markerName);await mkdir(marker);await writeFile(path.join(marker,"owner.json"),publicationOwnerBytes(owner));const record=slotCoordinationAck(owner,markerName,marker,disposition,terminalArtifactName,publicationOwnerBytes(owner));assert.equal(record.recoveryAuthority,recoveryAuthority);assert.equal(record.terminalArtifactName,terminalArtifactName);assert.equal(record.terminalArtifactDigest,rawDigest(publicationOwnerBytes(owner)));records.push(record);}const expectedKeys=Object.keys(records[0]!).sort();assert.deepEqual(expectedKeys,["disposition","kind","markerName","originalName","owner","ownerBytesDigest","ownerBytesLength","ownerDigest","ownerIdentity","purpose","recoveryAuthority","slotIdentity","terminalArtifactDigest","terminalArtifactName","v"]);for(const record of records)assert.deepEqual(Object.keys(record).sort(),expectedKeys);assert.equal(records[0]!.terminalArtifactName,records[0]!.markerName,"abandoned authority binds its positive durable retirement marker snapshot");}));

test("atomic admission preparation hard exits leave only exact recoverable topology",{timeout:30_000},async t=>{
  const boundaries=["after-admission-prep-create","after-admission-prep-owner-create","after-admission-prep-owner-partial-write","after-admission-prep-owner-sync","after-admission-prep-sync","after-admission-slot-rename","after-admission-slot-root-sync","after-admission-slot-final-validation"] as const;
  for(const boundary of boundaries)await t.test(boundary,()=>withRoot(async root=>{const callback=path.join(root,"callback-entered"),moduleUrl=pathToFileURL(path.resolve("dist-test/src/authority/host/fs-ledger.js")).href,source=`import{writeFileSync}from"node:fs";import{FsAuthorityLedger}from ${JSON.stringify(moduleUrl)};const ledger=new FsAuthorityLedger(process.argv[1],{now:()=>${t0},lockTimeoutMs:100,faultInjector(point){if(point===${JSON.stringify(boundary)})process.exit(91);if(point==="before-ledger-operation-callback")writeFileSync(process.argv[2],"entered");}});await ledger.observeClock();process.exit(92);`,code=await new Promise<number|null>((resolve,reject)=>{const child=spawn(process.execPath,["--input-type=module","-e",source,root,callback],{stdio:"ignore"});child.once("error",reject);child.once("close",resolve);});const names=await readdir(root),preps=names.filter(name=>name.startsWith(".authority-ledger-admission-prep-")&&!name.startsWith(".authority-ledger-admission-prep-retired-")),slots=names.filter(name=>name===".authority-ledger-admission-0"),stages=names.filter(name=>name.startsWith(".authority-ledger-lock-publication-"));assert.ok(preps.length<=1,boundary);assert.ok(slots.length<=1,boundary);assert.ok(stages.length<=1,boundary);assert.equal(existsSync(callback),false,`${boundary} cannot reach callback/dispatch`);assert.equal(code,91,`${boundary} must be a real recoverable hard-exit boundary`);assert.ok(preps.length+slots.length+stages.length>=1,`${boundary} preserves an exact recoverable coordination artifact`);}));
});

test("atomic admission preparation states are non-authorizing and dead states retire",async t=>{
  for(const state of ["empty","zero","partial","complete"] as const){
    await t.test(`live-${state}`,()=>withRoot(async root=>{const owner={host:hostname(),nonce:(state==="empty"?"1":state==="zero"?"2":state==="partial"?"3":"4").repeat(64),pid:process.pid,v:1 as const},prep=await writeAdmissionPrep(root,owner,state),before=await snapshotRootArtifacts(root);let callbackEntries=0;const result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="before-ledger-operation-callback")callbackEntries++;}} as never).observeClock();assert.deepEqual(result,{ok:false,reason:"busy"});assert.equal(callbackEntries,0);assert.equal(existsSync(prep),true);assert.deepEqual(await snapshotRootArtifacts(root),before);}));
    await t.test(`dead-${state}`,()=>withRoot(async root=>{const owner={host:hostname(),nonce:(state==="empty"?"5":state==="zero"?"6":state==="partial"?"7":"8").repeat(64),pid:47000+["empty","zero","partial","complete"].indexOf(state),v:1 as const},prep=await writeAdmissionPrep(root,owner,state),originalKill=process.kill;let callbackEntries=0;Object.defineProperty(process,"kill",{configurable:true,value:(pid:number)=>pid===owner.pid?(()=>{throw Object.assign(new Error("dead"),{code:"ESRCH"});})():originalKill.call(process,pid,0)});let result;try{result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:200,faultInjector:(point:string)=>{if(point==="before-ledger-operation-callback")callbackEntries++;}} as never).observeClock();}finally{Object.defineProperty(process,"kill",{configurable:true,value:originalKill});}assert.deepEqual(result,{ok:true,status:"advanced",observedAt:new Date(t0).toISOString()});assert.equal(existsSync(prep),false);assert.equal(callbackEntries,1);assert.deepEqual((await readdir(root)).filter(name=>name.startsWith(".authority-ledger-admission-")),[]);}));
  }
});

test("atomic admission preparation rejects every unclosed shape without mutation",async t=>{
  const cases=["malformed-owner","foreign-host","duplicate","broad-prefix","hardlinked-owner","replacement","unverifiable"] as const;
  for(const [index,kind] of cases.entries())await t.test(kind,()=>withRoot(async root=>{const owner={host:hostname(),nonce:(index+1).toString(16).repeat(64),pid:48000+index,v:1 as const},prep=await writeAdmissionPrep(root,owner,"complete"),originalKill=process.kill,external=await tempRoot();let replacementHook=false,probes=0;try{if(kind==="malformed-owner")await writeFile(path.join(prep,"owner.json"),"not-a-prefix");if(kind==="foreign-host"){await rename(prep,path.join(root,admissionPrepName({...owner,host:"foreign.invalid"})));}if(kind==="duplicate")await writeAdmissionPrep(root,{...owner,nonce:"f".repeat(64)},"complete");if(kind==="broad-prefix")await rename(prep,path.join(root,`${admissionPrepName(owner)}.extra`));if(kind==="hardlinked-owner"){const externalOwner=path.join(external,"owner.json");await writeFile(externalOwner,publicationOwnerBytes(owner));await rm(path.join(prep,"owner.json"));await link(externalOwner,path.join(prep,"owner.json"));}const before=await snapshotRootArtifacts(root);Object.defineProperty(process,"kill",{configurable:true,value:(pid:number)=>{if(pid===owner.pid){probes++;if(kind==="unverifiable")throw Object.assign(new Error("unverifiable"),{code:"EPERM"});return true;}return originalKill.call(process,pid,0);}});const result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20,faultInjector:(point:string)=>{if(kind==="replacement"&&point==="after-admission-prep-enumeration"){replacementHook=true;const displaced=path.join(external,"displaced");renameSync(prep,displaced);mkdirSync(prep);writeFileSync(path.join(prep,"owner.json"),publicationOwnerBytes(owner));}}} as never).observeClock();assert.deepEqual(result,{ok:false,reason:"corruption"});if(kind==="replacement")assert.equal(replacementHook,true,"replacement is observed after a frozen preparation snapshot");else{if(kind==="unverifiable")assert.ok(probes>0,"exact prep owner liveness is classified");assert.deepEqual(await snapshotRootArtifacts(root),before);}}finally{Object.defineProperty(process,"kill",{configurable:true,value:originalKill});await rm(external,{recursive:true,force:true});}}));
});

test("atomic admission keeps one owner and its fixed slot through publication durability",()=>withRoot(async root=>{let slotOwner=Buffer.alloc(0),lockOwner=Buffer.alloc(0),slotAtLockSync=false,retirementRootSynced=false,callbackEntries=0;const slot=path.join(root,".authority-ledger-admission-0");const result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:200,faultInjector:(point:string)=>{if(point==="after-admission-slot-root-sync")slotOwner=readFileSync(path.join(slot,"owner.json"));if(point==="after-lock-publication-root-sync"){slotAtLockSync=existsSync(slot);if(slotAtLockSync){lockOwner=readFileSync(path.join(root,"lock","owner.json"));assert.deepEqual(lockOwner,readFileSync(path.join(slot,"owner.json")));}}if(point==="after-admission-slot-retire-root-sync"){retirementRootSynced=true;assert.equal(existsSync(slot),false);}if(point==="before-ledger-operation-callback"){callbackEntries++;assert.equal(retirementRootSynced,true,"callback follows published-slot retirement root sync");}}} as never).observeClock();assert.deepEqual(result,{ok:true,status:"advanced",observedAt:new Date(t0).toISOString()});assert.equal(slotAtLockSync,true);assert.ok(slotOwner.length>0);assert.deepEqual(lockOwner,slotOwner,"prep, slot, publication stage, and active lock use one canonical owner/nonce");assert.equal(retirementRootSynced,true);assert.equal(callbackEntries,1);}));

test("atomic admission publication retirement failure aborts the active lock before callback",()=>withRoot(async root=>{let retirementAttempts=0,callbackEntries=0,publishedOwner:AdmissionOwner|undefined;const result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="after-lock-publication-root-sync")publishedOwner=JSON.parse(readFileSync(path.join(root,"lock","owner.json"),"utf8"));if(point==="before-admission-slot-retire-rename"){retirementAttempts++;throw Object.assign(new Error("sharing"),{code:"EBUSY"});}if(point==="before-ledger-operation-callback")callbackEntries++;}} as never).observeClock();assert.ok(retirementAttempts>0,"slot retirement has its own bounded retry path");assert.equal(callbackEntries,0);assert.deepEqual(result,{ok:false,reason:"busy"});assert.ok(publishedOwner);assert.equal(existsSync(path.join(root,"lock")),false);assert.equal(existsSync(path.join(root,`.authority-ledger-lock-${publishedOwner!.pid}-${publishedOwner!.nonce}.publication-aborted`)),true);}));

test("atomic admission K=1 classifies external publication membership without treating it as admission",async t=>{
  await t.test("lone live external stage is busy and preserved",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"4".repeat(64),pid:49101,v:1 as const,ticket:"0000000000000001"},stage=await writePublicationStage(root,owner,publicationOwnerBytes(owner)),before=await snapshotRootArtifacts(root),originalKill=process.kill;Object.defineProperty(process,"kill",{configurable:true,value:(pid:number)=>pid===owner.pid?true:originalKill.call(process,pid,0)});let result;try{result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20}).observeClock();}finally{Object.defineProperty(process,"kill",{configurable:true,value:originalKill});}assert.deepEqual(result,{ok:false,reason:"busy"});assert.equal(existsSync(stage),true);assert.deepEqual(await snapshotRootArtifacts(root),before);}));
  await t.test("lone dead external stage is atomically withdrawn and never promoted",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"5".repeat(64),pid:49102,v:1 as const,ticket:"0000000000000001"},stage=await writePublicationStage(root,owner,publicationOwnerBytes(owner)),marker=path.join(root,retirementMarkerName(owner,"publication-aborted")),originalKill=process.kill;let markerRootSynced=false;Object.defineProperty(process,"kill",{configurable:true,value:(pid:number)=>pid===owner.pid?(()=>{throw Object.assign(new Error("dead"),{code:"ESRCH"});})():originalKill.call(process,pid,0)});let result;try{result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:200,faultInjector:(point:string)=>{if(point==="after-creator-withdrawal-root-sync"){markerRootSynced=true;assert.equal(existsSync(marker),true);assert.equal(existsSync(stage),false);}}} as never).observeClock();}finally{Object.defineProperty(process,"kill",{configurable:true,value:originalKill});}assert.equal(markerRootSynced,true);assert.deepEqual(result,{ok:true,status:"advanced",observedAt:new Date(t0).toISOString()});assert.equal(existsSync(path.join(root,"lock")),false,"external owner is never promoted");}));
  // The K1 multi-stage corruption rule is scoped to a K1-ACTIVE generation. Publication-stage names
  // do not activate K1 (isK1ReservedName ignores them), so a stages-only root is legacy-only residue
  // and stays busy — which is what "two live publication stages retain legacy busy parity" pins. The
  // fixed admission slot is what makes this generation K1-active and the rule applicable.
  await t.test("two distinct external stages are invalid K=1 topology",()=>withRoot(async root=>{const owners=[{host:hostname(),nonce:"6".repeat(64),pid:49103,v:1 as const,ticket:"0000000000000001"},{host:hostname(),nonce:"7".repeat(64),pid:49104,v:1 as const,ticket:"0000000000000002"}];await writeAdmissionSlot(root,owners[0]);for(const owner of owners)await writePublicationStage(root,owner,publicationOwnerBytes(owner));const before=await snapshotRootArtifacts(root),originalKill=process.kill;Object.defineProperty(process,"kill",{configurable:true,value:(pid:number)=>owners.some(owner=>owner.pid===pid)?true:originalKill.call(process,pid,0)});let result;try{result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20}).observeClock();}finally{Object.defineProperty(process,"kill",{configurable:true,value:originalKill});}assert.deepEqual(result,{ok:false,reason:"corruption"});assert.deepEqual(await snapshotRootArtifacts(root),before);}));
});

test("K=1 external publication membership still rejects malformed topology without target mutation",async t=>{
  const owner={host:hostname(),nonce:"d".repeat(64),pid:process.pid,v:1 as const},exact=publicationStageName(owner),sentinel=Buffer.from("publication-external-target");
  await t.test("malformed-name",()=>withRoot(async root=>{const stage=path.join(root,".authority-ledger-lock-publication-malformed.tmp");await mkdir(stage);assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20}).recover(),{ok:false,reason:"corruption"});assert.equal(existsSync(stage),true);}));
  await t.test("extra-content",()=>withRoot(async root=>{const stage=path.join(root,exact);await mkdir(stage);await writeFile(path.join(stage,"owner.json"),publicationOwnerBytes(owner));await writeFile(path.join(stage,"extra"),sentinel);assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20}).recover(),{ok:false,reason:"corruption"});assert.deepEqual(await readFile(path.join(stage,"extra")),sentinel);}));
  await t.test("owner-mismatch",()=>withRoot(async root=>{const stage=path.join(root,exact);await mkdir(stage);await writeFile(path.join(stage,"owner.json"),publicationOwnerBytes({...owner,nonce:"e".repeat(64)}));assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20}).recover(),{ok:false,reason:"corruption"});assert.equal(existsSync(stage),true);}));
  await t.test("foreign-host",()=>withRoot(async root=>{const foreign={...owner,host:"foreign.invalid"},stage=await writePublicationStage(root,foreign,publicationOwnerBytes(foreign));assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20}).recover(),{ok:false,reason:"corruption"});assert.equal(existsSync(stage),true);}));
  await t.test("hard-linked-owner",()=>withRoot(async root=>{const stage=path.join(root,exact),external=path.join(root,"transactions","publication-owner");await mkdir(stage);await mkdir(path.dirname(external),{recursive:true});await writeFile(external,publicationOwnerBytes(owner));const before=await readFile(external);await link(external,path.join(stage,"owner.json"));assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20}).recover(),{ok:false,reason:"corruption"});assert.deepEqual(await readFile(external),before);}));
  await t.test("reparse-stage",()=>withRoot(async root=>{const external=await tempRoot(),stage=path.join(root,exact);try{await writeFile(path.join(external,"sentinel"),sentinel);await symlink(external,stage,process.platform==="win32"?"junction":"dir");assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20}).recover(),{ok:false,reason:"corruption"});assert.deepEqual(await readFile(path.join(external,"sentinel")),sentinel);}finally{await rm(external,{recursive:true,force:true});}}));
});

test("atomic admission canonical-owner write-all handles short writes and refuses invalid progress",async t=>{const scratch=await tempRoot(),probe=await open(path.join(scratch,"probe"),"w"),prototype=Object.getPrototypeOf(probe) as {write:(buffer:Uint8Array,offset:number,length:number,position:number)=>Promise<{bytesWritten:number;buffer:Uint8Array}>};await probe.close();await rm(scratch,{recursive:true,force:true});const original=prototype.write;await t.test("short-writes",()=>withRoot(async root=>{prototype.write=async function(buffer,offset,length,position){return original.call(this,buffer,offset,Math.min(length,2),position);};try{assert.equal((await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:200}).observeClock()).ok,true);}finally{prototype.write=original;}}));for(const [name,reported] of [["zero",0],["negative",-1],["oversized",Number.MAX_SAFE_INTEGER]] as const)await t.test(name,()=>withRoot(async root=>{let callbackEntries=0;prototype.write=async function(buffer){return {bytesWritten:reported,buffer};};try{const result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="before-ledger-operation-callback")callbackEntries++;}} as never).observeClock();assert.deepEqual(result,{ok:false,reason:"corruption"});assert.equal(callbackEntries,0);assert.equal(existsSync(path.join(root,"lock")),false);}finally{prototype.write=original;}}));});

test("active-lock identity replacement restarts classification without contender mutation",()=>withRoot(async root=>{const external=await tempRoot(),oldOwner={host:hostname(),nonce:"1".repeat(64),pid:process.pid,v:1 as const},replacementOwner={host:hostname(),nonce:"5".repeat(64),pid:process.pid,v:1 as const},replacementBytes=publicationOwnerBytes(replacementOwner),directory=path.join(root,"lock"),replacementDirectory=path.join(external,"replacement-lock");try{await mkdir(directory);await writeFile(path.join(directory,"owner.json"),publicationOwnerBytes(oldOwner));await mkdir(replacementDirectory);await writeFile(path.join(replacementDirectory,"owner.json"),replacementBytes);let fired=false,callbackEntries=0,ownPublicationHooks=0;const result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="before-ledger-operation-callback")callbackEntries++;if((publicationCrashPoints as readonly string[]).includes(point))ownPublicationHooks++;if(!fired&&point==="after-active-lock-metadata"){fired=true;renameSync(directory,path.join(external,"old-lock"));renameSync(replacementDirectory,directory);}}} as never).recover();assert.equal(fired,true);assert.deepEqual(result,{ok:false,reason:"busy"});assert.equal(callbackEntries,0);assert.equal(ownPublicationHooks,0);assert.deepEqual(await readFile(path.join(directory,"owner.json")),replacementBytes);}finally{await rm(external,{recursive:true,force:true});}}));

test("atomic admission slot classification gives corruption precedence and recovers only exact dead slots",async t=>{
  await t.test("live exact slot",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"9".repeat(64),pid:process.pid,v:1 as const};await writeAdmissionSlot(root,owner);const before=await snapshotRootArtifacts(root);const result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20}).observeClock();assert.deepEqual(result,{ok:false,reason:"busy"});assert.deepEqual(await snapshotRootArtifacts(root),before);}));
  await t.test("dead exact slot",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"a".repeat(64),pid:49000,v:1 as const};await writeAdmissionSlot(root,owner);const originalKill=process.kill;Object.defineProperty(process,"kill",{configurable:true,value:(pid:number)=>pid===owner.pid?(()=>{throw Object.assign(new Error("dead"),{code:"ESRCH"});})():originalKill.call(process,pid,0)});let result;try{result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:200}).observeClock();}finally{Object.defineProperty(process,"kill",{configurable:true,value:originalKill});}assert.deepEqual(result,{ok:true,status:"advanced",observedAt:new Date(t0).toISOString()});assert.deepEqual((await readdir(root)).filter(name=>name.startsWith(".authority-ledger-admission-")),[]);}));
  for(const [name,install] of [
    ["malformed-publication",async(root:string,owner:AdmissionOwner)=>{const stage=path.join(root,".authority-ledger-lock-publication-malformed.tmp");await mkdir(stage);await writeFile(path.join(stage,"owner.json"),"bad");}],
    ["foreign-publication",async(root:string,owner:AdmissionOwner)=>{const foreign={...owner,host:"foreign.invalid",nonce:"b".repeat(64),pid:owner.pid+1,ticket:"0000000000000001"};await writePublicationStage(root,foreign,publicationOwnerBytes(foreign));}],
    ["duplicate-publication",async(root:string,owner:AdmissionOwner)=>{await writePublicationStage(root,{...owner,nonce:"c".repeat(64),ticket:"0000000000000001"},publicationOwnerBytes({...owner,nonce:"c".repeat(64)}));await writePublicationStage(root,{...owner,nonce:"d".repeat(64),ticket:"0000000000000002"},publicationOwnerBytes({...owner,nonce:"d".repeat(64)}));}],
    ["unexpected-membership",async(root:string)=>{await writeFile(path.join(root,".authority-ledger-admission-lookalike"),"sentinel");}],
  ] as const)await t.test(name,()=>withRoot(async root=>{const owner={host:hostname(),nonce:"e".repeat(64),pid:process.pid,v:1 as const};await writeAdmissionSlot(root,owner);await install(root,owner);const before=await snapshotRootArtifacts(root),result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20}).observeClock();assert.deepEqual(result,{ok:false,reason:"corruption"});assert.deepEqual(await snapshotRootArtifacts(root),before);}));
  await t.test("hardlinked-slot-owner",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"f".repeat(64),pid:process.pid,v:1 as const},slot=path.join(root,".authority-ledger-admission-0"),external=await tempRoot();try{await mkdir(slot);const source=path.join(external,"owner.json");await writeFile(source,publicationOwnerBytes(owner));await link(source,path.join(slot,"owner.json"));const before=await snapshotRootArtifacts(root),result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20}).observeClock();assert.deepEqual(result,{ok:false,reason:"corruption"});assert.deepEqual(await snapshotRootArtifacts(root),before);assert.deepEqual(await readFile(source),publicationOwnerBytes(owner));}finally{await rm(external,{recursive:true,force:true});}}));
  await t.test("replaced-slot",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"0".repeat(64),pid:process.pid,v:1 as const},slot=await writeAdmissionSlot(root,owner),external=await tempRoot();let replacementHook=false;try{const result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="after-admission-slot-enumeration"){replacementHook=true;renameSync(slot,path.join(external,"original-slot"));mkdirSync(slot);writeFileSync(path.join(slot,"owner.json"),publicationOwnerBytes(owner));}}} as never).observeClock();assert.equal(replacementHook,true,"replacement occurs after the fixed slot identity is frozen");assert.deepEqual(result,{ok:false,reason:"corruption"});assert.equal(existsSync(slot),true);}finally{await rm(external,{recursive:true,force:true});}}));
  await t.test("reparse-slot",async t2=>withRoot(async root=>{const target=path.join(root,"transactions","slot-target"),slot=path.join(root,".authority-ledger-admission-0"),sentinel=Buffer.from("slot-reparse-sentinel");await mkdir(target,{recursive:true});await writeFile(path.join(target,"sentinel"),sentinel);try{await symlink(target,slot,process.platform==="win32"?"junction":"dir");}catch(error){if((error as {code?:string}).code==="EPERM"){t2.skip("reparse creation unavailable");return;}throw error;}assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20}).observeClock(),{ok:false,reason:"corruption"});assert.deepEqual(await readFile(path.join(target,"sentinel")),sentinel);}));
});

test("atomic admission slot retirement and purpose-bound ack crash windows converge",async t=>{
  for(const state of ["marker-only","marker-plus-stage","marker-plus-ack","orphan-ack"] as const)await t.test(state,()=>withRoot(async root=>{const owner={host:hostname(),nonce:(state==="marker-only"?"1":state==="marker-plus-stage"?"2":state==="marker-plus-ack"?"3":"4").repeat(64),pid:process.pid,v:1 as const},terminalName=retirementMarkerName(owner,"publication-aborted"),terminal=path.join(root,terminalName),markerName=admissionRetiredName(owner,"withdrawn"),marker=path.join(root,markerName);await mkdir(terminal);await writeFile(path.join(terminal,"owner.json"),publicationOwnerBytes(owner));await mkdir(marker);await writeFile(path.join(marker,"owner.json"),publicationOwnerBytes(owner));const ack=slotCoordinationAck(owner,markerName,marker,"withdrawn",terminalName,publicationOwnerBytes(owner)),ackPath=path.join(root,coordinationAckName(ack)),stagePath=path.join(root,coordinationStageName(ack,"slot-retired"));if(state==="marker-plus-stage")await writeFile(stagePath,authorityCanonicalBytes(ack));if(state==="marker-plus-ack"||state==="orphan-ack")await writeFile(ackPath,authorityCanonicalBytes(ack));if(state==="orphan-ack")await rm(marker,{recursive:true});const result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:200}).observeClock();assert.deepEqual(result,{ok:true,status:"advanced",observedAt:new Date(t0).toISOString()},state);assert.equal(existsSync(marker),false,state);assert.equal(existsSync(stagePath),false,state);assert.equal(existsSync(ackPath),false,state);assert.equal(existsSync(terminal),false,state);}));
});

test("atomic admission slot retirement exposes every durable cleanup boundary",{timeout:30_000},async t=>{
  const boundaries=["after-admission-slot-retire-rename","after-admission-slot-retire-root-sync","after-coordination-cleanup-stage-create","after-coordination-cleanup-ack-rename","after-coordination-cleanup-ack-root-sync","after-coordination-cleanup-marker-remove","after-coordination-cleanup-marker-root-sync"] as const;
  for(const boundary of boundaries)await t.test(boundary,()=>withRoot(async root=>{const callback=path.join(root,"callback-entered"),moduleUrl=pathToFileURL(path.resolve("dist-test/src/authority/host/fs-ledger.js")).href,source=`import{writeFileSync}from"node:fs";import{FsAuthorityLedger}from ${JSON.stringify(moduleUrl)};const ledger=new FsAuthorityLedger(process.argv[1],{now:()=>${t0},lockTimeoutMs:100,faultInjector(point){if(point===${JSON.stringify(boundary)})process.exit(94);if(point==="before-ledger-operation-callback")writeFileSync(process.argv[2],"entered");}});await ledger.observeClock();process.exit(92);`,code=await new Promise<number|null>((resolve,reject)=>{const child=spawn(process.execPath,["--input-type=module","-e",source,root,callback],{stdio:"ignore"});child.once("error",reject);child.once("close",resolve);});const names=await readdir(root);assert.equal(names.filter(name=>name===".authority-ledger-admission-0").length<=1,true);assert.equal(names.filter(name=>name.startsWith(".authority-ledger-admission-retired-")).length<=1,true);assert.equal(names.filter(name=>name.startsWith(".authority-ledger-coordination-cleanup-")).length<=1,true);assert.equal(existsSync(callback),false,`${boundary} precedes callback`);assert.equal(code,94,`${boundary} is crash-visible`);}));
});

test("atomic admission slot retirement rejects invalid markers and acknowledgments unchanged",async t=>{
  for(const kind of ["invalid-disposition","ack-mismatch","hardlinked-owner","broad-prefix"] as const)await t.test(kind,()=>withRoot(async root=>{const owner={host:hostname(),nonce:(kind==="invalid-disposition"?"4":kind==="ack-mismatch"?"5":kind==="hardlinked-owner"?"6":"7").repeat(64),pid:process.pid,v:1 as const},markerName=kind==="invalid-disposition"?`.authority-ledger-admission-retired-${publicationHostDigest(owner.host)}-${owner.pid}-${owner.nonce}.invalid`:kind==="broad-prefix"?`${admissionRetiredName(owner,"abandoned")}.extra`:admissionRetiredName(owner,"abandoned"),marker=path.join(root,markerName),external=await tempRoot();try{await mkdir(marker);if(kind==="hardlinked-owner"){const source=path.join(external,"owner.json");await writeFile(source,publicationOwnerBytes(owner));await link(source,path.join(marker,"owner.json"));}else await writeFile(path.join(marker,"owner.json"),publicationOwnerBytes(owner));if(kind==="ack-mismatch"){const ack={...slotCoordinationAck(owner,markerName,marker,"abandoned"),terminalArtifactDigest:digest("0")};await writeFile(path.join(root,coordinationAckName(ack)),authorityCanonicalBytes(ack));}const before=await snapshotRootArtifacts(root),result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20}).observeClock();assert.deepEqual(result,{ok:false,reason:"corruption"});assert.deepEqual(await snapshotRootArtifacts(root),before);}finally{await rm(external,{recursive:true,force:true});}}));
  await t.test("replacement",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"8".repeat(64),pid:process.pid,v:1 as const},markerName=admissionRetiredName(owner,"abandoned"),marker=path.join(root,markerName),external=await tempRoot();let replacementHook=false;try{await mkdir(marker);await writeFile(path.join(marker,"owner.json"),publicationOwnerBytes(owner));const result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="after-coordination-cleanup-marker-enumeration"){replacementHook=true;renameSync(marker,path.join(external,"original-marker"));mkdirSync(marker);writeFileSync(path.join(marker,"owner.json"),publicationOwnerBytes(owner));}}} as never).observeClock();assert.equal(replacementHook,true);assert.deepEqual(result,{ok:false,reason:"corruption"});assert.equal(existsSync(marker),true);}finally{await rm(external,{recursive:true,force:true});}}));
  await t.test("reparse",async t2=>withRoot(async root=>{const owner={host:hostname(),nonce:"9".repeat(64),pid:process.pid,v:1 as const},marker=path.join(root,admissionRetiredName(owner,"abandoned")),target=path.join(root,"transactions","slot-retired-target"),sentinel=Buffer.from("slot-retired-reparse");await mkdir(target,{recursive:true});await writeFile(path.join(target,"sentinel"),sentinel);try{await symlink(target,marker,process.platform==="win32"?"junction":"dir");}catch(error){if((error as {code?:string}).code==="EPERM"){t2.skip("reparse creation unavailable");return;}throw error;}assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20}).observeClock(),{ok:false,reason:"corruption"});assert.deepEqual(await readFile(path.join(target,"sentinel")),sentinel);}));
});

test("atomic admission creator withdrawal atomically seals empty zero partial and complete stages",async t=>{
  for(const [state,boundary] of [["empty","after-lock-publication-stage-create"],["zero","after-lock-publication-owner-create"],["partial","after-lock-publication-owner-partial-write"],["complete","after-lock-publication-owner-sync"]] as const)await t.test(state,()=>withRoot(async root=>{const terminal={state,boundary},stage="";let ticket="",ownStage=stage,owner:AdmissionOwner|undefined,thrown:unknown,callbackEntries=0,markerSeen=false,completeObservedEmpty=false;const ledger=new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="after-lock-publication-stage-create"&&!ownStage){const name=readdirSync(root).find(value=>value.startsWith(".authority-ledger-lock-publication-"));assert.ok(name);ownStage=path.join(root,name);const match=/^\.authority-ledger-lock-publication-[0-9a-f]{64}-([0-9a-f]{16})-(\d+)-([0-9a-f]{64})\.tmp$/.exec(name);assert.ok(match);owner={host:hostname(),nonce:match[3],pid:Number(match[2]),v:1};ticket=match[1];}if(point===boundary)throw terminal;if(point==="before-creator-withdrawal-seal"&&state==="complete"&&existsSync(ownStage)&&!existsSync(path.join(ownStage,"owner.json")))completeObservedEmpty=true;if(point==="after-creator-withdrawal-root-sync"&&owner){const markerName=state==="complete"?retirementMarkerName(owner,"publication-aborted"):creatorWithdrawalName(owner,state,ticket);markerSeen=existsSync(path.join(root,markerName));}if(point==="before-ledger-operation-callback")callbackEntries++;}} as never);try{await ledger.observeClock();}catch(error){thrown=error;}assert.equal(thrown,terminal,"cleanup preserves the original thrown object by identity");assert.equal(markerSeen,true,`${state} withdrawal is atomically durable before cleanup`);assert.equal(existsSync(ownStage),false);assert.equal(completeObservedEmpty,false,"complete withdrawal never exposes complete-to-empty");assert.equal(callbackEntries,0);void ticket;}));
});

test("atomic admission creator withdrawal exposes sealing and rename crash boundaries",{timeout:30_000},async t=>{
  const boundaries=["before-creator-withdrawal-seal","after-creator-withdrawal-seal","before-creator-withdrawal-rename","after-creator-withdrawal-rename","after-creator-withdrawal-root-sync"] as const;
  for(const boundary of boundaries)await t.test(boundary,()=>withRoot(async root=>{const callback=path.join(root,"callback-entered"),moduleUrl=pathToFileURL(path.resolve("dist-test/src/authority/host/fs-ledger.js")).href,source=`import{writeFileSync}from"node:fs";import{FsAuthorityLedger}from ${JSON.stringify(moduleUrl)};const terminal={kind:"terminal"};const ledger=new FsAuthorityLedger(process.argv[1],{now:()=>${t0},lockTimeoutMs:100,faultInjector(point){if(point==="after-lock-publication-owner-sync")throw terminal;if(point===${JSON.stringify(boundary)})process.exit(95);if(point==="before-ledger-operation-callback")writeFileSync(process.argv[2],"entered");}});try{await ledger.observeClock();}catch(error){if(error!==terminal)process.exit(96);}process.exit(92);`,code=await new Promise<number|null>((resolve,reject)=>{const child=spawn(process.execPath,["--input-type=module","-e",source,root,callback],{stdio:"ignore"});child.once("error",reject);child.once("close",resolve);});const names=await readdir(root);assert.equal(names.filter(name=>name.startsWith(".authority-ledger-lock-publication-")).length<=1,true);assert.equal(names.filter(name=>name.includes("creator-withdrawal")||name.endsWith(".publication-aborted")).length<=1,true);assert.equal(existsSync(callback),false);assert.equal(code,95,`${boundary} is a durable withdrawal boundary`);}));
});

test("atomic admission prep-retired ack windows converge only with creator or dead-owner authority",async t=>{
  for(const state of ["marker-only","marker-plus-ack","orphan-ack"] as const)await t.test(state,()=>withRoot(async root=>{const owner={host:hostname(),nonce:(state==="marker-only"?"8":state==="marker-plus-ack"?"9":"a").repeat(64),pid:49200+["marker-only","marker-plus-ack","orphan-ack"].indexOf(state),v:1 as const},partialState="partial" as const,markerName=admissionPrepRetiredName(owner,partialState),originalName=admissionPrepName(owner),marker=path.join(root,markerName),originalKill=process.kill;await mkdir(marker);await writeFile(path.join(marker,"owner.json"),ownerStateBytes(owner,partialState));const ack=incompleteCoordinationAck(owner,"prep-retired",markerName,originalName,partialState,marker),ackPath=path.join(root,coordinationAckName(ack));if(state!=="marker-only")await writeFile(ackPath,authorityCanonicalBytes(ack));if(state==="orphan-ack")await rm(marker,{recursive:true});Object.defineProperty(process,"kill",{configurable:true,value:(pid:number)=>pid===owner.pid?(()=>{throw Object.assign(new Error("dead"),{code:"ESRCH"});})():originalKill.call(process,pid,0)});let result;try{result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:200}).observeClock();}finally{Object.defineProperty(process,"kill",{configurable:true,value:originalKill});}assert.deepEqual(result,{ok:true,status:"advanced",observedAt:new Date(t0).toISOString()});assert.equal(existsSync(marker),false);assert.equal(existsSync(ackPath),false);}));
});

test("atomic admission incomplete-withdrawal evidence rejects mismatch links reparses and broad prefixes",async t=>{
  for(const kind of ["ack-mismatch","hardlink","broad-prefix"] as const)await t.test(kind,()=>withRoot(async root=>{const owner={host:hostname(),nonce:(kind==="ack-mismatch"?"e":kind==="hardlink"?"f":"1").repeat(64),pid:process.pid,v:1 as const},baseName=creatorWithdrawalName(owner,"partial"),markerName=kind==="broad-prefix"?`${baseName}.extra`:baseName,marker=path.join(root,markerName),external=await tempRoot();try{await mkdir(marker);if(kind==="hardlink"){const source=path.join(external,"owner.json");await writeFile(source,ownerStateBytes(owner,"partial"));await link(source,path.join(marker,"owner.json"));}else await writeFile(path.join(marker,"owner.json"),ownerStateBytes(owner,"partial"));if(kind==="ack-mismatch"){const slotAck={purpose:"slot-retired",v:coordinationAckVersion},ack={...incompleteCoordinationAck(owner,"creator-withdrawal",markerName,publicationStageName({...owner,ticket:"0000000000000001"}),"partial",marker,slotAck),ownerBytesLength:"999"};await writeFile(path.join(root,coordinationAckName(ack)),authorityCanonicalBytes(ack));}const before=await snapshotRootArtifacts(root),result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20}).observeClock();assert.deepEqual(result,{ok:false,reason:"corruption"});assert.deepEqual(await snapshotRootArtifacts(root),before);}finally{await rm(external,{recursive:true,force:true});}}));
  await t.test("replacement",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"4".repeat(64),pid:process.pid,v:1 as const},marker=await writeCreatorWithdrawal(root,owner,"partial"),external=await tempRoot();let replacementHook=false;try{const result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="after-coordination-cleanup-marker-enumeration"){replacementHook=true;renameSync(marker,path.join(external,"original-marker"));mkdirSync(marker);writeFileSync(path.join(marker,"owner.json"),ownerStateBytes(owner,"partial"));}}} as never).observeClock();assert.equal(replacementHook,true);assert.deepEqual(result,{ok:false,reason:"corruption"});assert.equal(existsSync(marker),true);}finally{await rm(external,{recursive:true,force:true});}}));
  await t.test("reparse",async t2=>withRoot(async root=>{const owner={host:hostname(),nonce:"2".repeat(64),pid:process.pid,v:1 as const},target=path.join(root,"transactions","withdrawal-target"),marker=path.join(root,creatorWithdrawalName(owner,"empty")),sentinel=Buffer.from("withdrawal-reparse-sentinel");await mkdir(target,{recursive:true});await writeFile(path.join(target,"sentinel"),sentinel);try{await symlink(target,marker,process.platform==="win32"?"junction":"dir");}catch(error){if((error as {code?:string}).code==="EPERM"){t2.skip("reparse creation unavailable");return;}throw error;}assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20}).observeClock(),{ok:false,reason:"corruption"});assert.deepEqual(await readFile(path.join(target,"sentinel")),sentinel);}));
});

test("atomic admission active owner cleans coordination once after every sync barrier",async()=>{const deadOwnerPid=await exitedProcessPid();await withRoot(async root=>{const owner={host:hostname(),nonce:"3".repeat(64),pid:deadOwnerPid,v:1 as const},withdrawalName=retirementMarkerName(owner,"publication-aborted"),withdrawal=path.join(root,withdrawalName),slotName=admissionRetiredName(owner,"withdrawn"),slot=path.join(root,slotName);await mkdir(withdrawal);await writeFile(path.join(withdrawal,"owner.json"),publicationOwnerBytes(owner));await mkdir(slot);await writeFile(path.join(slot,"owner.json"),publicationOwnerBytes(owner));const slotAck=slotCoordinationAck(owner,slotName,slot,"withdrawn",withdrawalName,publicationOwnerBytes(owner));await writeFile(path.join(root,coordinationAckName(slotAck)),authorityCanonicalBytes(slotAck));const order:string[]=[];let slotSyncs=0,withdrawalSyncs=0,callbackEntries=0;const result=await new RawFsAuthorityLedger(root,{[k1AdmissionPreparationOption()]:K1_ADMISSION_PREPARATION_LEGACY,now:()=>t0,lockTimeoutMs:200,faultInjector:(point:string)=>{if(point==="after-admission-slot-retire-cleanup-root-sync"){slotSyncs++;order.push("slot-sync");}if(point==="after-creator-withdrawal-cleanup-root-sync"){withdrawalSyncs++;order.push("withdrawal-sync");}if(point==="before-ledger-operation-callback"){callbackEntries++;order.push("callback");assert.equal(slotSyncs,1);assert.equal(withdrawalSyncs,1);}}} as never).observeClock();assert.deepEqual(result,{ok:true,status:"advanced",observedAt:new Date(t0).toISOString()});assert.deepEqual({slotSyncs,withdrawalSyncs,callbackEntries},{slotSyncs:1,withdrawalSyncs:1,callbackEntries:1});assert.deepEqual(order,["slot-sync","withdrawal-sync","callback"]);});});

test("pre-admission housekeeper retires one dead slot before preparation and mutates no semantic state",()=>withRoot(async root=>{
  assert.equal((await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:200}).recover()).ok,true);
  await mkdir(path.join(root,"decisions"));const semantic=["decisions","ingress","journal","transactions","claims","tombstones"] as const,before=await snapshotDurableSubtrees(root,semantic),journalClockBefore=await readJournalEvents(root),owner={host:hostname(),nonce:"4".repeat(64),pid:49301,v:1 as const},slot=await writeAdmissionSlot(root,owner),originalKill=process.kill,terminal={kind:"after-housekeeping-before-prep"};let callbacks=0,semanticClockReads=0,prepCreates=0,publicationCreates=0;
  Object.defineProperty(process,"kill",{configurable:true,value:(pid:number)=>pid===owner.pid?(()=>{throw Object.assign(new Error("dead"),{code:"ESRCH"});})():originalKill.call(process,pid,0)});
  try{await new RawFsAuthorityLedger(root,{now:()=>{semanticClockReads++;return t0;},lockTimeoutMs:200,faultInjector:(point:string)=>{if(point==="after-admission-prep-create")prepCreates++;if(point==="after-lock-publication-stage-create")publicationCreates++;if(point==="before-ledger-operation-callback")callbacks++;if(point==="after-pre-admission-housekeeping-root-sync")throw terminal;}} as never).observeClock();}catch(error){if(error!==terminal)throw error;}finally{Object.defineProperty(process,"kill",{configurable:true,value:originalKill});}
  assert.deepEqual({callbacks,semanticClockReads,prepCreates,publicationCreates},{callbacks:0,semanticClockReads:0,prepCreates:0,publicationCreates:0});assert.equal(existsSync(slot),false);assert.equal(existsSync(path.join(root,admissionRetiredName(owner,"abandoned"))),true);assert.deepEqual(await snapshotDurableSubtrees(root,semantic),before,"decisions, ingress, journal clock, transactions, claims, and tombstones retain exact bytes/topology");assert.deepEqual(await readJournalEvents(root),journalClockBefore,"semantic clock journal remains exact");
}));

test("pre-admission housekeeper preserves a live abandoned marker without ack as busy",()=>withRoot(async root=>{
  const owner={host:hostname(),nonce:"5".repeat(64),pid:process.pid,v:1 as const},markerName=admissionRetiredName(owner,"abandoned"),marker=path.join(root,markerName);await mkdir(marker);await writeFile(path.join(marker,"owner.json"),publicationOwnerBytes(owner));const before=await snapshotRootArtifacts(root);let callbacks=0,prepCreates=0;const result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="after-admission-prep-create")prepCreates++;if(point==="before-ledger-operation-callback")callbacks++;}} as never).observeClock();assert.deepEqual(result,{ok:false,reason:"busy"});assert.deepEqual({callbacks,prepCreates},{callbacks:0,prepCreates:0});assert.deepEqual(await snapshotRootArtifacts(root),before);
}));

test("withdrawn slot and creator-withdrawal cleanup recognizes exactly eight evidence-bound crash states",async t=>{
  const states=["slot-withdrawal","slot-withdrawal-slot-stage","slot-withdrawal-slot-ack","withdrawal-slot-ack","withdrawal-slot-ack-withdrawal-stage","withdrawal-both-acks","withdrawal-withdrawal-ack","orphan-withdrawal-ack"] as const;
  for(const [index,state] of states.entries())await t.test(state,()=>withRoot(async root=>{
    const owner={host:hostname(),nonce:(index+6).toString(16).repeat(64),pid:await exitedProcessPid(),v:1 as const},withdrawalName=creatorWithdrawalName(owner,"partial"),withdrawal=path.join(root,withdrawalName),slotName=admissionRetiredName(owner,"withdrawn"),slot=path.join(root,slotName);
    await mkdir(withdrawal);await writeFile(path.join(withdrawal,"owner.json"),ownerStateBytes(owner,"partial"));await mkdir(slot);await writeFile(path.join(slot,"owner.json"),publicationOwnerBytes(owner));
    const slotAck=slotCoordinationAck(owner,slotName,slot,"withdrawn",withdrawalName,ownerStateBytes(owner,"partial")),slotAckPath=path.join(root,coordinationAckName(slotAck)),slotStage=path.join(root,coordinationStageName(slotAck,"slot-retired"));
    if(state==="slot-withdrawal-slot-stage")await writeFile(slotStage,authorityCanonicalBytes(slotAck));
    if(!["slot-withdrawal","slot-withdrawal-slot-stage"].includes(state))await writeFile(slotAckPath,authorityCanonicalBytes(slotAck));
    if(["withdrawal-slot-ack","withdrawal-slot-ack-withdrawal-stage","withdrawal-both-acks","withdrawal-withdrawal-ack","orphan-withdrawal-ack"].includes(state))await rm(slot,{recursive:true});
    const withdrawalAck=incompleteCoordinationAck(owner,"creator-withdrawal",withdrawalName,publicationStageName({...owner,ticket:"0000000000000001"}),"partial",withdrawal,slotAck),withdrawalAckPath=path.join(root,coordinationAckName(withdrawalAck)),withdrawalStage=path.join(root,coordinationStageName(withdrawalAck,"creator-withdrawal"));
    if(state==="withdrawal-slot-ack-withdrawal-stage")await writeFile(withdrawalStage,authorityCanonicalBytes(withdrawalAck));
    if(["withdrawal-both-acks","withdrawal-withdrawal-ack","orphan-withdrawal-ack"].includes(state))await writeFile(withdrawalAckPath,authorityCanonicalBytes(withdrawalAck));
    if(["withdrawal-withdrawal-ack","orphan-withdrawal-ack"].includes(state))await rm(slotAckPath,{force:true});if(state==="orphan-withdrawal-ack")await rm(withdrawal,{recursive:true});
    let callbacks=0,result;for(let attempt=0;attempt<3;attempt++){result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:200,faultInjector:(point:string)=>{if(point==="before-ledger-operation-callback")callbacks++;}} as never).observeClock();if(result.ok||result.reason!=="busy")break;await new Promise(resolve=>setTimeout(resolve,100));}assert.deepEqual(result,{ok:true,status:"advanced",observedAt:new Date(t0).toISOString()},state);assert.equal(callbacks,1,state);for(const target of [slot,slotStage,slotAckPath,withdrawal,withdrawalStage,withdrawalAckPath])assert.equal(existsSync(target),false,`${state}:${path.basename(target)}`);
  }));
});

test("slot absence plus withdrawal without its bound retirement ack grants no cleanup authority",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"d".repeat(64),pid:process.pid,v:1 as const},withdrawal=await writeCreatorWithdrawal(root,owner,"partial"),before=await snapshotRootArtifacts(root);let callbacks=0,prepCreates=0;const result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="after-admission-prep-create")prepCreates++;if(point==="before-ledger-operation-callback")callbacks++;}} as never).observeClock();assert.deepEqual(result,{ok:false,reason:"corruption"});assert.deepEqual({callbacks,prepCreates},{callbacks:0,prepCreates:0});assert.deepEqual(await snapshotRootArtifacts(root),before);assert.equal(existsSync(withdrawal),true);}));

test("unrelated corrupt membership blocks every otherwise authorized housekeeper transition",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"e".repeat(64),pid:49302,v:1 as const},slot=await writeAdmissionSlot(root,owner),malformed=path.join(root,".authority-ledger-lock-publication-malformed.tmp"),originalKill=process.kill;await mkdir(malformed);const before=await snapshotRootArtifacts(root);let callbacks=0;Object.defineProperty(process,"kill",{configurable:true,value:(pid:number)=>pid===owner.pid?(()=>{throw Object.assign(new Error("dead"),{code:"ESRCH"});})():originalKill.call(process,pid,0)});let result;try{result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="before-ledger-operation-callback")callbacks++;}} as never).observeClock();}finally{Object.defineProperty(process,"kill",{configurable:true,value:originalKill});}assert.deepEqual(result,{ok:false,reason:"corruption"});assert.equal(callbacks,0);assert.deepEqual(await snapshotRootArtifacts(root),before);assert.equal(existsSync(slot),true);}));

test("publication identity comparison remains exact above Number.MAX_SAFE_INTEGER",async()=>{const publicAuthority=await import("../../src/authority/index.js") as Record<string,unknown>;assert.equal("__testSamePublicationFileIdentity" in publicAuthority,false);const hostModule=await import("../../src/authority/host/fs-ledger.js") as unknown as {__testSamePublicationFileIdentity?:(left:ExactFsIdentity,right:ExactFsIdentity)=>boolean},compare=hostModule.__testSamePublicationFileIdentity;assert.equal(typeof compare,"function");const adjacent=BigInt(Number.MAX_SAFE_INTEGER)+1n,left={dev:1n,ino:adjacent,mode:0o100600n,nlink:1n},right={...left,ino:adjacent+1n};assert.equal(Number(left.ino),Number(right.ino));assert.equal(compare!(left,right),false);});

test("signed Windows coordination identities remain exact local evidence",async()=>{type IdentityWire=Readonly<{dev:string;ino:string;mode:string;nlink:string}>;const publicAuthority=await import("../../src/authority/index.js") as Record<string,unknown>;for(const name of ["__testEncodeCoordinationIdentityWire","__testParseCoordinationIdentityWire","__testCoordinationIdentityMatches"])assert.equal(name in publicAuthority,false,`${name} remains host-private`);const hostModule=await import("../../src/authority/host/fs-ledger.js") as unknown as {__testEncodeCoordinationIdentityWire?:(raw:ExactFsIdentity)=>IdentityWire;__testParseCoordinationIdentityWire?:(wire:unknown)=>ExactFsIdentity;__testCoordinationIdentityMatches?:(wire:IdentityWire,raw:ExactFsIdentity)=>boolean},encode=hostModule.__testEncodeCoordinationIdentityWire,parse=hostModule.__testParseCoordinationIdentityWire,matches=hostModule.__testCoordinationIdentityMatches;if(typeof encode!=="function"||typeof parse!=="function"||typeof matches!=="function"){assert.fail("host-private coordination identity encode/parse/match seams are required");return;}const raw={dev:1324320917n,ino:-5004062135961710169n,mode:33206n,nlink:1n},adjacent={...raw,ino:raw.ino+1n},encoded=encode(raw),adjacentEncoded=encode(adjacent),unsignedAlias={...encoded,ino:BigInt.asUintN(64,raw.ino).toString(10)};assert.deepEqual(encoded,{dev:"1324320917",ino:"-5004062135961710169",mode:"33206",nlink:"1"});assert.deepEqual(parse(encoded),raw);assert.deepEqual(parse(adjacentEncoded),adjacent);assert.notEqual(authorityDigest(encoded),authorityDigest(adjacentEncoded));assert.equal(matches(encoded,raw),true);assert.equal(matches(encoded,adjacent),false);assert.equal(matches(unsignedAlias,raw),false);const invalid:unknown[]=[{...encoded,dev:"+1324320917"},{...encoded,ino:"-0"},{...encoded,ino:"01"},{...encoded,nlink:" 1"},{...encoded,dev:1324320917},{ino:encoded.ino,mode:encoded.mode,nlink:encoded.nlink},{...encoded,extra:"1"},{...encoded,dev:"-9223372036854775809"},{...encoded,ino:"18446744073709551616"},{...encoded,mode:"-1"},{...encoded,nlink:"18446744073709551616"},{...encoded,dev:"100000000000000000000"}];for(const value of invalid)assert.throws(()=>parse(value));assert.deepEqual(parse({dev:"-9223372036854775808",ino:"18446744073709551615",mode:"18446744073709551615",nlink:"0"}),{dev:-9223372036854775808n,ino:18446744073709551615n,mode:18446744073709551615n,nlink:0n});assert.throws(()=>encode({...raw,mode:-1n}));});

test("atomic admission revalidates owner bytes at every publication boundary",async t=>{
  const boundaries=["after-admission-prep-owner-sync","after-admission-prep-sync","before-admission-slot-rename","after-lock-publication-owner-sync","after-lock-publication-stage-sync","before-lock-publication-rename","after-lock-publication-rename","after-lock-publication-root-sync"] as const;
  for(const boundary of boundaries)await t.test(boundary,()=>withRoot(async root=>{let attempted=false,callbacks=0,semanticClockReads=0,replacementPath="";const replacement=Buffer.from(`replacement:${boundary}`),result=await new RawFsAuthorityLedger(root,{now:()=>{semanticClockReads++;return t0;},lockTimeoutMs:50,faultInjector:(point:string)=>{if(point==="before-ledger-operation-callback")callbacks++;if(point!==boundary||attempted)return;attempted=true;const names=readdirSync(root),prepBoundary=boundary.startsWith("after-admission-prep")||boundary==="before-admission-slot-rename",publishedBoundary=boundary==="after-lock-publication-rename"||boundary==="after-lock-publication-root-sync",container=prepBoundary?names.find(name=>name.startsWith(".authority-ledger-admission-prep-")&&!name.startsWith(".authority-ledger-admission-prep-retired-")):publishedBoundary?"lock":names.find(name=>name.startsWith(".authority-ledger-lock-publication-"));if(!container)return;const candidate=path.join(root,container,"owner.json");if(!existsSync(candidate))return;if(!prepBoundary){const slotOwner=path.join(root,".authority-ledger-admission-0","owner.json");if(!existsSync(slotOwner)||!readFileSync(slotOwner).equals(readFileSync(candidate)))return;}replacementPath=candidate;writeFileSync(replacementPath,replacement);}} as never).observeClock();assert.deepEqual(result,{ok:false,reason:"corruption"},boundary);assert.deepEqual({callbacks,semanticClockReads},{callbacks:0,semanticClockReads:0},boundary);assert.equal(Boolean(replacementPath)&&existsSync(replacementPath),true,`${boundary}: replacement remains at the selected owner path`);assert.deepEqual(readFileSync(replacementPath),replacement,boundary);assert.equal(existsSync(path.join(root,"lock"))&&boundary!=="after-lock-publication-rename"&&boundary!=="after-lock-publication-root-sync",false);}));
});

test("rename collision retains one synced creator stage and fixed slot across replacement classes",async t=>{
  for(const mutation of ["byte-mutation","same-byte-identity-replacement","type-replacement"] as const)await t.test(mutation,()=>withRoot(async root=>{
    const external=await tempRoot(),blocker={host:hostname(),nonce:"f".repeat(64),pid:process.pid,v:1 as const},blockerBytes=publicationOwnerBytes(blocker),replacement=Buffer.from(`collision-retained:${mutation}`),slotPath=path.join(root,".authority-ledger-admission-0");let stageCreates=0,collisions=0,publishedRenames=0,callbacks=0,stagePath="",stageIdentity:ExactFsIdentity|undefined,slotIdentity:ExactFsIdentity|undefined,originalOwnerBytes=Buffer.alloc(0);
    try{const result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:100,faultInjector:(point:string)=>{
      if(point==="after-admission-slot-root-sync"&&existsSync(slotPath))slotIdentity=exactFsIdentity(slotPath);
      if(point==="after-lock-publication-stage-create")stageCreates++;
      if(point==="after-lock-publication-stage-sync"&&!stagePath){const name=readdirSync(root).find(value=>value.startsWith(".authority-ledger-lock-publication-"));if(name){stagePath=path.join(root,name);stageIdentity=exactFsIdentity(stagePath);originalOwnerBytes=readFileSync(path.join(stagePath,"owner.json"));mkdirSync(path.join(root,"lock"));writeFileSync(path.join(root,"lock","owner.json"),blockerBytes);}}
      if(point==="after-lock-publication-rename-collision"&&stagePath){collisions++;const ownerPath=path.join(stagePath,"owner.json");if(mutation==="byte-mutation")writeFileSync(ownerPath,replacement);else if(mutation==="same-byte-identity-replacement"){renameSync(ownerPath,path.join(external,"displaced-owner"));writeFileSync(path.join(external,"replacement-owner"),originalOwnerBytes);renameSync(path.join(external,"replacement-owner"),ownerPath);}else{rmSync(ownerPath);mkdirSync(ownerPath);}rmSync(path.join(root,"lock"),{recursive:true});}
      if(point==="after-lock-publication-rename")publishedRenames++;if(point==="before-ledger-operation-callback")callbacks++;
    }} as never).observeClock();
    assert.deepEqual(result,{ok:false,reason:"corruption"},mutation);assert.deepEqual({stageCreates,collisions,publishedRenames,callbacks},{stageCreates:1,collisions:1,publishedRenames:0,callbacks:0},mutation);assert.equal((readdirSync(root).filter(name=>name.startsWith(".authority-ledger-lock-publication-")).length),1,mutation);assert.equal(Boolean(stagePath)&&existsSync(stagePath),true,mutation);assert.deepEqual(exactFsIdentity(stagePath),stageIdentity,`${mutation}: same stage identity`);assert.equal(existsSync(slotPath),true,`${mutation}: fixed slot remains`);assert.deepEqual(exactFsIdentity(slotPath),slotIdentity,`${mutation}: same fixed slot identity`);const ownerPath=path.join(stagePath,"owner.json");if(mutation==="byte-mutation")assert.deepEqual(readFileSync(ownerPath),replacement);else if(mutation==="same-byte-identity-replacement")assert.deepEqual(readFileSync(ownerPath),originalOwnerBytes);else assert.equal(lstatSync(ownerPath).isDirectory(),true);
    }finally{await rm(external,{recursive:true,force:true});}
  }));
});

test("whole-snapshot restart denies active-lock churn external dead-to-live change and slot replacement",async t=>{
  await t.test("sustained-active-lock-replacement",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"1".repeat(64),pid:process.pid,v:1 as const},bytes=publicationOwnerBytes(owner),lock=path.join(root,"lock"),external=await tempRoot();try{await mkdir(lock);await writeFile(path.join(lock,"owner.json"),bytes);let replacements=0,callbacks=0,prepCreates=0,publicationCreates=0;const result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="after-active-lock-metadata"){const next=path.join(external,`lock-${replacements++}`);mkdirSync(next);writeFileSync(path.join(next,"owner.json"),bytes);renameSync(lock,path.join(external,`old-${replacements}`));renameSync(next,lock);}if(point==="after-admission-prep-create")prepCreates++;if(point==="after-lock-publication-stage-create")publicationCreates++;if(point==="before-ledger-operation-callback")callbacks++;}} as never).observeClock();assert.deepEqual(result,{ok:false,reason:"busy"});assert.ok(replacements>1);assert.deepEqual({callbacks,prepCreates,publicationCreates},{callbacks:0,prepCreates:0,publicationCreates:0});assert.deepEqual(readFileSync(path.join(lock,"owner.json")),bytes);}finally{await rm(external,{recursive:true,force:true});}}));
  await t.test("external-stage-dead-to-live",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"2".repeat(64),pid:49303,v:1 as const,ticket:"0000000000000001"},bytes=publicationOwnerBytes(owner),stage=await writePublicationStage(root,owner,bytes),originalKill=process.kill;let probes=0,callbacks=0,prepCreates=0,publicationCreates=0;Object.defineProperty(process,"kill",{configurable:true,value:(pid:number)=>{if(pid!==owner.pid)return originalKill.call(process,pid,0);probes++;if(probes===1)throw Object.assign(new Error("dead"),{code:"ESRCH"});return true;}});let result;try{result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="after-admission-prep-create")prepCreates++;if(point==="after-lock-publication-stage-create")publicationCreates++;if(point==="before-ledger-operation-callback")callbacks++;}} as never).observeClock();}finally{Object.defineProperty(process,"kill",{configurable:true,value:originalKill});}assert.deepEqual(result,{ok:false,reason:"busy"});assert.ok(probes>=2);assert.deepEqual({callbacks,prepCreates,publicationCreates},{callbacks:0,prepCreates:0,publicationCreates:0});assert.equal(existsSync(stage),true);assert.deepEqual(await readFile(path.join(stage,"owner.json")),bytes);}));
  await t.test("fixed-slot-atomic-replacement",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"3".repeat(64),pid:process.pid,v:1 as const},slot=await writeAdmissionSlot(root,owner),bytes=publicationOwnerBytes(owner),external=await tempRoot();let replaced=false,callbacks=0,prepCreates=0;try{const result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="after-admission-slot-enumeration"&&!replaced){replaced=true;const next=path.join(external,"replacement-slot");mkdirSync(next);writeFileSync(path.join(next,"owner.json"),bytes);renameSync(slot,path.join(external,"original-slot"));renameSync(next,slot);}if(point==="after-admission-prep-create")prepCreates++;if(point==="before-ledger-operation-callback")callbacks++;}} as never).observeClock();assert.deepEqual(result,{ok:false,reason:"corruption"});assert.deepEqual({callbacks,prepCreates},{callbacks:0,prepCreates:0});assert.deepEqual(readFileSync(path.join(slot,"owner.json")),bytes);}finally{await rm(external,{recursive:true,force:true});}}));
});

test("typed housekeeping tombstones reject source-name reappearance at every closed snapshot",async t=>{
  const boundaries=["after-pre-admission-housekeeping-initial-enumeration","after-pre-admission-housekeeping-generation-closed","before-pre-admission-housekeeping-final-validation","after-pre-admission-housekeeping-marker-remove","after-pre-admission-housekeeping-marker-root-sync"] as const;
  for(const [index,boundary] of boundaries.entries())await t.test(boundary,()=>withRoot(async root=>{const external=await tempRoot(),owner={host:hostname(),nonce:(index+4).toString(16).repeat(64),pid:49310+index,v:1 as const},ownerBytes=publicationOwnerBytes(owner),markerName=admissionPrepRetiredName(owner,"complete"),marker=path.join(root,markerName),originalName=admissionPrepName(owner),original=path.join(root,originalName),originalKill=process.kill;try{await mkdir(marker);await writeFile(path.join(marker,"owner.json"),ownerBytes);const ack=incompleteCoordinationAck(owner,"prep-retired",markerName,originalName,"complete",marker),ackBytes=authorityCanonicalBytes(ack),ackPath=path.join(root,coordinationAckName(ack)),replacement=path.join(external,"replacement"),afterMarkerRemoval=boundary==="after-pre-admission-housekeeping-marker-remove"||boundary==="after-pre-admission-housekeeping-marker-root-sync";await writeFile(ackPath,ackBytes);await mkdir(replacement);await writeFile(path.join(replacement,"owner.json"),ownerBytes);let installed=false,callbacks=0,prepCreates=0;Object.defineProperty(process,"kill",{configurable:true,value:(pid:number)=>pid===owner.pid?(()=>{throw Object.assign(new Error("dead"),{code:"ESRCH"});})():originalKill.call(process,pid,0)});let result;try{result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:50,faultInjector:(point:string)=>{if(point===boundary&&!installed){assert.equal(existsSync(marker),!afterMarkerRemoval,`${boundary}: marker state is exact at the hook boundary`);if(!afterMarkerRemoval)assert.deepEqual(readFileSync(path.join(marker,"owner.json")),ownerBytes,`${boundary}: bound marker is byte-exact at the hook boundary`);assert.equal(existsSync(ackPath),true,`${boundary}: bound ack exists at the hook boundary`);assert.deepEqual(readFileSync(ackPath),ackBytes,`${boundary}: bound ack is byte-exact at the hook boundary`);installed=true;renameSync(replacement,original);}if(point==="after-admission-prep-create")prepCreates++;if(point==="before-ledger-operation-callback")callbacks++;}} as never).observeClock();}finally{Object.defineProperty(process,"kill",{configurable:true,value:originalKill});}if(!installed){assert.equal(installed,true,`${boundary}: closed-generation hook is emitted before admission can continue`);return;}assert.deepEqual(result,{ok:false,reason:"corruption"},boundary);assert.deepEqual({callbacks,prepCreates},{callbacks:0,prepCreates:0},boundary);assert.equal(existsSync(original),true,`${boundary}: canonical-same replacement remains at the retired original source name`);assert.deepEqual(await readFile(path.join(original,"owner.json")),ownerBytes,boundary);assert.equal(existsSync(marker),!afterMarkerRemoval,`${boundary}: marker presence matches its monotonic cleanup boundary`);if(!afterMarkerRemoval)assert.deepEqual(await readFile(path.join(marker,"owner.json")),ownerBytes,`${boundary}: still-present marker is byte-exact`);assert.equal(existsSync(ackPath),true,`${boundary}: typed ack survives source-name reappearance`);assert.deepEqual(await readFile(ackPath),ackBytes,`${boundary}: surviving typed ack is byte-exact`);}finally{Object.defineProperty(process,"kill",{configurable:true,value:originalKill});await rm(external,{recursive:true,force:true});}}));
});

test("unsafe NTFS identities cannot collapse same-byte owner-file or directory replacements",async t=>{
  type SyntheticPublicationStage=Readonly<{name:string;state:"complete";directoryIdentity:ExactFsIdentity;ownerIdentity:ExactFsIdentity;ownerBytes:Buffer}>;
  const publicAuthority=await import("../../src/authority/index.js") as Record<string,unknown>;assert.equal("__testSamePublicationStageSnapshot" in publicAuthority,false,"the stage comparator seam is host-private");const hostModule=await import("../../src/authority/host/fs-ledger.js") as unknown as {__testSamePublicationStageSnapshot?:(left:SyntheticPublicationStage,right:SyntheticPublicationStage)=>boolean},compare=hostModule.__testSamePublicationStageSnapshot,adjacent=BigInt(Number.MAX_SAFE_INTEGER)+1n,directory={dev:1n,ino:7n,mode:0o040700n,nlink:1n},ownerFile={dev:1n,ino:8n,mode:0o100600n,nlink:1n},bytes=Buffer.from("canonical-same-owner-bytes");
  for(const target of ["owner-file","directory"] as const)await t.test(target,()=>{const left:SyntheticPublicationStage={name:".authority-ledger-lock-publication-synthetic.tmp",state:"complete",directoryIdentity:target==="directory"?{...directory,ino:adjacent}:directory,ownerIdentity:target==="owner-file"?{...ownerFile,ino:adjacent}:ownerFile,ownerBytes:Buffer.from(bytes)},right:SyntheticPublicationStage={...left,directoryIdentity:target==="directory"?{...directory,ino:adjacent+1n}:directory,ownerIdentity:target==="owner-file"?{...ownerFile,ino:adjacent+1n}:ownerFile,ownerBytes:Buffer.from(bytes)};const leftChanged=target==="directory"?left.directoryIdentity:left.ownerIdentity,rightChanged=target==="directory"?right.directoryIdentity:right.ownerIdentity;assert.equal(Number(leftChanged.ino),Number(rightChanged.ino),`${target}: fixture proves unsafe Number rounding collapse`);assert.equal(typeof compare,"function",`${target}: host-private stage comparator seam exists`);assert.equal(compare!(left,right),false,`${target}: exact bigint identity replacement is not canonical-same`);});
});

test("pre-callback admission order closes and revalidates the synced generation",()=>withRoot(async root=>{const order:string[]=[];const expected=["slot-root-sync","stage-sync","lock-root-sync","slot-retire-root-sync","generation-closed","callback"];const result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:200,faultInjector:(point:string)=>{if(point==="after-admission-slot-root-sync")order.push("slot-root-sync");if(point==="after-lock-publication-stage-sync")order.push("stage-sync");if(point==="after-lock-publication-root-sync")order.push("lock-root-sync");if(point==="after-admission-slot-retire-root-sync")order.push("slot-retire-root-sync");if(point==="after-pre-callback-coordination-generation-closed")order.push("generation-closed");if(point==="before-ledger-operation-callback")order.push("callback");}} as never).observeClock();assert.deepEqual(result,{ok:true,status:"advanced",observedAt:new Date(t0).toISOString()});assert.deepEqual(order,expected);assert.equal((await readdir(root)).some(name=>name.startsWith(".authority-ledger-admission-")||name.startsWith(".authority-ledger-lock-publication-")||name.startsWith(".authority-ledger-coordination-cleanup-")),false);}));

async function exitedProcessPid():Promise<number>{return new Promise<number>((resolve,reject)=>{const child=spawn(process.execPath,["-e",""]);const pid=child.pid;child.once("error",reject);child.once("close",()=>{assert.ok(pid);resolve(pid);});});}
async function hardExitAtRequiredLedgerHook(root:string,target:string,tracked:readonly string[]):Promise<Readonly<{callbackEntered:boolean;code:number|null;order:string[]}>>{const control=await tempRoot(),log=path.join(control,"order.json"),callback=path.join(control,"callback");try{const moduleUrl=pathToFileURL(path.resolve("dist-test/src/authority/host/fs-ledger.js")).href,source=`import{writeFileSync}from"node:fs";import{FsAuthorityLedger}from ${JSON.stringify(moduleUrl)};const order=[],tracked=new Set(JSON.parse(process.argv[5]));const ledger=new FsAuthorityLedger(process.argv[1],{now:()=>${t0},lockTimeoutMs:200,faultInjector(point){if(tracked.has(point)){order.push(point);writeFileSync(process.argv[3],JSON.stringify(order));}if(point===process.argv[2])process.exit(97);if(point==="before-ledger-operation-callback")writeFileSync(process.argv[4],"entered");}});await ledger.observeClock();process.exit(92);`,code=await new Promise<number|null>((resolve,reject)=>{const child=spawn(process.execPath,["--input-type=module","-e",source,root,target,log,callback,JSON.stringify(tracked)],{stdio:"ignore"});child.once("error",reject);child.once("close",resolve);});return {callbackEntered:existsSync(callback),code,order:existsSync(log)?JSON.parse(await readFile(log,"utf8")):[]};}finally{await rm(control,{recursive:true,force:true});}}

test("before-housekeeping-transition is live and precedes any dead-slot mutation or callback",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"b".repeat(64),pid:await exitedProcessPid(),v:1 as const},slot=await writeAdmissionSlot(root,owner),before=await snapshotRootArtifacts(root),terminal={hook:"before-pre-admission-housekeeping-transition"},order:string[]=[];let thrown:unknown,callbacks=0;try{await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:200,faultInjector:(point:string)=>{if(["after-pre-admission-housekeeping-initial-enumeration","after-pre-admission-housekeeping-generation-closed","before-pre-admission-housekeeping-final-validation","before-pre-admission-housekeeping-transition"].includes(point))order.push(point);if(point==="before-pre-admission-housekeeping-transition")throw terminal;if(point==="before-ledger-operation-callback")callbacks++;}} as never).observeClock();}catch(error){thrown=error;}assert.equal(thrown,terminal);assert.deepEqual(order,["after-pre-admission-housekeeping-initial-enumeration","after-pre-admission-housekeeping-generation-closed","before-pre-admission-housekeeping-final-validation","before-pre-admission-housekeeping-transition"]);assert.equal(callbacks,0);assert.equal(existsSync(slot),true);assert.deepEqual(await snapshotRootArtifacts(root),before,"a pre-transition crash preserves the exact dead slot and all semantic state");}));

test("coordination cleanup stage write hooks are live and recover their exact crash windows",async t=>{for(const target of ["after-coordination-cleanup-stage-partial-write","after-coordination-cleanup-stage-file-sync"] as const)await t.test(target,()=>withRoot(async root=>{const owner={host:hostname(),nonce:(target.endsWith("partial-write")?"c":"d").repeat(64),pid:await exitedProcessPid(),v:1 as const},markerName=admissionPrepRetiredName(owner,"complete"),marker=path.join(root,markerName);await mkdir(marker);await writeFile(path.join(marker,"owner.json"),publicationOwnerBytes(owner));const ack=incompleteCoordinationAck(owner,"prep-retired",markerName,admissionPrepName(owner),"complete",marker),ackBytes=authorityCanonicalBytes(ack),stage=path.join(root,coordinationStageName(ack,"prep-retired")),finalAck=path.join(root,coordinationAckName(ack)),tracked=["after-coordination-cleanup-stage-create","after-coordination-cleanup-stage-partial-write","after-coordination-cleanup-stage-file-sync"],expected=target.endsWith("partial-write")?tracked.slice(0,2):tracked,result=await hardExitAtRequiredLedgerHook(root,target,tracked);if(result.code!==97){assert.equal(result.code,97,`${target} is emitted by the real cleanup write flow`);return;}assert.deepEqual(result.order,expected);assert.equal(result.callbackEntered,false);assert.equal(existsSync(marker),true);assert.equal(existsSync(finalAck),false);const stageBytes=await readFile(stage);if(target.endsWith("partial-write")){assert.ok(stageBytes.length>0&&stageBytes.length<ackBytes.length);assert.deepEqual(stageBytes,ackBytes.subarray(0,stageBytes.length));}else assert.deepEqual(stageBytes,ackBytes);const recovered=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:200}).recover();assert.equal(recovered.ok,true);assert.equal(existsSync(marker),false);assert.equal(existsSync(stage),false);assert.equal(existsSync(finalAck),false);}));});

test("coordination cleanup ack-removal hooks are live and leave only a valid next state",async t=>{for(const target of ["after-coordination-cleanup-ack-remove","after-coordination-cleanup-final-root-sync"] as const)await t.test(target,()=>withRoot(async root=>{const owner={host:hostname(),nonce:(target.endsWith("ack-remove")?"e":"f").repeat(64),pid:await exitedProcessPid(),v:1 as const},markerName=admissionPrepRetiredName(owner,"complete"),marker=path.join(root,markerName);await mkdir(marker);await writeFile(path.join(marker,"owner.json"),publicationOwnerBytes(owner));const ack=incompleteCoordinationAck(owner,"prep-retired",markerName,admissionPrepName(owner),"complete",marker),ackPath=path.join(root,coordinationAckName(ack));await writeFile(ackPath,authorityCanonicalBytes(ack));await rm(marker,{recursive:true});const tracked=["after-coordination-cleanup-ack-remove","after-coordination-cleanup-final-root-sync"],expected=target.endsWith("ack-remove")?tracked.slice(0,1):tracked,result=await hardExitAtRequiredLedgerHook(root,target,tracked);if(result.code!==97){assert.equal(result.code,97,`${target} is emitted after authenticated orphan-ack classification`);return;}assert.deepEqual(result.order,expected);assert.equal(result.callbackEntered,false);assert.equal(existsSync(marker),false);assert.equal(existsSync(ackPath),false);const recovered=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:200}).recover();assert.equal(recovered.ok,true);assert.equal((await readdir(root)).some(name=>name.startsWith(".authority-ledger-coordination-cleanup-")),false);}));});

test("active-lock content-read hook is live and refuses owner replacement",()=>withRoot(async root=>{const external=await tempRoot(),owner={host:hostname(),nonce:"1".repeat(64),pid:process.pid,v:1 as const},lock=path.join(root,"lock"),ownerPath=path.join(lock,"owner.json"),replacement=Buffer.from("active-lock-content-replacement"),order:string[]=[];let callbacks=0,publicationCreates=0,replaced=false;try{await mkdir(lock);await writeFile(ownerPath,publicationOwnerBytes(owner));const result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="after-active-lock-metadata")order.push(point);if(point==="before-active-lock-content-read"){order.push(point);replaced=true;renameSync(ownerPath,path.join(external,"original-owner"));writeFileSync(ownerPath,replacement);}if(point==="after-lock-publication-stage-create")publicationCreates++;if(point==="before-ledger-operation-callback")callbacks++;}} as never).observeClock();assert.deepEqual(order,["after-active-lock-metadata","before-active-lock-content-read"]);assert.equal(replaced,true);assert.deepEqual(result,{ok:false,reason:"corruption"});assert.deepEqual({callbacks,publicationCreates},{callbacks:0,publicationCreates:0});assert.deepEqual(await readFile(ownerPath),replacement);}finally{await rm(external,{recursive:true,force:true});}}));

test("publication-stage classification hooks are live and refuse same-name identity replacement",async t=>{for(const target of ["after-publication-stage-enumeration","before-publication-stage-validation"] as const)await t.test(target,()=>withRoot(async root=>{const external=await tempRoot(),owner={host:hostname(),nonce:(target.startsWith("after-")?"2":"3").repeat(64),pid:process.pid,v:1 as const,ticket:"0000000000000001"},bytes=publicationOwnerBytes(owner),stage=await writePublicationStage(root,owner,bytes),order:string[]=[];let callbacks=0,replaced=false;try{const result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="after-publication-stage-enumeration")order.push(point);if(point===target&&!replaced){replaced=true;if(target==="after-publication-stage-enumeration"){const replacement=path.join(external,"replacement-stage");mkdirSync(replacement);writeFileSync(path.join(replacement,"owner.json"),bytes);renameSync(stage,path.join(external,"original-stage"));renameSync(replacement,stage);}else{const ownerPath=path.join(stage,"owner.json"),replacement=path.join(external,"replacement-owner");writeFileSync(replacement,bytes);renameSync(ownerPath,path.join(external,"original-owner"));renameSync(replacement,ownerPath);}}if(point==="before-publication-stage-validation")order.push(point);if(point==="before-ledger-operation-callback")callbacks++;}} as never).observeClock();assert.equal(replaced,true,`${target} participates in classification`);assert.equal(order[0],"after-publication-stage-enumeration");assert.ok(order.slice(1).every(point=>point==="before-publication-stage-validation"));if(target==="before-publication-stage-validation")assert.ok(order.indexOf(target)>order.indexOf("after-publication-stage-enumeration"));assert.deepEqual(result,{ok:false,reason:"busy"});assert.equal(callbacks,0);assert.deepEqual(await readFile(path.join(stage,"owner.json")),bytes);}finally{await rm(external,{recursive:true,force:true});}}));});

const publicationStageConstructionFaultPoints=["after-lock-publication-stage-create","after-lock-publication-owner-create","after-lock-publication-owner-partial-write","after-lock-publication-owner-sync","after-lock-publication-stage-sync"] as const;
const publicationCrashPoints=[...publicationStageConstructionFaultPoints,"after-lock-publication-rename","after-lock-publication-root-sync"] as const;
const admissionPreparationFaultPoints=["after-admission-prep-create","after-admission-prep-owner-create","after-admission-prep-owner-partial-write","after-admission-prep-owner-sync","after-admission-prep-sync","before-admission-slot-rename","after-admission-slot-rename","after-admission-slot-root-sync","after-admission-slot-final-validation"] as const;
const closedClassificationHousekeepingFaultPoints=["after-admission-prep-enumeration","after-admission-slot-enumeration","after-pre-admission-housekeeping-initial-enumeration","after-pre-admission-housekeeping-generation-closed","before-pre-admission-housekeeping-final-validation","before-pre-admission-housekeeping-transition","after-pre-admission-housekeeping-root-sync","after-pre-admission-housekeeping-marker-remove","after-pre-admission-housekeeping-marker-root-sync"] as const;
const admissionSlotRetirementFaultPoints=["before-admission-slot-retire-rename","after-admission-slot-retire-rename","after-admission-slot-retire-root-sync","after-admission-slot-retire-cleanup-root-sync"] as const;
const creatorWithdrawalFaultPoints=["before-creator-withdrawal-seal","after-creator-withdrawal-seal","before-creator-withdrawal-rename","after-creator-withdrawal-rename","after-creator-withdrawal-root-sync","after-creator-withdrawal-cleanup-root-sync"] as const;
const coordinationCleanupFaultPoints=["after-coordination-cleanup-marker-enumeration","after-coordination-cleanup-stage-create","after-coordination-cleanup-stage-partial-write","after-coordination-cleanup-stage-file-sync","after-coordination-cleanup-ack-rename","after-coordination-cleanup-ack-root-sync","after-coordination-cleanup-marker-owner-remove","after-coordination-cleanup-marker-remove","after-coordination-cleanup-marker-root-sync","after-coordination-cleanup-ack-remove","after-coordination-cleanup-final-root-sync"] as const;
const publicationRenameAttemptFaultPoints=["before-lock-publication-rename","after-lock-publication-rename","after-lock-publication-root-sync","after-lock-publication-rename-collision"] as const;
const activeLockValidationFaultPoints=["after-active-lock-metadata","before-active-lock-content-read"] as const;
const publicationStageClassificationFaultPoints=["after-publication-stage-enumeration","before-publication-stage-validation"] as const;
const preCallbackGenerationClosureFaultPoints=["after-pre-callback-coordination-generation-closed"] as const;
const ledgerOperationCallbackFaultPoints=["before-ledger-operation-callback"] as const;
const k1LedgerLockFaultGroups=[admissionPreparationFaultPoints,closedClassificationHousekeepingFaultPoints,admissionSlotRetirementFaultPoints,creatorWithdrawalFaultPoints,coordinationCleanupFaultPoints,publicationStageConstructionFaultPoints,publicationRenameAttemptFaultPoints,activeLockValidationFaultPoints,publicationStageClassificationFaultPoints,preCallbackGenerationClosureFaultPoints,ledgerOperationCallbackFaultPoints,ledgerLockDurabilityPoints] as const;

async function hardExitAtPublicationPoint(root:string,point:typeof publicationCrashPoints[number]):Promise<Readonly<{code:number|null,pid:number}>>{
  const moduleUrl=pathToFileURL(path.resolve("dist-test/src/authority/host/fs-ledger.js")).href,source=`import {FsAuthorityLedger,__testK1AdmissionPreparationRuntimeOption} from ${JSON.stringify(moduleUrl)};const ledger=new FsAuthorityLedger(process.argv[1],{[__testK1AdmissionPreparationRuntimeOption]:${JSON.stringify(K1_ADMISSION_PREPARATION_LEGACY)},now:()=>${t0},faultInjector(observed){if(observed===process.argv[2])process.exit(93);}});await ledger.recover();process.exit(94);`;
  let childPid:number|undefined;
  const code=await new Promise<number|null>((resolve,reject)=>{const child=spawn(process.execPath,["--input-type=module","-e",source,root,point],{stdio:"ignore"});childPid=child.pid;child.on("error",reject);child.on("close",resolve);});
  assert.ok(Number.isSafeInteger(childPid));
  return {code,pid:childPid!};
}

test("ledger lock publication and whole-lock retirement expose the exact durability fault order",async()=>{
  await withRoot(async root=>{const observed:string[]=[];assert.equal((await new RawFsAuthorityLedger(root,{now:()=>t0,faultInjector:(point:string)=>{if((ledgerLockDurabilityPoints as readonly string[]).includes(point))observed.push(point);}} as never).recover()).ok,true);assert.deepEqual(observed,ledgerLockDurabilityPoints);});
});

test("interrupted ledger owner publication never leaves an ownerless active lock",async()=>{
  for(const point of ["after-owner-file-sync","after-lock-directory-sync"] as const)await withRoot(async root=>{let fired=false;const ledger=new RawFsAuthorityLedger(root,{now:()=>t0,faultInjector:(observed:string)=>{if(!fired&&observed===point){fired=true;throw new Error(`fault:${point}`);}}} as never);await assert.rejects(()=>ledger.recover(),new RegExp(`fault:${point}`));assert.equal(fired,true,point);assert.equal(existsSync(path.join(root,"lock")),false,point);});
});

test("publication cleanup never deletes a replacement ledger lock owner",async()=>{
  await withRoot(async root=>{const replacement=authorityCanonicalBytes({host:"replacement-host",nonce:"e".repeat(64),pid:process.pid,v:1});let fired=false,ownerPath="";const ledger=new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20,faultInjector:(point:string)=>{if(!fired&&point==="after-owner-file-sync"){fired=true;const stage=readdirSync(root).find(name=>/^\.authority-ledger-lock-publication-[0-9a-f]{64}-[0-9a-f]{16}-\d+-[0-9a-f]{64}\.tmp$/.test(name));assert.ok(stage);ownerPath=path.join(root,stage,"owner.json");writeFileSync(ownerPath,replacement);throw new Error("fault:replacement-owner");}}} as never);await assert.rejects(()=>ledger.recover(),/fault:replacement-owner/);assert.equal(fired,true);assert.deepEqual(await readFile(ownerPath),replacement,"cleanup must preserve a publication stage it no longer owns");assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20}).recover(),{ok:false,reason:"corruption"});assert.deepEqual(await readFile(ownerPath),replacement);});
});

test("owner publication hard-exit boundaries never expose an ownerless shared lock",{timeout:60_000},async t=>{
  for(const point of publicationCrashPoints)await t.test(point,()=>withRoot(async root=>{
    const child=await hardExitAtPublicationPoint(root,point);
    assert.equal(child.code,93,`${point} must be an exact product crash hook`);
    const names=await readdir(root),stages=names.filter(name=>/^\.authority-ledger-lock-publication-[0-9a-f]{64}-[0-9a-f]{16}-\d+-[0-9a-f]{64}\.tmp$/.test(name));
    const afterRename=point==="after-lock-publication-rename"||point==="after-lock-publication-root-sync";
    assert.equal(existsSync(path.join(root,"lock")),afterRename,`${point}: exact lock presence`);
    assert.equal(stages.length,afterRename?0:1,`${point}: exact publication-stage count`);
    if(afterRename){
      const bytes=await readFile(path.join(root,"lock","owner.json")),owner=JSON.parse(bytes.toString("utf8"));
      assert.deepEqual(bytes,authorityCanonicalBytes(owner),point);assert.equal(owner.host,hostname(),point);assert.equal(owner.pid,child.pid,point);assert.match(owner.nonce,/^[0-9a-f]{64}$/,point);
    }
    else{
      const match=/^\.authority-ledger-lock-publication-([0-9a-f]{64})-([0-9a-f]{16})-(\d+)-([0-9a-f]{64})\.tmp$/.exec(stages[0]);assert.ok(match);assert.equal(match[1],publicationHostDigest(hostname()),point);assert.match(match[2],/^[0-9a-f]{16}$/);assert.equal(Number(match[3]),child.pid,point);
      const entries=await readdir(path.join(root,stages[0]));
      if(point==="after-lock-publication-stage-create")assert.deepEqual(entries,[],point);
      else{
        assert.deepEqual(entries,["owner.json"],point);const bytes=await readFile(path.join(root,stages[0],"owner.json"));
        if(point==="after-lock-publication-owner-create")assert.equal(bytes.length,0,point);
        else if(point==="after-lock-publication-owner-partial-write"){assert.ok(bytes.length>0,point);assert.throws(()=>JSON.parse(bytes.toString("utf8")),point);}
        else{const owner=JSON.parse(bytes.toString("utf8"));assert.deepEqual(bytes,authorityCanonicalBytes(owner),point);assert.equal(owner.host,hostname(),point);assert.equal(owner.pid,child.pid,point);assert.equal(owner.nonce,match[4],point);}
      }
    }
    assert.equal((await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:200}).recover()).ok,true,`${point}: successor recovers exact publication state`);
    assert.equal(existsSync(path.join(root,"lock")),false,`${point}: successor retires its lock`);
    assert.equal((await readdir(root)).some(name=>name.startsWith(".authority-ledger-lock-publication-")),false,`${point}: successor services publication stage`);
  }));
});



test("failure before ledger lock retirement preserves the complete canonical active owner",async()=>{
  await withRoot(async root=>{let fired=false;const ledger=new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20,faultInjector:(point:string)=>{if(!fired&&point==="before-lock-retire"){fired=true;throw new Error("fault:before-lock-retire");}}} as never);assert.equal((await ledger.recover()).ok,true);assert.equal(fired,true);const ownerBytes=await readFile(path.join(root,"lock","owner.json")),owner=JSON.parse(ownerBytes.toString("utf8"));assert.deepEqual(Object.keys(owner).sort(),["host","nonce","pid","v"]);assert.deepEqual(ownerBytes,authorityCanonicalBytes(owner));assert.equal(owner.host,hostname());assert.equal(owner.pid,process.pid);assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20}).recover(),{ok:false,reason:"busy"});});
});

test("a crash after whole-lock retirement leaves a validated non-blocking tombstone for bounded cleanup",{timeout:30_000},async()=>{
  await withRoot(async root=>{const moduleUrl=pathToFileURL(path.resolve("dist-test/src/authority/host/fs-ledger.js")).href,childSource=`import {FsAuthorityLedger} from ${JSON.stringify(moduleUrl)};const ledger=new FsAuthorityLedger(process.argv[1],{now:()=>${t0},faultInjector(point){if(point==="after-lock-retire")process.exit(92);}});await ledger.recover();`;let childPid:number|undefined;const code=await new Promise<number|null>((resolve,reject)=>{const child=spawn(process.execPath,["--input-type=module","-e",childSource,root],{stdio:"ignore"});childPid=child.pid;child.on("error",reject);child.on("close",resolve);});assert.equal(code,92);assert.ok(Number.isSafeInteger(childPid));assert.equal(existsSync(path.join(root,"lock")),false,"atomic retirement never exposes an ownerless active lock");const retired=(await readdir(root)).filter(name=>/^\.authority-ledger-lock-\d+-[0-9a-f]{64}\.released$/.test(name));assert.equal(retired.length,1);const ownerBytes=await readFile(path.join(root,retired[0],"owner.json")),owner=JSON.parse(ownerBytes.toString("utf8"));assert.deepEqual(Object.keys(owner).sort(),["host","nonce","pid","v"]);assert.equal(owner.v,1);assert.equal(owner.host,hostname());assert.equal(owner.pid,childPid);assert.match(owner.nonce,/^[0-9a-f]{64}$/);assert.deepEqual(ownerBytes,authorityCanonicalBytes(owner));const match=/^\.authority-ledger-lock-(\d+)-([0-9a-f]{64})\.released$/.exec(retired[0]);assert.ok(match);assert.equal(Number(match[1]),owner.pid);assert.equal(match[2],owner.nonce);assert.equal((await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:200}).recover()).ok,true);assert.equal(existsSync(path.join(root,retired[0])),false,"validated released marker is cleaned before acquisition completes");});
});

test("ledger root audit refuses arbitrary and malformed lock-retirement tombstones",async()=>{
  for(const name of [".authority-ledger-lock-arbitrary.retired",`.authority-ledger-lock-999-${"a".repeat(64)}.retired`])await withRoot(async root=>{await mkdir(path.join(root,name));if(name.includes("-999-"))await writeFile(path.join(root,name,"owner.json"),"{");assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20}).recover(),{ok:false,reason:"corruption"},name);assert.equal(existsSync(path.join(root,name)),true,"unvalidated topology is never silently removed");});
});

test("canonical retired owner bytes that mismatch the tombstone name remain and fail closed",async()=>{
  await withRoot(async root=>{const name=`.authority-ledger-lock-999-${"a".repeat(64)}.retired`,directory=path.join(root,name),ownerBytes=authorityCanonicalBytes({host:hostname(),nonce:"b".repeat(64),pid:process.pid,v:1});await mkdir(directory);await writeFile(path.join(directory,"owner.json"),ownerBytes);assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20}).recover(),{ok:false,reason:"corruption"});assert.deepEqual(await readFile(path.join(directory,"owner.json")),ownerBytes);});
});

test("closed retirement dispositions reject unknown, malformed, mismatched, and extra-content markers",async()=>{
  const nonce="3".repeat(64),owner={host:hostname(),nonce,pid:process.pid,v:1};
  for(const name of [`.authority-ledger-lock-${owner.pid}-${nonce}.unknown`,`.authority-ledger-lock-${owner.pid}-${nonce}.recovery_pending`,`.authority-ledger-lock-${owner.pid}-${nonce}.recovery-pending.extra`])await withRoot(async root=>{const directory=path.join(root,name);await mkdir(directory);await writeFile(path.join(directory,"owner.json"),authorityCanonicalBytes(owner));assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20}).recover(),{ok:false,reason:"corruption"});assert.equal(existsSync(directory),true);});
  await withRoot(async root=>{const name=`.authority-ledger-lock-${owner.pid}-${nonce}.recovery-pending`,directory=path.join(root,name);await mkdir(directory);await writeFile(path.join(directory,"owner.json"),authorityCanonicalBytes({...owner,nonce:"4".repeat(64)}));assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20}).recover(),{ok:false,reason:"corruption"});assert.equal(existsSync(directory),true);});
  await withRoot(async root=>{const name=`.authority-ledger-lock-${owner.pid}-${nonce}.released`,directory=path.join(root,name);await mkdir(directory);await writeFile(path.join(directory,"owner.json"),authorityCanonicalBytes(owner));await writeFile(path.join(directory,"extra"),"unexpected");assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20}).recover(),{ok:false,reason:"corruption"});assert.equal(existsSync(directory),true);});
});

test("retirement marker owner links remain fail-closed and unmodified",async()=>{
  await withRoot(async root=>{const nonce="5".repeat(64),name=`.authority-ledger-lock-${process.pid}-${nonce}.publication-aborted`,directory=path.join(root,name),target=path.join(root,"transactions","marker-target");await mkdir(target,{recursive:true});await writeFile(path.join(target,"owner.json"),authorityCanonicalBytes({host:hostname(),nonce,pid:process.pid,v:1}));await symlink(target,directory,process.platform==="win32"?"junction":"dir");assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20}).recover(),{ok:false,reason:"corruption"});assert.equal(existsSync(directory),true);});
});

test("a hard-linked retirement owner fails closed and preserves both links",async()=>{
  await withRoot(async root=>{const externalRoot=await tempRoot();try{const owner={host:hostname(),nonce:"f".repeat(64),pid:process.pid,v:1 as const},markerName=retirementMarkerName(owner,"recovery-pending"),marker=path.join(root,markerName),external=path.join(externalRoot,"retired-owner-hardlink");await mkdir(marker);await writeFile(external,authorityCanonicalBytes(owner));const before=await readFile(external);await link(external,path.join(marker,"owner.json"));assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20}).recover(),{ok:false,reason:"corruption"});assert.equal(existsSync(marker),true,"untrusted marker is retained");assert.deepEqual(await readFile(path.join(marker,"owner.json")),before);assert.deepEqual(await readFile(external),before,"external inode bytes are untouched");}finally{await rm(externalRoot,{recursive:true,force:true});}});
});

test("cleanup acknowledgments reject malformed names, digests, bindings, heads, and reparse points",async()=>{
  const owner={host:hostname(),nonce:"6".repeat(64),pid:process.pid,v:1 as const},markerName=retirementMarkerName(owner,"released");
  const run=async(makeAck:(root:string)=>Promise<string>)=>withRoot(async root=>{const marker=path.join(root,markerName);await mkdir(marker);await writeFile(path.join(marker,"owner.json"),authorityCanonicalBytes(owner));const ackPath=await makeAck(root);assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20}).recover(),{ok:false,reason:"corruption"});assert.equal(existsSync(marker),true);assert.equal(existsSync(ackPath),true);});
  await run(async root=>{const target=path.join(root,".authority-ledger-lock-cleanup-short.ack");await writeFile(target,"{");return target;});
  await run(async root=>{const target=path.join(root,`.authority-ledger-lock-cleanup-${"0".repeat(64)}.ack`);await writeFile(target,"{");return target;});
  await run(async root=>{const ack=cleanupAck(owner,markerName,"released",null),target=path.join(root,`.authority-ledger-lock-cleanup-${"0".repeat(64)}.ack`);await writeFile(target,authorityCanonicalBytes(ack));return target;});
  await run(async root=>{const ack=cleanupAck(owner,`${markerName}.other`,"released",null),target=path.join(root,cleanupAckName(ack));await writeFile(target,authorityCanonicalBytes(ack));return target;});
  await run(async root=>{const ack={...cleanupAck(owner,markerName,"released",null),ownerDigest:digest("7")},target=path.join(root,`.authority-ledger-lock-cleanup-${authorityDigest(ack).slice(7)}.ack`);await writeFile(target,authorityCanonicalBytes(ack));return target;});
  const nestedOwnerCase=(mutate:(value:Record<string,unknown>)=>Record<string,unknown>)=>run(async root=>{const nested=mutate({host:owner.host,nonce:owner.nonce,pid:owner.pid,v:1}),ack={...cleanupAck(owner,markerName,"released",null),owner:nested,ownerDigest:authorityDigest(nested)},target=path.join(root,`.authority-ledger-lock-cleanup-${authorityDigest(ack).slice(7)}.ack`);await writeFile(target,authorityCanonicalBytes(ack));return target;});
  await nestedOwnerCase(value=>({...value,host:"foreign.invalid"}));
  await nestedOwnerCase(value=>({...value,pid:owner.pid+1}));
  await nestedOwnerCase(value=>{const copy={...value};delete copy.host;return copy;});
  await nestedOwnerCase(value=>({...value,unexpected:true}));
  await nestedOwnerCase(value=>({...value,v:2}));
  await withRoot(async root=>{const pending=retirementMarkerName(owner,"recovery-pending"),directory=path.join(root,pending),ack=cleanupAck(owner,pending,"recovery-pending",digest("8")),ackPath=path.join(root,cleanupAckName(ack));await mkdir(directory);await writeFile(path.join(directory,"owner.json"),authorityCanonicalBytes(owner));await writeFile(ackPath,authorityCanonicalBytes(ack));assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20}).recover(),{ok:false,reason:"corruption"});assert.equal(existsSync(ackPath),true);});
  await run(async root=>{const incomplete={disposition:"released",journalHead:null,markerName,v:"reelier.authority-ledger-lock-cleanup-ack/v1"},target=path.join(root,`.authority-ledger-lock-cleanup-${authorityDigest(incomplete).slice(7)}.ack`);await writeFile(target,authorityCanonicalBytes(incomplete));return target;});
  await run(async root=>{const base=cleanupAck(owner,markerName,"released",null),ack={...base,unexpected:true},target=path.join(root,`.authority-ledger-lock-cleanup-${authorityDigest(ack).slice(7)}.ack`);await writeFile(target,authorityCanonicalBytes(ack));return target;});
  await run(async root=>{const ack=cleanupAck(owner,markerName,"released",null),target=path.join(root,cleanupAckName(ack)),source=path.join(root,"transactions","ack-target");if(process.platform==="win32"){await mkdir(source,{recursive:true});await writeFile(path.join(source,"ack.json"),authorityCanonicalBytes(ack));await symlink(source,target,"junction");}else{await mkdir(path.dirname(source),{recursive:true});await writeFile(source,authorityCanonicalBytes(ack));await symlink(source,target,"file");}return target;});
  await run(async root=>{const ack=cleanupAck(owner,markerName,"released",null),target=path.join(root,cleanupAckName(ack)),source=path.join(root,"transactions","ack-hard-link");await mkdir(path.dirname(source),{recursive:true});await writeFile(source,authorityCanonicalBytes(ack));await link(source,target);return target;});
  await withRoot(async root=>{const malformed=path.join(root,".authority-ledger-lock-cleanup-orphan.ack");await writeFile(malformed,"{");assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20}).recover(),{ok:false,reason:"corruption"});assert.equal(existsSync(malformed),true);});
  await withRoot(async root=>{const mismatchedMarker=retirementMarkerName(owner,"recovery-pending"),ack=cleanupAck(owner,mismatchedMarker,"released",null),ackPath=path.join(root,cleanupAckName(ack));await writeFile(ackPath,authorityCanonicalBytes(ack));assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20}).recover(),{ok:false,reason:"corruption"});assert.equal(existsSync(ackPath),true);});
});

test("orphan cleanup acknowledgments authenticate their self-contained owner",async()=>{
  const owner={host:hostname(),nonce:"1".repeat(64),pid:process.pid,v:1 as const},markerName=retirementMarkerName(owner,"released");
  await withRoot(async root=>{const ack={...cleanupAck(owner,markerName,"released",null),ownerDigest:digest("7")},ackPath=path.join(root,cleanupAckName(ack));await writeFile(ackPath,authorityCanonicalBytes(ack));assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20}).recover(),{ok:false,reason:"corruption"});assert.equal(existsSync(ackPath),true);});
  await withRoot(async root=>{const mismatched={...owner,nonce:"2".repeat(64)},ack=cleanupAck(mismatched,markerName,"released",null),ackPath=path.join(root,cleanupAckName(ack));await writeFile(ackPath,authorityCanonicalBytes(ack));assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20}).recover(),{ok:false,reason:"corruption"});assert.equal(existsSync(ackPath),true);});
  const malformedOrphan=(nestedOwner:Record<string,unknown>,boundMarkerName=markerName)=>withRoot(async root=>{const ack={...cleanupAck(owner,boundMarkerName,"released",null),owner:nestedOwner,ownerDigest:authorityDigest(nestedOwner)},ackPath=path.join(root,`.authority-ledger-lock-cleanup-${authorityDigest(ack).slice(7)}.ack`),ackBytes=authorityCanonicalBytes(ack),markerPath=path.join(root,boundMarkerName);assert.equal(existsSync(markerPath),false,"fixture is a true orphan");await writeFile(ackPath,ackBytes);assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20}).recover(),{ok:false,reason:"corruption"});assert.equal(existsSync(markerPath),false);assert.deepEqual(await readFile(ackPath),ackBytes);});
  await malformedOrphan({...owner,host:"foreign.invalid"});
  await malformedOrphan({...owner,pid:owner.pid+1});
  const missingHost:Record<string,unknown>={...owner};delete missingHost.host;await malformedOrphan(missingHost);
  await malformedOrphan({...owner,unexpected:true});
});

test("pre-service confinement audit precedes retirement housekeeping",async()=>{
  await withRoot(async root=>{const initialized=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:200}).recover();assert.equal(initialized.ok,true);const external=await tempRoot();try{await rm(path.join(root,"journal"),{recursive:true});const sentinel=Buffer.from("external-journal-sentinel");await writeFile(path.join(external,"sentinel"),sentinel);await symlink(external,path.join(root,"journal"),process.platform==="win32"?"junction":"dir");const owner={host:hostname(),nonce:"3".repeat(64),pid:process.pid,v:1 as const},markerName=retirementMarkerName(owner,"released"),marker=path.join(root,markerName),ownerBytes=authorityCanonicalBytes(owner);await mkdir(marker);await writeFile(path.join(marker,"owner.json"),ownerBytes);assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20}).recover(),{ok:false,reason:"corruption"});assert.equal(existsSync(marker),true,"confinement failure must precede marker cleanup");assert.deepEqual(await readFile(path.join(marker,"owner.json")),ownerBytes);assert.deepEqual(await readFile(path.join(external,"sentinel")),sentinel);}finally{await rm(external,{recursive:true,force:true});}});
});

test("pre-service confinement preserves valid orphan and marker-bound acknowledgments",async()=>{
  await withRoot(async root=>{const initialized=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:200}).recover();assert.equal(initialized.ok,true);const external=await tempRoot();try{const orphanOwner={host:hostname(),nonce:"8".repeat(64),pid:process.pid,v:1 as const},orphanMarkerName=retirementMarkerName(orphanOwner,"released"),orphanAck=cleanupAck(orphanOwner,orphanMarkerName,"released",null),orphanAckPath=path.join(root,cleanupAckName(orphanAck)),markerOwner={host:hostname(),nonce:"9".repeat(64),pid:process.pid,v:1 as const},markerName=retirementMarkerName(markerOwner,"released"),marker=path.join(root,markerName),markerBytes=authorityCanonicalBytes(markerOwner),markerAck=cleanupAck(markerOwner,markerName,"released",null),markerAckPath=path.join(root,cleanupAckName(markerAck)),orphanBytes=authorityCanonicalBytes(orphanAck),markerAckBytes=authorityCanonicalBytes(markerAck),sentinel=Buffer.from("external-journal-with-acks");await writeFile(orphanAckPath,orphanBytes);await mkdir(marker);await writeFile(path.join(marker,"owner.json"),markerBytes);await writeFile(markerAckPath,markerAckBytes);await rm(path.join(root,"journal"),{recursive:true});await writeFile(path.join(external,"sentinel"),sentinel);await symlink(external,path.join(root,"journal"),process.platform==="win32"?"junction":"dir");assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20}).recover(),{ok:false,reason:"corruption"});assert.deepEqual(await readFile(orphanAckPath),orphanBytes);assert.deepEqual(await readFile(markerAckPath),markerAckBytes);assert.deepEqual(await readFile(path.join(marker,"owner.json")),markerBytes);assert.deepEqual(await readFile(path.join(external,"sentinel")),sentinel);}finally{await rm(external,{recursive:true,force:true});}});
});

test("owner-bound cleanup staging recovers create, partial-write, and file-sync crashes",async t=>{
  const owner={host:hostname(),nonce:"8".repeat(64),pid:process.pid,v:1 as const},markerName=retirementMarkerName(owner,"released"),ack=cleanupAck(owner,markerName,"released",null),stageName=cleanupStageName(owner,ack);
  for(const state of ["after-stage-create","after-stage-partial-write","after-stage-file-sync"] as const)await t.test(state,()=>withRoot(async root=>{const marker=path.join(root,markerName),stage=path.join(root,stageName);await mkdir(marker);await writeFile(path.join(marker,"owner.json"),authorityCanonicalBytes(owner));await writeFile(stage,state==="after-stage-create"?Buffer.alloc(0):state==="after-stage-partial-write"?Buffer.from("{"):authorityCanonicalBytes(ack));const recovered=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:200}).recover();assert.equal(recovered.ok,true,state);assert.equal(existsSync(marker),false,state);assert.equal(existsSync(stage),false,state);}));
});

test("cleanup staging rejects malformed, mismatched, orphaned, and duplicate artifacts",async()=>{
  const owner={host:hostname(),nonce:"9".repeat(64),pid:process.pid,v:1 as const},markerName=retirementMarkerName(owner,"released"),ack=cleanupAck(owner,markerName,"released",null),exact=cleanupStageName(owner,ack);
  const run=async(names:string[])=>withRoot(async root=>{const marker=path.join(root,markerName);await mkdir(marker);await writeFile(path.join(marker,"owner.json"),authorityCanonicalBytes(owner));for(const name of names)await writeFile(path.join(root,name),authorityCanonicalBytes(ack));assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20}).recover(),{ok:false,reason:"corruption"});for(const name of names)assert.equal(existsSync(path.join(root,name)),true);});
  await run([".authority-ledger-lock-cleanup-stage-short.tmp"]);
  await run([`.authority-ledger-lock-cleanup-stage-${owner.pid}-${owner.nonce}-${"0".repeat(64)}.tmp`]);
  await run([`.authority-ledger-lock-cleanup-stage-${owner.pid+1}-${owner.nonce}-${authorityDigest(ack).slice(7)}.tmp`]);
  await run([exact,`.authority-ledger-lock-cleanup-stage-${owner.pid}-${owner.nonce}-${"0".repeat(64)}.tmp`]);
  await withRoot(async root=>{const stage=path.join(root,exact);await writeFile(stage,authorityCanonicalBytes(ack));assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20}).recover(),{ok:false,reason:"corruption"});assert.equal(existsSync(stage),true);});
});

test("the exact expected cleanup stage path rejects directories, links, and reparse points without target mutation",async t=>{
  const owner={host:hostname(),nonce:"a".repeat(64),pid:process.pid,v:1 as const},markerName=retirementMarkerName(owner,"released"),ack=cleanupAck(owner,markerName,"released",null),stageName=cleanupStageName(owner,ack),sentinel=Buffer.from("external-stage-target");
  const run=async(kind:"directory"|"hardlink"|"reparse")=>withRoot(async root=>{const marker=path.join(root,markerName),stage=path.join(root,stageName),external=path.join(root,"transactions",`stage-${kind}`);await mkdir(marker);await writeFile(path.join(marker,"owner.json"),authorityCanonicalBytes(owner));await mkdir(path.dirname(external),{recursive:true});if(kind==="directory"){await mkdir(stage);await writeFile(path.join(stage,"sentinel"),sentinel);}else if(kind==="hardlink"){await writeFile(external,sentinel);await link(external,stage);}else if(process.platform==="win32"){await mkdir(external);await writeFile(path.join(external,"sentinel"),sentinel);await symlink(external,stage,"junction");}else{await writeFile(external,sentinel);await symlink(external,stage,"file");}assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20}).recover(),{ok:false,reason:"corruption"});const observed=kind==="directory"?await readFile(path.join(stage,"sentinel")):kind==="reparse"&&process.platform==="win32"?await readFile(path.join(external,"sentinel")):await readFile(external);assert.deepEqual(observed,sentinel,kind);});
  for(const kind of ["directory","hardlink","reparse"] as const)await t.test(kind,()=>run(kind));
});

test("valid cleanup acknowledgments recover every marker-removal crash window",async t=>{
  const owner={host:hostname(),nonce:"7".repeat(64),pid:process.pid,v:1 as const},markerName=retirementMarkerName(owner,"released"),ack=cleanupAck(owner,markerName,"released",null),ackName=cleanupAckName(ack);
  for(const state of ["after-ack-rename","after-ack-root-sync","during-marker-removal","after-marker-sync"] as const)await t.test(state,()=>withRoot(async root=>{const marker=path.join(root,markerName),ackPath=path.join(root,ackName);if(state!=="after-marker-sync"){await mkdir(marker);if(state!=="during-marker-removal")await writeFile(path.join(marker,"owner.json"),authorityCanonicalBytes(owner));}await writeFile(ackPath,authorityCanonicalBytes(ack));const recovered=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:200}).recover();assert.equal(recovered.ok,true,state);assert.equal(existsSync(marker),false,state);assert.equal(existsSync(ackPath),false,state);}));
});

test("recovery-pending cleanup accepts exact non-null journal-head acknowledgments",async t=>{
  for(const state of ["complete-stage","partial-marker-final-ack","orphan-final-ack"] as const)await t.test(state,()=>withRoot(async root=>{const ledger=new FsAuthorityLedger(root,{now:()=>t0}),reserved=await ledger.reserve(intent());assert.equal(reserved.ok,true);const journalNames=(await readdir(path.join(root,"journal"))).sort(),headEvent=JSON.parse(await readFile(path.join(root,"journal",journalNames.at(-1)!),"utf8")),journalHead=authorityDigest(headEvent);for(const name of await readdir(root))if(/^\.authority-ledger-lock-/.test(name))await rm(path.join(root,name),{recursive:true});const owner={host:hostname(),nonce:"b".repeat(64),pid:process.pid,v:1 as const},markerName=retirementMarkerName(owner,"recovery-pending"),marker=path.join(root,markerName),ack=cleanupAck(owner,markerName,"recovery-pending",journalHead),ackPath=path.join(root,cleanupAckName(ack)),stage=path.join(root,cleanupStageName(owner,ack));if(state!=="orphan-final-ack"){await mkdir(marker);if(state==="complete-stage")await writeFile(path.join(marker,"owner.json"),authorityCanonicalBytes(owner));}if(state==="complete-stage")await writeFile(stage,authorityCanonicalBytes(ack));else await writeFile(ackPath,authorityCanonicalBytes(ack));const recovered=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:200}).recover();assert.equal(recovered.ok,true,state);assert.equal(existsSync(marker),false,state);assert.equal(existsSync(stage),false,state);assert.equal(existsSync(ackPath),false,state);}));
});

test("a validated retired lock from a proved-dead owner hands recovery to its successor",async()=>{
  await withRoot(async root=>{const ledger=new FsAuthorityLedger(root,{now:()=>t0});const reserved=await ledger.reserve(intent());assert.equal(reserved.ok,true);if(!reserved.ok)return;assert.equal((await ledger.transition(reserved.reservation.reservationId,"reserved",{to:"dispatched"})).ok,true);await seedDeadActiveLock(root);const successor=new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:200});assert.equal((await successor.observeClock()).ok,true);assert.equal((await successor.getReservation(reserved.reservation.reservationId))?.state,"ambiguous");});
});

test("recovery evidence remains durable when its first successor faults before prepare",{timeout:30_000},async()=>{
  await withRoot(async root => {
    const ledger = new FsAuthorityLedger(root, { now: () => t0 });
    const reserved = await ledger.reserve(intent());
    assert.equal(reserved.ok, true); if (!reserved.ok) return;
    assert.equal((await ledger.transition(reserved.reservation.reservationId, "reserved", { to: "dispatched" })).ok, true);
    await seedDeadActiveLock(root);
    const moduleUrl = pathToFileURL(path.resolve("dist-test/src/authority/host/fs-ledger.js")).href;
    const source = `import {FsAuthorityLedger} from ${JSON.stringify(moduleUrl)};let fired=false;const ledger=new FsAuthorityLedger(process.argv[1],{now:()=>${t0},faultInjector(point){if(!fired&&point==="after-lock-acquire"){fired=true;throw new Error("fault:after-recovery-evidence");}}});try{await ledger.getReservation(${JSON.stringify(reserved.reservation.reservationId)});process.exit(94);}catch(error){if(!fired||String(error)!=="Error: fault:after-recovery-evidence")process.exit(93);process.stdout.write("exact-fault\\n");setInterval(()=>{},1_000);}`;
    const child = spawn(process.execPath, ["--input-type=module", "-e", source, root], { stdio: ["ignore", "pipe", "ignore"] });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("fault child handshake timed out")), 5_000);
        let output = "";
        child.stdout.setEncoding("utf8").on("data", chunk => { output += chunk; if (output === "exact-fault\n") { clearTimeout(timer); resolve(); } });
        child.on("error", error => { clearTimeout(timer); reject(error); });
        child.on("close", code => { clearTimeout(timer); reject(new Error(`fault child exited early: ${code}`)); });
      });
      const successor = new RawFsAuthorityLedger(root, { now: () => t0, lockTimeoutMs: 200 });
      assert.equal((await successor.observeClock()).ok, true);
      assert.equal((await successor.getReservation(reserved.reservation.reservationId))?.state, "ambiguous");
    } finally { child.kill(); }
  });
});

test("an ingress-only callback cannot bypass pending ledger recovery",async()=>{
  await withRoot(async root=>{const ledger=new FsAuthorityLedger(root,{now:()=>t0});const candidate=intent(),reserved=await ledger.reserve(candidate);assert.equal(reserved.ok,true);if(!reserved.ok)return;assert.equal((await ledger.transition(reserved.reservation.reservationId,"reserved",{to:"dispatched"})).ok,true);await seedDeadActiveLock(root);const successor=new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:200});assert.ok(await successor.lookupIngress(candidate.requestKey));assert.equal((await successor.getReservation(reserved.reservation.reservationId))?.state,"ambiguous");});
});

test("durable recovery-pending disposition overrides a currently live reused pid",async()=>{
  await withRoot(async root => {
    const ledger = new FsAuthorityLedger(root, { now: () => t0 });
    const reserved = await ledger.reserve(intent());
    assert.equal(reserved.ok, true); if (!reserved.ok) return;
    assert.equal((await ledger.transition(reserved.reservation.reservationId, "reserved", { to: "dispatched" })).ok, true);
    for (const name of await readdir(root)) if (/^\.authority-ledger-lock-/.test(name)) await rm(path.join(root, name), { recursive: true });
    const owner = { host: hostname(), nonce: "1".repeat(64), pid: process.pid, v: 1 };
    const marker = `.authority-ledger-lock-${owner.pid}-${owner.nonce}.recovery-pending`;
    await mkdir(path.join(root, marker));
    await writeFile(path.join(root, marker, "owner.json"), authorityCanonicalBytes(owner));
    const successor = new RawFsAuthorityLedger(root, { now: () => t0, lockTimeoutMs: 200 });
    assert.equal((await successor.observeClock()).ok, true, "durable disposition, not current PID liveness, controls recovery");
    assert.equal((await successor.getReservation(reserved.reservation.reservationId))?.state, "ambiguous");
  });
});

test("a partial durable recovery is acknowledged before exact evidence cleanup",{timeout:30_000},async()=>{
  await withRoot(async root => {
    const ledger = new FsAuthorityLedger(root, { now: () => t0 });
    const first = await ledger.reserve(intent());
    const secondCandidate=intent({requestId:"request_2",capabilityId:"capability_2",outcomeKey:digest("8"),effectDigest:digest("9"),sourceBundleDigest:digest("e"),sourceSnapshotDigest:digest("f"),limitSlots:[{kind:"contract-window",key:digest("5"),maximum:2},{kind:"source-trigger",key:digest("2"),maximum:1}]});
    const second = await ledger.reserve(secondCandidate);
    assert.equal(first.ok, true); assert.equal(second.ok, true); if (!first.ok || !second.ok) return;
    assert.equal((await ledger.transition(first.reservation.reservationId, "reserved", { to: "dispatched" })).ok, true);
    assert.equal((await ledger.transition(second.reservation.reservationId, "reserved", { to: "dispatched" })).ok, true);
    await seedDeadActiveLock(root);
    const moduleUrl=pathToFileURL(path.resolve("dist-test/src/authority/host/fs-ledger.js")).href;
    const childSource=`import {FsAuthorityLedger} from ${JSON.stringify(moduleUrl)};const ledger=new FsAuthorityLedger(process.argv[1],{now:()=>${t0},faultInjector(point){if(point==="result-after-directory-sync")process.exit(95);}});await ledger.observeClock();process.exit(96);`;
    const code=await new Promise<number|null>((resolve,reject)=>{const child=spawn(process.execPath,["--input-type=module","-e",childSource,root],{stdio:"ignore"});child.on("error",reject);child.on("close",resolve);});
    assert.equal(code,95,"child exits only after the first ambiguous transition is directory-synced");
    const readEvents=async()=>Promise.all((await readdir(path.join(root,"journal"))).map(async name=>JSON.parse(await readFile(path.join(root,"journal",name),"utf8"))));
    const countAmbiguous=async(reservationId:string)=>(await readEvents()).filter(event=>event.type==="transition"&&event.to==="ambiguous"&&event.reservationId===reservationId).length;
    assert.equal(await countAmbiguous(first.reservation.reservationId),1,"the first recovery transition is durable exactly once");
    assert.equal(await countAmbiguous(second.reservation.reservationId),0,"the hard exit precedes the second recovery transition");
    assert.equal((await readdir(root)).some(name=>name.endsWith(".recovery-pending")),true,"unacknowledged recovery disposition remains durable");
    const successor = new RawFsAuthorityLedger(root, { now: () => t0 });
    assert.equal((await successor.observeClock()).ok, true);
    assert.equal((await successor.getReservation(first.reservation.reservationId))?.state,"ambiguous");
    assert.equal((await successor.getReservation(second.reservation.reservationId))?.state,"ambiguous");
    assert.equal(await countAmbiguous(first.reservation.reservationId),1,"recovery replay never duplicates the first transition");
    assert.equal(await countAmbiguous(second.reservation.reservationId),1,"the successor completes the remaining transition");
    assert.equal((await readdir(root)).some(name=>name.endsWith(".recovery-pending")),false,"exact evidence is cleaned only after durable acknowledgment");
  });
});

test("a proved-dead same-host lock is reclaimed and recovery runs before reservation", async () => {
  await withRoot(async root => {
    await mkdir(path.join(root, "lock"));
    await writeFile(path.join(root, "lock", "owner.json"), JSON.stringify({ host: hostname(), nonce: "c".repeat(64), pid: 2_147_483_647, v: 1 }));
    const ledger = new FsAuthorityLedger(root, { now: () => t0, lockTimeoutMs: 100 });
    const result = await ledger.reserve(intent());
    assert.equal(result.ok, true);
    const recovered = await ledger.recover();
    assert.equal(recovered.ok, true);
    if (recovered.ok) assert.equal(recovered.reservations.length, 1);
  });
});

test("a crash-held lock is reclaimed only after the child process is proved dead", { timeout: 30_000 }, async () => {
  await withRoot(async root => {
    const moduleUrl = pathToFileURL(path.join(process.cwd(), "dist-test/src/authority/host/fs-ledger.js")).href;
    const childSource = `
      import { FsAuthorityLedger } from ${JSON.stringify(moduleUrl)};
      const ledger = new FsAuthorityLedger(process.argv[1], { now: () => ${t0}, faultInjector(point) {
        if (point === "after-lock-acquire") process.exit(91);
      }});
      await ledger.recover();
    `;
    const code = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", childSource, root], { stdio: "ignore" });
      child.on("error", reject);
      child.on("close", resolve);
    });
    assert.equal(code, 91);
    const result = await new FsAuthorityLedger(root, { now: () => t0, lockTimeoutMs: 200 }).recover();
    assert.equal(result.ok, true);
  });
});

test("bindIngress atomically elects one exact owner and aliases or bytes cannot reuse its tuple", async () => {
  await withRoot(async root => {
    const ledger = new FsAuthorityLedger(root, { now: () => t0 });
    const exact = authenticateOutcomeRequest({ tenant: "tenant_1", requester: "requester_1", definitionAlias: "definition_1", request: { v: "reelier.outcome-request/v1", requestId: "request_1", sourceRefs: { source: "ref_1" }, choices: {} } });
    const results = await Promise.all(Array.from({ length: 100 }, () => ledger.bindIngress(exact)));
    assert.equal(results.filter(result => result.ok && result.status === "claimed").length, 1);
    assert.equal(results.filter(result => result.ok && result.status === "exact-existing").length, 99);
    const owner = results.find(result => result.ok && result.status === "claimed");assert.ok(owner?.ok);if(!owner?.ok)return;const ownerDigest=owner.ingressClaimDigest;
    assert.ok(results.every(result => "ingressClaimDigest" in result && result.ingressClaimDigest === ownerDigest));
    const aliasConflict = authenticateOutcomeRequest({ tenant: "tenant_1", requester: "requester_1", definitionAlias: "definition_2", request: { v: "reelier.outcome-request/v1", requestId: "request_1", sourceRefs: { source: "ref_1" }, choices: {} } });
    const bodyConflict = authenticateOutcomeRequest({ tenant: "tenant_1", requester: "requester_1", definitionAlias: "definition_1", request: { v: "reelier.outcome-request/v1", requestId: "request_1", sourceRefs: { source: "other" }, choices: {} } });
    assert.deepEqual(await ledger.bindIngress(aliasConflict), { ok: false, reason: "conflict", evaluationEligible: false, ingressClaimDigest: ownerDigest });
    assert.deepEqual(await ledger.bindIngress(bodyConflict), { ok: false, reason: "conflict", evaluationEligible: false, ingressClaimDigest: ownerDigest });
    assert.deepEqual(await ledger.lookupIngress(authenticatedOutcomeRequestState(exact).requestKey), { requestId: "request_1", requestKey: authenticatedOutcomeRequestState(exact).requestKey, definitionAlias: "definition_1", ingressClaimDigest: ownerDigest, bindingStatus: "bound" });
    assert.deepEqual(await readdir(path.join(root,"ingress")),[`${authenticatedOutcomeRequestState(exact).requestKey.slice(7)}.json`]);
    assert.deepEqual(await readdir(path.join(root, "transactions")).catch(() => []), []);
    assert.deepEqual(await readdir(path.join(root, "journal")).catch(() => []), []);
  });
});

test("observeClock durably advances, is idempotent at equality, and refuses rollback or invalid clocks", async () => {
  await withRoot(async root => {
    let now = t0;
    const ledger = new FsAuthorityLedger(root, { now: () => now });
    assert.deepEqual(await ledger.observeClock(), { ok: true, status: "advanced", observedAt: new Date(t0).toISOString() });
    assert.deepEqual(await ledger.observeClock(), { ok: true, status: "equal", observedAt: new Date(t0).toISOString() });
    now--;
    assert.deepEqual(await ledger.observeClock(), { ok: false, reason: "clock-rollback" });
    const restarted=await new FsAuthorityLedger(root,{now:()=>t0}).observeClock();assert.equal(restarted.ok,true);if(restarted.ok)assert.equal(restarted.status,"equal");
  });
  await withRoot(async root => assert.deepEqual(await new FsAuthorityLedger(root, { now: () => Number.NaN }).observeClock(), { ok: false, reason: "clock-unavailable" }));
  await withRoot(async root => assert.deepEqual(await new FsAuthorityLedger(root, { now: () => Number.MAX_SAFE_INTEGER }).observeClock(), { ok: false, reason: "clock-unavailable" }));
  await withRoot(async root => assert.deepEqual(await new FsAuthorityLedger(root, { now: () => { throw new Error("clock"); } }).observeClock(), { ok: false, reason: "clock-unavailable" }));
});

test("reserve requires the exact live ingress claim before writing any transaction", async () => {
  await withRoot(async root => {
    const authenticated = authenticateOutcomeRequest({ tenant: "tenant_1", requester: "requester_1", definitionAlias: "definition_1", request: { v: "reelier.outcome-request/v1", requestId: "request_1", sourceRefs: { source: "ref_1" }, choices: {} } });
    const state = authenticatedOutcomeRequestState(authenticated);
    const candidate = intent({ requestKey: state.requestKey, requestDigest: state.requestDigest, canonicalRequestBytes: Buffer.from(state.canonicalRequestBase64, "base64") });
    assert.deepEqual(await new RawFsAuthorityLedger(root, { now: () => t0 }).reserve({ ...candidate, ingressClaimDigest: digest("9") }), { ok: false, reason: "integrity-failure" });
    assert.deepEqual(await readdir(path.join(root, "transactions")).catch(() => []), []);
    const bound = await new FsAuthorityLedger(root, { now: () => t0 }).bindIngress(authenticated);
    assert.equal(bound.ok, true); if (!bound.ok) return;
    assert.equal((await new FsAuthorityLedger(root, { now: () => t0 }).reserve({ ...candidate, ingressClaimDigest: bound.ingressClaimDigest })).ok, true);
  });
});

test("new ingress, clock, and ledger-lock fault-point sets are complete and disjoint", () => {
  assert.deepEqual(ingressFaultPoints, ["ingress-before-create","ingress-after-create","ingress-before-write","ingress-after-write","ingress-before-file-sync","ingress-after-file-sync","ingress-before-close","ingress-after-close","ingress-before-directory-sync","ingress-after-directory-sync"]);
  assert.deepEqual(clockFaultPoints, ["clock-before-clock-high-water-write","clock-after-clock-high-water-write","clock-before-create","clock-after-create","clock-before-write","clock-after-write","clock-before-file-sync","clock-after-file-sync","clock-before-close","clock-after-close","clock-before-directory-sync","clock-after-directory-sync"]);
  const expectedLedgerLockFaultPoints=k1LedgerLockFaultGroups.flat();assert.equal(new Set(expectedLedgerLockFaultPoints).size,expectedLedgerLockFaultPoints.length,"K=1 fault groups are exact and disjoint");assert.deepEqual(ledgerLockFaultPoints,expectedLedgerLockFaultPoints,"production exposes the complete K=1 fault surface, not legacy election machinery");
  const all=[...reservationFaultPoints,...dispatchFaultPoints,...resultFaultPoints,...ingressFaultPoints,...clockFaultPoints,...ledgerLockFaultPoints];
  assert.equal(new Set(all).size,all.length);
  assert.deepEqual([...all].sort(),[...ledgerFaultPoints].sort());
});

test("every ingress and standalone-clock crash boundary recovers only prior, committed, or corruption",{timeout:120_000},async()=>{
  const authenticated=authenticateOutcomeRequest({tenant:"tenant_1",requester:"requester_1",definitionAlias:"definition_1",request:{v:"reelier.outcome-request/v1",requestId:"request_1",sourceRefs:{source:"ref_1"},choices:{}}});
  for(const point of ingressFaultPoints)await withRoot(async root=>{let fired=false;const crashing=new RawFsAuthorityLedger(root,{now:()=>t0,faultInjector(observed){if(!fired&&observed===point){fired=true;throw new Error(`fault:${point}`);}}});try{await crashing.bindIngress(authenticated);}catch(error){assert.match(String(error),/fault:/);}assert.equal(fired,true,point);const recovered=await new RawFsAuthorityLedger(root,{now:()=>t0}).recover();if(!recovered.ok)assert.equal(recovered.reason,"corruption");else{const lookup=await new RawFsAuthorityLedger(root,{now:()=>t0}).lookupIngress(authenticatedOutcomeRequestState(authenticated).requestKey);assert.ok(lookup===undefined||lookup.bindingStatus==="bound");}});
  for(const point of clockFaultPoints)await withRoot(async root=>{assert.equal((await new RawFsAuthorityLedger(root,{now:()=>t0}).observeClock()).ok,true);let fired=false;const crashing=new RawFsAuthorityLedger(root,{now:()=>t0+1,faultInjector(observed){if(!fired&&observed===point){fired=true;throw new Error(`fault:${point}`);}}});try{await crashing.observeClock();}catch(error){assert.match(String(error),/fault:/);}assert.equal(fired,true,point);const recovered=await new RawFsAuthorityLedger(root,{now:()=>t0+1}).recover();if(!recovered.ok)assert.equal(recovered.reason,"corruption");else assert.ok([new Date(t0).toISOString(),new Date(t0+1).toISOString()].includes(recovered.highWaterMark!));});
});

test("ingress filename, bytes, digest linkage, and pre-v4 transactions fail closed on recovery",async()=>{
  await withRoot(async root=>{const authenticated=authenticateOutcomeRequest({tenant:"tenant_1",requester:"requester_1",definitionAlias:"definition_1",request:{v:"reelier.outcome-request/v1",requestId:"request_1",sourceRefs:{source:"ref_1"},choices:{}}});const state=authenticatedOutcomeRequestState(authenticated);assert.equal((await new RawFsAuthorityLedger(root,{now:()=>t0}).bindIngress(authenticated)).ok,true);await writeFile(path.join(root,"ingress",`${state.requestKey.slice(7)}.json`),"{");assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0}).recover(),{ok:false,reason:"corruption"});});
  await withRoot(async root=>{const ledger=new FsAuthorityLedger(root,{now:()=>t0});const created=await ledger.reserve(intent());assert.equal(created.ok,true);const ingress=await readdir(path.join(root,"ingress"));await unlink(path.join(root,"ingress",ingress[0]));assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0}).recover(),{ok:false,reason:"corruption"});});
  for(const version of ["v1","v2","v3"])await withRoot(async root=>{assert.equal((await new RawFsAuthorityLedger(root,{now:()=>t0}).recover()).ok,true);const bytes=authorityCanonicalBytes({v:`reelier.authority-ledger-transaction/${version}`,intent:{}});const name=createHash("sha256").update(bytes).digest("hex");await writeFile(path.join(root,"transactions",name),bytes);assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0}).recover(),{ok:false,reason:"corruption"});});
});

test("bindIngress refuses evaluation eligibility when any existing ingress record is corrupt",async()=>{
  await withRoot(async root=>{const first=authenticateOutcomeRequest({tenant:"tenant_1",requester:"requester_1",definitionAlias:"definition_1",request:{v:"reelier.outcome-request/v1",requestId:"request_1",sourceRefs:{source:"ref_1"},choices:{}}});const second=authenticateOutcomeRequest({tenant:"tenant_1",requester:"requester_1",definitionAlias:"definition_1",request:{v:"reelier.outcome-request/v1",requestId:"request_2",sourceRefs:{source:"ref_2"},choices:{}}});const ledger=new RawFsAuthorityLedger(root,{now:()=>t0});assert.equal((await ledger.bindIngress(first)).ok,true);await writeFile(path.join(root,"ingress",`${authenticatedOutcomeRequestState(first).requestKey.slice(7)}.json`),"{");assert.deepEqual(await ledger.bindIngress(second),{ok:false,reason:"corruption"});});
});

test("reservation linkage lookup returns only the verified ingress/capability/context edges needed by gate decision verification",async()=>{
  await withRoot(async root=>{
    const ledger=new FsAuthorityLedger(root,{now:()=>t0});
    const reserved=await ledger.reserve(intent());
    assert.equal(reserved.ok,true);if(!reserved.ok)return;
    const linkage=await ledger.lookupReservationLinkage(reserved.reservation.reservationId);
    assert.deepEqual(linkage,{
      reservationId:reserved.reservation.reservationId,
      ingressClaimDigest:reserved.reservation.intent.ingressClaimDigest,
      capabilityId:reserved.reservation.intent.capabilityId,
      capabilityDigest:reserved.reservation.intent.capabilityDigest,
      authorityStateDigest:reserved.reservation.intent.authorityStateDigest,
      decisionContextDigest:reserved.reservation.intent.decisionContextDigest,
      state:"reserved",
      updatedAt:new Date(t0).toISOString(),
    });
    assert.equal(Object.isFrozen(linkage),true);
    assert.equal("capabilityBase64" in linkage,false);
    assert.equal("canonicalRequestBase64" in linkage,false);
  });
});

// ---------------------------------------------------------------------------------------------
// S1 of the admission-preparation lifecycle (docs/superpowers/plans/2026-08-04-admission-preparation-design.md).
//
// Appended at the END of this file ON PURPOSE. The spec cites test line anchors directly -- see
// docs/specs/compiled-authority-v1.md:655-656 and :670, which cite ledger.test.ts:1022 and :1746
// inside an UNRESOLVED open-discrepancy note -- so an insertion higher up silently rots an anchor
// the owner still has to act on.
//
// The committed hard-exit corpus at :1653 drives the DEFAULT clean-root path, which creates no
// preparation at all, so it stays red until the S4 activation flip. This suite drives the same
// family through a host-private runtime option, so the mechanism is provable before any default
// changes. It also carries the ninth boundary (`before-admission-slot-rename`), which has no
// hard-exit subtest in that corpus.
//
// WHAT THE BOUNDARY ROWS DO AND DO NOT DISCRIMINATE -- do not overstate this in a slice's
// acceptance criteria. The nine rows encode only FIVE distinct durable states, so they pin the
// owner-state ladder (absent -> zero -> strict-prefix -> complete) and the prep->slot name
// transition, and nothing else. Sync barriers and read-only revalidation are invisible to a
// post-mortem listing, which the spec itself concedes at docs/specs/compiled-authority-v1.md:229-231
// ("the name alone never asserts that the barrier completed"). Emission ORDER is therefore pinned
// separately, in-process, by the degraded-terminal test below.
// ---------------------------------------------------------------------------------------------
function k1AdmissionPreparationOption():symbol{const option=(hostAuthorityModule as Record<string,unknown>).__testK1AdmissionPreparationRuntimeOption;assert.equal(typeof option,"symbol","the host module exposes the private admission-preparation runtime option");return option as symbol;}
const K1_ADMISSION_PREPARATION_MODE={mode:"prepare-and-promote"} as const;const K1_ADMISSION_PREPARATION_LEGACY={mode:"legacy"} as const;
const K1_ADMISSION_PREPARATION_POINTS=["after-admission-prep-create","after-admission-prep-owner-create","after-admission-prep-owner-partial-write","after-admission-prep-owner-sync","after-admission-prep-sync","before-admission-slot-rename","after-admission-slot-rename","after-admission-slot-root-sync","after-admission-slot-final-validation"] as const;
const LIVE_ADMISSION_PREP=/^\.authority-ledger-admission-prep-([0-9a-f]{64})-(\d+)-([0-9a-f]{64})\.tmp$/;
function livePrepNames(names:readonly string[]):string[]{return names.filter(name=>name.startsWith(".authority-ledger-admission-prep-")&&!name.startsWith(".authority-ledger-admission-prep-retired-"));}

// Subtest labels are prefixed. `baseline-diff` flattens node:test output to a Set of BARE subtest
// names (scripts/baseline-diff.mjs:60), and all nine points are already failing names from the
// committed corpus, so an unprefixed label would make a regression here produce zero NEWLY FAILING
// names -- invisible to exactly the gate that is supposed to catch it.
test("option-gated admission preparation hard exits leave the exact specified durable state",{timeout:30_000},async t=>{
  // Spec :218-222 -- preparation has the exact monotonic states empty -> zero -> strict-prefix ->
  // complete -> synced, and only synced may become the fixed slot.
  const boundaries=[
    {point:"after-admission-prep-create",prep:1,slot:0,owner:"absent"},
    {point:"after-admission-prep-owner-create",prep:1,slot:0,owner:"zero"},
    {point:"after-admission-prep-owner-partial-write",prep:1,slot:0,owner:"strict-prefix"},
    {point:"after-admission-prep-owner-sync",prep:1,slot:0,owner:"complete"},
    {point:"after-admission-prep-sync",prep:1,slot:0,owner:"complete"},
    {point:"before-admission-slot-rename",prep:1,slot:0,owner:"complete"},
    {point:"after-admission-slot-rename",prep:0,slot:1,owner:"complete"},
    {point:"after-admission-slot-root-sync",prep:0,slot:1,owner:"complete"},
    {point:"after-admission-slot-final-validation",prep:0,slot:1,owner:"complete"},
  ] as const;
  assert.deepEqual(boundaries.map(row=>row.point),[...K1_ADMISSION_PREPARATION_POINTS],"all nine specified admission-preparation/fixed-slot boundaries are covered, in spec order");
  const option=k1AdmissionPreparationOption();assert.equal(typeof option,"symbol");
  for(const boundary of boundaries)await t.test(`option-gated ${boundary.point}`,()=>withRoot(async root=>{
    const callback=path.join(root,"callback-entered"),moduleUrl=pathToFileURL(path.resolve("dist-test/src/authority/host/fs-ledger.js")).href;
    // Exit 80 separates "the option does not exist" from "the boundary never fired"; stderr is
    // captured so a child-side constructor throw is not silently indistinguishable from either.
    const source=`import{writeFileSync}from"node:fs";import*as host from ${JSON.stringify(moduleUrl)};const option=host.__testK1AdmissionPreparationRuntimeOption;if(typeof option!=="symbol")process.exit(80);const ledger=new host.FsAuthorityLedger(process.argv[1],{[option]:${JSON.stringify(K1_ADMISSION_PREPARATION_MODE)},now:()=>${t0},lockTimeoutMs:100,faultInjector(point){if(point===${JSON.stringify(boundary.point)})process.exit(91);if(point==="before-ledger-operation-callback")writeFileSync(process.argv[2],"entered");}});await ledger.observeClock();process.exit(92);`;
    let childPid:number|undefined,stderr="";
    const code=await new Promise<number|null>((resolve,reject)=>{const child=spawn(process.execPath,["--input-type=module","-e",source,root,callback],{stdio:["ignore","ignore","pipe"]});childPid=child.pid;child.stderr?.on("data",(chunk:unknown)=>{stderr+=String(chunk);});child.once("error",reject);child.once("close",resolve);});
    assert.ok(Number.isSafeInteger(childPid));
    assert.equal(code,91,`${boundary.point} must be a real recoverable hard-exit boundary${stderr?`; child stderr: ${stderr.slice(0,600)}`:""}`);
    assert.equal(existsSync(callback),false,`${boundary.point} cannot reach callback/dispatch`);
    const names=await readdir(root),preps=livePrepNames(names),slots=names.filter(name=>name===".authority-ledger-admission-0"),stages=names.filter(name=>name.startsWith(".authority-ledger-lock-publication-"));
    assert.equal(preps.length,boundary.prep,`${boundary.point} leaves exactly ${boundary.prep} preparation(s)`);
    assert.equal(slots.length,boundary.slot,`${boundary.point} leaves exactly ${boundary.slot} fixed slot(s)`);
    assert.equal(stages.length,0,`${boundary.point} precedes publication-stage creation`);
    assert.equal(existsSync(path.join(root,"lock")),false,`${boundary.point} precedes publication`);
    // Exact name grammar, not a prefix. A preparation carrying a stale host digest or a pid that is
    // not the creating process is not recoverable: prep-retired housekeeping authority is keyed on
    // exactly those fields (spec :503-504).
    if(boundary.prep===1){const match=LIVE_ADMISSION_PREP.exec(preps[0]!);assert.ok(match,`${boundary.point}: the preparation carries the exact specified grammar, got ${preps[0]}`);assert.equal(match[1],publicationHostDigest(hostname()),`${boundary.point}: exact host digest`);assert.equal(Number(match[2]),childPid,`${boundary.point}: the preparation pid is the creating process`);}
    const target=path.join(root,preps[0]??slots[0]!),ownerPath=path.join(target,"owner.json");
    if(boundary.owner==="absent"){assert.equal(existsSync(ownerPath),false,`${boundary.point} precedes owner creation`);assert.deepEqual(await readdir(target),[],"an empty preparation holds nothing");return;}
    assert.equal(existsSync(ownerPath),true,`${boundary.point} follows owner creation`);
    const bytes=await readFile(ownerPath);
    if(boundary.owner==="zero")assert.equal(bytes.length,0,`${boundary.point} leaves an exact zero-byte owner`);
    // Spec :219-220 requires only "a nonempty proper prefix". The exact one-byte width pinned here is
    // this codebase's shipped convention (src/authority/host/fs-ledger.ts:710 writes
    // ownerBytes.subarray(0,1) for the publication stage), not a spec requirement.
    else if(boundary.owner==="strict-prefix"){assert.equal(bytes.length,1,`${boundary.point} leaves a deterministic nonempty strict prefix`);assert.equal(bytes.toString("utf8"),"{","the strict prefix is the leading canonical byte");}
    else{const parsed=JSON.parse(bytes.toString("utf8")) as AdmissionOwner;assert.equal(parsed.v,1);assert.equal(parsed.host,hostname());assert.match(parsed.nonce,/^[0-9a-f]{64}$/);assert.equal(parsed.pid,childPid,`${boundary.point}: the canonical owner names the creating process`);assert.deepEqual(bytes,publicationOwnerBytes(parsed),`${boundary.point} leaves all canonical owner bytes`);}
  }));
});

// The completion pin. S1 builds preparation -> slot -> slot-owner-bound stage -> lock but has no
// own-slot retirement (that is S2), so a successful publication cannot retire its exact slot. The
// spec's terminal for that case (:314-316): retire the active lock to `publication-aborted`,
// root-sync, and run ZERO callback.
//
// THREE THINGS HERE ARE STAGING DECISIONS, NOT SPEC, and are recorded as such:
//  (a) The spec conditions the degraded terminal on failing to retire "within its fresh
//      slot-retirement deadline". S1 does not attempt retirement at all, so it synthesises the
//      condition as "no mechanism, therefore degraded exit". The spec does not sanction a
//      no-attempt path; S2 replaces it with a real attempt.
//  (b) The spec states the artifacts and the zero callback but never states the operation's RETURN
//      VALUE. `busy` is taken from the committed pin at :1672, which is itself still red.
//  (c) The surviving unretired slot contradicts nothing in the spec, but activation-contract item 5
//      in the design plan requires zero admission-family residue. That item binds a later slice;
//      the assertion below must be REVISED, not extended, when S2 lands.
test("option-gated admission preparation promotes one owner through the nine boundaries",()=>withRoot(async root=>{
  const option=k1AdmissionPreparationOption(),slot=path.join(root,".authority-ledger-admission-0");
  const observed:string[]=[];
  let prepOwner=Buffer.alloc(0),slotOwner=Buffer.alloc(0),lockOwner=Buffer.alloc(0),stageOwner=Buffer.alloc(0);
  let prepIdentity:ExactFsIdentity|undefined,prepOwnerIdentity:ExactFsIdentity|undefined,slotAtLockSync=false,callbackEntries=0,publishedOwner:AdmissionOwner|undefined;
  const result=await new RawFsAuthorityLedger(root,{[option]:K1_ADMISSION_PREPARATION_MODE,now:()=>t0,lockTimeoutMs:2_000,faultInjector:(point:string)=>{
    observed.push(point);
    if(point==="after-admission-prep-sync"){const prep=livePrepNames(readdirSync(root))[0];assert.ok(prep,"a preparation exists at its own sync barrier");prepOwner=readFileSync(path.join(root,prep,"owner.json"));prepIdentity=exactFsIdentity(path.join(root,prep));prepOwnerIdentity=exactFsIdentity(path.join(root,prep,"owner.json"));}
    if(point==="after-admission-slot-root-sync"){slotOwner=readFileSync(path.join(slot,"owner.json"));
      // Promotion is an atomic rename, so the fixed slot IS the preparation: same dev/ino/mode/nlink.
      // Byte equality alone cannot tell rename from copy-then-delete.
      assert.deepEqual(exactFsIdentity(slot),prepIdentity,"the fixed slot is the promoted preparation directory itself, not a copy");
      assert.deepEqual(exactFsIdentity(path.join(slot,"owner.json")),prepOwnerIdentity,"the promoted owner object keeps its filesystem identity");}
    if(point==="after-lock-publication-stage-sync"){const stage=readdirSync(root).filter(name=>name.startsWith(".authority-ledger-lock-publication-"))[0];assert.ok(stage,"the slot owner created exactly one publication stage");assert.equal(existsSync(slot),true,"the stage is created while the fixed slot is still exact");stageOwner=readFileSync(path.join(root,stage,"owner.json"));}
    if(point==="after-lock-publication-root-sync"){slotAtLockSync=existsSync(slot);lockOwner=readFileSync(path.join(root,"lock","owner.json"));publishedOwner=JSON.parse(lockOwner.toString("utf8")) as AdmissionOwner;}
    if(point==="before-ledger-operation-callback")callbackEntries++;
  }} as never).observeClock();
  assert.ok(prepOwner.length>0,"the preparation reaches its complete synced state");
  assert.deepEqual(slotOwner,prepOwner,"the preparation is promoted, never rewritten");
  assert.deepEqual(stageOwner,slotOwner,"the publication stage is bound to the fixed-slot owner");
  assert.deepEqual(lockOwner,slotOwner,"prep, slot, publication stage and active lock carry one canonical owner");
  assert.equal(slotAtLockSync,true,"the fixed slot is still present when the active lock root-syncs");
  assert.ok(publishedOwner);
  // The terminal moved twice while this pin stood still -- S1's no-attempt exit, then S2's real
  // bounded retirement, then S3's completed cleanup pass. It is settled now, so this asserts it
  // exactly rather than the near-tautological `result.ok === false` it carried in between.
  assert.deepEqual(result,{ok:true,status:"advanced",observedAt:new Date(t0).toISOString()});
  assert.equal(callbackEntries,1,"the promotion path reaches the callback exactly once");
  assert.equal(livePrepNames(await readdir(root)).length,0,"the promoted preparation name is gone");
  // The only discriminator for the boundaries the durable-state rows collapse (the two sync barriers
  // and the final read-only validation): each specified point fires exactly once, in spec order.
  assert.deepEqual(observed.filter(point=>(K1_ADMISSION_PREPARATION_POINTS as readonly string[]).includes(point)),[...K1_ADMISSION_PREPARATION_POINTS],"the nine boundaries fire exactly once each, in the specified order");
}));

// Gate half (a) is a null signal on its own for an option-gated slice: untouched defaults are exactly
// what a slice that does nothing also produces. This asserts the untouched-ness directly, on both
// sides -- no new emission appears, and the default path's own shape is unchanged.
test("the admission-preparation option leaves default clean-root behaviour untouched",()=>withRoot(async root=>{
  const observed:string[]=[];let published=0,retired=0,callbacks=0;
  const result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:2_000,faultInjector:(point:string)=>{
    observed.push(point);
    if(point==="after-lock-publication-root-sync")published++;
    if(point==="after-lock-retire")retired++;
    if(point==="before-ledger-operation-callback")callbacks++;
  }} as never).observeClock();
  assert.deepEqual(result,{ok:true,status:"advanced",observedAt:new Date(t0).toISOString()});
  assert.deepEqual(observed.filter(point=>(K1_ADMISSION_PREPARATION_POINTS as readonly string[]).includes(point)),[],"no admission-preparation boundary fires without the option");
  assert.deepEqual({published,retired,callbacks},{published:1,retired:1,callbacks:1},"the default clean-root shape is unchanged");
  assert.deepEqual(livePrepNames(await readdir(root)),[],"no preparation is created without the option");
  assert.equal(existsSync(path.join(root,".authority-ledger-admission-0")),false,"no fixed slot is created without the option");
}));

// The measured cost of S1's degraded terminal, pinned rather than assumed. The test above asserts the
// slot survives; this one says what surviving actually means today, because the honest answer is not
// "the next acquisition classifies it".
//
// It also pins a consequence nobody predicted: the very next DEFAULT acquisition drains the
// `publication-aborted` marker (src/authority/host/fs-ledger.ts services retirement artifacts when
// the only K1 name is the slot) while leaving the slot itself. Spec :510 makes that same-owner
// successor the only authority that can ever retire the slot as `published`, so S1 destroys its own
// recovery path. S2 must change this; the pin exists so S2 cannot change it silently.
// This pin used to record the reason S3 had to exist: S2 retired the slot but drained nothing, so
// the `published` marker was still in the root when withLock's post-acquisition guard ran, and no
// option-on operation could complete. S3's cleanup pass removed that, and the pin now guards the
// property the residue threatened -- a root that option-on acquisitions have touched stays fully
// usable, by DEFAULT operations and by recover(), not only by the acquisition that made it.
test("option-gated acquisitions leave a root that every entry point can still use",()=>withRoot(async root=>{
  const option=k1AdmissionPreparationOption();
  const at=t0+1_000;
  assert.deepEqual(await new RawFsAuthorityLedger(root,{[option]:K1_ADMISSION_PREPARATION_MODE,now:()=>at,lockTimeoutMs:2_000} as never).observeClock(),{ok:true,status:"advanced",observedAt:new Date(at).toISOString()});
  assert.deepEqual(coordinationResidue(await readdir(root)),[],"nothing in the admission family survives the acquisition");
  const byDefault=(now:number)=>new RawFsAuthorityLedger(root,{now:()=>now,lockTimeoutMs:2_000} as never);
  assert.deepEqual(await byDefault(at+1_000).recover(),{ok:true,reservations:[],highWaterMark:new Date(at).toISOString(),topology:{directorySync:"best-effort"}},"recover() works on the reused root and sees the clock the option-on acquisition wrote");
  assert.deepEqual(await byDefault(at+2_000).observeClock(),{ok:true,status:"advanced",observedAt:new Date(at+2_000).toISOString()});
  assert.deepEqual(await byDefault(at+2_000).getHighWaterMark(),{observedAt:new Date(at+2_000).toISOString()},"and reads are not refused");
  assert.deepEqual(coordinationResidue(await readdir(root)),[],"and the default operations add no admission-family residue of their own");
}));

// Spec :307 -- the exact slot owner alone may create one publication stage; spec :383 -- a lone live
// external pre-slot publication stage is preserved and bounded-waits to `busy`. The guard must not
// fall through to legacy publication when it cannot prepare, or the option publishes an active lock
// with no fixed slot behind it and then runs the callback.
test("option-gated admission preparation refuses rather than publishing without a fixed slot",()=>withRoot(async root=>{
  const option=k1AdmissionPreparationOption(),foreign={host:hostname(),nonce:"b7".repeat(32),pid:49771,v:1 as const,ticket:"0000000000000001"};
  const stage=await writePublicationStage(root,foreign,publicationOwnerBytes(foreign));
  const before=await snapshotRootArtifacts(root);
  // The stage owner must read as ALIVE. A dead foreign stage is legitimately withdrawn first, which
  // leaves an admission-ready root where preparing IS correct -- a different branch entirely.
  const originalKill=process.kill;
  Object.defineProperty(process,"kill",{configurable:true,value:(pid:number)=>pid===foreign.pid?true:originalKill.call(process,pid,0)});
  let prepCreates=0,slotRenames=0,published=0,callbacks=0,result;
  try{
    result=await new RawFsAuthorityLedger(root,{[option]:K1_ADMISSION_PREPARATION_MODE,now:()=>t0,lockTimeoutMs:20,faultInjector:(point:string)=>{
      if(point==="after-admission-prep-create")prepCreates++;
      if(point==="after-admission-slot-rename")slotRenames++;
      if(point==="after-lock-publication-root-sync")published++;
      if(point==="before-ledger-operation-callback")callbacks++;
    }} as never).observeClock();
  }finally{Object.defineProperty(process,"kill",{configurable:true,value:originalKill});}
  assert.deepEqual(result,{ok:false,reason:"busy"});
  assert.deepEqual({prepCreates,slotRenames,published,callbacks},{prepCreates:0,slotRenames:0,published:0,callbacks:0},"a contended root neither prepares nor publishes under the option");
  assert.equal(existsSync(path.join(root,".authority-ledger-admission-0")),false,"no fixed slot appears");
  assert.equal(existsSync(stage),true);
  assert.deepEqual(await snapshotRootArtifacts(root),before,"the foreign stage is preserved byte-identical");
}));

// Spec :217 -- "An existing destination is completely classified and never overwritten." POSIX
// rename(2) REMOVES an empty destination directory and succeeds, so this is the one boundary where
// the platform will silently do the forbidden thing unless the destination is classified first.
test("option-gated admission promotion never overwrites an existing fixed slot",async t=>{
  const option=k1AdmissionPreparationOption();
  for(const shape of ["empty","occupied"] as const)await t.test(shape,()=>withRoot(async root=>{
    const slot=path.join(root,".authority-ledger-admission-0"),foreign=Buffer.from(`foreign-${shape}-slot`);
    let planted=false,renames=0;
    const result=await new RawFsAuthorityLedger(root,{[option]:K1_ADMISSION_PREPARATION_MODE,now:()=>t0,lockTimeoutMs:20,faultInjector:(point:string)=>{
      if(point==="before-admission-slot-rename"&&!planted){planted=true;mkdirSync(slot);if(shape==="occupied")writeFileSync(path.join(slot,"owner.json"),foreign);}
      if(point==="after-admission-slot-rename")renames++;
    }} as never).observeClock();
    assert.equal(planted,true,"the fixture occupies the destination before the promotion attempt");
    assert.equal(renames,0,`${shape}: the promotion does not proceed onto an existing destination`);
    assert.deepEqual(result,{ok:false,reason:"corruption"},`${shape}: an existing destination is a typed refusal, never a raw errno out of the public API`);
    assert.equal(existsSync(slot),true,`${shape}: the destination survives`);
    if(shape==="occupied")assert.deepEqual(readFileSync(path.join(slot,"owner.json")),foreign,"foreign slot bytes are preserved byte-identical");
    else assert.deepEqual(await readdir(slot),[],"an empty foreign destination is not clobbered by rename");
    assert.equal(livePrepNames(await readdir(root)).length,1,`${shape}: the contender's own preparation is preserved in place, never deleted`);
  }));
});

// ---------------------------------------------------------------------------------------------
// S2 — the active owner retiring ITS OWN published slot.
//
// Spec :572-574: "After publication, the active owner—not the pre-admission housekeeper—closes and
// exact-revalidates the complete coordination generation, durably retires the matching slot as
// `published`, and performs one complete active-owner cleanup pass before callback entry."
// Spec :310-313: the slot renames to `.authority-ledger-admission-retired-<host64>-<pid>-<nonce64>
// .published`, `published` REQUIRES the byte-identical active lock, and callback eligibility begins
// only after both the active-lock root sync AND the matching published slot-retirement root sync.
//
// This is an OWN-ACT retirement and deliberately does not touch the blocked foreign-dead-slot
// housekeeping decision: the committed dead-owner slot-orphan pins seed FOREIGN slots and a
// lock-seeking contender must still leave those byte-identical. The last pin below is a direct
// regression guard on exactly that, so the two acts cannot be conflated by a later change.
//
// These mirror the committed default-path pins at ledger.test.ts:1670 and :1672, which stay red
// until the S4 activation flip.
// ---------------------------------------------------------------------------------------------
const ADMISSION_SLOT_RETIRE_POINTS=["before-admission-slot-retire-rename","after-admission-slot-retire-rename","after-admission-slot-retire-root-sync"] as const;
function admissionRetiredNames(names:readonly string[]):string[]{return names.filter(name=>name.startsWith(".authority-ledger-admission-retired-"));}

test("option-gated publication retires its own slot as published before entering the callback",()=>withRoot(async root=>{
  const option=k1AdmissionPreparationOption(),slot=path.join(root,".authority-ledger-admission-0");
  const observed:string[]=[];
  let slotOwner=Buffer.alloc(0),lockOwner=Buffer.alloc(0),retiredOwner=Buffer.alloc(0);
  let slotAtLockSync=false,slotAtRetireRootSync=true,retirementRootSynced=false,callbackEntries=0,slotIdentity:ExactFsIdentity|undefined,retiredIdentity:ExactFsIdentity|undefined,retiredName="";
  const result=await new RawFsAuthorityLedger(root,{[option]:K1_ADMISSION_PREPARATION_MODE,now:()=>t0,lockTimeoutMs:2_000,faultInjector:(point:string)=>{
    observed.push(point);
    if(point==="after-admission-slot-root-sync"){slotOwner=readFileSync(path.join(slot,"owner.json"));slotIdentity=exactFsIdentity(slot);}
    if(point==="after-lock-publication-root-sync"){slotAtLockSync=existsSync(slot);lockOwner=readFileSync(path.join(root,"lock","owner.json"));}
    // Spec :310 — `published` requires the byte-identical active lock, so the lock must still be
    // exactly this owner's at the moment the retirement rename is attempted.
    if(point==="before-admission-slot-retire-rename"){assert.equal(existsSync(slot),true,"the slot is still exact when its retirement begins");assert.deepEqual(readFileSync(path.join(root,"lock","owner.json")),slotOwner,"the byte-identical active lock is the authority for `published`");}
    if(point==="after-admission-slot-retire-rename"){slotAtRetireRootSync=existsSync(slot);retiredName=admissionRetiredNames(readdirSync(root))[0]??"";assert.ok(retiredName,"the slot is renamed to a retirement marker");retiredIdentity=exactFsIdentity(path.join(root,retiredName));retiredOwner=readFileSync(path.join(root,retiredName,"owner.json"));}
    if(point==="after-admission-slot-retire-root-sync"){retirementRootSynced=true;assert.equal(existsSync(slot),false,"the fixed slot is gone once its retirement is durable");}
    if(point==="before-ledger-operation-callback"){callbackEntries++;assert.equal(retirementRootSynced,true,"callback eligibility begins only after the published slot-retirement root sync");}
  }} as never).observeClock();
  // Spec :313 -- callback eligibility begins only after BOTH the active-lock root sync and the
  // matching published slot-retirement root sync. The injector above asserts that ordering at the
  // callback itself; this asserts the callback was actually reached, which only became true once S3
  // drained the retirement. It is the option-gated twin of the committed pin at :1670.
  assert.deepEqual(result,{ok:true,status:"advanced",observedAt:new Date(t0).toISOString()});
  assert.equal(callbackEntries,1);
  assert.equal(slotAtLockSync,true);
  assert.equal(slotAtRetireRootSync,false,"the rename removes the slot name");
  assert.equal(retirementRootSynced,true);
  assert.deepEqual(lockOwner,slotOwner,"one canonical owner across slot and active lock");
  assert.deepEqual(retiredOwner,slotOwner,"retirement moves the slot, never rewrites its owner");
  assert.deepEqual(retiredIdentity,slotIdentity,"retirement is an atomic rename of the slot directory itself");
  const owner=JSON.parse(slotOwner.toString("utf8")) as AdmissionOwner;
  assert.equal(retiredName,admissionRetiredName(owner,"published"),"the exact specified retirement grammar and disposition");
  assert.deepEqual(observed.filter(point=>(ADMISSION_SLOT_RETIRE_POINTS as readonly string[]).includes(point)),[...ADMISSION_SLOT_RETIRE_POINTS],"the three own-act retirement boundaries fire exactly once each, in spec order");
  assert.equal(existsSync(slot),false);
}));

// Spec :314-316 — if a successful publication cannot retire its exact slot within its FRESH
// slot-retirement deadline, the owner retires the active lock to publication-aborted, root-syncs and
// runs zero callback. S1 reached this terminal by having no mechanism; S2 must reach it by a real
// bounded attempt that fails. This is the option-gated twin of the committed pin at :1672.
test("option-gated publication whose own slot retirement fails aborts the lock before callback",()=>withRoot(async root=>{
  const option=k1AdmissionPreparationOption(),slot=path.join(root,".authority-ledger-admission-0");
  let retirementAttempts=0,callbackEntries=0,publishedOwner:AdmissionOwner|undefined;
  const result=await new RawFsAuthorityLedger(root,{[option]:K1_ADMISSION_PREPARATION_MODE,now:()=>t0,lockTimeoutMs:20,faultInjector:(point:string)=>{
    if(point==="after-lock-publication-root-sync")publishedOwner=JSON.parse(readFileSync(path.join(root,"lock","owner.json"),"utf8")) as AdmissionOwner;
    if(point==="before-admission-slot-retire-rename"){retirementAttempts++;throw Object.assign(new Error("sharing"),{code:"EBUSY"});}
    if(point==="before-ledger-operation-callback")callbackEntries++;
  }} as never).observeClock();
  assert.ok(retirementAttempts>0,"slot retirement has its own bounded retry path");
  assert.equal(callbackEntries,0,"a publication that cannot retire its slot runs zero callback");
  assert.deepEqual(result,{ok:false,reason:"busy"});
  assert.ok(publishedOwner);
  assert.equal(existsSync(path.join(root,"lock")),false);
  assert.equal(existsSync(path.join(root,`.authority-ledger-lock-${publishedOwner!.pid}-${publishedOwner!.nonce}.publication-aborted`)),true,"the degraded terminal is unchanged from S1");
  assert.equal(existsSync(slot),true,"a slot that could not retire is preserved, not abandoned");
}));

// The own-act/foreign-act boundary. An earlier version of this guard seeded a foreign slot in the one
// literal K1 name, which meant the contender never prepared at all -- it would have passed with the
// own-act path deleted, and passed identically with the option OFF. It measured admission refusal,
// not the boundary.
//
// This version makes the own-act path actually RUN and then requires it to decline: the acquisition
// creates and promotes its own slot, and only then is that slot swapped for a foreign directory
// carrying byte-identical owner bytes. Bytes alone must not authorise retirement -- spec :327 makes
// same-name replacement preserved corruption, and spec :510 makes the `published` marker durable
// evidence a later housekeeper trusts, so laundering a replaced slot into one is the worst available
// outcome. The retirement binds to the promotion-time creator snapshot, not to a fresh stat.
test("option-gated own-act retirement refuses a slot that was replaced under its own name",()=>withRoot(async root=>{
  const option=k1AdmissionPreparationOption(),slot=path.join(root,".authority-ledger-admission-0");
  let swapped=false,originalId:ExactFsIdentity|undefined,replacementId:ExactFsIdentity|undefined,retireRenames=0,callbacks=0;
  const result=await new RawFsAuthorityLedger(root,{[option]:K1_ADMISSION_PREPARATION_MODE,now:()=>t0,lockTimeoutMs:200,faultInjector:(point:string)=>{
    if(point==="after-lock-publication-root-sync"&&!swapped){
      swapped=true;originalId=exactFsIdentity(slot);
      const bytes=readFileSync(path.join(slot,"owner.json")),stash=`${slot}.stash`;
      renameSync(slot,stash);mkdirSync(slot);writeFileSync(path.join(slot,"owner.json"),bytes);rmSync(stash,{recursive:true,force:true});
      replacementId=exactFsIdentity(slot);
    }
    if(point==="after-admission-slot-retire-rename")retireRenames++;
    if(point==="before-ledger-operation-callback")callbacks++;
  }} as never).observeClock();
  assert.equal(swapped,true,"the fixture replaces the promoted slot with a byte-identical directory");
  assert.notDeepEqual(replacementId,originalId,"and the replacement really is a different filesystem object");
  assert.equal(retireRenames,0,"a replaced slot is never minted into a durable `published` retirement marker");
  assert.equal(callbacks,0);
  assert.deepEqual(result,{ok:false,reason:"corruption"});
  assert.deepEqual(admissionRetiredNames(await readdir(root)),[],"no retirement marker exists");
  assert.equal(existsSync(slot),true,"the replaced slot is preserved, not deleted");
}));

// Spec :314-316 applies to EVERY way a publication can fail to retire its slot, not just deadline
// exhaustion. A corruption throw that skips it leaves the freshly published active lock live, which
// bricks the root for every later operation including reads. An earlier revision of this slice did
// exactly that, and it was invisible because the assertion that would have caught it had been deleted
// from a neighbouring pin in the same change. This pin exists so that cannot recur silently.
test("option-gated publication never leaves its active lock live on any non-ok terminal",async t=>{
  const option=k1AdmissionPreparationOption();
  const cases=[
    {name:"slot owner drifts",point:"after-admission-slot-final-validation",act:(root:string)=>{writeFileSync(path.join(root,".authority-ledger-admission-0","owner.json"),publicationOwnerBytes({host:hostname(),nonce:"a1".repeat(32),pid:process.pid,v:1}));}},
    {name:"slot gains an extra child",point:"after-lock-publication-root-sync",act:(root:string)=>{writeFileSync(path.join(root,".authority-ledger-admission-0","intruder.json"),"x");}},
    {name:"slot vanishes",point:"after-lock-publication-root-sync",act:(root:string)=>{rmSync(path.join(root,".authority-ledger-admission-0"),{recursive:true,force:true});}},
  ] as const;
  for(const item of cases)await t.test(item.name,()=>withRoot(async root=>{
    let fired=false,callbacks=0;
    const result=await new RawFsAuthorityLedger(root,{[option]:K1_ADMISSION_PREPARATION_MODE,now:()=>t0,lockTimeoutMs:200,faultInjector:(point:string)=>{
      if(point===item.point&&!fired){fired=true;item.act(root);}
      if(point==="before-ledger-operation-callback")callbacks++;
    }} as never).observeClock();
    assert.equal(fired,true,`${item.name}: the fixture fired`);
    assert.equal(result.ok,false,`${item.name}: does not complete`);
    assert.equal(callbacks,0,`${item.name}: zero callback`);
    const names=await readdir(root);
    assert.equal(names.includes("lock"),false,`${item.name}: the active lock is never left live`);
    assert.equal(names.some(name=>name.endsWith(".publication-aborted")),true,`${item.name}: the specified degraded terminal artifact is durable`);
    assert.deepEqual(admissionRetiredNames(names),[],`${item.name}: no published marker is minted`);
  }));
});

// Idempotent re-entry. A transient error AFTER the retirement rename has committed must resume, not
// restart: restarting finds the source gone, burns the whole budget, and reports the degraded
// terminal for a retirement that actually succeeded -- a durable record carrying BOTH a `published`
// marker and a `publication-aborted` one, which describes two contradictory histories.
test("option-gated own-act retirement resumes after a committed rename instead of restarting",()=>withRoot(async root=>{
  const option=k1AdmissionPreparationOption();
  let injected=0,rootSyncs=0;
  const result=await new RawFsAuthorityLedger(root,{[option]:K1_ADMISSION_PREPARATION_MODE,now:()=>t0,lockTimeoutMs:200,faultInjector:(point:string)=>{
    if(point==="after-admission-slot-retire-rename"&&injected++===0)throw Object.assign(new Error("sharing"),{code:"EBUSY"});
    if(point==="after-admission-slot-retire-root-sync")rootSyncs++;
  }} as never).observeClock();
  assert.equal(injected,1,"the transient fires once, after the rename is durable");
  assert.equal(rootSyncs,1,"the retry resumes at the root sync rather than restarting from the vanished source");
  assert.deepEqual(result,{ok:true,status:"advanced",observedAt:new Date(t0).toISOString()},"a resumed retirement still completes");
  const names=await readdir(root);
  assert.equal(names.some(name=>name.endsWith(".publication-aborted")),false,"no contradictory publication-aborted marker is written for a retirement that succeeded");
  assert.deepEqual(coordinationResidue(names),[],"the retirement completed and was then drained by the cleanup pass");
}));

// Spec :310 -- `published` requires the byte-identical active lock, and the slot must still be the
// owner's own. The retirement therefore revalidates BOTH before renaming.
//
// Only the slot half is exercisable. Measured by patching the build: deleting the active-lock
// precondition changes no test result, because there is no injectable window that can reach it --
// tampering with the lock owner before retirement is already caught by assertPublishedSnapshotUnchanged
// at the publication root sync, and no fault point sits between that check and this one. The
// precondition stays as defence-in-depth for the untestable window; this pin covers the half that a
// fixture can actually reach, so the revalidation is not wholly unpinned.
test("option-gated own-act retirement refuses when its own slot owner drifts",()=>withRoot(async root=>{
  const option=k1AdmissionPreparationOption(),slot=path.join(root,".authority-ledger-admission-0");
  let retireRenames=0,callbacks=0,tampered=false;
  const result=await new RawFsAuthorityLedger(root,{[option]:K1_ADMISSION_PREPARATION_MODE,now:()=>t0,lockTimeoutMs:200,faultInjector:(point:string)=>{
    if(point==="after-admission-slot-final-validation"&&!tampered){tampered=true;writeFileSync(path.join(slot,"owner.json"),publicationOwnerBytes({host:hostname(),nonce:"e9".repeat(32),pid:process.pid,v:1}));}
    if(point==="after-admission-slot-retire-rename")retireRenames++;
    if(point==="before-ledger-operation-callback")callbacks++;
  }} as never).observeClock();
  assert.equal(tampered,true,"the fixture drifts the slot owner after its final validation");
  assert.equal(retireRenames,0,"a slot whose owner is no longer this acquisition's is never retired as published");
  assert.equal(callbacks,0);
  assert.deepEqual(result,{ok:false,reason:"corruption"});
  assert.deepEqual(admissionRetiredNames(await readdir(root)),[],"no retirement marker is minted from a drifted slot");
}));

// ---------------------------------------------------------------------------------------------
// S3 -- the active-owner cleanup pass. Spec :572-574: "After publication, the active owner-not the
// pre-admission housekeeper-closes and exact-revalidates the complete coordination generation,
// durably retires the matching slot as `published`, and performs one complete active-owner cleanup
// pass before callback entry."
//
// S2 performed the retirement and stopped, which left the `published` marker in the root when
// withLock's post-acquisition guard ran, so no option-on operation could complete. S3 drains it
// inline, before the guard and before callback entry, and emits the two points that were still
// unemitted: `after-pre-callback-coordination-generation-closed` and
// `after-admission-slot-retire-cleanup-root-sync`.
//
// ORDER NOTE. The spec sentence lists closure BEFORE retirement; the committed pin at
// ledger.test.ts:1822 pins the opposite (`slot-retire-root-sync` then `generation-closed`). That
// disagreement is recorded in the spec beside the rule. The implementation follows the PIN.
// ---------------------------------------------------------------------------------------------
const OWN_ACT_CLEANUP_ORDER=[
  "after-admission-slot-retire-rename","after-admission-slot-retire-root-sync",
  "after-pre-callback-coordination-generation-closed",
  "after-coordination-cleanup-stage-create","after-coordination-cleanup-stage-partial-write",
  "after-coordination-cleanup-stage-file-sync","after-coordination-cleanup-ack-rename",
  "after-coordination-cleanup-ack-root-sync","after-coordination-cleanup-marker-owner-remove","after-coordination-cleanup-marker-remove",
  "after-coordination-cleanup-marker-root-sync","after-admission-slot-retire-cleanup-root-sync",
  "after-coordination-cleanup-ack-remove","after-coordination-cleanup-final-root-sync",
  "before-ledger-operation-callback",
] as const;
function coordinationResidue(names:readonly string[]):string[]{return names.filter(name=>name.startsWith(".authority-ledger-admission-")||name.startsWith(".authority-ledger-coordination-cleanup-")).sort();}

// The pin the whole staged sequence has been building toward: an option-on operation completes.
test("option-gated publication drains its own retirement and completes with one callback",()=>withRoot(async root=>{
  const option=k1AdmissionPreparationOption();
  const observed:string[]=[];let callbacks=0;
  const result=await new RawFsAuthorityLedger(root,{[option]:K1_ADMISSION_PREPARATION_MODE,now:()=>t0,lockTimeoutMs:2_000,faultInjector:(point:string)=>{
    observed.push(point);
    if(point==="before-ledger-operation-callback"){callbacks++;assert.deepEqual(coordinationResidue(readdirSync(root)),[],"the callback is entered only after every admission-family artifact is drained");}
  }} as never).observeClock();
  assert.deepEqual(result,{ok:true,status:"advanced",observedAt:new Date(t0).toISOString()});
  assert.equal(callbacks,1);
  // Activation-contract clause 5, on the success path: zero admission-family residue.
  assert.deepEqual(coordinationResidue(await readdir(root)),[],"a successful option-on acquisition leaves no admission-family residue");
  // And the ordinary legacy layout is created exactly as on the default path.
  for(const name of ["claims","ingress","journal","tombstones","transactions"])assert.equal(existsSync(path.join(root,name)),true,`${name} layout directory exists`);
  assert.deepEqual(observed.filter(point=>(OWN_ACT_CLEANUP_ORDER as readonly string[]).includes(point)),[...OWN_ACT_CLEANUP_ORDER],"retirement, generation closure and the cleanup lifecycle fire exactly once each, in order, before callback");
}));

// Idempotence across acquisitions on ONE REUSED ROOT. Every other test in this file uses a fresh
// root per acquisition and therefore cannot observe residue at all -- which is exactly why the S1/S2
// residue defects survived their own green suites.
test("option-gated acquisitions leave a reusable root",()=>withRoot(async root=>{
  const option=k1AdmissionPreparationOption();
  // Each acquisition gets its own instant, so every one must report `advanced` -- proving the
  // semantic clock really moves across a reused root rather than merely not regressing.
  const enabled=(at:number)=>new RawFsAuthorityLedger(root,{[option]:K1_ADMISSION_PREPARATION_MODE,now:()=>at,lockTimeoutMs:2_000} as never);
  for(const attempt of [1,2,3]){
    const at=t0+attempt*1_000;
    assert.deepEqual(await enabled(at).observeClock(),{ok:true,status:"advanced",observedAt:new Date(at).toISOString()},`acquisition ${attempt} succeeds`);
    assert.deepEqual(coordinationResidue(await readdir(root)),[],`acquisition ${attempt} leaves no admission-family residue`);
  }
  // A DEFAULT operation on a root that option-on acquisitions have used must be unaffected.
  const later=t0+9_000;
  assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>later,lockTimeoutMs:2_000} as never).observeClock(),{ok:true,status:"advanced",observedAt:new Date(later).toISOString()});
  assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>later,lockTimeoutMs:2_000} as never).getHighWaterMark(),{observedAt:new Date(later).toISOString()});
}));

// Crash windows inside the cleanup pass. A hard exit at any of these boundaries must leave a
// topology the next acquisition can classify -- never the callback, and never a state where both the
// marker and its acknowledgment are gone while the active lock is still live.
test("option-gated cleanup-pass hard exits leave a topology the next acquisition classifies",{timeout:30_000},async t=>{
  const option=k1AdmissionPreparationOption();
  // `stage` is the acknowledgment's byte state at that boundary: the same
  // absent -> zero -> strict-prefix -> complete ladder the preparation uses, which is what stops an
  // implementation writing all the bytes at once and still passing.
  const boundaries=[
    {point:"after-pre-callback-coordination-generation-closed",marker:1,stage:"absent"},
    {point:"after-coordination-cleanup-stage-create",marker:1,stage:"zero"},
    {point:"after-coordination-cleanup-stage-partial-write",marker:1,stage:"strict-prefix"},
    {point:"after-coordination-cleanup-stage-file-sync",marker:1,stage:"complete"},
    {point:"after-coordination-cleanup-ack-rename",marker:1,stage:"complete"},
    {point:"after-coordination-cleanup-marker-owner-remove",marker:1,stage:"complete"},
    {point:"after-coordination-cleanup-marker-remove",marker:0,stage:"complete"},
    {point:"after-admission-slot-retire-cleanup-root-sync",marker:0,stage:"complete"},
    {point:"after-coordination-cleanup-ack-remove",marker:0,stage:"absent"},
  ] as const;
  for(const boundary of boundaries)await t.test(`option-gated cleanup ${boundary.point}`,()=>withRoot(async root=>{
    const callback=path.join(root,"callback-entered"),moduleUrl=pathToFileURL(path.resolve("dist-test/src/authority/host/fs-ledger.js")).href;
    const source=`import{writeFileSync}from"node:fs";import*as host from ${JSON.stringify(moduleUrl)};const option=host.__testK1AdmissionPreparationRuntimeOption;if(typeof option!=="symbol")process.exit(80);const ledger=new host.FsAuthorityLedger(process.argv[1],{[option]:${JSON.stringify(K1_ADMISSION_PREPARATION_MODE)},now:()=>${t0},lockTimeoutMs:200,faultInjector(point){if(point===${JSON.stringify(boundary.point)})process.exit(91);if(point==="before-ledger-operation-callback")writeFileSync(process.argv[2],"entered");}});await ledger.observeClock();process.exit(92);`;
    let stderr="";
    const code=await new Promise<number|null>((resolve,reject)=>{const child=spawn(process.execPath,["--input-type=module","-e",source,root,callback],{stdio:["ignore","ignore","pipe"]});child.stderr?.on("data",(chunk:unknown)=>{stderr+=String(chunk);});child.once("error",reject);child.once("close",resolve);});
    assert.equal(code,91,`${boundary.point} must be a real recoverable hard-exit boundary${stderr?`; child stderr: ${stderr.slice(0,600)}`:""}`);
    assert.equal(existsSync(callback),false,`${boundary.point} cannot reach callback/dispatch`);
    const names=await readdir(root),markers=names.filter(name=>name.startsWith(".authority-ledger-admission-retired-")),acks=names.filter(name=>name.startsWith(".authority-ledger-coordination-cleanup-"));
    assert.equal(names.includes(".authority-ledger-admission-0"),false,`${boundary.point}: the fixed slot has already retired`);
    assert.ok(acks.length<=1,`${boundary.point}: at most one cleanup stage or acknowledgment`);
    // The marker may only disappear AFTER its acknowledgment is durable. A stage file is not an
    // acknowledgment: the record becomes authoritative at the rename, so removing the marker while
    // only a stage exists leaves a crash window in which neither survives and the lock is still live.
    assert.equal(markers.length,boundary.marker,`${boundary.point}: the retirement marker survives until its acknowledgment is durable`);
    if(boundary.stage==="absent")assert.deepEqual(acks,[],`${boundary.point}: no cleanup artifact exists yet`);
    else{
      assert.equal(acks.length,1,`${boundary.point}: exactly one cleanup artifact exists`);
      const bytes=await readFile(path.join(root,acks[0]!));
      if(boundary.stage==="zero")assert.equal(bytes.length,0,`${boundary.point}: the stage is created empty`);
      else if(boundary.stage==="strict-prefix"){assert.equal(bytes.length,1,`${boundary.point}: a deterministic nonempty strict prefix`);assert.equal(bytes.toString("utf8"),"{","the strict prefix is the leading canonical byte");}
      else{const parsed=JSON.parse(bytes.toString("utf8")) as Readonly<Record<string,unknown>>;assert.equal(parsed.purpose,"slot-retired");assert.equal(parsed.disposition,"published");assert.equal(parsed.recoveryAuthority,"active-owner-or-exact-lock-successor");}
    }
    if(boundary.point==="after-coordination-cleanup-ack-remove")assert.deepEqual([...markers,...acks],[],`${boundary.point}: the retirement is fully drained`);
    else assert.ok(markers.length+acks.length>=1,`${boundary.point}: an exact recoverable coordination artifact survives`);
    // The step the first version of this suite omitted, which is exactly why a wedge shipped green:
    // actually RE-CLASSIFY the root the crash left behind. A readdir assertion cannot tell a
    // classifiable topology from one that every later operation calls corruption. `busy` here means
    // the next acquisition understood what it found and declined; only the fully drained boundary
    // hands the root back. Nothing may report `corruption`.
    // The granted foreign-dead-slot drainage (owner decision 2026-08-05): a later contender —
    // any contender — retires the DEAD owner's slot as `published` on the authority of its exact
    // same-owner active lock, drains the marker and acknowledgment, reclaims the dead lock
    // through the legacy machinery, and completes — in ONE acquisition. Before the grant these
    // rows pinned `busy`; the flip to drained-and-advanced ships in the same commit as the grant.
    const reclassified=await new RawFsAuthorityLedger(root,{now:()=>t0+1_000,lockTimeoutMs:2_000} as never).observeClock();
    assert.deepEqual(reclassified,{ok:true,status:"advanced",observedAt:new Date(t0+1_000).toISOString()},`${boundary.point}: the granted drainage hands the root back in one acquisition`);
    assert.deepEqual(coordinationResidue(await readdir(root)),[],`${boundary.point}: with zero admission-family residue`);
    const again=await new RawFsAuthorityLedger(root,{now:()=>t0+2_000,lockTimeoutMs:2_000} as never).observeClock();
    assert.deepEqual(again,{ok:true,status:"advanced",observedAt:new Date(t0+2_000).toISOString()},`${boundary.point}: and the root keeps working`);
  }));
});

// The generation closure is not decoration. Spec :572-574 requires the active owner to close and
// EXACT-REVALIDATE the coordination generation before its cleanup pass; without the revalidation the
// pass would mint an acknowledgment binding an artifact it never re-checked. Measured by patching
// the build: deleting the revalidation changed no test result until this pin existed.
test("option-gated cleanup pass refuses when its retirement marker drifts before closure",()=>withRoot(async root=>{
  const option=k1AdmissionPreparationOption();
  let tampered=false,stageCreates=0,callbacks=0;
  const result=await new RawFsAuthorityLedger(root,{[option]:K1_ADMISSION_PREPARATION_MODE,now:()=>t0,lockTimeoutMs:200,faultInjector:(point:string)=>{
    if(point==="after-admission-slot-retire-root-sync"&&!tampered){
      tampered=true;
      const marker=admissionRetiredNames(readdirSync(root))[0]!;
      writeFileSync(path.join(root,marker,"intruder.json"),"x");
    }
    if(point==="after-coordination-cleanup-stage-create")stageCreates++;
    if(point==="before-ledger-operation-callback")callbacks++;
  }} as never).observeClock();
  assert.equal(tampered,true,"the fixture drifts the retirement marker after it is durable");
  assert.equal(stageCreates,0,"no acknowledgment is minted for a generation that failed revalidation");
  assert.equal(callbacks,0,"and the callback is never entered");
  assert.deepEqual(result,{ok:false,reason:"corruption"});
  assert.equal((await readdir(root)).includes("lock"),false,"the active lock is not left live");
  assert.equal(admissionRetiredNames(await readdir(root)).length,1,"the drifted marker is preserved, not drained");
}));

// The published-successor classifier counts only SAME-OWNER candidates. Every used root carries the
// previous acquisition's `.authority-ledger-lock-<pid>-<nonce>.released` marker as steady-state
// residue (measured: one full option-on acquisition leaves exactly that artifact), so every
// mid-flight published-slot graph on a real root coexists with unrelated inert legacy residue.
// Counting that residue as a successor candidate turned a live healthy acquisition into a
// `corruption` verdict for every concurrent observer -- the defect that reverted the first narrow
// drainage build. These fixtures use a LIVE owner, so their `busy` verdicts are stable: no drainage
// route may ever touch a live owner's artifacts.
test("published-slot graphs tolerate unrelated inert legacy residue on a used root",async t=>{
  const assertDecisionUnchanged=async(root:string,expected:{ok:false;reason:"busy"|"corruption"})=>{const before=await snapshotRootArtifacts(root);let semanticNow=0,callbacks=0,legacyMutations=0;const result=await new RawFsAuthorityLedger(root,{now:()=>{semanticNow++;return t0;},lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="before-ledger-operation-callback")callbacks++;if(legacyMutationBoundaries.has(point))legacyMutations++;}} as never).observeClock();assert.deepEqual(result,expected);assert.deepEqual(await snapshotRootArtifacts(root),before);assert.deepEqual({semanticNow,callbacks,legacyMutations},{semanticNow:0,callbacks:0,legacyMutations:0});};
  const writeOwnerDirectory=async(root:string,name:string,owner:AdmissionOwner)=>{const directory=path.join(root,name);await mkdir(directory);await writeFile(path.join(directory,"owner.json"),publicationOwnerBytes(owner));return directory;};
  const writePublishedWithLock=async(root:string,owner:AdmissionOwner)=>{const markerName=admissionRetiredName(owner,"published"),marker=await writeOwnerDirectory(root,markerName,owner);await writeOwnerDirectory(root,"lock",owner);return {marker,markerName};};
  // The unrelated markers in the first two fixtures carry a LIVE pid on purpose: the motivating
  // residue is the previous acquisition of the SAME process (same pid, different nonce), so a
  // tolerance implemented only for dead foreign owners would pass a dead-pid fixture while leaving
  // the actual steady-state shape broken. Later fixtures use a dead foreign pid so both liveness
  // classes are covered.
  await t.test("published slot with its live same-owner lock tolerates an unrelated released marker",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"1".repeat(64),pid:process.pid,v:1 as const},foreign={host:hostname(),nonce:"a".repeat(64),pid:process.pid,v:1 as const};await writePublishedWithLock(root,owner);await writeOwnerDirectory(root,retirementMarkerName(foreign,"released"),foreign);await assertDecisionUnchanged(root,{ok:false,reason:"busy"});}));
  await t.test("published slot with its live same-owner lock tolerates an unrelated publication-aborted marker",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"2".repeat(64),pid:process.pid,v:1 as const},foreign={host:hostname(),nonce:"b".repeat(64),pid:process.pid,v:1 as const};await writePublishedWithLock(root,owner);await writeOwnerDirectory(root,retirementMarkerName(foreign,"publication-aborted"),foreign);await assertDecisionUnchanged(root,{ok:false,reason:"busy"});}));
  await t.test("mid-cleanup published slot with its bound acknowledgment tolerates an unrelated released marker",async()=>{const foreign={host:hostname(),nonce:"c".repeat(64),pid:await exitedProcessPid(),v:1 as const};await withRoot(async root=>{const owner={host:hostname(),nonce:"3".repeat(64),pid:process.pid,v:1 as const},graph=await writePublishedWithLock(root,owner),ack=slotCoordinationAck(owner,graph.markerName,graph.marker,"published","lock",publicationOwnerBytes(owner));await writeFile(path.join(root,coordinationAckName(ack)),authorityCanonicalBytes(ack));await writeOwnerDirectory(root,retirementMarkerName(foreign,"released"),foreign);await assertDecisionUnchanged(root,{ok:false,reason:"busy"});});});
  await t.test("orphan published-slot final bound to its live lock tolerates an unrelated released marker",async()=>{const foreign={host:hostname(),nonce:"d".repeat(64),pid:await exitedProcessPid(),v:1 as const};await withRoot(async root=>{const owner={host:hostname(),nonce:"4".repeat(64),pid:process.pid,v:1 as const},graph=await writePublishedWithLock(root,owner),ack=slotCoordinationAck(owner,graph.markerName,graph.marker,"published","lock",publicationOwnerBytes(owner));await writeFile(path.join(root,coordinationAckName(ack)),authorityCanonicalBytes(ack));await rm(graph.marker,{recursive:true});await writeOwnerDirectory(root,retirementMarkerName(foreign,"released"),foreign);await assertDecisionUnchanged(root,{ok:false,reason:"busy"});});});
  // The boundary of the tolerance, pinned so a filter that ignores EVERY foreign artifact cannot
  // pass: an unrelated recovery-pending marker is an unserviced semantic recovery obligation, not
  // inert residue, and a second same-owner successor is genuine ambiguity.
  // Foreign `recovery-pending` is conditioned on the ACTIVE LOCK being the successor. Spec :571
  // grants retirement-marker coexistence "only for the next active owner", and :862-863 makes that
  // owner the sole marker scanner servicing every recovery-pending marker before every callback —
  // inspectActiveLock's own dead-lock reclaim mints exactly this shape in the same iteration that
  // publishes, so refusing it would corrupt every acquisition that follows a crash-with-lock. With
  // no lock in the graph there is no next active owner, and the committed corpus pins corruption.
  await t.test("published slot with its live same-owner lock tolerates an unserviced foreign recovery-pending marker",async()=>{const foreign={host:hostname(),nonce:"e".repeat(64),pid:await exitedProcessPid(),v:1 as const};await withRoot(async root=>{const owner={host:hostname(),nonce:"5".repeat(64),pid:process.pid,v:1 as const};await writePublishedWithLock(root,owner);await writeOwnerDirectory(root,retirementMarkerName(foreign,"recovery-pending"),foreign);await assertDecisionUnchanged(root,{ok:false,reason:"busy"});});});
  await t.test("published slot without an active lock does not tolerate an unrelated recovery-pending marker",async()=>{const foreign={host:hostname(),nonce:"e".repeat(64),pid:await exitedProcessPid(),v:1 as const};await withRoot(async root=>{const owner={host:hostname(),nonce:"5".repeat(64),pid:process.pid,v:1 as const},markerName=admissionRetiredName(owner,"published");await writeOwnerDirectory(root,markerName,owner);await writeOwnerDirectory(root,retirementMarkerName(owner,"released"),owner);await writeOwnerDirectory(root,retirementMarkerName(foreign,"recovery-pending"),foreign);await assertDecisionUnchanged(root,{ok:false,reason:"corruption"});});});
  await t.test("published slot with two same-owner successors stays corruption",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"6".repeat(64),pid:process.pid,v:1 as const};await writePublishedWithLock(root,owner);await writeOwnerDirectory(root,retirementMarkerName(owner,"released"),owner);await assertDecisionUnchanged(root,{ok:false,reason:"corruption"});}));
  // A live FOREIGN active lock beside a published marker is invalid K1 topology, never tolerated
  // concurrency: admission is blocked while the marker exists, so no honest path publishes that
  // lock. Without this pin, an implementation that filters the lock by owner silently degrades
  // today's corruption verdict to busy.
  await t.test("published slot with a same-owner successor does not tolerate a foreign active lock",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"7".repeat(64),pid:process.pid,v:1 as const},foreign={host:hostname(),nonce:"8".repeat(64),pid:process.pid,v:1 as const},markerName=admissionRetiredName(owner,"published");await writeOwnerDirectory(root,markerName,owner);await writeOwnerDirectory(root,retirementMarkerName(owner,"released"),owner);await writeOwnerDirectory(root,"lock",foreign);await assertDecisionUnchanged(root,{ok:false,reason:"corruption"});}));
  // The two remaining call sites of the successor classification: legacy-cleanup coexistence and
  // the K1 cleanup-stage terminal proof must tolerate the same inert residue.
  await t.test("published slot with its released successor and legacy cleanup ack tolerates an unrelated released marker",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"9".repeat(64),pid:process.pid,v:1 as const},foreign={host:hostname(),nonce:"f".repeat(64),pid:process.pid,v:1 as const},slotName=admissionRetiredName(owner,"published");await writeOwnerDirectory(root,slotName,owner);const markerName=retirementMarkerName(owner,"released");await writeOwnerDirectory(root,markerName,owner);const ack=cleanupAck(owner,markerName,"released",null);await writeFile(path.join(root,cleanupAckName(ack)),authorityCanonicalBytes(ack));await writeOwnerDirectory(root,retirementMarkerName(foreign,"released"),foreign);await assertDecisionUnchanged(root,{ok:false,reason:"busy"});}));
  await t.test("published slot with its cleanup stage and live lock tolerates an unrelated released marker",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"0".repeat(64),pid:process.pid,v:1 as const},foreign={host:hostname(),nonce:"c".repeat(64),pid:process.pid,v:1 as const},graph=await writePublishedWithLock(root,owner),ack=slotCoordinationAck(owner,graph.markerName,graph.marker,"published","lock",publicationOwnerBytes(owner)),bytes=authorityCanonicalBytes(ack);await writeFile(path.join(root,coordinationStageName(ack,"slot-retired")),bytes.subarray(0,Math.min(17,bytes.length-1)));await writeOwnerDirectory(root,retirementMarkerName(foreign,"released"),foreign);await assertDecisionUnchanged(root,{ok:false,reason:"busy"});}));
  // The unrelated marker's own cleanup lifecycle is tolerated with it: ack durable -> marker
  // removed -> ack removed is the legacy machinery's resumable window, and refusing it just moves
  // the corruption one artifact later (measured: a real option-on acquisition over exactly this
  // residue publishes, retires its slot, and then classifies its own root as corruption).
  await t.test("published slot with its live lock tolerates an unrelated marker's resumable legacy cleanup",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"d".repeat(63)+"0",pid:process.pid,v:1 as const},foreign={host:hostname(),nonce:"d".repeat(63)+"1",pid:process.pid,v:1 as const};await writePublishedWithLock(root,owner);const markerName=retirementMarkerName(foreign,"released");await writeOwnerDirectory(root,markerName,foreign);const ack=cleanupAck(foreign,markerName,"released",null);await writeFile(path.join(root,cleanupAckName(ack)),authorityCanonicalBytes(ack));await assertDecisionUnchanged(root,{ok:false,reason:"busy"});}));
  await t.test("published slot with its live lock tolerates an unrelated orphan legacy cleanup ack",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"e".repeat(63)+"0",pid:process.pid,v:1 as const},foreign={host:hostname(),nonce:"e".repeat(63)+"1",pid:process.pid,v:1 as const};await writePublishedWithLock(root,owner);const ack=cleanupAck(foreign,retirementMarkerName(foreign,"released"),"released",null);await writeFile(path.join(root,cleanupAckName(ack)),authorityCanonicalBytes(ack));await assertDecisionUnchanged(root,{ok:false,reason:"busy"});}));
  // The live twin of the marker-owner-remove window: an EMPTY published marker beside its bound
  // acknowledgment and the live same-owner lock is a mid-window healthy acquisition — a concurrent
  // observer waits, mutates nothing, and no drainage may ever touch a live owner's artifacts.
  await t.test("mid-window empty published marker with its live lock stays busy and untouched",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"e".repeat(63)+"2",pid:process.pid,v:1 as const},graph=await writePublishedWithLock(root,owner),ack=slotCoordinationAck(owner,graph.markerName,graph.marker,"published","lock",publicationOwnerBytes(owner));await writeFile(path.join(root,coordinationAckName(ack)),authorityCanonicalBytes(ack));await unlink(path.join(graph.marker,"owner.json"));await assertDecisionUnchanged(root,{ok:false,reason:"busy"});}));
});

// The marker-removal window: unlink the owner object, then remove the directory. Before the
// `after-coordination-cleanup-marker-owner-remove` point existed, no test could reach the state
// between the two syscalls — a hard exit there leaves an EMPTY `published` marker beside its
// durable acknowledgment, which classified as permanent corruption (the second defect that
// reverted the first drainage build), and the unwind path that restores the owner bytes on an
// in-process failure was correct-by-construction and unverified (spec discrepancy 9, resolved by
// this point). The crash fixtures run WARM — a prior acquisition's `.released` marker present —
// so the window is exercised together with the same-owner successor tolerance it coexists with on
// every real root; the verdicts themselves are the same cold (measured by independent review).
test("marker-owner-remove window leaves a classifiable root and an exercisable repair",async t=>{
  const option=k1AdmissionPreparationOption();
  const warmup=async(root:string)=>{
    assert.deepEqual(await new RawFsAuthorityLedger(root,{[option]:K1_ADMISSION_PREPARATION_MODE,now:()=>t0,lockTimeoutMs:2_000} as never).observeClock(),{ok:true,status:"advanced",observedAt:new Date(t0).toISOString()},"the warmup acquisition succeeds");
    assert.equal((await readdir(root)).filter(name=>/\.released$/.test(name)).length,1,"the warm root carries the prior acquisition's released marker");
  };
  await t.test("hard exit between owner unlink and marker rmdir classifies, never corrupts",()=>withRoot(async root=>{
    await warmup(root);
    const moduleUrl=pathToFileURL(path.resolve("dist-test/src/authority/host/fs-ledger.js")).href;
    const source=`import*as host from ${JSON.stringify(moduleUrl)};const option=host.__testK1AdmissionPreparationRuntimeOption;if(typeof option!=="symbol")process.exit(80);const ledger=new host.FsAuthorityLedger(process.argv[1],{[option]:${JSON.stringify(K1_ADMISSION_PREPARATION_MODE)},now:()=>${t0+1_000},lockTimeoutMs:200,faultInjector(point){if(point==="after-coordination-cleanup-marker-owner-remove")process.exit(91);}});await ledger.observeClock();process.exit(92);`;
    const code=await new Promise<number|null>((resolve,reject)=>{const child=spawn(process.execPath,["--input-type=module","-e",source,root],{stdio:["ignore","ignore","ignore"]});child.once("error",reject);child.once("close",resolve);});
    assert.equal(code,91,"the window is a real hard-exit boundary");
    const names=await readdir(root),markers=names.filter(name=>name.startsWith(".authority-ledger-admission-retired-"));
    assert.equal(markers.length,1,"the half-drained marker survives");
    assert.equal(existsSync(path.join(root,markers[0]!,"owner.json")),false,"its owner object is already unlinked");
    assert.deepEqual(await readdir(path.join(root,markers[0]!)),[],"as exactly the empty directory the window leaves");
    assert.equal(names.filter(name=>name.startsWith(".authority-ledger-coordination-cleanup-")).length,1,"beside its durable acknowledgment");
    assert.equal(names.includes("lock"),true,"and the dead owner's live-format lock");
    // The granted foreign-dead-slot drainage: the empty marker classifies through the rescue,
    // its cleanup lifecycle resumes, and the root heals in one acquisition. Before the grant this
    // pinned exact `busy`; the flip ships in the same commit as the grant.
    assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0+2_000,lockTimeoutMs:2_000} as never).observeClock(),{ok:true,status:"advanced",observedAt:new Date(t0+2_000).toISOString()},"the crash window drains and the root heals");
    assert.deepEqual(coordinationResidue(await readdir(root)),[],"with zero admission-family residue");
  }));
  await t.test("an in-process failure inside the window restores the owner bytes it removed",()=>withRoot(async root=>{
    await warmup(root);
    const boom=new Error("injected marker-owner-remove failure");let fired=0,removedOwnerBytes:Buffer|null=null;
    await assert.rejects(new RawFsAuthorityLedger(root,{[option]:K1_ADMISSION_PREPARATION_MODE,now:()=>t0+1_000,lockTimeoutMs:2_000,faultInjector:(point:string)=>{
      if(point==="after-admission-slot-retire-root-sync"){const marker=admissionRetiredNames(readdirSync(root))[0]!;removedOwnerBytes=readFileSync(path.join(root,marker,"owner.json"));}
      if(point==="after-coordination-cleanup-marker-owner-remove"&&fired++===0)throw boom;
    }} as never).observeClock(),(error:unknown)=>error===boom,"the injected window failure propagates by identity");
    assert.ok(removedOwnerBytes!==null,"the fixture captured the marker owner bytes the pass later removed");
    const names=await readdir(root),markers=names.filter(name=>name.startsWith(".authority-ledger-admission-retired-")&&name.endsWith(".published"));
    assert.equal(markers.length,1,"the published marker survives the unwind");
    assert.deepEqual(await readdir(path.join(root,markers[0]!)),["owner.json"],"restored to exactly its owner object");
    assert.deepEqual(await readFile(path.join(root,markers[0]!,"owner.json")),removedOwnerBytes,"with the exact bytes the pass removed");
    const aborted=names.filter(name=>/\.publication-aborted$/.test(name));
    assert.equal(aborted.length,1,"the failure path aborts the freshly published lock");
    assert.equal(names.filter(name=>name.startsWith(".authority-ledger-coordination-cleanup-")).length,0,"the pass dropped its own stage and acknowledgment");
    assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0+2_000,lockTimeoutMs:200} as never).observeClock(),{ok:false,reason:"busy"},"the restored live-owner graph classifies busy");
  }));
  // The two housekeeper flavors emit the same point between THEIR unlink and rmdir. Without these,
  // a build emitting only in the own-act pass is fully green (measured by independent review). The
  // empty-marker fixture is the guard discriminator: nothing was unlinked, so the point must not
  // fire — an emission placed outside the children-present guard fires there and fails it.
  await t.test("the housekeeper marker removal emits the window point exactly once, before marker-remove",()=>withRoot(async root=>{
    const owner={host:hostname(),nonce:"f".repeat(63)+"2",pid:process.pid,v:1 as const},markerName=admissionPrepRetiredName(owner,"complete"),marker=path.join(root,markerName);
    await mkdir(marker);await writeFile(path.join(marker,"owner.json"),publicationOwnerBytes(owner));
    const ack=incompleteCoordinationAck(owner,"prep-retired",markerName,admissionPrepName(owner),"complete",marker);
    await writeFile(path.join(root,coordinationAckName(ack)),authorityCanonicalBytes(ack));
    const observed:string[]=[];
    const result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:2_000,faultInjector:(point:string)=>{if(point==="after-coordination-cleanup-marker-owner-remove"||point==="after-coordination-cleanup-marker-remove")observed.push(point);}} as never).recover();
    assert.equal(result.ok,true,"the housekeeper drains the retired-prep lineage");
    assert.deepEqual(observed,["after-coordination-cleanup-marker-owner-remove","after-coordination-cleanup-marker-remove"],"owner unlink fires the window point once, before the directory removal point");
    assert.equal((await readdir(root)).some(name=>name.startsWith(".authority-ledger-")),false,"and the lineage drains completely");
  }));
  await t.test("an empty marker unlinks nothing and must not fire the window point",()=>withRoot(async root=>{
    const owner={host:hostname(),nonce:"f".repeat(63)+"3",pid:process.pid,v:1 as const},markerName=admissionPrepRetiredName(owner,"empty"),marker=path.join(root,markerName);
    await mkdir(marker);
    const ack=incompleteCoordinationAck(owner,"prep-retired",markerName,admissionPrepName(owner),"empty",marker);
    await writeFile(path.join(root,coordinationAckName(ack)),authorityCanonicalBytes(ack));
    const observed:string[]=[];
    const result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:2_000,faultInjector:(point:string)=>{if(point==="after-coordination-cleanup-marker-owner-remove"||point==="after-coordination-cleanup-marker-remove")observed.push(point);}} as never).recover();
    assert.equal(result.ok,true,"the housekeeper drains the empty-marker lineage");
    assert.deepEqual(observed,["after-coordination-cleanup-marker-remove"],"no owner object was unlinked, so the window point never fires");
    assert.equal((await readdir(root)).some(name=>name.startsWith(".authority-ledger-")),false,"and the lineage drains completely");
  }));
  await t.test("the slot housekeeper marker removal emits the window point exactly once",async()=>{
    const owner={host:hostname(),nonce:"f".repeat(63)+"4",pid:await exitedProcessPid(),v:1 as const};
    await withRoot(async root=>{
      const markerName=admissionRetiredName(owner,"abandoned"),marker=path.join(root,markerName);
      await mkdir(marker);await writeFile(path.join(marker,"owner.json"),publicationOwnerBytes(owner));
      const ack=slotCoordinationAck(owner,markerName,marker,"abandoned");
      await writeFile(path.join(root,coordinationAckName(ack)),authorityCanonicalBytes(ack));
      const observed:string[]=[];
      const result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:2_000,faultInjector:(point:string)=>{if(point==="after-coordination-cleanup-marker-owner-remove")observed.push(point);}} as never).recover();
      assert.equal(result.ok,true,"the housekeeper drains the dead-owner abandoned lineage");
      assert.deepEqual(observed,["after-coordination-cleanup-marker-owner-remove"],"the slot flavor fires the window point exactly once");
      assert.equal((await readdir(root)).some(name=>name.startsWith(".authority-ledger-")),false,"and the lineage drains completely");
    });
  });
  await t.test("an empty slot marker unlinks nothing and must not fire the window point",async()=>{
    const owner={host:hostname(),nonce:"f".repeat(63)+"5",pid:await exitedProcessPid(),v:1 as const};
    await withRoot(async root=>{
      const markerName=admissionRetiredName(owner,"abandoned"),marker=path.join(root,markerName);
      await mkdir(marker);await writeFile(path.join(marker,"owner.json"),publicationOwnerBytes(owner));
      const ack=slotCoordinationAck(owner,markerName,marker,"abandoned");
      await writeFile(path.join(root,coordinationAckName(ack)),authorityCanonicalBytes(ack));
      await unlink(path.join(marker,"owner.json"));
      const observed:string[]=[];
      const result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:2_000,faultInjector:(point:string)=>{if(point==="after-coordination-cleanup-marker-owner-remove")observed.push(point);}} as never).recover();
      assert.equal(result.ok,true,"the housekeeper drains the authenticated-partial abandoned lineage");
      assert.deepEqual(observed,[],"no owner object was unlinked, so the window point never fires");
      assert.equal((await readdir(root)).some(name=>name.startsWith(".authority-ledger-")),false,"and the lineage drains completely");
    });
  });
});

// The granted foreign-dead-slot drainage route (owner decision 2026-08-05): any contender may
// retire a DEAD-OWNER fixed slot as `published`, but ONLY where the exact same-owner active lock
// or a named successor is present. These pins drive the real crash lineages — an option-on child
// hard-exited at a fault point on a WARM root (the prior acquisition's `.released` marker present,
// the shape every real root has) — and require the root to self-heal completely. The abandoned
// family stays recover()-only: the bare-slot guard at the end pins the grant's boundary.
test("foreign-dead-slot drainage retires and drains the granted shapes",{timeout:60_000},async t=>{
  const option=k1AdmissionPreparationOption();
  const warmup=async(root:string)=>{
    assert.deepEqual(await new RawFsAuthorityLedger(root,{[option]:K1_ADMISSION_PREPARATION_MODE,now:()=>t0,lockTimeoutMs:2_000} as never).observeClock(),{ok:true,status:"advanced",observedAt:new Date(t0).toISOString()},"the warmup acquisition succeeds");
    assert.equal((await readdir(root)).filter(name=>/\.released$/.test(name)).length,1,"the warm root carries the prior acquisition's released marker");
  };
  const crashChild=async(root:string,point:string)=>{
    const moduleUrl=pathToFileURL(path.resolve("dist-test/src/authority/host/fs-ledger.js")).href;
    const source=`import*as host from ${JSON.stringify(moduleUrl)};const option=host.__testK1AdmissionPreparationRuntimeOption;if(typeof option!=="symbol")process.exit(80);const ledger=new host.FsAuthorityLedger(process.argv[1],{[option]:${JSON.stringify(K1_ADMISSION_PREPARATION_MODE)},now:()=>${t0+1_000},lockTimeoutMs:200,faultInjector(point){if(point===${JSON.stringify(point)})process.exit(91);}});await ledger.observeClock();process.exit(92);`;
    const code=await new Promise<number|null>((resolve,reject)=>{const child=spawn(process.execPath,["--input-type=module","-e",source,root],{stdio:["ignore","ignore","ignore"]});child.once("error",reject);child.once("close",resolve);});
    assert.equal(code,91,`${point} is a real hard-exit boundary`);
  };
  // The admission/coordination oracle alone would miss legacy debris the drainage could wrongly
  // leave or mint (a stray recovery-pending marker, an unremoved cleanup stage, the lock itself),
  // so the healed state is additionally pinned to exactly one `.released` marker and no `lock`.
  const legacyResidue=(names:readonly string[])=>names.filter(name=>/^\.authority-ledger-lock-/.test(name)).sort();
  const assertHealed=async(root:string,label:string)=>{
    assert.deepEqual(coordinationResidue(await readdir(root)),[],`${label}: zero admission-family residue`);
    const legacy=legacyResidue(await readdir(root));
    assert.equal(legacy.length,1,`${label}: exactly one legacy marker remains`);
    assert.match(legacy[0]!,/\.released$/,`${label}: and it is the released marker of the healing acquisition`);
    assert.equal(existsSync(path.join(root,"lock")),false,`${label}: no live lock remains`);
  };
  // The stage-partial-write row is the ack byte-reconstruction path: the housekeeper must rebuild
  // the crashed own-act acknowledgment byte-identically and APPEND to the one-byte stage, or the
  // lifecycle wedges busy instead of resuming.
  const crashPoints=["after-lock-publication-root-sync","after-admission-slot-retire-root-sync","after-coordination-cleanup-stage-partial-write","after-coordination-cleanup-ack-root-sync","after-coordination-cleanup-marker-remove"] as const;
  for(const point of crashPoints)await t.test(`recover() drains the ${point} crash and the root self-heals`,()=>withRoot(async root=>{
    await warmup(root);
    await crashChild(root,point);
    const recovered=await new RawFsAuthorityLedger(root,{now:()=>t0+2_000,lockTimeoutMs:2_000} as never).recover();
    assert.equal(recovered.ok,true,`${point}: recover() succeeds on the crashed root`);
    assert.deepEqual(coordinationResidue(await readdir(root)),[],`${point}: recover() drained every admission-family artifact`);
    assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0+3_000,lockTimeoutMs:2_000} as never).observeClock(),{ok:true,status:"advanced",observedAt:new Date(t0+3_000).toISOString()},`${point}: the next default acquisition completes`);
    await assertHealed(root,point);
  }));
  await t.test("a default lock-seeking contender performs the granted drainage in one acquisition",()=>withRoot(async root=>{
    await warmup(root);
    await crashChild(root,"after-admission-slot-retire-root-sync");
    let callbacks=0;
    const result=await new RawFsAuthorityLedger(root,{now:()=>t0+2_000,lockTimeoutMs:2_000,faultInjector:(point:string)=>{if(point==="before-ledger-operation-callback"){callbacks++;assert.deepEqual(coordinationResidue(readdirSync(root)),[],"the callback is entered only after the foreign residue is drained");}}} as never).observeClock();
    assert.deepEqual(result,{ok:true,status:"advanced",observedAt:new Date(t0+2_000).toISOString()},"one default acquisition drains and completes");
    assert.equal(callbacks,1,"with exactly one callback");
    await assertHealed(root,"one-acquisition self-heal");
  }));
  // The grant makes a READ entry point a writer on another process's dead artifacts. That is
  // intended — it is the wedge being removed — and this pin records it: before the grant this
  // exact call raised AuthorityLedgerReadError(busy) forever.
  await t.test("getHighWaterMark performs the granted drainage before its read",()=>withRoot(async root=>{
    await warmup(root);
    await crashChild(root,"after-coordination-cleanup-ack-root-sync");
    const mark=await new RawFsAuthorityLedger(root,{now:()=>t0+2_000,lockTimeoutMs:2_000} as never).getHighWaterMark();
    assert.deepEqual(mark,{observedAt:new Date(t0).toISOString()},"the read returns the durable mark the crashed child never advanced");
    assert.deepEqual(coordinationResidue(await readdir(root)),[],"and the read drained the foreign residue on its way");
  }));
  await t.test("two same-process contenders converge on the crashed root with zero residue",()=>withRoot(async root=>{
    await warmup(root);
    await crashChild(root,"after-admission-slot-retire-root-sync");
    // Same instant on purpose: this subtest pins convergence, not fence-admission order. The
    // first-admitted contender advances the clock; the other observes the equal durable instant.
    const [first,second]=await Promise.all([
      new RawFsAuthorityLedger(root,{now:()=>t0+2_000,lockTimeoutMs:5_000} as never).observeClock(),
      new RawFsAuthorityLedger(root,{now:()=>t0+2_000,lockTimeoutMs:5_000} as never).observeClock(),
    ]);
    for(const result of [first,second]){
      assert.equal((result as Readonly<{ok:boolean}>).ok,true,"both contenders complete");
      assert.ok(["advanced","equal"].includes((result as Readonly<{status?:string}>).status??""),"each either advances or observes the equal durable instant");
    }
    assert.deepEqual(coordinationResidue(await readdir(root)),[],"and the root converges with zero residue");
  }));
  // The boundary of the grant: a bare dead-owner slot has NO same-owner lock or successor, so it
  // is the `abandoned` family — reserved to recover(), byte-identical under any lock-seeking
  // contender exactly as the committed dead-owner orphan pins require.
  await t.test("a bare dead slot stays reserved to recover() under the grant",()=>withRoot(async root=>{
    await warmup(root);
    await crashChild(root,"after-admission-slot-root-sync");
    // The first contender legitimately drains the prior `.released` marker (the pre-classification
    // legacy service is sanctioned mutation); the GRANT boundary is that the bare slot itself is
    // the `abandoned` family and stays byte-identical under every later lock-seeking contender,
    // exactly as the committed dead-owner orphan pins require.
    assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0+2_000,lockTimeoutMs:200} as never).observeClock(),{ok:false,reason:"busy"},"a lock-seeking contender declines the abandoned family");
    const before=await snapshotRootArtifacts(root);
    assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0+3_000,lockTimeoutMs:200} as never).observeClock(),{ok:false,reason:"busy"},"and keeps declining");
    assert.deepEqual(await snapshotRootArtifacts(root),before,"byte-identically");
    const recovered=await new RawFsAuthorityLedger(root,{now:()=>t0+4_000,lockTimeoutMs:2_000} as never).recover();
    assert.equal(recovered.ok,true,"recover() still drains it");
    assert.deepEqual(coordinationResidue(await readdir(root)),[],"completely");
  }));
  // The abandoned family's MIDDLE states (marker plus its cleanup acknowledgment, dead owner) are
  // likewise outside the grant: a lock-seeking contender leaves them byte-identical; only
  // recover() advances them.
  await t.test("an abandoned marker mid-lifecycle stays reserved to recover() under the grant",async()=>{
    const owner={host:hostname(),nonce:"a".repeat(63)+"b",pid:await exitedProcessPid(),v:1 as const};
    await withRoot(async root=>{
      const markerName=admissionRetiredName(owner,"abandoned"),marker=path.join(root,markerName);
      await mkdir(marker);await writeFile(path.join(marker,"owner.json"),publicationOwnerBytes(owner));
      const ack=slotCoordinationAck(owner,markerName,marker,"abandoned");
      await writeFile(path.join(root,coordinationAckName(ack)),authorityCanonicalBytes(ack));
      const before=await snapshotRootArtifacts(root);
      for(const at of [t0+1_000,t0+2_000])assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>at,lockTimeoutMs:200} as never).observeClock(),{ok:false,reason:"busy"},"a lock-seeking contender declines the abandoned lifecycle");
      assert.deepEqual(await snapshotRootArtifacts(root),before,"byte-identically");
      const recovered=await new RawFsAuthorityLedger(root,{now:()=>t0+3_000,lockTimeoutMs:2_000} as never).recover();
      assert.equal(recovered.ok,true,"recover() advances it");
      assert.deepEqual(coordinationResidue(await readdir(root)),[],"to completion");
    });
  });
  // The wedge a wrong retirement disposition would mint, pinned by name: an `.abandoned` marker
  // beside a live-format lock has an impossible successor and is preserved corruption — so an
  // implementation that retires a locked slot as abandoned fails here, not just downstream.
  await t.test("an abandoned marker beside a same-owner lock is preserved corruption",async()=>{
    const owner={host:hostname(),nonce:"a".repeat(63)+"c",pid:await exitedProcessPid(),v:1 as const};
    await withRoot(async root=>{
      const markerName=admissionRetiredName(owner,"abandoned"),marker=path.join(root,markerName);
      await mkdir(marker);await writeFile(path.join(marker,"owner.json"),publicationOwnerBytes(owner));
      await mkdir(path.join(root,"lock"));await writeFile(path.join(root,"lock","owner.json"),publicationOwnerBytes(owner));
      const before=await snapshotRootArtifacts(root);
      assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0+1_000,lockTimeoutMs:200} as never).observeClock(),{ok:false,reason:"corruption"},"the impossible successor refuses");
      assert.deepEqual(await snapshotRootArtifacts(root),before,"and is preserved");
    });
  });
});

test("warm preparation-stage crashes recover from both entry points and the root self-heals",{timeout:120_000},async t=>{
  const option=k1AdmissionPreparationOption();
  const warmup=async(root:string)=>{
    assert.deepEqual(await new RawFsAuthorityLedger(root,{[option]:K1_ADMISSION_PREPARATION_MODE,now:()=>t0,lockTimeoutMs:2_000} as never).observeClock(),{ok:true,status:"advanced",observedAt:new Date(t0).toISOString()},"the warmup acquisition succeeds");
    assert.equal((await readdir(root)).filter(name=>/\.released$/.test(name)).length,1,"the warm root carries the prior acquisition's released marker");
  };
  const crashChild=async(root:string,point:string)=>{
    const moduleUrl=pathToFileURL(path.resolve("dist-test/src/authority/host/fs-ledger.js")).href;
    const source=`import*as host from ${JSON.stringify(moduleUrl)};const option=host.__testK1AdmissionPreparationRuntimeOption;if(typeof option!=="symbol")process.exit(80);const ledger=new host.FsAuthorityLedger(process.argv[1],{[option]:${JSON.stringify(K1_ADMISSION_PREPARATION_MODE)},now:()=>${t0+1_000},lockTimeoutMs:200,faultInjector(point){if(point===${JSON.stringify(point)})process.exit(91);}});await ledger.observeClock();process.exit(92);`;
    const code=await new Promise<number|null>((resolve,reject)=>{const child=spawn(process.execPath,["--input-type=module","-e",source,root],{stdio:["ignore","ignore","ignore"]});child.once("error",reject);child.once("close",resolve);});
    assert.equal(code,91,`${point} is a real hard-exit boundary`);
  };
  const legacyResidue=(names:readonly string[])=>names.filter(name=>/^\.authority-ledger-lock-/.test(name)).sort();
  const assertHealed=async(root:string,label:string)=>{
    assert.deepEqual(coordinationResidue(await readdir(root)),[],`${label}: zero admission-family residue`);
    const legacy=legacyResidue(await readdir(root));
    assert.equal(legacy.length,1,`${label}: exactly one legacy marker remains`);
    assert.match(legacy[0]!,/\.released$/,`${label}: and it is the released marker of the healing acquisition`);
    assert.equal(existsSync(path.join(root,"lock")),false,`${label}: no live lock remains`);
  };
  // The six pre-rename boundaries leave a dead PREPARATION beside the warm root's steady-state
  // `.released` marker — the shape the spec records (2026-08-05) as permanently corrupt from both
  // entry points. The healed contract below is the FRESH-root behavior of the same crash, measured
  // before the fix: a lock-seeking contender refuses `busy` (dead-prep retirement stays recover()'s;
  // the red default-path pins above are not pre-decided here), recover() drains, and the next
  // default acquisition completes on a root indistinguishable from steady state.
  const preRenamePoints=["after-admission-prep-create","after-admission-prep-owner-create","after-admission-prep-owner-partial-write","after-admission-prep-owner-sync","after-admission-prep-sync","before-admission-slot-rename"] as const;
  // The three post-rename boundaries leave the fixed SLOT instead; those already drain warm via
  // recover() — pinned here as regression guards so the preparation fix cannot cost the slot path.
  const postRenamePoints=["after-admission-slot-rename","after-admission-slot-root-sync","after-admission-slot-final-validation"] as const;
  const pinWarmCrashHeals=(point:string)=>withRoot(async root=>{
    await warmup(root);
    await crashChild(root,point);
    let callbacks=0;
    const observed=await new RawFsAuthorityLedger(root,{now:()=>t0+2_000,lockTimeoutMs:300,faultInjector:(faultPoint:string)=>{if(faultPoint==="before-ledger-operation-callback")callbacks++;}} as never).observeClock();
    assert.deepEqual(observed,{ok:false,reason:"busy"},`${point}: a lock-seeking contender refuses busy, never corruption`);
    assert.equal(callbacks,0,`${point}: and enters no callback`);
    const recovered=await new RawFsAuthorityLedger(root,{now:()=>t0+3_000,lockTimeoutMs:2_000} as never).recover();
    assert.equal(recovered.ok,true,`${point}: recover() succeeds on the warm crashed root`);
    assert.deepEqual(coordinationResidue(await readdir(root)),[],`${point}: recover() drained every admission-family artifact`);
    assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0+4_000,lockTimeoutMs:2_000} as never).observeClock(),{ok:true,status:"advanced",observedAt:new Date(t0+4_000).toISOString()},`${point}: the next default acquisition completes`);
    await assertHealed(root,point);
  });
  for(const point of preRenamePoints)await t.test(`warm ${point} crash classifies busy, drains via recover(), and heals`,()=>pinWarmCrashHeals(point));
  for(const point of postRenamePoints)await t.test(`warm ${point} crash keeps draining via recover() and heals`,()=>pinWarmCrashHeals(point));
  // The boundary of the tolerance, pinned from day one: an unrelated `recovery-pending` marker is
  // SEMANTIC residue — the legacy service never drains one, and with no active lock there is no
  // next active owner to service it (the published-successor rule's exact precedent) — so beside a
  // dead preparation it stays preserved corruption under both entry points. The preparation is a
  // real crash child's; only the marker is seeded, because no warmup mints a recovery-pending.
  await t.test("a dead preparation beside an unrelated recovery-pending marker stays preserved corruption",async()=>{
    const markerOwner={host:hostname(),nonce:"e".repeat(63)+"d",pid:await exitedProcessPid(),v:1 as const};
    await withRoot(async root=>{
      await crashChild(root,"after-admission-prep-sync");
      const marker=path.join(root,retirementMarkerName(markerOwner,"recovery-pending"));
      await mkdir(marker);await writeFile(path.join(marker,"owner.json"),publicationOwnerBytes(markerOwner));
      const before=await snapshotRootArtifacts(root);
      assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0+2_000,lockTimeoutMs:200} as never).observeClock(),{ok:false,reason:"corruption"},"a lock-seeking contender preserves the semantic-residue graph");
      assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0+3_000,lockTimeoutMs:200} as never).recover(),{ok:false,reason:"corruption"},"recover() refuses it identically");
      assert.deepEqual(await snapshotRootArtifacts(root),before,"byte-identically");
    });
  });
  // The same-owner edge of the tolerance: a released marker carrying the preparation's OWN owner
  // tuple has no real lineage (a nonce is minted fresh per acquisition and release follows the
  // cleanup pass), so it stays preserved corruption — and this pin is what keeps the
  // sameCoordinationOwner clause in blockingRetiredResidue alive under mutation testing.
  await t.test("a preparation beside its own same-owner released marker stays preserved corruption",()=>withRoot(async root=>{
    const owner={host:hostname(),nonce:"c7".repeat(32),pid:process.pid,v:1 as const};
    await writeAdmissionPrep(root,owner,"complete");
    await writeLegacyRetiredLock(root,owner,"released");
    const before=await snapshotRootArtifacts(root);
    assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0+2_000,lockTimeoutMs:200} as never).observeClock(),{ok:false,reason:"corruption"},"a lock-seeking contender preserves the impossible same-owner graph");
    assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0+3_000,lockTimeoutMs:200} as never).recover(),{ok:false,reason:"corruption"},"recover() refuses it identically");
    assert.deepEqual(await snapshotRootArtifacts(root),before,"byte-identically");
  }));
  // Every warm option-on acquisition passes through {live preparation + prior released marker}
  // between creating its preparation and its own post-publication legacy drain — so a concurrent
  // observer meets this graph on every used root. The tolerance classifies it busy; the pin also
  // holds observation to ZERO mutation, the property that separates the shipped tolerance design
  // from the rejected pre-classification-drain candidate, which would drain the live creator's
  // neighboring marker from a read-intent entry point.
  await t.test("a live in-flight preparation beside the warm released marker is observed busy without mutation",()=>withRoot(async root=>{
    const prepOwner={host:hostname(),nonce:"a5".repeat(32),pid:process.pid,v:1 as const},markerOwner={host:hostname(),nonce:"b6".repeat(32),pid:process.pid,v:1 as const};
    await writeAdmissionPrep(root,prepOwner,"complete");
    await writeLegacyRetiredLock(root,markerOwner,"released");
    const before=await snapshotRootArtifacts(root);
    let callbacks=0;
    assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0+2_000,lockTimeoutMs:200,faultInjector:(faultPoint:string)=>{if(faultPoint==="before-ledger-operation-callback")callbacks++;}} as never).observeClock(),{ok:false,reason:"busy"},"a lock-seeking contender observes the live mid-flight graph busy");
    assert.equal(callbacks,0,"and enters no callback");
    assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>t0+3_000,lockTimeoutMs:200} as never).recover(),{ok:false,reason:"busy"},"recover() defers to the live creator identically");
    assert.deepEqual(await snapshotRootArtifacts(root),before,"and neither entry point mutates one byte");
  }));
});

// The reused-root discipline, institutionalized for the DEFAULT path. Every residue defect this
// corpus has shipped (six by now) survived a green suite because fixtures used fresh roots; this
// family runs one root through repeated default acquisitions interleaved with real hard-exit
// crashes and recover() calls, asserting the residue and healed-state oracles at every step. The
// oracles: the default path never mints an admission-family artifact (even mid-crash), a healing
// acquisition leaves exactly one released marker and no lock, and recover() leaves zero legacy
// residue. Deterministic — sequential children at fixed points, no races beyond the committed
// crash-child pattern.
test("reused roots on the default path stay healed across acquisitions, crashes, and recover()",{timeout:120_000},async t=>{
  const crashDefaultChild=async(root:string,point:string)=>{
    const moduleUrl=pathToFileURL(path.resolve("dist-test/src/authority/host/fs-ledger.js")).href;
    const source=`import{FsAuthorityLedger}from ${JSON.stringify(moduleUrl)};const ledger=new FsAuthorityLedger(process.argv[1],{now:()=>${t0+500},lockTimeoutMs:200,faultInjector(point){if(point===${JSON.stringify(point)})process.exit(91);}});await ledger.observeClock();process.exit(92);`;
    let stderr="";
    const code=await new Promise<number|null>((resolve,reject)=>{const child=spawn(process.execPath,["--input-type=module","-e",source,root],{stdio:["ignore","ignore","pipe"]});child.stderr.setEncoding("utf8").on("data",chunk=>{stderr+=chunk;});child.once("error",reject);child.once("close",resolve);});
    assert.equal(code,91,`${point} is a real hard-exit boundary on the default path: ${stderr}`);
  };
  const legacyResidue=(names:readonly string[])=>names.filter(name=>/^\.authority-ledger-lock-/.test(name)).sort();
  const assertNoAdmissionResidue=async(root:string,label:string)=>{
    assert.deepEqual(coordinationResidue(await readdir(root)),[],`${label}: the default path minted no admission-family artifact`);
  };
  const assertSteady=async(root:string,label:string)=>{
    await assertNoAdmissionResidue(root,label);
    const legacy=legacyResidue(await readdir(root));
    assert.equal(legacy.length,1,`${label}: exactly one legacy marker remains`);
    assert.match(legacy[0]!,/\.released$/,`${label}: and it is the healing acquisition's released marker`);
    assert.equal(existsSync(path.join(root,"lock")),false,`${label}: no live lock remains`);
  };
  const observeAdvances=async(root:string,at:number,label:string)=>{
    let callbacks=0;
    assert.deepEqual(await new RawFsAuthorityLedger(root,{now:()=>at,lockTimeoutMs:2_000,faultInjector:(faultPoint:string)=>{if(faultPoint==="before-ledger-operation-callback")callbacks++;}} as never).observeClock(),{ok:true,status:"advanced",observedAt:new Date(at).toISOString()},`${label}: the acquisition completes`);
    assert.equal(callbacks,1,`${label}: with exactly one semantic callback`);
  };
  await t.test("one root survives the crash-and-heal lifecycle end to end",()=>withRoot(async root=>{
    await observeAdvances(root,t0+1_000,"fresh-root acquisition");
    await assertSteady(root,"after the first acquisition");
    await crashDefaultChild(root,"after-lock-publication-stage-sync");
    await assertNoAdmissionResidue(root,"after the mid-publication crash");
    await observeAdvances(root,t0+2_000,"heal over the dead publication stage");
    await assertSteady(root,"after the dead stage was withdrawn");
    await crashDefaultChild(root,"after-lock-publication-root-sync");
    await assertNoAdmissionResidue(root,"after the post-publication crash");
    assert.equal(existsSync(path.join(root,"lock")),true,"the crash left the dead owner's live-format lock");
    await observeAdvances(root,t0+3_000,"heal over the dead lock");
    await assertSteady(root,"after the dead lock was reclaimed");
    await crashDefaultChild(root,"after-lock-publication-root-sync");
    const recovered=await new RawFsAuthorityLedger(root,{now:()=>t0+4_000,lockTimeoutMs:2_000} as never).recover();
    assert.equal(recovered.ok,true,"recover() drains the same crash shape first");
    await assertNoAdmissionResidue(root,"after recover() on the crashed root");
    await observeAdvances(root,t0+5_000,"acquisition after recover()");
    await assertSteady(root,"after the post-recover acquisition");
    await crashDefaultChild(root,"after-lock-retire");
    await assertNoAdmissionResidue(root,"after the post-retire crash");
    await observeAdvances(root,t0+6_000,"heal over the retired residue");
    await assertSteady(root,"after the post-retire heal");
    // Measured 2026-08-05, and this test's first two runs each refuted a drafted oracle (zero
    // markers, then untouched marker): recover() on a HEALED root runs a full lock cycle of its
    // own — it drains the prior acquisition's released marker through the legacy steady-state
    // machinery and leaves its OWN released marker behind. The durable shape is invariant
    // (exactly one released marker, no lock, no admission residue); the marker's identity is the
    // recover() call's, not the predecessor's. Scoping, so this pin is not read against the
    // spec's "recover() ... without taking the lock": that sentence is the K1 writer-only route
    // (housekeeping progress with no contender admission); DEFAULT-path recover() must hold the
    // legacy lock, because the spec makes the next complete active-lock owner the sole marker
    // scanner and recover() demonstrably drained the predecessor's marker here.
    const beforeIdle=legacyResidue(await readdir(root));
    const drained=await new RawFsAuthorityLedger(root,{now:()=>t0+7_000,lockTimeoutMs:2_000} as never).recover();
    assert.equal(drained.ok,true,"recover() on a healed root succeeds");
    await assertNoAdmissionResidue(root,"after recover() on the healed root");
    await assertSteady(root,"after the idle recover()");
    assert.notDeepEqual(legacyResidue(await readdir(root)),beforeIdle,"the surviving released marker is recover()'s own, not the predecessor's");
    await observeAdvances(root,t0+8_000,"the root remains serviceable after the idle recover()");
    await assertSteady(root,"at the end of the lifecycle");
  }));
});

// Warm parity — measured 2026-08-05 (Batch B probe, the sixth fresh-root-blindness instance):
// every withdrawal-chain crash residue below classified bounded `busy` on a fresh root and
// permanent `corruption` from BOTH entry points once the root also carried the steady-state
// unrelated `.released` marker every used root keeps — so the committed eight-state matrix was
// satisfiable only on never-used directories. Owner decision D4 (2026-08-05) grants the
// released-only tolerance and this family as its guard. The parity pins assert PARITY (same
// result and the same surviving seeded artifacts, warm vs fresh), never absolute outcomes, so
// they remain valid when the withdrawal chain lands and these residues progress instead of
// waiting; the two absolute anchors pin fresh live-residue `busy`, which the live-preservation
// family (:1135-:1170) pins independently. The boundary pins hold the tolerance edge at every
// tolerance site: only the UNRELATED `released` marker is inert — a SAME-owner `released` has no
// real lineage (release follows the cleanup pass), and an UNRELATED `publication-aborted` has no
// measured withdrawal-family lineage.
test("withdrawal-family crash residue classifies identically on warm and fresh roots",{timeout:120_000},async t=>{
  const eightStates=["slot-withdrawal","slot-withdrawal-slot-stage","slot-withdrawal-slot-ack","withdrawal-slot-ack","withdrawal-slot-ack-withdrawal-stage","withdrawal-both-acks","withdrawal-withdrawal-ack","orphan-withdrawal-ack"] as const;
  type SeededRole=readonly [role:string,name:string];
  const seedEight=async(root:string,owner:AdmissionOwner,state:typeof eightStates[number]):Promise<SeededRole[]>=>{
    const withdrawalName=creatorWithdrawalName(owner,"partial"),withdrawal=path.join(root,withdrawalName),slotName=admissionRetiredName(owner,"withdrawn"),slot=path.join(root,slotName);
    await mkdir(withdrawal);await writeFile(path.join(withdrawal,"owner.json"),ownerStateBytes(owner,"partial"));
    await mkdir(slot);await writeFile(path.join(slot,"owner.json"),publicationOwnerBytes(owner));
    const slotAck=slotCoordinationAck(owner,slotName,slot,"withdrawn",withdrawalName,ownerStateBytes(owner,"partial")),slotAckName=coordinationAckName(slotAck),slotStageName=coordinationStageName(slotAck,"slot-retired");
    if(state==="slot-withdrawal-slot-stage")await writeFile(path.join(root,slotStageName),authorityCanonicalBytes(slotAck));
    if(!["slot-withdrawal","slot-withdrawal-slot-stage"].includes(state))await writeFile(path.join(root,slotAckName),authorityCanonicalBytes(slotAck));
    if(["withdrawal-slot-ack","withdrawal-slot-ack-withdrawal-stage","withdrawal-both-acks","withdrawal-withdrawal-ack","orphan-withdrawal-ack"].includes(state))await rm(slot,{recursive:true});
    const withdrawalAck=incompleteCoordinationAck(owner,"creator-withdrawal",withdrawalName,publicationStageName({...owner,ticket:"0000000000000001"}),"partial",withdrawal,slotAck),withdrawalAckName=coordinationAckName(withdrawalAck),withdrawalStageName=coordinationStageName(withdrawalAck,"creator-withdrawal");
    if(state==="withdrawal-slot-ack-withdrawal-stage")await writeFile(path.join(root,withdrawalStageName),authorityCanonicalBytes(withdrawalAck));
    if(["withdrawal-both-acks","withdrawal-withdrawal-ack","orphan-withdrawal-ack"].includes(state))await writeFile(path.join(root,withdrawalAckName),authorityCanonicalBytes(withdrawalAck));
    if(["withdrawal-withdrawal-ack","orphan-withdrawal-ack"].includes(state))await rm(path.join(root,slotAckName),{force:true});
    if(state==="orphan-withdrawal-ack")await rm(withdrawal,{recursive:true});
    const roles:SeededRole[]=[],present=new Set(await readdir(root));
    for(const [role,name] of [["withdrawal",withdrawalName],["slot",slotName],["slot-ack",slotAckName],["slot-stage",slotStageName],["withdrawal-ack",withdrawalAckName],["withdrawal-stage",withdrawalStageName]] as const)if(present.has(name))roles.push([role,name]);
    return roles;
  };
  const seedAbortedTerminal=async(root:string,owner:AdmissionOwner):Promise<SeededRole[]>=>{
    const terminalName=retirementMarkerName(owner,"publication-aborted"),slotName=admissionRetiredName(owner,"withdrawn"),slot=path.join(root,slotName);
    await writeLegacyRetiredLock(root,owner,"publication-aborted");
    await mkdir(slot);await writeFile(path.join(slot,"owner.json"),publicationOwnerBytes(owner));
    const ack=slotCoordinationAck(owner,slotName,slot,"withdrawn",terminalName,publicationOwnerBytes(owner)),ackName=coordinationAckName(ack);
    await writeFile(path.join(root,ackName),authorityCanonicalBytes(ack));
    return [["terminal",terminalName],["slot",slotName],["slot-ack",ackName]];
  };
  // Bounded `busy` is retryable by the product's own contract (a transient sharing or fence
  // refusal is not a settled classification), so classification settles over up to three
  // attempts; corruption and completion are terminal on first sight. Without this, an in-suite
  // transient refusal on one root fabricated a parity failure (captured 2026-08-06, 406ms —
  // quick refuse, not deadline exhaustion).
  const classify=async(root:string,entry:"observe"|"recover")=>{
    let result;
    for(let attempt=0;attempt<3;attempt++){
      const ledger=new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:200});
      result=entry==="recover"?await ledger.recover():await ledger.observeClock();
      if(result.ok||result.reason!=="busy")return result;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    return result!;
  };
  const surviving=async(root:string,seeded:readonly SeededRole[]):Promise<string[]>=>{const present=new Set(await readdir(root));return seeded.filter(([,name])=>present.has(name)).map(([role])=>role).sort();};
  const assertParity=(name:string,seed:(root:string,owner:AdmissionOwner)=>Promise<SeededRole[]>,pid:number,entry:"observe"|"recover")=>withRoot(async fresh=>{await withRoot(async warm=>{
    assert.equal((await new RawFsAuthorityLedger(warm,{now:()=>t0,lockTimeoutMs:2_000}).observeClock()).ok,true,`${name}: the warming acquisition succeeds`);
    assert.equal((await readdir(warm)).some(entryName=>/^\.authority-ledger-lock-\d+-[0-9a-f]{64}\.released$/.test(entryName)),true,`${name}: the warm root carries its steady-state released marker`);
    const owner:AdmissionOwner={host:hostname(),nonce:"a".repeat(64),pid,v:1};
    const seededFresh=await seed(fresh,owner),seededWarm=await seed(warm,owner);
    assert.deepEqual(seededWarm.map(([role])=>role),seededFresh.map(([role])=>role),`${name}: identical fixture roles`);
    const freshResult=await classify(fresh,entry),warmResult=await classify(warm,entry);
    // Parity of CLASSIFICATION, not of the semantic clock: once a dead residue completes (the
    // chain landing), a fresh root reports `advanced` where a warm root reports `equal` — clock
    // state, not classification. Compare ok plus the failure reason, which keeps the
    // corruption-vs-busy discriminator these pins exist for.
    assert.equal(warmResult.ok,freshResult.ok,`${name}: the unrelated released marker is inert to withdrawal-family classification (fresh=${JSON.stringify(freshResult)} warm=${JSON.stringify(warmResult)})`);
    if(!freshResult.ok&&!warmResult.ok)assert.equal(warmResult.reason,freshResult.reason,`${name}: warm and fresh refuse for the same reason`);
    assert.deepEqual(await surviving(warm,seededWarm),await surviving(fresh,seededFresh),`${name}: the same seeded artifacts survive warm and fresh`);
  });});
  // The dead parity subtests classify TWICE per run (fresh root, then warm root); a reaped
  // child's pid can be recycled by an unrelated process between the two on Windows, flipping one
  // side and fabricating a parity failure (observed once in-suite, passing isolated and in the
  // next full run). The corpus's kill-monkeypatch pattern makes the dead proof deterministic.
  const withDeadPid=async(pid:number,run:()=>Promise<void>)=>{const originalKill=process.kill;Object.defineProperty(process,"kill",{configurable:true,value:(target:number,signal?:number)=>target===pid?(()=>{throw Object.assign(new Error("dead"),{code:"ESRCH"});})():originalKill.call(process,target,signal as never)});try{await run();}finally{Object.defineProperty(process,"kill",{configurable:true,value:originalKill});}};
  for(const state of eightStates)await t.test(`${state} live observe parity`,()=>assertParity(state,(root,owner)=>seedEight(root,owner,state),process.pid,"observe"));
  for(const state of ["slot-withdrawal","withdrawal-both-acks"] as const)await t.test(`${state} live recover parity`,()=>assertParity(state,(root,owner)=>seedEight(root,owner,state),process.pid,"recover"));
  await t.test("slot-withdrawal dead observe parity",()=>withDeadPid(49397,()=>assertParity("slot-withdrawal-dead",(root,owner)=>seedEight(root,owner,"slot-withdrawal"),49397,"observe")));
  await t.test("aborted-terminal live observe parity",()=>assertParity("aborted-terminal",seedAbortedTerminal,process.pid,"observe"));
  await t.test("aborted-terminal dead observe parity",()=>withDeadPid(49398,()=>assertParity("aborted-terminal-dead",seedAbortedTerminal,49398,"observe")));
  await t.test("aborted-terminal dead recover parity",()=>withDeadPid(49399,()=>assertParity("aborted-terminal-dead",seedAbortedTerminal,49399,"recover")));
  for(const state of ["slot-withdrawal","withdrawal-withdrawal-ack","orphan-withdrawal-ack","withdrawal-both-acks"] as const)await t.test(`${state} fresh live residue stays bounded busy`,()=>withRoot(async root=>{
    const owner:AdmissionOwner={host:hostname(),nonce:"a".repeat(64),pid:process.pid,v:1};
    await seedEight(root,owner,state);
    const before=await snapshotRootArtifacts(root);
    assert.deepEqual(await classify(root,"observe"),{ok:false,reason:"busy"},state);
    assert.deepEqual(await snapshotRootArtifacts(root),before,`${state}: preserved byte-identically`);
  }));
  await t.test("aborted-terminal fresh live residue stays bounded busy",()=>withRoot(async root=>{
    const owner:AdmissionOwner={host:hostname(),nonce:"a".repeat(64),pid:process.pid,v:1};
    await seedAbortedTerminal(root,owner);
    const before=await snapshotRootArtifacts(root);
    assert.deepEqual(await classify(root,"observe"),{ok:false,reason:"busy"},"aborted-terminal");
    assert.deepEqual(await snapshotRootArtifacts(root),before,"aborted-terminal: preserved byte-identically");
  }));
  for(const state of ["slot-withdrawal","withdrawal-withdrawal-ack","orphan-withdrawal-ack","withdrawal-both-acks"] as const)for(const [boundary,seedBlocking] of [
    ["same-owner released",async(root:string,owner:AdmissionOwner)=>{await writeLegacyRetiredLock(root,owner,"released");}],
    ["unrelated publication-aborted",async(root:string,owner:AdmissionOwner)=>{await writeLegacyRetiredLock(root,{...owner,nonce:"f".repeat(64)},"publication-aborted");}],
  ] as const)await t.test(`${state} beside ${boundary} stays preserved corruption`,()=>withRoot(async root=>{
    const owner:AdmissionOwner={host:hostname(),nonce:"a".repeat(64),pid:process.pid,v:1};
    await seedEight(root,owner,state);
    await seedBlocking(root,owner);
    const before=await snapshotRootArtifacts(root);
    assert.deepEqual(await classify(root,"observe"),{ok:false,reason:"corruption"},`${state} ${boundary}`);
    assert.deepEqual(await snapshotRootArtifacts(root),before,`${state} ${boundary}: preserved byte-identically`);
  }));
});

// The lone-withdrawal dead-owner retirement (spec "a lone legacy withdrawal … final same-host
// dead-owner proof; it is retired only", granted as a D1(a) dead-owner route, 2026-08-05): a
// creator whose terminal-error failure path minted a sub-complete withdrawal marker and then
// died leaves residue any contender retires — pinned warm and fresh, both entry points, on a
// marker a REAL crashed creator minted — while a live owner's lone marker stays preserved
// corruption from both entry points (the fresh pin "slot absence plus withdrawal without its
// bound retirement ack grants no cleanup authority" holds that; the warm twin is pinned here).
test("lone creator-withdrawal markers retire only with dead-owner proof, warm and fresh",{timeout:60_000},async t=>{
  const mintDeadLoneMarker=async(root:string):Promise<string>=>{
    const moduleUrl=pathToFileURL(path.resolve("dist-test/src/authority/host/fs-ledger.js")).href;
    const source=`import{FsAuthorityLedger}from ${JSON.stringify(moduleUrl)};const terminal={kind:"terminal"};const ledger=new FsAuthorityLedger(process.argv[1],{now:()=>${t0},lockTimeoutMs:200,faultInjector(point){if(point==="after-lock-publication-owner-partial-write")throw terminal;}});try{await ledger.observeClock();}catch(error){process.exit(93);}process.exit(92);`;
    const code=await new Promise<number|null>((resolve,reject)=>{const child=spawn(process.execPath,["--input-type=module","-e",source,root],{stdio:"ignore"});child.once("error",reject);child.once("close",resolve);});
    assert.equal(code,93,"the creator's own failure path completes the withdrawal, then the process dies");
    const marker=(await readdir(root)).find(name=>name.startsWith(".authority-ledger-creator-withdrawal-"));
    assert.ok(marker,"the dead creator left its withdrawal marker");
    return marker!;
  };
  for(const temp of ["fresh","warm"] as const)for(const entry of ["observe","recover"] as const)await t.test(`dead ${temp} ${entry} retires and heals`,()=>withRoot(async root=>{
    if(temp==="warm")assert.equal((await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:2_000}).observeClock()).ok,true,"the warming acquisition succeeds");
    const marker=await mintDeadLoneMarker(root);
    const ledger=new RawFsAuthorityLedger(root,{now:()=>t0+1_000,lockTimeoutMs:2_000});
    const result=entry==="recover"?await ledger.recover():await ledger.observeClock();
    assert.equal(result.ok,true,`${temp} ${entry}: the dead lone marker is retired and the operation proceeds`);
    assert.equal(existsSync(path.join(root,marker)),false,`${temp} ${entry}: the marker is drained`);
    assert.equal((await readdir(root)).filter(name=>name.startsWith(".authority-ledger-admission-")||name.startsWith(".authority-ledger-creator-withdrawal-")||name.startsWith(".authority-ledger-coordination-cleanup-")).length,0,`${temp} ${entry}: no admission-family residue survives`);
  }));
  await t.test("live warm lone marker stays preserved corruption from both entry points",()=>withRoot(async root=>{
    assert.equal((await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:2_000}).observeClock()).ok,true,"the warming acquisition succeeds");
    const owner:AdmissionOwner={host:hostname(),nonce:"b".repeat(64),pid:process.pid,v:1};
    const marker=await writeCreatorWithdrawal(root,owner,"partial");
    const before=await snapshotRootArtifacts(root);
    for(const entry of ["observe","recover"] as const){
      const ledger=new RawFsAuthorityLedger(root,{now:()=>t0+1_000,lockTimeoutMs:200});
      assert.deepEqual(entry==="recover"?await ledger.recover():await ledger.observeClock(),{ok:false,reason:"corruption"},entry);
    }
    assert.deepEqual(await snapshotRootArtifacts(root),before,"preserved byte-identically");
    assert.equal(existsSync(marker),true);
  }));
});

// The dead-owner creator-withdrawal chain (D1(a), 2026-08-05): every crash-matrix residue of a
// DEAD creator progresses to completion — the withdrawn slot's cleanup lifecycle, the
// creator-withdrawal ack lifecycle, and the terminal drains — from both entry points, with the
// two family signals in the pinned order. Live-owner residue stays preserved (the parity family
// and the live-preservation family above); the re-fixtured committed pin "atomic admission
// active owner cleans coordination once after every sync barrier" drives the aborted-terminal
// form of the same route.
test("the creator-withdrawal chain completes for dead owners from every crash state",{timeout:120_000},async t=>{
  const eightStates=["slot-withdrawal","slot-withdrawal-slot-stage","slot-withdrawal-slot-ack","withdrawal-slot-ack","withdrawal-slot-ack-withdrawal-stage","withdrawal-both-acks","withdrawal-withdrawal-ack","orphan-withdrawal-ack"] as const;
  const seedChainState=async(root:string,owner:AdmissionOwner,state:typeof eightStates[number]):Promise<void>=>{
    const withdrawalName=creatorWithdrawalName(owner,"partial"),withdrawal=path.join(root,withdrawalName),slotName=admissionRetiredName(owner,"withdrawn"),slot=path.join(root,slotName);
    await mkdir(withdrawal);await writeFile(path.join(withdrawal,"owner.json"),ownerStateBytes(owner,"partial"));
    await mkdir(slot);await writeFile(path.join(slot,"owner.json"),publicationOwnerBytes(owner));
    const slotAck=slotCoordinationAck(owner,slotName,slot,"withdrawn",withdrawalName,ownerStateBytes(owner,"partial")),slotAckPath=path.join(root,coordinationAckName(slotAck));
    if(state==="slot-withdrawal-slot-stage")await writeFile(path.join(root,coordinationStageName(slotAck,"slot-retired")),authorityCanonicalBytes(slotAck));
    if(!["slot-withdrawal","slot-withdrawal-slot-stage"].includes(state))await writeFile(slotAckPath,authorityCanonicalBytes(slotAck));
    if(["withdrawal-slot-ack","withdrawal-slot-ack-withdrawal-stage","withdrawal-both-acks","withdrawal-withdrawal-ack","orphan-withdrawal-ack"].includes(state))await rm(slot,{recursive:true});
    const withdrawalAck=incompleteCoordinationAck(owner,"creator-withdrawal",withdrawalName,publicationStageName({...owner,ticket:"0000000000000001"}),"partial",withdrawal,slotAck);
    if(state==="withdrawal-slot-ack-withdrawal-stage")await writeFile(path.join(root,coordinationStageName(withdrawalAck,"creator-withdrawal")),authorityCanonicalBytes(withdrawalAck));
    if(["withdrawal-both-acks","withdrawal-withdrawal-ack","orphan-withdrawal-ack"].includes(state))await writeFile(path.join(root,coordinationAckName(withdrawalAck)),authorityCanonicalBytes(withdrawalAck));
    if(["withdrawal-withdrawal-ack","orphan-withdrawal-ack"].includes(state))await rm(slotAckPath,{force:true});
    if(state==="orphan-withdrawal-ack")await rm(withdrawal,{recursive:true});
  };
  const expectedSignals=(state:typeof eightStates[number])=>({slotSyncs:state.startsWith("slot-")?1:0,withdrawalSyncs:state==="orphan-withdrawal-ack"?0:1});
  // Bounded `busy` is retryable by the product's own contract; completion settles over up to
  // three attempts. Each chain transition happens exactly once across the whole healing, so the
  // signal counters stay exact whichever attempt performs which transition.
  const runChain=async(root:string,entry:"observe"|"recover")=>{
    let slotSyncs=0,withdrawalSyncs=0,callbacks=0,result;
    for(let attempt=0;attempt<3;attempt++){
      const ledger=new RawFsAuthorityLedger(root,{now:()=>t0+1_000,lockTimeoutMs:2_000,faultInjector:(point:string)=>{if(point==="after-admission-slot-retire-cleanup-root-sync")slotSyncs++;if(point==="after-creator-withdrawal-cleanup-root-sync")withdrawalSyncs++;if(point==="before-ledger-operation-callback")callbacks++;}} as never);
      result=entry==="recover"?await ledger.recover():await ledger.observeClock();
      if(result.ok||result.reason!=="busy")break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    return {result:result!,slotSyncs,withdrawalSyncs,callbacks};
  };
  const assertDrained=async(root:string,label:string)=>{
    const residue=(await readdir(root)).filter(name=>name.startsWith(".authority-ledger-admission-")||name.startsWith(".authority-ledger-creator-withdrawal-")||name.startsWith(".authority-ledger-coordination-cleanup-"));
    assert.deepEqual(residue,[],`${label}: the chain's evidence is fully drained`);
  };
  for(const state of eightStates)await t.test(`${state} dead fresh observe completes`,async()=>{const owner:AdmissionOwner={host:hostname(),nonce:"c".repeat(64),pid:await exitedProcessPid(),v:1};await withRoot(async root=>{
    await seedChainState(root,owner,state);
    const {result,slotSyncs,withdrawalSyncs,callbacks}=await runChain(root,"observe");
    assert.deepEqual(result,{ok:true,status:"advanced",observedAt:new Date(t0+1_000).toISOString()},state);
    assert.deepEqual({slotSyncs,withdrawalSyncs,callbacks},{...expectedSignals(state),callbacks:1},state);
    await assertDrained(root,state);
  });});
  for(const state of ["slot-withdrawal","withdrawal-both-acks"] as const){
    await t.test(`${state} dead fresh recover completes`,async()=>{const owner:AdmissionOwner={host:hostname(),nonce:"c".repeat(64),pid:await exitedProcessPid(),v:1};await withRoot(async root=>{
      await seedChainState(root,owner,state);
      const {result}=await runChain(root,"recover");
      assert.equal(result.ok,true,state);
      await assertDrained(root,state);
    });});
    await t.test(`${state} dead warm observe completes`,async()=>{const owner:AdmissionOwner={host:hostname(),nonce:"c".repeat(64),pid:await exitedProcessPid(),v:1};await withRoot(async root=>{
      assert.equal((await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:2_000}).observeClock()).ok,true,"the warming acquisition succeeds");
      await seedChainState(root,owner,state);
      const {result,slotSyncs,withdrawalSyncs}=await runChain(root,"observe");
      assert.deepEqual(result,{ok:true,status:"advanced",observedAt:new Date(t0+1_000).toISOString()},state);
      assert.deepEqual({slotSyncs,withdrawalSyncs},expectedSignals(state),state);
      await assertDrained(root,state);
    });});
  }
  // The terminal's three legal states complete alike since the empty-terminal grant (Batch C):
  // a ZERO terminal (owner.json with no bytes) completes like partial, and an EMPTY terminal
  // (no owner.json at all) completes through the empty-terminal acknowledgment form — the
  // withdrawn slot-ack binds the digest of the empty byte string, the creator-withdrawal ack
  // binds length "0" with null owner identity — recorded in the spec beside the crash matrix.
  await t.test("slot-withdrawal zero-terminal dead observe completes",async()=>{const owner:AdmissionOwner={host:hostname(),nonce:"c".repeat(64),pid:await exitedProcessPid(),v:1};await withRoot(async root=>{
    const withdrawal=path.join(root,creatorWithdrawalName(owner,"zero")),slot=path.join(root,admissionRetiredName(owner,"withdrawn"));
    await mkdir(withdrawal);await writeFile(path.join(withdrawal,"owner.json"),Buffer.alloc(0));
    await mkdir(slot);await writeFile(path.join(slot,"owner.json"),publicationOwnerBytes(owner));
    const {result}=await runChain(root,"observe");
    assert.deepEqual(result,{ok:true,status:"advanced",observedAt:new Date(t0+1_000).toISOString()});
    await assertDrained(root,"zero-terminal");
  });});
  await t.test("slot-withdrawal empty-terminal dead completes",async()=>{const owner:AdmissionOwner={host:hostname(),nonce:"c".repeat(64),pid:await exitedProcessPid(),v:1};await withRoot(async root=>{
    const withdrawal=path.join(root,creatorWithdrawalName(owner,"empty")),slot=path.join(root,admissionRetiredName(owner,"withdrawn"));
    await mkdir(withdrawal);
    await mkdir(slot);await writeFile(path.join(slot,"owner.json"),publicationOwnerBytes(owner));
    const {result,slotSyncs,withdrawalSyncs}=await runChain(root,"observe");
    assert.deepEqual(result,{ok:true,status:"advanced",observedAt:new Date(t0+1_000).toISOString()});
    assert.deepEqual({slotSyncs,withdrawalSyncs},{slotSyncs:1,withdrawalSyncs:1},"empty-terminal signals");
    await assertDrained(root,"empty-terminal");
  });});
  await t.test("slot-withdrawal empty-terminal dead recover completes",async()=>{const owner:AdmissionOwner={host:hostname(),nonce:"c".repeat(64),pid:await exitedProcessPid(),v:1};await withRoot(async root=>{
    const withdrawal=path.join(root,creatorWithdrawalName(owner,"empty")),slot=path.join(root,admissionRetiredName(owner,"withdrawn"));
    await mkdir(withdrawal);
    await mkdir(slot);await writeFile(path.join(slot,"owner.json"),publicationOwnerBytes(owner));
    const {result}=await runChain(root,"recover");
    assert.equal(result.ok,true,"empty-terminal recover");
    await assertDrained(root,"empty-terminal recover");
  });});
  // The empty form survives the ack lifecycle too: chain step 5's residue with an EMPTY
  // terminal — the withdrawal marker (no owner object), the durable withdrawn slot-ack binding
  // the empty-bytes digest, and the creator-withdrawal ack in the empty form — resumes and
  // drains rather than wedging on a byte binding the terminal cannot satisfy.
  await t.test("withdrawal-both-acks empty-terminal dead completes",async()=>{const owner:AdmissionOwner={host:hostname(),nonce:"c".repeat(64),pid:await exitedProcessPid(),v:1};await withRoot(async root=>{
    const withdrawalName=creatorWithdrawalName(owner,"empty"),withdrawal=path.join(root,withdrawalName),slotName=admissionRetiredName(owner,"withdrawn"),slot=path.join(root,slotName);
    await mkdir(withdrawal);
    await mkdir(slot);await writeFile(path.join(slot,"owner.json"),publicationOwnerBytes(owner));
    const slotAck=slotCoordinationAck(owner,slotName,slot,"withdrawn",withdrawalName,Buffer.alloc(0));
    await writeFile(path.join(root,coordinationAckName(slotAck)),authorityCanonicalBytes(slotAck));
    await rm(slot,{recursive:true});
    const withdrawalAck=incompleteCoordinationAck(owner,"creator-withdrawal",withdrawalName,publicationStageName({...owner,ticket:"0000000000000001"}),"empty",withdrawal,slotAck);
    await writeFile(path.join(root,coordinationAckName(withdrawalAck)),authorityCanonicalBytes(withdrawalAck));
    const {result,withdrawalSyncs}=await runChain(root,"observe");
    assert.deepEqual(result,{ok:true,status:"advanced",observedAt:new Date(t0+1_000).toISOString()});
    assert.equal(withdrawalSyncs,1,"the terminal-removal signal fires once");
    await assertDrained(root,"empty-terminal both-acks");
  });});
  // The ONLY boundary of the grant: the empty form belongs to withdrawal-family terminals. A
  // published disposition with a bytes-less successor stays refused — an empty active lock is
  // malformed before any cleanup validator runs, and this pin holds that refusal in place so a
  // wider empty acceptance cannot ship silently.
  await t.test("an empty active lock beside a published slot marker stays preserved corruption",async()=>{const owner:AdmissionOwner={host:hostname(),nonce:"c".repeat(64),pid:await exitedProcessPid(),v:1};await withRoot(async root=>{
    const marker=path.join(root,admissionRetiredName(owner,"published"));
    await mkdir(marker);await writeFile(path.join(marker,"owner.json"),publicationOwnerBytes(owner));
    await mkdir(path.join(root,"lock"));
    const before=await snapshotRootArtifacts(root);
    const observed=await new RawFsAuthorityLedger(root,{now:()=>t0+1_000,lockTimeoutMs:200}).observeClock();
    assert.deepEqual(observed,{ok:false,reason:"corruption"});
    assert.deepEqual(await snapshotRootArtifacts(root),before,"the empty lock and marker are preserved");
  });});
  // The empty form's digest is a universal constant — digest-of-empty proves nothing about
  // WHICH terminal — so the same-owner checks are the empty terminal's ONLY binding. This pin
  // holds a cross-owner empty terminal to corruption so a refactor that consolidates the
  // "redundant" owner checks cannot ship silently (RED-review finding, Batch C).
  await t.test("a cross-owner empty terminal grants no withdrawn cleanup authority",async()=>{const ownerA:AdmissionOwner={host:hostname(),nonce:"a".repeat(64),pid:await exitedProcessPid(),v:1},ownerB:AdmissionOwner={host:hostname(),nonce:"b".repeat(64),pid:await exitedProcessPid(),v:1};await withRoot(async root=>{
    const slotName=admissionRetiredName(ownerA,"withdrawn"),slot=path.join(root,slotName),foreignTerminalName=creatorWithdrawalName(ownerB,"empty");
    await mkdir(slot);await writeFile(path.join(slot,"owner.json"),publicationOwnerBytes(ownerA));
    await mkdir(path.join(root,foreignTerminalName));
    const slotAck=slotCoordinationAck(ownerA,slotName,slot,"withdrawn",foreignTerminalName,Buffer.alloc(0));
    await writeFile(path.join(root,coordinationAckName(slotAck)),authorityCanonicalBytes(slotAck));
    const before=await snapshotRootArtifacts(root);
    for(const entry of ["observe","recover"] as const){
      const ledger=new RawFsAuthorityLedger(root,{now:()=>t0+1_000,lockTimeoutMs:200});
      const result=entry==="recover"?await ledger.recover():await ledger.observeClock();
      assert.deepEqual({ok:result.ok,reason:(result as {reason?:string}).reason},{ok:false,reason:"corruption"},`cross-owner empty ${entry}`);
    }
    assert.deepEqual(await snapshotRootArtifacts(root),before,"cross-owner empty terminal is preserved byte-identically");
  });});
  // The classifier-layer twin of the empty-lock boundary pin: an orphan PUBLISHED final whose
  // successor is an empty (owner-less) released marker stays corruption — under a widening
  // that reconstructs owners for empty retired markers, this exact shape drained and the root
  // gained a self-authored acquisition (RED-review probe, Batch C).
  await t.test("an orphan published final over an empty released successor stays preserved corruption",async()=>{const owner:AdmissionOwner={host:hostname(),nonce:"d".repeat(64),pid:await exitedProcessPid(),v:1};await withRoot(async root=>{
    const markerName=admissionRetiredName(owner,"published"),marker=path.join(root,markerName),releasedName=retirementMarkerName(owner,"released");
    await mkdir(marker);await writeFile(path.join(marker,"owner.json"),publicationOwnerBytes(owner));
    const ack=slotCoordinationAck(owner,markerName,marker,"published",releasedName,Buffer.alloc(0));
    await writeFile(path.join(root,coordinationAckName(ack)),authorityCanonicalBytes(ack));
    await rm(marker,{recursive:true});
    await mkdir(path.join(root,releasedName));
    const before=await snapshotRootArtifacts(root);
    const observed=await new RawFsAuthorityLedger(root,{now:()=>t0+1_000,lockTimeoutMs:200}).observeClock();
    assert.deepEqual(observed,{ok:false,reason:"corruption"});
    assert.deepEqual(await snapshotRootArtifacts(root),before,"the orphan final and empty successor are preserved");
  });});
});

// The creator's own continuation (Batch C, task 1(ii)) — option-gated: after the terminal-path
// stage withdrawal publishes its marker, the same failure path retires its own slot `withdrawn`
// on the marker's authority (spec :508-516 — the marker is the retirement's authority, which is
// why the terminal rename precedes it) and runs the cleanup chain inline under the ONE fresh
// cleanup deadline spec :443 grants the creator's failure path. The original thrown object
// propagates by identity; the root's K1 evidence is fully drained when the chain finishes; the
// two family signals fire once each in the pinned slot-then-withdrawal order. The four
// sub-complete boundaries cover every W1-minting state (empty, empty, zero, partial — the
// task 1(i) wedge set); the complete form takes the aborted-terminal chain (signed clause 3 as
// amended: the family signal fires on the bound slot-ack's removal root sync, and the aborted
// marker itself stays for the legacy machinery).
test("option-gated creator terminal failure after slot creation completes its own withdrawal chain",{timeout:120_000},async t=>{
  const drive=async(root:string,point:string)=>{
    const terminal={kind:"stable-terminal-error"};
    let fired=false,thrown:unknown,slotSyncs=0,withdrawalSyncs=0,callbacks=0,markerFirst:boolean|null=null;const order:string[]=[];
    try{
      await new RawFsAuthorityLedger(root,{[k1AdmissionPreparationOption()]:K1_ADMISSION_PREPARATION_MODE,now:()=>t0+1_000,lockTimeoutMs:2_000,faultInjector:(p:string)=>{
        if(p===point&&!fired){fired=true;throw terminal;}
        // Marker-first order (spec :508-516, seal clause 4): at the slot's retire-rename the
        // withdrawal terminal must ALREADY be durable on disk — it is the retirement's
        // authority. Observational, so the continuation's failure-swallowing cannot mask it.
        if(p==="after-admission-slot-retire-rename"&&markerFirst===null)markerFirst=readdirSync(root).some(name=>name.startsWith(".authority-ledger-creator-withdrawal-")||name.endsWith(".publication-aborted"));
        if(p==="after-admission-slot-retire-cleanup-root-sync"){slotSyncs++;order.push("slot-sync");}
        if(p==="after-creator-withdrawal-cleanup-root-sync"){withdrawalSyncs++;order.push("withdrawal-sync");}
        if(p==="before-ledger-operation-callback")callbacks++;
      }} as never).observeClock();
    }catch(error){thrown=error;}
    return {terminal,fired,thrown,slotSyncs,withdrawalSyncs,callbacks,order,markerFirst};
  };
  const k1Residue=async(root:string)=>(await readdir(root)).filter(name=>name.startsWith(".authority-ledger-admission-")||name.startsWith(".authority-ledger-creator-withdrawal-")||name.startsWith(".authority-ledger-coordination-cleanup-")||name.startsWith(".authority-ledger-lock-publication-"));
  const boundaries=[
    {point:"before-publication-stage-validation",state:"empty"},
    {point:"after-lock-publication-stage-create",state:"empty"},
    {point:"after-lock-publication-owner-create",state:"zero"},
    {point:"after-lock-publication-owner-partial-write",state:"partial"},
  ] as const;
  for(const temp of ["warm","fresh"] as const)for(const boundary of boundaries)await t.test(`option-gated ${boundary.state} terminal at ${boundary.point} ${temp} completes the chain in order`,()=>withRoot(async root=>{
    if(temp==="warm")assert.equal((await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:2_000}).observeClock()).ok,true,"the warming acquisition succeeds");
    const outcome=await drive(root,boundary.point);
    assert.equal(outcome.fired,true,`${boundary.point} fired`);
    assert.equal(outcome.thrown,outcome.terminal,"the creator's original thrown object propagates by identity");
    assert.deepEqual({slotSyncs:outcome.slotSyncs,withdrawalSyncs:outcome.withdrawalSyncs,callbacks:outcome.callbacks},{slotSyncs:1,withdrawalSyncs:1,callbacks:0},boundary.point);
    assert.deepEqual(outcome.order,["slot-sync","withdrawal-sync"],boundary.point);
    assert.equal(outcome.markerFirst,true,`${boundary.point}: the withdrawal terminal is durable before the slot retire-rename`);
    assert.deepEqual(await k1Residue(root),[],`${boundary.point}: the chain drains every K1 artifact`);
  }));
  await t.test("option-gated complete terminal at after-lock-publication-stage-sync completes the aborted-terminal chain",()=>withRoot(async root=>{
    const outcome=await drive(root,"after-lock-publication-stage-sync");
    assert.equal(outcome.fired,true);
    assert.equal(outcome.thrown,outcome.terminal,"identity preserved");
    assert.deepEqual({slotSyncs:outcome.slotSyncs,withdrawalSyncs:outcome.withdrawalSyncs,callbacks:outcome.callbacks},{slotSyncs:1,withdrawalSyncs:1,callbacks:0});
    assert.deepEqual(outcome.order,["slot-sync","withdrawal-sync"]);
    assert.equal(outcome.markerFirst,true,"the aborted terminal is durable before the slot retire-rename");
    assert.deepEqual(await k1Residue(root),[],"the chain's K1 evidence is fully drained");
    assert.equal((await readdir(root)).some(name=>name.endsWith(".publication-aborted")),true,"the aborted terminal remains for the legacy machinery");
    const next=await new RawFsAuthorityLedger(root,{now:()=>t0+2_000,lockTimeoutMs:2_000}).observeClock();
    assert.deepEqual(next,{ok:true,status:"advanced",observedAt:new Date(t0+2_000).toISOString()},"the next default acquisition services the lone aborted marker and proceeds");
  }));
  // The two-syscall marker-removal windows (the GREEN review's blocking find, measured): a
  // hard exit between a marker's owner unlink and its rmdir leaves an EMPTIED directory beside
  // its durable acknowledgment. The authenticated-partial rescue must cover the withdrawal
  // family — an emptied `.withdrawn` slot marker bound by its slot-ack, and an emptied
  // sub-complete withdrawal terminal bound by its withdrawal ack — or every such crash is
  // permanent corruption from the machinery's own hand, the exact class the W1 criterion
  // forbids. The same windows are reachable through the committed dead-owner housekeeper, so
  // this rescue heals that latent path too.
  for(const window of [{occurrence:1,label:"the withdrawn slot marker's removal window"},{occurrence:2,label:"the withdrawal terminal's removal window"}] as const)await t.test(`option-gated continuation crash inside ${window.label} resumes and drains`,()=>withRoot(async root=>{
    const moduleUrl=pathToFileURL(path.resolve("dist-test/src/authority/host/fs-ledger.js")).href;
    const source=`import*as host from ${JSON.stringify(moduleUrl)};const option=host.__testK1AdmissionPreparationRuntimeOption;if(typeof option!=="symbol")process.exit(80);const terminal={kind:"terminal"};let fired=false,ownerRemoves=0;const ledger=new host.FsAuthorityLedger(process.argv[1],{[option]:${JSON.stringify(K1_ADMISSION_PREPARATION_MODE)},now:()=>${t0},lockTimeoutMs:2_000,faultInjector(point){if(point==="after-lock-publication-owner-partial-write"&&!fired){fired=true;throw terminal;}if(point==="after-coordination-cleanup-marker-owner-remove"&&++ownerRemoves===${window.occurrence})process.exit(93);}});try{await ledger.observeClock();}catch(error){process.exit(error===terminal?94:95);}process.exit(92);`;
    const code=await new Promise<number|null>((resolve,reject)=>{const child=spawn(process.execPath,["--input-type=module","-e",source,root],{stdio:"ignore"});child.once("error",reject);child.once("close",resolve);});
    assert.equal(code,93,`the child hard-exits inside ${window.label}`);
    let result;for(let attempt=0;attempt<3;attempt++){result=await new RawFsAuthorityLedger(root,{now:()=>t0+1_000,lockTimeoutMs:2_000}).observeClock();if(result.ok||result.reason!=="busy")break;await new Promise(resolve=>setTimeout(resolve,100));}
    assert.deepEqual(result,{ok:true,status:"advanced",observedAt:new Date(t0+1_000).toISOString()},window.label);
    assert.deepEqual(await k1Residue(root),[],`${window.label}: the resumed chain drains fully`);
  }));
  // The W1 dead-owner route (task 1(iii)): a REAL option-ON creator throws its terminal,
  // withdraws its stage, and hard-exits at the withdrawal's root sync — BEFORE its own
  // continuation — leaving the W1 window with a dead owner. The housekeeping route retires the
  // bare slot `withdrawn` on the marker's authority (dead-PID-gated like its siblings) and the
  // existing chain completes it, from both entry points, warm and fresh, in the pinned signal
  // order. The empty-state window exercises the empty-terminal form end to end.
  for(const scenario of [
    {mint:"after-lock-publication-owner-partial-write",state:"partial",temp:"warm",entry:"observe"},
    {mint:"after-lock-publication-owner-partial-write",state:"partial",temp:"fresh",entry:"observe"},
    {mint:"after-lock-publication-owner-partial-write",state:"partial",temp:"fresh",entry:"recover"},
    {mint:"after-lock-publication-stage-create",state:"empty",temp:"fresh",entry:"observe"},
  ] as const)await t.test(`option-gated dead W1 window ${scenario.state} ${scenario.temp} ${scenario.entry} completes`,()=>withRoot(async root=>{
    if(scenario.temp==="warm")assert.equal((await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:2_000}).observeClock()).ok,true,"the warming acquisition succeeds");
    const moduleUrl=pathToFileURL(path.resolve("dist-test/src/authority/host/fs-ledger.js")).href;
    const source=`import*as host from ${JSON.stringify(moduleUrl)};const option=host.__testK1AdmissionPreparationRuntimeOption;if(typeof option!=="symbol")process.exit(80);const terminal={kind:"terminal"};let fired=false;const ledger=new host.FsAuthorityLedger(process.argv[1],{[option]:${JSON.stringify(K1_ADMISSION_PREPARATION_MODE)},now:()=>${t0},lockTimeoutMs:2_000,faultInjector(point){if(point===${JSON.stringify(scenario.mint)}&&!fired){fired=true;throw terminal;}if(point==="after-creator-withdrawal-root-sync")process.exit(93);}});try{await ledger.observeClock();}catch(error){process.exit(error===terminal?94:95);}process.exit(92);`;
    const code=await new Promise<number|null>((resolve,reject)=>{const child=spawn(process.execPath,["--input-type=module","-e",source,root],{stdio:"ignore"});child.once("error",reject);child.once("close",resolve);});
    assert.equal(code,93,"the creator dies at the withdrawal root sync, before its continuation");
    const names=await readdir(root);
    assert.equal(names.includes(".authority-ledger-admission-0"),true,"the bare slot remains");
    assert.equal(names.some(name=>name.startsWith(".authority-ledger-creator-withdrawal-")&&name.endsWith(`.${scenario.state}`)),true,"the sub-complete terminal remains");
    let result,slotSyncs=0,withdrawalSyncs=0;const order:string[]=[];
    for(let attempt=0;attempt<3;attempt++){
      const ledger=new RawFsAuthorityLedger(root,{now:()=>t0+1_000,lockTimeoutMs:2_000,faultInjector:(p:string)=>{if(p==="after-admission-slot-retire-cleanup-root-sync"){slotSyncs++;order.push("slot-sync");}if(p==="after-creator-withdrawal-cleanup-root-sync"){withdrawalSyncs++;order.push("withdrawal-sync");}}} as never);
      result=scenario.entry==="recover"?await ledger.recover():await ledger.observeClock();
      if(result.ok||result.reason!=="busy")break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.equal(result!.ok,true,`${scenario.state} ${scenario.temp} ${scenario.entry}: the dead window completes`);
    assert.deepEqual({slotSyncs,withdrawalSyncs},{slotSyncs:1,withdrawalSyncs:1},"both family signals fire once");
    assert.deepEqual(order,["slot-sync","withdrawal-sync"],"the pinned signal order holds");
    assert.deepEqual(await k1Residue(root),[],`${scenario.state} ${scenario.temp} ${scenario.entry}: fully drained`);
  }));
  // A continuation crash window past the slot retirement is exactly crash-matrix state 1: a
  // REAL option-ON creator throws its terminal, withdraws its stage, retires its slot, and
  // hard-exits before the slot-ack — the next default acquisition completes the dead chain.
  await t.test("option-gated continuation crash after slot retirement resumes as chain state 1",()=>withRoot(async root=>{
    const moduleUrl=pathToFileURL(path.resolve("dist-test/src/authority/host/fs-ledger.js")).href;
    const source=`import*as host from ${JSON.stringify(moduleUrl)};const option=host.__testK1AdmissionPreparationRuntimeOption;if(typeof option!=="symbol")process.exit(80);const terminal={kind:"terminal"};let fired=false;const ledger=new host.FsAuthorityLedger(process.argv[1],{[option]:${JSON.stringify(K1_ADMISSION_PREPARATION_MODE)},now:()=>${t0},lockTimeoutMs:2_000,faultInjector(point){if(point==="after-lock-publication-owner-partial-write"&&!fired){fired=true;throw terminal;}if(point==="after-admission-slot-retire-root-sync")process.exit(93);}});try{await ledger.observeClock();}catch(error){process.exit(error===terminal?94:95);}process.exit(92);`;
    const code=await new Promise<number|null>((resolve,reject)=>{const child=spawn(process.execPath,["--input-type=module","-e",source,root],{stdio:"ignore"});child.once("error",reject);child.once("close",resolve);});
    assert.equal(code,93,"the child hard-exits inside the continuation after the slot retirement root sync");
    const names=await readdir(root);
    assert.equal(names.some(name=>name.endsWith(".withdrawn")),true,"the withdrawn slot marker is durable");
    assert.equal(names.some(name=>name.startsWith(".authority-ledger-creator-withdrawal-")),true,"the withdrawal terminal remains");
    let result;for(let attempt=0;attempt<3;attempt++){result=await new RawFsAuthorityLedger(root,{now:()=>t0+1_000,lockTimeoutMs:2_000}).observeClock();if(result.ok||result.reason!=="busy")break;await new Promise(resolve=>setTimeout(resolve,100));}
    assert.deepEqual(result,{ok:true,status:"advanced",observedAt:new Date(t0+1_000).toISOString()},"the dead chain completes from state 1");
    assert.deepEqual(await k1Residue(root),[],"the resumed chain drains fully");
  }));
});

// Seal clause 4's in-flight residue (the W1 window, B2b): between the creator's terminal-path
// stage withdrawal and the withdrawn slot retirement, the root holds exactly the bare fixed slot
// plus its same-owner SUB-COMPLETE withdrawal terminal. Measured 2026-08-06 (Batch C, task 1(i)):
// thrown terminals at the four stage-construction boundaries mint this shape on every option-ON
// failure, and it classified permanent corruption from both entry points, live or dead, warm or
// fresh — the machinery's own hand. This family pins the LIVE half: preserved bounded busy,
// byte-identical, warm parity with the steady-state unrelated `released` marker inert (the D4
// boundary), and one over-tolerance boundary pin per adjacent artifact class so a wider
// recognition cannot ship silently. The dead half completes via the W1 dead-owner route,
// pinned by the "option-gated dead W1 window" family on real crashed creators.
test("K1 fixed slot with same-owner sub-complete withdrawal terminal is preserved live in-flight residue",async t=>{
  const states=["empty","zero","partial"] as const;
  const assertPreserved=async(root:string,expected:Readonly<{ok:false;reason:string}>,label:string)=>{
    const before=await snapshotRootArtifacts(root);
    let callbacks=0,prepCreates=0;
    const observed=await new RawFsAuthorityLedger(root,{now:()=>t0+1_000,lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="before-ledger-operation-callback")callbacks++;if(point==="after-admission-prep-create")prepCreates++;}} as never).observeClock();
    assert.deepEqual(observed,expected,`${label}: observe`);
    assert.deepEqual(await snapshotRootArtifacts(root),before,`${label}: observe preserves byte-identically`);
    const recovered=await new RawFsAuthorityLedger(root,{now:()=>t0+1_000,lockTimeoutMs:20}).recover();
    assert.deepEqual({ok:recovered.ok,reason:(recovered as {reason?:string}).reason},expected,`${label}: recover`);
    assert.deepEqual(await snapshotRootArtifacts(root),before,`${label}: recover preserves byte-identically`);
    assert.deepEqual({callbacks,prepCreates},{callbacks:0,prepCreates:0},label);
  };
  for(const temp of ["warm","fresh"] as const)for(const state of states)await t.test(`${state} ${temp} live window is preserved bounded busy from both entry points`,()=>withRoot(async root=>{
    if(temp==="warm"){
      assert.equal((await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:2_000}).observeClock()).ok,true,"the warming acquisition succeeds");
      assert.equal((await readdir(root)).some(name=>name.endsWith(".released")),true,"the steady-state released marker is present");
    }
    const owner:AdmissionOwner={host:hostname(),nonce:(state==="empty"?"a":state==="zero"?"b":"d").repeat(64),pid:process.pid,v:1};
    await writeAdmissionSlot(root,owner);
    await writeCreatorWithdrawal(root,owner,state);
    await assertPreserved(root,{ok:false,reason:"busy"},`${state} ${temp}`);
  }));
  const boundaryCases=[
    {name:"same-owner released beside the window stays preserved corruption",install:async(root:string,owner:AdmissionOwner)=>{await writeLegacyRetiredLock(root,owner,"released");}},
    {name:"unrelated publication-aborted beside the window stays preserved corruption",install:async(root:string,owner:AdmissionOwner)=>{await writeLegacyRetiredLock(root,{...owner,nonce:"2".repeat(64)},"publication-aborted");}},
    {name:"unrelated recovery-pending beside the window stays preserved corruption",install:async(root:string,owner:AdmissionOwner)=>{await writeLegacyRetiredLock(root,{...owner,nonce:"3".repeat(64)},"recovery-pending");}},
    {name:"a same-owner publication stage beside the window stays preserved corruption",install:async(root:string,owner:AdmissionOwner)=>{await writePublicationStage(root,{...owner,ticket:"0000000000000002"},publicationOwnerBytes(owner));}},
    {name:"a same-owner active lock beside the window stays preserved corruption",install:async(root:string,owner:AdmissionOwner)=>{const lock=path.join(root,"lock");await mkdir(lock);await writeFile(path.join(lock,"owner.json"),publicationOwnerBytes(owner));}},
  ] as const;
  for(const boundary of boundaryCases)await t.test(boundary.name,()=>withRoot(async root=>{
    const owner:AdmissionOwner={host:hostname(),nonce:"1".repeat(64),pid:process.pid,v:1};
    await writeAdmissionSlot(root,owner);
    await writeCreatorWithdrawal(root,owner,"partial");
    await boundary.install(root,owner);
    await assertPreserved(root,{ok:false,reason:"corruption"},boundary.name);
  }));
  await t.test("a cross-owner withdrawal marker beside the slot stays preserved corruption",()=>withRoot(async root=>{
    const slotOwner:AdmissionOwner={host:hostname(),nonce:"5".repeat(64),pid:process.pid,v:1},markerOwner:AdmissionOwner={host:hostname(),nonce:"6".repeat(64),pid:process.pid,v:1};
    await writeAdmissionSlot(root,slotOwner);
    await writeCreatorWithdrawal(root,markerOwner,"partial");
    await assertPreserved(root,{ok:false,reason:"corruption"},"cross-owner");
  }));
  // The RED review's discriminator gap: a recognition that merely counted OWNED artifacts would
  // also admit the window beside a typed coordination record. The ack here is validation-clean —
  // correctly purpose-bound to the marker with a well-formed (absent) slot-ack reference — so it
  // reaches the slots branch rather than dying in ack validation, and only the exact
  // two-artifact-graph condition refuses it. The chain never legitimately holds a
  // creator-withdrawal ack while the fixed slot is still unretired (the ack is chain step 4; the
  // slot retires in step 1).
  await t.test("a validation-clean creator-withdrawal ack beside the window stays preserved corruption",()=>withRoot(async root=>{
    const owner:AdmissionOwner={host:hostname(),nonce:"7".repeat(64),pid:process.pid,v:1};
    await writeAdmissionSlot(root,owner);
    const marker=await writeCreatorWithdrawal(root,owner,"partial"),markerName=path.basename(marker);
    const referencedSlotAck={purpose:"slot-retired",v:coordinationAckVersion};
    const ack=incompleteCoordinationAck(owner,"creator-withdrawal",markerName,publicationStageName({...owner,ticket:"0000000000000001"}),"partial",marker,referencedSlotAck);
    await writeFile(path.join(root,coordinationAckName(ack)),authorityCanonicalBytes(ack));
    await assertPreserved(root,{ok:false,reason:"corruption"},"typed-ack");
  }));
});

// The abandoned family's warm parity (D6, owner grant (a), contingent — the A/B found zero
// committed movers): the released-only tolerance extends to the abandoned slot-retired branch,
// its orphan-final twin, and their two descriptor sites, with exactly the D4 boundary —
// unrelated `released` inert; same-owner `released`, unrelated `publication-aborted`, and
// `recovery-pending` stay corruption, each held by its own pin. The family stays
// recover-reserved: observe preserves bounded busy warm exactly as fresh; recover() drains
// warm exactly as fresh. Measured before pinning (the four-site compiled-build A/B).
test("the abandoned family classifies and drains identically on warm and fresh roots",{timeout:60_000},async t=>{
  const seedAbandoned=async(root:string,owner:AdmissionOwner)=>{const marker=path.join(root,admissionRetiredName(owner,"abandoned"));await mkdir(marker);await writeFile(path.join(marker,"owner.json"),publicationOwnerBytes(owner));return marker;};
  const warmRoot=async(root:string)=>{assert.equal((await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:2_000}).observeClock()).ok,true,"the warming acquisition succeeds");};
  const settle=async(root:string,entry:"observe"|"recover")=>{let result;for(let attempt=0;attempt<3;attempt++){const ledger=new RawFsAuthorityLedger(root,{now:()=>t0+1_000,lockTimeoutMs:2_000});result=entry==="recover"?await ledger.recover():await ledger.observeClock();if(result.ok||result.reason!=="busy")break;await new Promise(resolve=>setTimeout(resolve,100));}return result!;};
  await t.test("warm dead marker drains through recover exactly as fresh",async()=>{const owner:AdmissionOwner={host:hostname(),nonce:"a".repeat(64),pid:await exitedProcessPid(),v:1};await withRoot(async root=>{
    await warmRoot(root);
    const marker=await seedAbandoned(root,owner);
    const result=await settle(root,"recover");
    assert.equal(result.ok,true,"recover drains the warm dead abandoned marker");
    assert.equal(existsSync(marker),false,"the marker is retired and its lifecycle drained");
    assert.equal((await readdir(root)).some(name=>name.startsWith(".authority-ledger-admission-")||name.startsWith(".authority-ledger-coordination-cleanup-")),false,"no admission residue survives");
  });});
  await t.test("warm dead marker stays preserved bounded busy through observe exactly as fresh",async()=>{const owner:AdmissionOwner={host:hostname(),nonce:"b".repeat(64),pid:await exitedProcessPid(),v:1};await withRoot(async root=>{
    await warmRoot(root);
    await seedAbandoned(root,owner);
    const before=await snapshotRootArtifacts(root);
    const result=await settle(root,"observe");
    assert.deepEqual({ok:result.ok,reason:(result as {reason?:string}).reason},{ok:false,reason:"busy"},"observe holds the recover-reserved family");
    assert.deepEqual(await snapshotRootArtifacts(root),before,"preserved byte-identically");
  });});
  await t.test("warm live marker stays preserved bounded busy from both entry points",()=>withRoot(async root=>{
    await warmRoot(root);
    const owner:AdmissionOwner={host:hostname(),nonce:"c".repeat(64),pid:process.pid,v:1};
    await seedAbandoned(root,owner);
    const before=await snapshotRootArtifacts(root);
    for(const entry of ["observe","recover"] as const){
      const result=await settle(root,entry);
      assert.deepEqual({ok:result.ok,reason:(result as {reason?:string}).reason},{ok:false,reason:"busy"},entry);
    }
    assert.deepEqual(await snapshotRootArtifacts(root),before,"preserved byte-identically");
  }));
  await t.test("warm orphan abandoned final drains through recover",async()=>{const owner:AdmissionOwner={host:hostname(),nonce:"d".repeat(64),pid:await exitedProcessPid(),v:1};await withRoot(async root=>{
    await warmRoot(root);
    const markerName=admissionRetiredName(owner,"abandoned"),marker=path.join(root,markerName);
    await mkdir(marker);await writeFile(path.join(marker,"owner.json"),publicationOwnerBytes(owner));
    const ack=slotCoordinationAck(owner,markerName,marker,"abandoned");
    await writeFile(path.join(root,coordinationAckName(ack)),authorityCanonicalBytes(ack));
    await rm(marker,{recursive:true});
    const result=await settle(root,"recover");
    assert.equal(result.ok,true,"recover drains the warm orphan abandoned final");
    assert.equal((await readdir(root)).some(name=>name.startsWith(".authority-ledger-coordination-cleanup-")),false,"the orphan ack is drained");
  });});
  const boundaries=[
    {name:"a same-owner released beside the warm marker stays preserved corruption",install:async(root:string,owner:AdmissionOwner)=>{await writeLegacyRetiredLock(root,owner,"released");}},
    {name:"an unrelated publication-aborted beside the warm marker stays preserved corruption",install:async(root:string,owner:AdmissionOwner)=>{await writeLegacyRetiredLock(root,{...owner,nonce:"e".repeat(64)},"publication-aborted");}},
    {name:"an unrelated recovery-pending beside the warm marker stays preserved corruption",install:async(root:string,owner:AdmissionOwner)=>{await writeLegacyRetiredLock(root,{...owner,nonce:"f".repeat(64)},"recovery-pending");}},
  ] as const;
  for(const boundary of boundaries)await t.test(boundary.name,async()=>{const owner:AdmissionOwner={host:hostname(),nonce:"1".repeat(64),pid:await exitedProcessPid(),v:1};await withRoot(async root=>{
    await warmRoot(root);
    await seedAbandoned(root,owner);
    await boundary.install(root,owner);
    const before=await snapshotRootArtifacts(root);
    for(const entry of ["observe","recover"] as const){
      const result=await settle(root,entry);
      assert.deepEqual({ok:result.ok,reason:(result as {reason?:string}).reason},{ok:false,reason:"corruption"},`${boundary.name}: ${entry}`);
    }
    assert.deepEqual(await snapshotRootArtifacts(root),before,"preserved byte-identically");
  });});
  await t.test("an unrelated publication-aborted beside the warm orphan final stays preserved corruption",async()=>{const owner:AdmissionOwner={host:hostname(),nonce:"2".repeat(64),pid:await exitedProcessPid(),v:1};await withRoot(async root=>{
    await warmRoot(root);
    const markerName=admissionRetiredName(owner,"abandoned"),marker=path.join(root,markerName);
    await mkdir(marker);await writeFile(path.join(marker,"owner.json"),publicationOwnerBytes(owner));
    const ack=slotCoordinationAck(owner,markerName,marker,"abandoned");
    await writeFile(path.join(root,coordinationAckName(ack)),authorityCanonicalBytes(ack));
    await rm(marker,{recursive:true});
    await writeLegacyRetiredLock(root,{...owner,nonce:"3".repeat(64)},"publication-aborted");
    const before=await snapshotRootArtifacts(root);
    for(const entry of ["observe","recover"] as const){
      const result=await settle(root,entry);
      assert.deepEqual({ok:result.ok,reason:(result as {reason?:string}).reason},{ok:false,reason:"corruption"},entry);
    }
    assert.deepEqual(await snapshotRootArtifacts(root),before,"preserved byte-identically");
  });});
});

// Phase 1a of the flip's staged migration (owner grant 2026-08-06, recorded in the S4 re-spec §§6-7):
// {mode:"legacy"} is the exact recognized disable value the committed default-mode fixtures migrate
// to before the default inverts, so their pinned pre-flip semantics survive the flip unchanged. The
// pin asserts the disable value takes the legacy path directly -- zero admission-preparation
// boundaries, the pre-K1 clean-root shape -- never "identical to option-absent", because after the
// flip option-absent means enabled while this value must keep meaning disabled until it retires.
test("the admission-preparation runtime recognizes the exact legacy disable value",()=>withRoot(async root=>{
  const option=k1AdmissionPreparationOption();
  const observed:string[]=[];let published=0,retired=0,callbacks=0;
  const result=await new RawFsAuthorityLedger(root,{[option]:{mode:"legacy"},now:()=>t0,lockTimeoutMs:2_000,faultInjector:(point:string)=>{
    observed.push(point);
    if(point==="after-lock-publication-root-sync")published++;
    if(point==="after-lock-retire")retired++;
    if(point==="before-ledger-operation-callback")callbacks++;
  }} as never).observeClock();
  assert.deepEqual(result,{ok:true,status:"advanced",observedAt:new Date(t0).toISOString()});
  assert.deepEqual(observed.filter(point=>(K1_ADMISSION_PREPARATION_POINTS as readonly string[]).includes(point)),[],"no admission-preparation boundary fires under the exact disable value");
  assert.deepEqual({published,retired,callbacks},{published:1,retired:1,callbacks:1},"the disable value keeps the pre-K1 clean-root shape");
  assert.deepEqual(livePrepNames(await readdir(root)),[],"no preparation is created under the disable value");
  assert.equal(existsSync(path.join(root,".authority-ledger-admission-0")),false,"no fixed slot is created under the disable value");
}));

// The post-flip unknown-value semantics, decided and pinned BEFORE the flip makes them live (the
// Batch D task-1 pin): an unrecognized admission-preparation runtime value refuses construction
// with a TypeError -- fail closed, no silent mode selection -- while undefined and the two exact
// literals keep their meanings. Measured before pinning: every committed constructor passes either
// nothing or the exact ON literal, so the throw breaks no committed fixture. The pin enforces the
// refusal AT CONSTRUCTION (assert.throws wraps only the constructor); the implementation places it
// before any filesystem access, and the injector/byte-identical assertions guard the closed half.
test("an unrecognized admission-preparation runtime value refuses construction with a TypeError",()=>withRoot(async root=>{
  const option=k1AdmissionPreparationOption();
  const junk:readonly unknown[]=[null,{},{mode:"unknown"},{mode:"legacy",extra:true},{mode:"prepare-and-promote",extra:true},{mode:1},{mode:null},"legacy","prepare-and-promote",true,1,[],Symbol("mode")];
  const before=await snapshotRootArtifacts(root);
  for(const [index,value] of junk.entries()){
    let hooks=0;
    assert.throws(()=>new RawFsAuthorityLedger(root,{[option]:value,now:()=>t0,lockTimeoutMs:2_000,faultInjector:()=>{hooks++;}} as never),TypeError,`junk ${index} refuses construction`);
    assert.equal(hooks,0,`junk ${index} never reaches the injector`);
  }
  assert.deepEqual(await snapshotRootArtifacts(root),before,"refused construction mutates nothing");
}));
