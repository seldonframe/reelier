import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync,linkSync,lstatSync,mkdirSync,readFileSync,readdirSync,renameSync,rmSync,symlinkSync,writeFileSync } from "node:fs";
import { mkdtemp, open, rm, writeFile, mkdir, readFile, readdir, rename, symlink, unlink, link } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFile,spawn } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
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
} from "../../src/authority/host/fs-ledger.js";

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
  const root=await tempRoot();
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

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await tempRoot();
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
  const first=new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:40,faultInjector:(point:string)=>{
    if(point==="after-lock-publication-stage-sync"&&!secondPromise){staged=true;secondPromise=new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:500,faultInjector:(observed:string)=>{if(observed==="before-ledger-operation-callback")secondCallbacks++;}} as never).observeClock();}
    if(staged&&point==="before-publication-stage-root-reenumeration")throw Object.assign(new Error("sharing"),{code:"EBUSY"});
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
  const ledger=new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="after-lock-publication-stage-sync"){const name=readdirSync(root).find(value=>value.startsWith(".authority-ledger-lock-publication-"));assert.ok(name);ownStage=path.join(root,name);ownerBytes=readFileSync(path.join(ownStage,"owner.json"));owner=JSON.parse(ownerBytes.toString("utf8"));throw terminalError;}if(point==="before-creator-stage-withdrawal-validation")withdrawalActive=true;if(withdrawalActive&&point==="after-publication-stage-cleanup-root-sync"&&owner){const marker=path.join(root,`.authority-ledger-lock-${owner.pid}-${owner.nonce}.publication-aborted`);originalAbsent=!existsSync(ownStage);markerPresent=existsSync(marker);if(markerPresent)markerBytes=readFileSync(path.join(marker,"owner.json"));}if(point==="before-ledger-operation-callback")callbackEntries++;}} as never);
  try{await ledger.observeClock();}catch(error){thrown=error;}
  assert.equal(thrown,terminalError);assert.equal(withdrawalActive,true);assert.equal(originalAbsent,true);assert.equal(markerPresent,true);assert.deepEqual(markerBytes,ownerBytes);assert.equal(callbackEntries,0);
}));

test("active owner treats atomic complete withdrawal as membership change, never corruption",()=>withRoot(async root=>{
  const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});assert.ok(child.pid);const owner={host:hostname(),nonce:"3".repeat(64),pid:child.pid,v:1 as const,ticket:"0000000000000001"},bytes=publicationOwnerBytes(owner),stage=path.join(root,publicationStageName(owner)),marker=path.join(root,`.authority-ledger-lock-${owner.pid}-${owner.nonce}.publication-aborted`);let installed=false,renamed=false,callbackEntries=0;
  try{const result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:200,faultInjector:(point:string)=>{if(point==="after-lock-publication-root-sync"&&!installed){installed=true;mkdirSync(stage);writeFileSync(path.join(stage,"owner.json"),bytes);}if(point==="after-lock-publication-generation-closed"&&installed&&!renamed){renamed=true;renameSync(stage,marker);}if(point==="before-ledger-operation-callback")callbackEntries++;}} as never).observeClock();assert.deepEqual(result,{ok:true,status:"advanced",observedAt:new Date(t0).toISOString()});assert.equal(installed,true);assert.equal(renamed,true);assert.equal(callbackEntries,1);assert.equal(existsSync(stage),false);assert.equal(existsSync(marker),false,"the active owner services the authenticated publication-aborted marker");}finally{child.kill();}
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
function coordinationStageName(record:Readonly<Record<string,unknown>>,owner:AdmissionOwner,purpose:CoordinationPurpose):string{return `.authority-ledger-coordination-cleanup-stage-${purpose}-${publicationHostDigest(owner.host)}-${owner.pid}-${owner.nonce}-${authorityDigest(record).slice(7)}.tmp`;}
function incompleteCoordinationAck(owner:AdmissionOwner,purpose:"prep-retired"|"creator-withdrawal",markerName:string,originalName:string,state:AdmissionPartialState,marker:string,slotRetirementAck?:Readonly<Record<string,unknown>>){const bytes=state==="empty"?Buffer.alloc(0):readFileSync(path.join(marker,"owner.json")),base={directoryIdentity:decimalIdentity(marker),kind:purpose==="prep-retired"?"admission-prep-retired":"creator-withdrawal",markerName,originalName,owner,ownerBytesDigest:rawDigest(bytes),ownerBytesLength:String(bytes.length),ownerDigest:authorityDigest(owner),ownerIdentity:state==="empty"?null:decimalIdentity(path.join(marker,"owner.json")),purpose,recoveryAuthority:purpose==="prep-retired"?"dead-owner-or-exact-creator":"exact-slot-retirement-ack",state,v:coordinationAckVersion};if(purpose==="prep-retired")return base;assert.ok(slotRetirementAck,"creator withdrawal fixture requires the exact slot-retirement ack");return {...base,slotRetirementAckDigest:authorityDigest(slotRetirementAck),slotRetirementAckName:coordinationAckName(slotRetirementAck)};}
function slotCoordinationAck(owner:AdmissionOwner,markerName:string,marker:string,disposition:"published"|"withdrawn"|"abandoned",terminalArtifactName=markerName,terminalBytes=publicationOwnerBytes(owner)){const ownerPath=path.join(marker,"owner.json"),bytes=readFileSync(ownerPath);return {disposition,kind:"admission-slot-retired",markerName,owner,ownerBytesDigest:rawDigest(bytes),ownerBytesLength:String(bytes.length),ownerDigest:authorityDigest(owner),ownerIdentity:decimalIdentity(ownerPath),originalName:".authority-ledger-admission-0",purpose:"slot-retired",recoveryAuthority:"active-owner-after-terminal-proof",slotIdentity:decimalIdentity(marker),terminalArtifactDigest:rawDigest(terminalBytes),terminalArtifactName,v:coordinationAckVersion};}

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
  await t.test("two distinct external stages are invalid K=1 topology",()=>withRoot(async root=>{const owners=[{host:hostname(),nonce:"6".repeat(64),pid:49103,v:1 as const,ticket:"0000000000000001"},{host:hostname(),nonce:"7".repeat(64),pid:49104,v:1 as const,ticket:"0000000000000002"}];for(const owner of owners)await writePublicationStage(root,owner,publicationOwnerBytes(owner));const before=await snapshotRootArtifacts(root),originalKill=process.kill;Object.defineProperty(process,"kill",{configurable:true,value:(pid:number)=>owners.some(owner=>owner.pid===pid)?true:originalKill.call(process,pid,0)});let result;try{result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20}).observeClock();}finally{Object.defineProperty(process,"kill",{configurable:true,value:originalKill});}assert.deepEqual(result,{ok:false,reason:"corruption"});assert.deepEqual(await snapshotRootArtifacts(root),before);}));
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
  for(const state of ["marker-only","marker-plus-stage","marker-plus-ack","orphan-ack"] as const)await t.test(state,()=>withRoot(async root=>{const owner={host:hostname(),nonce:(state==="marker-only"?"1":state==="marker-plus-stage"?"2":state==="marker-plus-ack"?"3":"4").repeat(64),pid:process.pid,v:1 as const},terminalName=retirementMarkerName(owner,"publication-aborted"),terminal=path.join(root,terminalName),markerName=admissionRetiredName(owner,"withdrawn"),marker=path.join(root,markerName);await mkdir(terminal);await writeFile(path.join(terminal,"owner.json"),publicationOwnerBytes(owner));await mkdir(marker);await writeFile(path.join(marker,"owner.json"),publicationOwnerBytes(owner));const ack=slotCoordinationAck(owner,markerName,marker,"withdrawn",terminalName,publicationOwnerBytes(owner)),ackPath=path.join(root,coordinationAckName(ack)),stagePath=path.join(root,coordinationStageName(ack,owner,"slot-retired"));if(state==="marker-plus-stage")await writeFile(stagePath,authorityCanonicalBytes(ack));if(state==="marker-plus-ack"||state==="orphan-ack")await writeFile(ackPath,authorityCanonicalBytes(ack));if(state==="orphan-ack")await rm(marker,{recursive:true});const result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:200}).observeClock();assert.deepEqual(result,{ok:true,status:"advanced",observedAt:new Date(t0).toISOString()},state);assert.equal(existsSync(marker),false,state);assert.equal(existsSync(stagePath),false,state);assert.equal(existsSync(ackPath),false,state);assert.equal(existsSync(terminal),false,state);}));
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
  for(const [state,boundary] of [["empty","after-lock-publication-stage-create"],["zero","after-lock-publication-owner-create"],["partial","after-lock-publication-owner-partial-write"],["complete","after-lock-publication-owner-sync"]] as const)await t.test(state,()=>withRoot(async root=>{const terminal={state,boundary},ticket="",stage="";let ownStage=stage,owner:AdmissionOwner|undefined,thrown:unknown,callbackEntries=0,markerSeen=false,completeObservedEmpty=false;const ledger=new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="after-lock-publication-stage-create"&&!ownStage){const name=readdirSync(root).find(value=>value.startsWith(".authority-ledger-lock-publication-"));assert.ok(name);ownStage=path.join(root,name);const match=/^\.authority-ledger-lock-publication-[0-9a-f]{64}-([0-9a-f]{16})-(\d+)-([0-9a-f]{64})\.tmp$/.exec(name);assert.ok(match);owner={host:hostname(),nonce:match[3],pid:Number(match[2]),v:1};}if(point===boundary)throw terminal;if(point==="before-creator-stage-withdrawal-validation"&&state==="complete"&&existsSync(ownStage)&&!existsSync(path.join(ownStage,"owner.json")))completeObservedEmpty=true;if(point==="after-publication-stage-cleanup-root-sync"&&owner){const markerName=state==="complete"?retirementMarkerName(owner,"publication-aborted"):creatorWithdrawalName(owner,state);markerSeen=existsSync(path.join(root,markerName));}if(point==="before-ledger-operation-callback")callbackEntries++;}} as never);try{await ledger.observeClock();}catch(error){thrown=error;}assert.equal(thrown,terminal,"cleanup preserves the original thrown object by identity");assert.equal(markerSeen,true,`${state} withdrawal is atomically durable before cleanup`);assert.equal(existsSync(ownStage),false);assert.equal(completeObservedEmpty,false,"complete withdrawal never exposes complete-to-empty");assert.equal(callbackEntries,0);void ticket;}));
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

test("atomic admission active owner cleans coordination once after every sync barrier",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"3".repeat(64),pid:process.pid,v:1 as const},withdrawalName=retirementMarkerName(owner,"publication-aborted"),withdrawal=path.join(root,withdrawalName),slotName=admissionRetiredName(owner,"withdrawn"),slot=path.join(root,slotName);await mkdir(withdrawal);await writeFile(path.join(withdrawal,"owner.json"),publicationOwnerBytes(owner));await mkdir(slot);await writeFile(path.join(slot,"owner.json"),publicationOwnerBytes(owner));const slotAck=slotCoordinationAck(owner,slotName,slot,"withdrawn",withdrawalName,publicationOwnerBytes(owner));await writeFile(path.join(root,coordinationAckName(slotAck)),authorityCanonicalBytes(slotAck));const order:string[]=[];let slotSyncs=0,withdrawalSyncs=0,callbackEntries=0;const result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:200,faultInjector:(point:string)=>{if(point==="after-admission-slot-retire-cleanup-root-sync"){slotSyncs++;order.push("slot-sync");}if(point==="after-creator-withdrawal-cleanup-root-sync"){withdrawalSyncs++;order.push("withdrawal-sync");}if(point==="before-ledger-operation-callback"){callbackEntries++;order.push("callback");assert.equal(slotSyncs,1);assert.equal(withdrawalSyncs,1);}}} as never).observeClock();assert.deepEqual(result,{ok:true,status:"advanced",observedAt:new Date(t0).toISOString()});assert.deepEqual({slotSyncs,withdrawalSyncs,callbackEntries},{slotSyncs:1,withdrawalSyncs:1,callbackEntries:1});assert.deepEqual(order,["slot-sync","withdrawal-sync","callback"]);}));

test("pre-admission housekeeper retires one dead slot before preparation and mutates no semantic state",()=>withRoot(async root=>{
  assert.equal((await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:200}).recover()).ok,true);
  const semantic=["ingress","journal","transactions","claims","tombstones"] as const,before=await snapshotDurableSubtrees(root,semantic),owner={host:hostname(),nonce:"4".repeat(64),pid:49301,v:1 as const},slot=await writeAdmissionSlot(root,owner),originalKill=process.kill,terminal={kind:"after-housekeeping-before-prep"};let callbacks=0,semanticClockReads=0,prepCreates=0,publicationCreates=0,thrown:unknown;
  Object.defineProperty(process,"kill",{configurable:true,value:(pid:number)=>pid===owner.pid?(()=>{throw Object.assign(new Error("dead"),{code:"ESRCH"});})():originalKill.call(process,pid,0)});
  try{await new RawFsAuthorityLedger(root,{now:()=>{semanticClockReads++;return t0;},lockTimeoutMs:200,faultInjector:(point:string)=>{if(point==="after-admission-prep-create")prepCreates++;if(point==="after-lock-publication-stage-create")publicationCreates++;if(point==="before-ledger-operation-callback")callbacks++;if(point==="after-pre-admission-housekeeping-root-sync")throw terminal;}} as never).observeClock();}catch(error){thrown=error;}finally{Object.defineProperty(process,"kill",{configurable:true,value:originalKill});}
  assert.equal(thrown,terminal);assert.deepEqual({callbacks,semanticClockReads,prepCreates,publicationCreates},{callbacks:0,semanticClockReads:0,prepCreates:0,publicationCreates:0});assert.equal(existsSync(slot),false);assert.equal(existsSync(path.join(root,admissionRetiredName(owner,"abandoned"))),true);assert.deepEqual(await snapshotDurableSubtrees(root,semantic),before);
}));

test("pre-admission housekeeper preserves a live abandoned marker without ack as busy",()=>withRoot(async root=>{
  const owner={host:hostname(),nonce:"5".repeat(64),pid:process.pid,v:1 as const},markerName=admissionRetiredName(owner,"abandoned"),marker=path.join(root,markerName);await mkdir(marker);await writeFile(path.join(marker,"owner.json"),publicationOwnerBytes(owner));const before=await snapshotRootArtifacts(root);let callbacks=0,prepCreates=0;const result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="after-admission-prep-create")prepCreates++;if(point==="before-ledger-operation-callback")callbacks++;}} as never).observeClock();assert.deepEqual(result,{ok:false,reason:"busy"});assert.deepEqual({callbacks,prepCreates},{callbacks:0,prepCreates:0});assert.deepEqual(await snapshotRootArtifacts(root),before);
}));

test("withdrawn slot and creator-withdrawal cleanup recognizes exactly seven evidence-bound crash states",async t=>{
  const states=["slot-withdrawal","slot-withdrawal-slot-stage","slot-withdrawal-slot-ack","withdrawal-slot-ack","withdrawal-both-acks","withdrawal-withdrawal-ack","orphan-withdrawal-ack"] as const;
  for(const [index,state] of states.entries())await t.test(state,()=>withRoot(async root=>{const owner={host:hostname(),nonce:(index+6).toString(16).repeat(64),pid:process.pid,v:1 as const},withdrawalName=creatorWithdrawalName(owner,"partial"),withdrawal=path.join(root,withdrawalName),slotName=admissionRetiredName(owner,"withdrawn"),slot=path.join(root,slotName);await mkdir(withdrawal);await writeFile(path.join(withdrawal,"owner.json"),ownerStateBytes(owner,"partial"));await mkdir(slot);await writeFile(path.join(slot,"owner.json"),publicationOwnerBytes(owner));const slotAck=slotCoordinationAck(owner,slotName,slot,"withdrawn",withdrawalName,ownerStateBytes(owner,"partial")),slotAckPath=path.join(root,coordinationAckName(slotAck)),slotStage=path.join(root,coordinationStageName(slotAck,owner,"slot-retired"));if(state==="slot-withdrawal-slot-stage")await writeFile(slotStage,authorityCanonicalBytes(slotAck));if(!["slot-withdrawal","slot-withdrawal-slot-stage"].includes(state))await writeFile(slotAckPath,authorityCanonicalBytes(slotAck));if(["withdrawal-slot-ack","withdrawal-both-acks","withdrawal-withdrawal-ack","orphan-withdrawal-ack"].includes(state))await rm(slot,{recursive:true});const withdrawalAck=incompleteCoordinationAck(owner,"creator-withdrawal",withdrawalName,publicationStageName({...owner,ticket:"0000000000000001"}),"partial",withdrawal,slotAck),withdrawalAckPath=path.join(root,coordinationAckName(withdrawalAck));if(["withdrawal-both-acks","withdrawal-withdrawal-ack","orphan-withdrawal-ack"].includes(state))await writeFile(withdrawalAckPath,authorityCanonicalBytes(withdrawalAck));if(["withdrawal-withdrawal-ack","orphan-withdrawal-ack"].includes(state))await rm(slotAckPath,{force:true});if(state==="orphan-withdrawal-ack")await rm(withdrawal,{recursive:true});let callbacks=0;const result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:200,faultInjector:(point:string)=>{if(point==="before-ledger-operation-callback")callbacks++;}} as never).observeClock();assert.deepEqual(result,{ok:true,status:"advanced",observedAt:new Date(t0).toISOString()},state);assert.equal(callbacks,1,state);for(const target of [slot,slotStage,slotAckPath,withdrawal,withdrawalAckPath])assert.equal(existsSync(target),false,`${state}:${path.basename(target)}`);}));
});

test("slot absence plus withdrawal without its bound retirement ack grants no cleanup authority",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"d".repeat(64),pid:process.pid,v:1 as const},withdrawal=await writeCreatorWithdrawal(root,owner,"partial"),before=await snapshotRootArtifacts(root);let callbacks=0,prepCreates=0;const result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="after-admission-prep-create")prepCreates++;if(point==="before-ledger-operation-callback")callbacks++;}} as never).observeClock();assert.deepEqual(result,{ok:false,reason:"corruption"});assert.deepEqual({callbacks,prepCreates},{callbacks:0,prepCreates:0});assert.deepEqual(await snapshotRootArtifacts(root),before);assert.equal(existsSync(withdrawal),true);}));

test("unrelated corrupt membership blocks every otherwise authorized housekeeper transition",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"e".repeat(64),pid:49302,v:1 as const},slot=await writeAdmissionSlot(root,owner),malformed=path.join(root,".authority-ledger-lock-publication-malformed.tmp"),originalKill=process.kill;await mkdir(malformed);const before=await snapshotRootArtifacts(root);let callbacks=0;Object.defineProperty(process,"kill",{configurable:true,value:(pid:number)=>pid===owner.pid?(()=>{throw Object.assign(new Error("dead"),{code:"ESRCH"});})():originalKill.call(process,pid,0)});let result;try{result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="before-ledger-operation-callback")callbacks++;}} as never).observeClock();}finally{Object.defineProperty(process,"kill",{configurable:true,value:originalKill});}assert.deepEqual(result,{ok:false,reason:"corruption"});assert.equal(callbacks,0);assert.deepEqual(await snapshotRootArtifacts(root),before);assert.equal(existsSync(slot),true);}));

test("publication identity comparison remains exact above Number.MAX_SAFE_INTEGER",async()=>{const publicAuthority=await import("../../src/authority/index.js") as Record<string,unknown>;assert.equal("__testSamePublicationFileIdentity" in publicAuthority,false);const hostModule=await import("../../src/authority/host/fs-ledger.js") as unknown as {__testSamePublicationFileIdentity?:(left:ExactFsIdentity,right:ExactFsIdentity)=>boolean},compare=hostModule.__testSamePublicationFileIdentity;assert.equal(typeof compare,"function");const adjacent=BigInt(Number.MAX_SAFE_INTEGER)+1n,left={dev:1n,ino:adjacent,mode:0o100600n,nlink:1n},right={...left,ino:adjacent+1n};assert.equal(Number(left.ino),Number(right.ino));assert.equal(compare!(left,right),false);});

test("atomic admission revalidates owner bytes at every publication boundary",async t=>{
  const boundaries=["after-admission-prep-owner-sync","after-admission-prep-sync","before-admission-slot-rename","after-lock-publication-owner-sync","after-lock-publication-stage-sync","before-lock-publication-rename","after-lock-publication-rename","after-lock-publication-root-sync"] as const;
  for(const boundary of boundaries)await t.test(boundary,()=>withRoot(async root=>{let fired=false,callbacks=0,semanticClockReads=0,replacementPath="";const replacement=Buffer.from(`replacement:${boundary}`),result=await new RawFsAuthorityLedger(root,{now:()=>{semanticClockReads++;return t0;},lockTimeoutMs:50,faultInjector:(point:string)=>{if(point==="before-ledger-operation-callback")callbacks++;if(point!==boundary||fired)return;fired=true;const names=readdirSync(root),prepBoundary=boundary.startsWith("after-admission-prep")||boundary==="before-admission-slot-rename",publishedBoundary=boundary==="after-lock-publication-rename"||boundary==="after-lock-publication-root-sync",container=prepBoundary?names.find(name=>name.startsWith(".authority-ledger-admission-prep-")&&!name.startsWith(".authority-ledger-admission-prep-retired-")):publishedBoundary?"lock":names.find(name=>name.startsWith(".authority-ledger-lock-publication-"));assert.ok(container,`${boundary}: fixture observes the exact owner container`);replacementPath=path.join(root,container,"owner.json");if(!prepBoundary){const slotOwner=path.join(root,".authority-ledger-admission-0","owner.json");assert.equal(existsSync(slotOwner),true,`${boundary}: fixed slot remains present until valid publication successor`);assert.deepEqual(readFileSync(slotOwner),readFileSync(replacementPath),`${boundary}: slot and publication owner remain byte-identical`);}writeFileSync(replacementPath,replacement);}} as never).observeClock();assert.equal(fired,true,`${boundary}: production exposes the revalidation boundary`);assert.deepEqual(result,{ok:false,reason:"corruption"});assert.deepEqual({callbacks,semanticClockReads},{callbacks:0,semanticClockReads:0});assert.deepEqual(readFileSync(replacementPath),replacement);assert.equal(existsSync(path.join(root,"lock"))&&boundary!=="after-lock-publication-rename"&&boundary!=="after-lock-publication-root-sync",false);}));
});

test("rename collision retains one synced creator stage and fixed slot and revalidates replacements",()=>withRoot(async root=>{const blocker={host:hostname(),nonce:"f".repeat(64),pid:process.pid,v:1 as const},blockerBytes=publicationOwnerBytes(blocker),replacement=Buffer.from("collision-retained-owner-replacement");let stageCreates=0,collisions=0,publishedRenames=0,callbacks=0,stagePath="",slotPath="",stageIdentity:ExactFsIdentity|undefined,slotIdentity:ExactFsIdentity|undefined;const result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:100,faultInjector:(point:string)=>{if(point==="after-admission-slot-root-sync"){slotPath=path.join(root,".authority-ledger-admission-0");slotIdentity=exactFsIdentity(slotPath);}if(point==="after-lock-publication-stage-create")stageCreates++;if(point==="after-lock-publication-stage-sync"&&!stagePath){const name=readdirSync(root).find(value=>value.startsWith(".authority-ledger-lock-publication-"));assert.ok(name);stagePath=path.join(root,name);stageIdentity=exactFsIdentity(stagePath);assert.ok(slotIdentity);mkdirSync(path.join(root,"lock"));writeFileSync(path.join(root,"lock","owner.json"),blockerBytes);}if(point==="after-lock-publication-rename-collision"){collisions++;assert.deepEqual(exactFsIdentity(stagePath),stageIdentity);assert.deepEqual(exactFsIdentity(slotPath),slotIdentity);writeFileSync(path.join(stagePath,"owner.json"),replacement);rmSync(path.join(root,"lock"),{recursive:true});}if(point==="after-lock-publication-rename")publishedRenames++;if(point==="before-ledger-operation-callback")callbacks++;}} as never).observeClock();assert.deepEqual(result,{ok:false,reason:"corruption"});assert.deepEqual({stageCreates,collisions,publishedRenames,callbacks},{stageCreates:1,collisions:1,publishedRenames:0,callbacks:0});assert.equal((readdirSync(root).filter(name=>name.startsWith(".authority-ledger-lock-publication-")).length),1);assert.deepEqual(readFileSync(path.join(stagePath,"owner.json")),replacement);assert.deepEqual(exactFsIdentity(slotPath),slotIdentity);}));

test("whole-snapshot restart denies active-lock churn external dead-to-live change and slot replacement",async t=>{
  await t.test("sustained-active-lock-replacement",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"1".repeat(64),pid:process.pid,v:1 as const},bytes=publicationOwnerBytes(owner),lock=path.join(root,"lock"),external=await tempRoot();try{await mkdir(lock);await writeFile(path.join(lock,"owner.json"),bytes);let replacements=0,callbacks=0,prepCreates=0,publicationCreates=0;const result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="after-active-lock-metadata"){const next=path.join(external,`lock-${replacements++}`);mkdirSync(next);writeFileSync(path.join(next,"owner.json"),bytes);renameSync(lock,path.join(external,`old-${replacements}`));renameSync(next,lock);}if(point==="after-admission-prep-create")prepCreates++;if(point==="after-lock-publication-stage-create")publicationCreates++;if(point==="before-ledger-operation-callback")callbacks++;}} as never).observeClock();assert.deepEqual(result,{ok:false,reason:"busy"});assert.ok(replacements>1);assert.deepEqual({callbacks,prepCreates,publicationCreates},{callbacks:0,prepCreates:0,publicationCreates:0});assert.deepEqual(readFileSync(path.join(lock,"owner.json")),bytes);}finally{await rm(external,{recursive:true,force:true});}}));
  await t.test("external-stage-dead-to-live",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"2".repeat(64),pid:49303,v:1 as const,ticket:"0000000000000001"},bytes=publicationOwnerBytes(owner),stage=await writePublicationStage(root,owner,bytes),originalKill=process.kill;let probes=0,callbacks=0,prepCreates=0,publicationCreates=0;Object.defineProperty(process,"kill",{configurable:true,value:(pid:number)=>{if(pid!==owner.pid)return originalKill.call(process,pid,0);probes++;if(probes===1)throw Object.assign(new Error("dead"),{code:"ESRCH"});return true;}});let result;try{result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="after-admission-prep-create")prepCreates++;if(point==="after-lock-publication-stage-create")publicationCreates++;if(point==="before-ledger-operation-callback")callbacks++;}} as never).observeClock();}finally{Object.defineProperty(process,"kill",{configurable:true,value:originalKill});}assert.deepEqual(result,{ok:false,reason:"busy"});assert.ok(probes>=2);assert.deepEqual({callbacks,prepCreates,publicationCreates},{callbacks:0,prepCreates:0,publicationCreates:0});assert.equal(existsSync(stage),true);assert.deepEqual(await readFile(path.join(stage,"owner.json")),bytes);}));
  await t.test("fixed-slot-atomic-replacement",()=>withRoot(async root=>{const owner={host:hostname(),nonce:"3".repeat(64),pid:process.pid,v:1 as const},slot=await writeAdmissionSlot(root,owner),bytes=publicationOwnerBytes(owner),external=await tempRoot();let replaced=false,callbacks=0,prepCreates=0;try{const result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="after-admission-slot-enumeration"&&!replaced){replaced=true;const next=path.join(external,"replacement-slot");mkdirSync(next);writeFileSync(path.join(next,"owner.json"),bytes);renameSync(slot,path.join(external,"original-slot"));renameSync(next,slot);}if(point==="after-admission-prep-create")prepCreates++;if(point==="before-ledger-operation-callback")callbacks++;}} as never).observeClock();assert.equal(replaced,true);assert.deepEqual(result,{ok:false,reason:"corruption"});assert.deepEqual({callbacks,prepCreates},{callbacks:0,prepCreates:0});assert.deepEqual(readFileSync(path.join(slot,"owner.json")),bytes);}finally{await rm(external,{recursive:true,force:true});}}));
});

test("typed housekeeping tombstones reject source-name reappearance at every closed snapshot",async t=>{
  const boundaries=["after-pre-admission-housekeeping-initial-enumeration","after-pre-admission-housekeeping-generation-closed","before-pre-admission-housekeeping-final-validation","after-pre-admission-housekeeping-marker-remove"] as const;
  for(const [index,boundary] of boundaries.entries())await t.test(boundary,()=>withRoot(async root=>{const external=await tempRoot(),owner={host:hostname(),nonce:(index+4).toString(16).repeat(64),pid:49310+index,v:1 as const},markerName=admissionPrepRetiredName(owner,"complete"),marker=path.join(root,markerName),originalName=admissionPrepName(owner),originalKill=process.kill;try{await mkdir(marker);await writeFile(path.join(marker,"owner.json"),publicationOwnerBytes(owner));const ack=incompleteCoordinationAck(owner,"prep-retired",markerName,originalName,"complete",marker),ackPath=path.join(root,coordinationAckName(ack)),replacement=path.join(external,"replacement");await writeFile(ackPath,authorityCanonicalBytes(ack));await mkdir(replacement);await writeFile(path.join(replacement,"owner.json"),publicationOwnerBytes(owner));let installed=false,callbacks=0,prepCreates=0;Object.defineProperty(process,"kill",{configurable:true,value:(pid:number)=>pid===owner.pid?(()=>{throw Object.assign(new Error("dead"),{code:"ESRCH"});})():originalKill.call(process,pid,0)});let result;try{result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:50,faultInjector:(point:string)=>{if(point===boundary&&!installed){installed=true;if(existsSync(marker))renameSync(marker,path.join(external,"original-marker"));renameSync(replacement,marker);}if(point==="after-admission-prep-create")prepCreates++;if(point==="before-ledger-operation-callback")callbacks++;}} as never).observeClock();}finally{Object.defineProperty(process,"kill",{configurable:true,value:originalKill});}assert.equal(installed,true,`${boundary}: exact product snapshot hook`);assert.deepEqual(result,{ok:false,reason:"corruption"});assert.deepEqual({callbacks,prepCreates},{callbacks:0,prepCreates:0});assert.equal(existsSync(marker),true);assert.deepEqual(await readFile(path.join(marker,"owner.json")),publicationOwnerBytes(owner));assert.equal(existsSync(ackPath),true,"typed ack is preserved with the replacement");}finally{Object.defineProperty(process,"kill",{configurable:true,value:originalKill});await rm(external,{recursive:true,force:true});}}));
});

test("unsafe NTFS identities cannot collapse same-byte prep-retired replacements",async t=>{
  for(const target of ["owner","directory"] as const)await t.test(target,()=>withRoot(async root=>{const external=await tempRoot(),owner={host:hostname(),nonce:(target==="owner"?"8":"9").repeat(64),pid:49320+(target==="owner"?0:1),v:1 as const},bytes=publicationOwnerBytes(owner),markerName=admissionPrepRetiredName(owner,"complete"),marker=path.join(root,markerName),originalKill=process.kill;try{const rounded=new Map<number,{path:string;ino:bigint}>();let first="",second="",firstIno=0n,secondIno=0n;for(let index=0;index<4096&&!second;index++){const candidate=path.join(external,`candidate-${index}`);if(target==="owner")writeFileSync(candidate,bytes);else{mkdirSync(candidate);writeFileSync(path.join(candidate,"owner.json"),bytes);}const ino=lstatSync(candidate,{bigint:true}).ino;if(ino<=BigInt(Number.MAX_SAFE_INTEGER))continue;const prior=rounded.get(Number(ino));if(prior&&prior.ino!==ino){first=prior.path;firstIno=prior.ino;second=candidate;secondIno=ino;break;}rounded.set(Number(ino),{path:candidate,ino});}if(!first||!second){t.skip("filesystem does not expose a bounded unsafe rounded-identity collision");return;}if(target==="owner"){await mkdir(marker);renameSync(first,path.join(marker,"owner.json"));}else renameSync(first,marker);const artifact=target==="owner"?path.join(marker,"owner.json"):marker;Object.defineProperty(process,"kill",{configurable:true,value:(pid:number)=>pid===owner.pid?(()=>{throw Object.assign(new Error("dead"),{code:"ESRCH"});})():originalKill.call(process,pid,0)});let replaced=false,callbacks=0,result;try{result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:20,faultInjector:(point:string)=>{if(point==="before-pre-admission-housekeeping-transition"&&!replaced){replaced=true;const displaced=path.join(external,`displaced-${target}`);renameSync(artifact,displaced);renameSync(second,artifact);}if(point==="before-ledger-operation-callback")callbacks++;}} as never).observeClock();}finally{Object.defineProperty(process,"kill",{configurable:true,value:originalKill});}assert.equal(replaced,true);assert.deepEqual(result,{ok:false,reason:"corruption"});assert.equal(callbacks,0);assert.notEqual(firstIno,secondIno);assert.equal(Number(firstIno),Number(secondIno));assert.equal(lstatSync(artifact,{bigint:true}).ino,secondIno);if(target==="owner")assert.deepEqual(await readFile(artifact),bytes);else assert.deepEqual(await readFile(path.join(artifact,"owner.json")),bytes);}finally{Object.defineProperty(process,"kill",{configurable:true,value:originalKill});await rm(external,{recursive:true,force:true});}}));
});

test("pre-callback admission order closes and revalidates the synced generation",()=>withRoot(async root=>{const order:string[]=[];const expected=["slot-root-sync","stage-sync","lock-root-sync","slot-retire-root-sync","generation-closed","callback"];const result=await new RawFsAuthorityLedger(root,{now:()=>t0,lockTimeoutMs:200,faultInjector:(point:string)=>{if(point==="after-admission-slot-root-sync")order.push("slot-root-sync");if(point==="after-lock-publication-stage-sync")order.push("stage-sync");if(point==="after-lock-publication-root-sync")order.push("lock-root-sync");if(point==="after-admission-slot-retire-root-sync")order.push("slot-retire-root-sync");if(point==="after-pre-callback-coordination-generation-closed")order.push("generation-closed");if(point==="before-ledger-operation-callback")order.push("callback");}} as never).observeClock();assert.deepEqual(result,{ok:true,status:"advanced",observedAt:new Date(t0).toISOString()});assert.deepEqual(order,expected);assert.equal((await readdir(root)).some(name=>name.startsWith(".authority-ledger-admission-")||name.startsWith(".authority-ledger-lock-publication-")||name.startsWith(".authority-ledger-coordination-cleanup-")),false);}));

const publicationCrashPoints=["after-lock-publication-stage-create","after-lock-publication-owner-create","after-lock-publication-owner-partial-write","after-lock-publication-owner-sync","after-lock-publication-stage-sync","after-lock-publication-rename","after-lock-publication-root-sync"] as const;
const publicationSnapshotFaultPoints=["after-active-lock-metadata","before-active-lock-content-read","after-mutating-admission-enumeration","after-publication-stage-enumeration","before-publication-stage-validation"] as const;
const publicationCleanupFaultPoints=["after-lock-publication-rename-collision","before-publication-stage-root-reenumeration","before-publication-stage-final-validation","before-publication-stage-final-liveness","before-publication-stage-remove-attempt","before-creator-stage-withdrawal-validation","after-publication-stage-cleanup-root-sync"] as const;
const publicationElectionFaultPoints=["after-lock-publication-provisional-predecessor-selection","before-lock-publication-provisional-root-reenumeration","before-lock-publication-provisional-predecessor-liveness","before-staged-publication-settlement","after-lock-publication-generation-closed","before-lock-publication-predecessor-validation"] as const;
const ledgerOperationCallbackFaultPoints=["before-ledger-operation-callback"] as const;

async function hardExitAtPublicationPoint(root:string,point:typeof publicationCrashPoints[number]):Promise<Readonly<{code:number|null,pid:number}>>{
  const moduleUrl=pathToFileURL(path.resolve("dist-test/src/authority/host/fs-ledger.js")).href,source=`import {FsAuthorityLedger} from ${JSON.stringify(moduleUrl)};const ledger=new FsAuthorityLedger(process.argv[1],{now:()=>${t0},faultInjector(observed){if(observed===process.argv[2])process.exit(93);}});await ledger.recover();process.exit(94);`;
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
  assert.deepEqual(ledgerLockFaultPoints, [...publicationCrashPoints,...publicationSnapshotFaultPoints,...publicationCleanupFaultPoints,...publicationElectionFaultPoints,...ledgerOperationCallbackFaultPoints,...ledgerLockDurabilityPoints]);
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
