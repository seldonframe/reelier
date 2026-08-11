import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { authorityCanonicalBytes, authorityDigest } from "../../src/authority/wire.js";
import {
  createFileGateDecisionSink,
  gateDecisionFaultPoints,
  gateDecisionRecordDigest,
  parseGateDecisionRecord,
  type GateDecisionRecord,
} from "../../src/authority/decision.js";
import { GATE_REFUSAL_REASONS, GATE_UNAVAILABLE_REASONS } from "../../src/authority/errors.js";

const sha = (character: string) => `sha256:${character.repeat(64)}`;
const context = Object.freeze({
  v: "reelier.decision-context/v1" as const,
  tenant: "tenant_1", requester: "requester_1", definitionAlias: "definition_1", requestId: "request_1",
  requestDigest: sha("1"), requestKey: sha("2"), contractDigest: null, capabilityId: null,
  capabilityDigest: null, outcomeKey: null, effectDigest: null,
  snapshots: Object.freeze({ sourceBundleDigest: null, authorityStateDigest: sha("3") }),
});
const event = Object.freeze({
  v: "reelier.gate-event/v1" as const, eventId: "event_1", at: "2026-08-02T12:00:00.000Z",
  verdict: "refused" as const, reasonCode: "contract-not-found", decisionContextDigest: authorityDigest(context),
});

function primary(overrides: Partial<GateDecisionRecord> = {}): GateDecisionRecord {
  return Object.freeze({
    v: "reelier.gate-decision-record/internal-v1", role: "primary", ingressClaimDigest: sha("4"),
    reservationId: null, decisionContext: context, decisionContextDigest: authorityDigest(context), gateEvent: event,
    gateEventDigest: authorityDigest(event), signerId: "gate_signer_1", signature: { alg: "ed25519" as const, sig: Buffer.alloc(64, 7).toString("base64") },
    ...overrides,
  });
}

function accepted(eventId="event_accepted",ingressClaimDigest=sha("4"),reservationId="reservation_1"):GateDecisionRecord{
  const decisionContext={...context,contractDigest:sha("5"),capabilityId:"capability_1",capabilityDigest:sha("6"),outcomeKey:sha("7"),effectDigest:sha("8"),snapshots:{sourceBundleDigest:sha("9"),authorityStateDigest:sha("3")}};
  const gateEvent={...event,eventId,verdict:"accepted" as const,reasonCode:"accepted",decisionContextDigest:authorityDigest(decisionContext)};
  return primary({ingressClaimDigest,reservationId,decisionContext,decisionContextDigest:authorityDigest(decisionContext),gateEvent,gateEventDigest:authorityDigest(gateEvent)});
}

function conflict(eventId="event_conflict"):GateDecisionRecord{
  const decisionContext={...context,definitionAlias:"definition_2"};
  const gateEvent={...event,eventId,reasonCode:"request-id-conflict",decisionContextDigest:authorityDigest(decisionContext)};
  return primary({role:"conflict",decisionContext,decisionContextDigest:authorityDigest(decisionContext),gateEvent,gateEventDigest:authorityDigest(gateEvent)});
}

test("the closed reason protocol has the exact approved order and no free-form escape hatch", () => {
  assert.deepEqual(GATE_REFUSAL_REASONS, [
    "request-id-conflict", "authority-state-invalid", "authority-state-rollback", "authority-state-changed",
    "contract-not-found", "contract-not-eligible", "contract-ambiguous", "contract-untrusted",
    "contract-alias-mismatch", "contract-audience-mismatch", "contract-inactive", "contract-revoked",
    "contract-not-yet-valid", "contract-expired", "delegation-invalid", "pack-mismatch", "definition-mismatch",
    "resolver-mismatch", "connector-mismatch", "account-mismatch", "endpoint-not-allowed", "risk-not-allowed",
    "source-read-refused", "source-observation-invalid", "source-projection-invalid", "source-ungrounded", "source-stale",
    "choices-invalid", "compile-refused", "effect-refused", "effect-endpoint-not-allowed", "effect-risk-not-allowed", "reservation-idempotency-conflict", "semantic-duplicate",
    "capability-integrity", "capability-already-reserved", "limit-exceeded", "not-yet-valid", "expired", "clock-rollback",
    "integrity-failure", "busy", "lock-owner-unverifiable", "corruption",
  ]);
  assert.deepEqual(GATE_UNAVAILABLE_REASONS, [
    "clock-unavailable", "ingress-ledger-unavailable", "authority-state-unavailable", "source-read-unavailable",
    "capability-id-unavailable", "event-id-unavailable", "signer-unavailable", "sink-unavailable", "decision-missing",
    "internal-integrity-unavailable",
  ]);
});

test("decision record parsing recomputes every context/event digest edge and intrinsic role combination", () => {
  assert.deepEqual(parseGateDecisionRecord(primary()), primary());
  assert.equal(gateDecisionRecordDigest(primary()), authorityDigest(primary()));
  for (const candidate of [
    primary({ decisionContextDigest: sha("9") }), primary({ gateEventDigest: sha("9") }),
    primary({ role: "conflict" }), primary({ reservationId: "reservation_1" }),
    primary({ gateEvent: { ...event, reasonCode: "request-id-conflict" } }),
  ]) assert.throws(() => parseGateDecisionRecord(candidate), /invalid gate decision record/i);
});

test("file sink atomically indexes event and primary ingress, returns copies, and freezes every conflict mapping", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-decision-"));
  try {
    const sink = createFileGateDecisionSink(root);
    const record = primary();
    assert.deepEqual(await sink.append(record), { ok: true, status: "appended", recordDigest: authorityDigest(record) });
    assert.deepEqual(await sink.append(record), { ok: true, status: "idempotent", recordDigest: authorityDigest(record) });
    const byEvent=await sink.lookupByEvent("event_1");assert.equal(byEvent.ok,true);if(byEvent.ok&&byEvent.status==="found"){assert.notEqual(byEvent.record,record);assert.equal(Object.isFrozen(byEvent.record),true);assert.throws(()=>{(byEvent.record as {signerId:string}).signerId="mutated";},/read only|Cannot assign/i);}
    assert.equal((await sink.lookupPrimaryByIngress(sha("4"))).ok, true);
    assert.deepEqual(await sink.append(primary({ signerId: "other" })), { ok: false, reason: "event-id-conflict" });
    assert.deepEqual(await sink.append(primary({ gateEvent: { ...event, eventId: "event_2" }, gateEventDigest: authorityDigest({ ...event, eventId: "event_2" }) })), { ok: false, reason: "primary-ingress-conflict" });
    const stored = await readFile(path.join(root, "gate-decisions.json"), "utf8");
    await writeFile(path.join(root, "gate-decisions.json"), stored.replace("contract-not-found", "contract-expired"));
    assert.deepEqual(await createFileGateDecisionSink(root).lookupByEvent("event_1"), { ok: false, reason: "corruption" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a relative decision root is fixed at construction and never follows a later cwd",async()=>{
  const originalCwd=process.cwd(),outer=await mkdtemp(path.join(tmpdir(),"reelier-decision-relative-root-")),other=await mkdtemp(path.join(tmpdir(),"reelier-decision-other-cwd-"));
  try{
    process.chdir(outer);await mkdir("fixed-root");const fixed=path.join(outer,"fixed-root"),sink=createFileGateDecisionSink("fixed-root");process.chdir(other);
    assert.deepEqual(await sink.append(primary()),{ok:true,status:"appended",recordDigest:authorityDigest(primary())});
    assert.equal(existsSync(path.join(fixed,"gate-decisions.json")),true);
    assert.equal(existsSync(path.join(other,"fixed-root")),false);
  }finally{process.chdir(originalCwd);await rm(outer,{recursive:true,force:true});await rm(other,{recursive:true,force:true});}
});

test("an existing Windows decision root is accepted through its distinct DOS 8.3 alias",{skip:process.platform!=="win32"},async t=>{
  const root=await mkdtemp(path.join(tmpdir(),"reelier-decision-short-alias-"));
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
    assert.doesNotThrow(()=>createFileGateDecisionSink(shortRoot));
  }finally{await rm(root,{recursive:true,force:true});}
});

test("decision roots reject symlink traversal at construction",async t=>{
  const outer=await mkdtemp(path.join(tmpdir(),"reelier-decision-root-symlink-")),real=path.join(outer,"real"),link=path.join(outer,"link");await mkdir(real);
  try{await symlink(real,link,process.platform==="win32"?"junction":"dir");}catch(error){if((error as {code?:string}).code==="EPERM"){t.skip("symlink creation unavailable on this host");await rm(outer,{recursive:true,force:true});return;}throw error;}
  try{assert.throws(()=>createFileGateDecisionSink(link),/root|symlink|reparse/i);}finally{await rm(outer,{recursive:true,force:true});}
});

test("an absent decision root is refused synchronously with zero filesystem creation",async()=>{
  const outer=await mkdtemp(path.join(tmpdir(),"reelier-decision-absent-root-")),parent=path.join(outer,"missing"),root=path.join(parent,"decisions");
  try{assert.throws(()=>createFileGateDecisionSink(root),/root|exist|directory/i);assert.equal(existsSync(parent),false,"construction must perform zero filesystem creation");}
  finally{await rm(outer,{recursive:true,force:true});}
});

test("a later parent junction cannot redirect an already-refused absent decision root",async t=>{
  const outer=await mkdtemp(path.join(tmpdir(),"reelier-decision-late-root-")),outside=await mkdtemp(path.join(tmpdir(),"reelier-decision-late-outside-")),parent=path.join(outer,"late-link"),root=path.join(parent,"decisions");
  try{
    assert.throws(()=>createFileGateDecisionSink(root),/root|exist|directory/i);
    try{await symlink(outside,parent,process.platform==="win32"?"junction":"dir");}catch(error){if((error as {code?:string}).code==="EPERM"){t.skip("symlink creation unavailable on this host");return;}throw error;}
    assert.equal(existsSync(path.join(outside,"decisions")),false,"the later junction target remains untouched");
  }finally{await rm(outer,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}
});

test("decision roots reject substitution without writing through the replacement",async t=>{
  const outer=await mkdtemp(path.join(tmpdir(),"reelier-decision-root-substitution-")),real=path.join(outer,"real"),outside=path.join(outer,"outside"),moved=path.join(outer,"moved");await mkdir(real);await mkdir(outside);const sink=createFileGateDecisionSink(real);await rename(real,moved);
  try{await symlink(outside,real,process.platform==="win32"?"junction":"dir");}catch(error){if((error as {code?:string}).code==="EPERM"){t.skip("symlink creation unavailable on this host");await rm(outer,{recursive:true,force:true});return;}throw error;}
  try{
    assert.deepEqual(await sink.append(primary()),{ok:false,reason:"unavailable"});
    assert.equal(existsSync(path.join(outside,"gate-decisions.json")),false);
  }finally{await rm(outer,{recursive:true,force:true});}
});

test("decision lock owner publication is file-synced, lock-directory-synced, then root-synced",async()=>{
  const root=await mkdtemp(path.join(tmpdir(),"reelier-decision-owner-publication-")),observed:string[]=[];
  try{
    const sink=createFileGateDecisionSink(root,{lockFaultInjector:(point:string)=>{observed.push(point);}} as never);
    assert.equal((await sink.append(primary())).ok,true);
    assert.deepEqual(observed.slice(0,5),["before-owner-publish","after-owner-write","after-owner-file-sync","after-lock-directory-sync","after-root-directory-sync"]);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("every interrupted owner-publication boundary cleans its self-created lock without an ownerless remainder",async()=>{
  const points=["before-owner-publish","after-owner-write","after-owner-file-sync","after-lock-directory-sync","after-root-directory-sync"] as const;
  for(const point of points){const root=await mkdtemp(path.join(tmpdir(),"reelier-decision-owner-publication-fault-"));try{let fired=false;const sink=createFileGateDecisionSink(root,{lockFaultInjector:(observed:string)=>{if(!fired&&observed===point){fired=true;throw new Error(`fault:${point}`);}}} as never);assert.deepEqual(await sink.append(primary()),{ok:false,reason:"unavailable"},point);assert.equal(fired,true,point);assert.equal(existsSync(path.join(root,".gate-decisions.lock")),false,point);}finally{await rm(root,{recursive:true,force:true});}}
});

test("decision lock timeout is a closed positive bounded integer",async()=>{
  const root=await mkdtemp(path.join(tmpdir(),"reelier-decision-timeout-"));
  try{
    for(const value of [1,60_000,undefined])assert.doesNotThrow(()=>createFileGateDecisionSink(root,value===undefined?{}:{lockTimeoutMs:value}),String(value));
    for(const value of [0,-1,Number.NaN,Number.POSITIVE_INFINITY,1.5,60_001])assert.throws(()=>createFileGateDecisionSink(root,{lockTimeoutMs:value}),/lock timeout/i,String(value));
  }finally{await rm(root,{recursive:true,force:true});}
});

test("wall-clock rollback cannot extend a bounded unavailable decision-lock acquisition",{timeout:10_000},async()=>{
  const root=await mkdtemp(path.join(tmpdir(),"reelier-decision-monotonic-timeout-"));
  try{
    const moduleUrl=pathToFileURL(path.resolve("dist-test/src/authority/decision.js")).href,run=promisify(execFile);
    const script='const {mkdir,writeFile}=await import("node:fs/promises");const {hostname}=await import("node:os");const path=(await import("node:path")).default;const {createFileGateDecisionSink}=await import(process.argv[1]);const root=process.argv[2],lock=path.join(root,".gate-decisions.lock");await mkdir(lock);await writeFile(path.join(lock,"owner.json"),JSON.stringify({host:hostname(),nonce:"d".repeat(64),pid:process.pid,v:"reelier.gate-decision-lock/internal-v1"}));let wall=1000;Date.now=()=>--wall;const result=await createFileGateDecisionSink(root,{lockTimeoutMs:1}).append(JSON.parse(process.argv[3]));process.stdout.write(JSON.stringify(result));';
    const output=await run(process.execPath,["--input-type=module","-e",script,moduleUrl,root,JSON.stringify(primary())],{timeout:2_000});assert.deepEqual(JSON.parse(output.stdout),{ok:false,reason:"unavailable"});
  }finally{await rm(root,{recursive:true,force:true});}
});

test("append classifies malformed stores and duplicate indexes as corruption, never environmental unavailability",async()=>{
  const cases:readonly [string,Buffer][]=[
    ["malformed-json",Buffer.from("{")],
    ["invalid-record",authorityCanonicalBytes({v:"reelier.gate-decision-store/internal-v1",records:[{}]})],
    ["duplicate-event",authorityCanonicalBytes({v:"reelier.gate-decision-store/internal-v1",records:[primary(),primary({signerId:"other_signer"})]})],
    ["duplicate-primary",authorityCanonicalBytes({v:"reelier.gate-decision-store/internal-v1",records:[primary(),primary({gateEvent:{...event,eventId:"event_2"},gateEventDigest:authorityDigest({...event,eventId:"event_2"})})]})],
    ["duplicate-reservation",authorityCanonicalBytes({v:"reelier.gate-decision-store/internal-v1",records:[accepted("event_a",sha("4")),accepted("event_b",sha("5"))]})],
  ];
  for(const [label,bytes] of cases){
    const root=await mkdtemp(path.join(tmpdir(),`reelier-decision-corrupt-${label}-`));
    try{await writeFile(path.join(root,"gate-decisions.json"),bytes);assert.deepEqual(await createFileGateDecisionSink(root).append(primary({gateEvent:{...event,eventId:"event_new"},gateEventDigest:authorityDigest({...event,eventId:"event_new"})})),{ok:false,reason:"corruption"},label);}finally{await rm(root,{recursive:true,force:true});}
  }
});

test("a crashed decision-lock owner is reclaimed only after same-host death is proved",{timeout:30_000},async()=>{
  const root=await mkdtemp(path.join(tmpdir(),"reelier-decision-dead-lock-")),run=promisify(execFile);
  try{
    const script='const {mkdir,writeFile}=await import("node:fs/promises");const {hostname}=await import("node:os");const path=(await import("node:path")).default;const lock=path.join(process.argv[1],".gate-decisions.lock");await mkdir(lock);await writeFile(path.join(lock,"owner.json"),JSON.stringify({host:hostname(),nonce:"a".repeat(64),pid:process.pid,v:"reelier.gate-decision-lock/internal-v1"}));';
    await run(process.execPath,["--input-type=module","-e",script,root]);
    assert.deepEqual(await createFileGateDecisionSink(root,{lockTimeoutMs:2_000}).append(primary()),{ok:true,status:"appended",recordDigest:authorityDigest(primary())});
  }finally{await rm(root,{recursive:true,force:true});}
});

test("decision-lock reclaim refuses owner mutation and every unverifiable or live owner",async()=>{
  const ownerPath=(root:string)=>path.join(root,".gate-decisions.lock","owner.json"),owner=(overrides:Record<string,unknown>={})=>authorityCanonicalBytes({host:hostname(),nonce:"b".repeat(64),pid:2_147_483_647,v:"reelier.gate-decision-lock/internal-v1",...overrides});
  for(const [label,bytes] of [["malformed",Buffer.from("{")],["foreign",owner({host:"another-host"})],["live",owner({pid:process.pid})]] as const){const root=await mkdtemp(path.join(tmpdir(),`reelier-decision-lock-${label}-`));try{await writeFile(ownerPath(root),bytes,{flag:"wx"}).catch(async()=>{await (await import("node:fs/promises")).mkdir(path.dirname(ownerPath(root)),{recursive:true});await writeFile(ownerPath(root),bytes);});assert.deepEqual(await createFileGateDecisionSink(root,{lockTimeoutMs:20}).append(primary()),{ok:false,reason:"unavailable"},label);assert.deepEqual(await readFile(ownerPath(root)),bytes,label);}finally{await rm(root,{recursive:true,force:true});}}
  const root=await mkdtemp(path.join(tmpdir(),"reelier-decision-lock-mutation-"));
  try{
    await (await import("node:fs/promises")).mkdir(path.dirname(ownerPath(root)),{recursive:true});await writeFile(ownerPath(root),owner());
    const replacement=owner({nonce:"c".repeat(64),pid:process.pid});let injected=false;
    const sink=createFileGateDecisionSink(root,{lockTimeoutMs:20,lockFaultInjector:(point:string)=>{if(point==="after-owner-read"&&!injected){injected=true;writeFileSync(ownerPath(root),replacement);}}} as never);
    assert.deepEqual(await sink.append(primary()),{ok:false,reason:"unavailable"});
    assert.equal(injected,true);
    assert.deepEqual(await readFile(ownerPath(root)),replacement);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("a failed atomic decision-lock retirement leaves the complete verified owner in place",async()=>{
  const root=await mkdtemp(path.join(tmpdir(),"reelier-decision-lock-retire-failure-")),ownerFile=path.join(root,".gate-decisions.lock","owner.json");let injected=false;
  try{
    const sink=createFileGateDecisionSink(root,{lockTimeoutMs:20,lockFaultInjector:(point:string)=>{if(point==="before-lock-retire"&&!injected){injected=true;throw new Error("injected lock retirement failure");}}} as never);
    assert.deepEqual(await sink.append(primary()),{ok:true,status:"appended",recordDigest:authorityDigest(primary())});
    assert.equal(injected,true);
    const preserved=await readFile(ownerFile),parsed=JSON.parse(preserved.toString("utf8"));
    assert.deepEqual(Object.keys(parsed).sort(),["host","nonce","pid","v"]);
    assert.equal(parsed.v,"reelier.gate-decision-lock/internal-v1");
    assert.deepEqual(await createFileGateDecisionSink(root,{lockTimeoutMs:20}).append(primary({gateEvent:{...event,eventId:"event_after_failed_release"},gateEventDigest:authorityDigest({...event,eventId:"event_after_failed_release"})})),{ok:false,reason:"primary-ingress-conflict"});
    assert.deepEqual(await readFile(ownerFile),preserved);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("a concurrent held decision lock returns the durable terminal classification",async()=>{
  const root=await mkdtemp(path.join(tmpdir(),"reelier-decision-held-lock-"));
  try{
    const record=primary(),sink=createFileGateDecisionSink(root,{lockTimeoutMs:20});
    assert.deepEqual(await sink.append(record),{ok:true,status:"appended",recordDigest:authorityDigest(record)});
    const lock=path.join(root,".gate-decisions.lock");
    await mkdir(lock);
    await writeFile(path.join(lock,"owner.json"),authorityCanonicalBytes({host:hostname(),nonce:"c".repeat(64),pid:process.pid,v:"reelier.gate-decision-lock/internal-v1"}));
    assert.deepEqual(await createFileGateDecisionSink(root,{lockTimeoutMs:20}).append(record),{ok:true,status:"idempotent",recordDigest:authorityDigest(record)});
  }finally{await rm(root,{recursive:true,force:true});}
});

test("accepted reservation and non-primary conflict indexes have exact distinct occupancy",async()=>{
  const root=await mkdtemp(path.join(tmpdir(),"reelier-decision-index-"));try{const sink=createFileGateDecisionSink(root);const acceptedContext={...context,contractDigest:sha("5"),capabilityId:"capability_1",capabilityDigest:sha("6"),outcomeKey:sha("7"),effectDigest:sha("8"),snapshots:{sourceBundleDigest:sha("9"),authorityStateDigest:sha("3")}};const acceptedEvent={...event,verdict:"accepted" as const,reasonCode:"accepted",decisionContextDigest:authorityDigest(acceptedContext)};const accepted=primary({reservationId:"reservation_1",decisionContext:acceptedContext,decisionContextDigest:authorityDigest(acceptedContext),gateEvent:acceptedEvent,gateEventDigest:authorityDigest(acceptedEvent)});assert.equal((await sink.append(accepted)).ok,true);assert.equal((await sink.lookupAcceptedByReservation("reservation_1")).ok,true);const collision={...accepted,gateEvent:{...acceptedEvent,eventId:"event_2"},gateEventDigest:authorityDigest({...acceptedEvent,eventId:"event_2"}),ingressClaimDigest:sha("a")};assert.deepEqual(await sink.append(collision),{ok:false,reason:"reservation-conflict"});const conflictContext={...context,definitionAlias:"definition_2"};const conflictEvent={...event,eventId:"event_3",reasonCode:"request-id-conflict",decisionContextDigest:authorityDigest(conflictContext)};const conflict=primary({role:"conflict",ingressClaimDigest:sha("4"),decisionContext:conflictContext,decisionContextDigest:authorityDigest(conflictContext),gateEvent:conflictEvent,gateEventDigest:authorityDigest(conflictEvent)});assert.equal((await sink.append(conflict)).ok,true);const owner=await sink.lookupPrimaryByIngress(sha("4"));assert.equal(owner.ok,true);if(owner.ok)assert.equal(owner.status,"found");}finally{await rm(root,{recursive:true,force:true});}
});

test("concurrent appends and every crash boundary expose a complete transaction or no transaction",async()=>{
  const exactRoot=await mkdtemp(path.join(tmpdir(),"reelier-decision-exact-"));
  try{const results=await Promise.all(Array.from({length:100},()=>createFileGateDecisionSink(exactRoot).append(primary())));assert.equal(results.filter((result:{ok:boolean;status?:string})=>result.ok&&result.status==="appended").length,1);assert.equal(results.filter((result:{ok:boolean;status?:string})=>result.ok&&result.status==="idempotent").length,99);}finally{await rm(exactRoot,{recursive:true,force:true});}

  const eventRoot=await mkdtemp(path.join(tmpdir(),"reelier-decision-event-race-"));
  try{const records=Array.from({length:100},(_,index)=>primary({signerId:`gate_signer_${index}`}));const results=await Promise.all(records.map(record=>createFileGateDecisionSink(eventRoot).append(record)));assert.equal(results.filter((result:{ok:boolean;status?:string})=>result.ok&&result.status==="appended").length,1);assert.equal(results.filter((result:{ok:boolean;reason?:string})=>!result.ok&&result.reason==="event-id-conflict").length,99);}finally{await rm(eventRoot,{recursive:true,force:true});}

  const primaryRoot=await mkdtemp(path.join(tmpdir(),"reelier-decision-primary-race-"));
  try{const records=Array.from({length:100},(_,index)=>{const gateEvent={...event,eventId:`event_primary_${index}`};return primary({gateEvent,gateEventDigest:authorityDigest(gateEvent)});});const results=await Promise.all(records.map(record=>createFileGateDecisionSink(primaryRoot).append(record)));assert.equal(results.filter((result:{ok:boolean;status?:string})=>result.ok&&result.status==="appended").length,1);assert.equal(results.filter((result:{ok:boolean;reason?:string})=>!result.ok&&result.reason==="primary-ingress-conflict").length,99);}finally{await rm(primaryRoot,{recursive:true,force:true});}

  const reservationRoot=await mkdtemp(path.join(tmpdir(),"reelier-decision-reservation-race-"));
  try{const records=Array.from({length:100},(_,index)=>accepted(`event_reservation_${index}`,`sha256:${(index+1).toString(16).padStart(64,"0")}`));const results=await Promise.all(records.map(record=>createFileGateDecisionSink(reservationRoot).append(record)));assert.equal(results.filter((result:{ok:boolean;status?:string})=>result.ok&&result.status==="appended").length,1);assert.equal(results.filter((result:{ok:boolean;reason?:string})=>!result.ok&&result.reason==="reservation-conflict").length,99);}finally{await rm(reservationRoot,{recursive:true,force:true});}

  const moduleUrl=pathToFileURL(path.resolve("dist-test/src/authority/decision.js")).href;
  const script='const {createFileGateDecisionSink}=await import(process.argv[1]);const result=await createFileGateDecisionSink(process.argv[2]).append(JSON.parse(process.argv[3]));process.stdout.write(JSON.stringify(result));';
  const run=promisify(execFile);
  for(const [label,records,conflictReason] of [
    ["event",Array.from({length:80},(_,index)=>primary({signerId:`child_signer_${index}`})),"event-id-conflict"],
    ["primary",Array.from({length:80},(_,index)=>{const gateEvent={...event,eventId:`event_child_primary_${index}`};return primary({gateEvent,gateEventDigest:authorityDigest(gateEvent)});}),"primary-ingress-conflict"],
    ["reservation",Array.from({length:80},(_,index)=>accepted(`event_child_reservation_${index}`,`sha256:${(index+200).toString(16).padStart(64,"0")}`)),"reservation-conflict"],
  ] as const){
    const childRoot=await mkdtemp(path.join(tmpdir(),`reelier-decision-child-${label}-race-`));
    try{const outputs=await Promise.all(records.map(record=>run(process.execPath,["--input-type=module","-e",script,moduleUrl,childRoot,JSON.stringify(record)])));const results=outputs.map(output=>JSON.parse(output.stdout) as {ok:boolean;status?:string;reason?:string});assert.equal(results.filter(result=>result.ok&&result.status==="appended").length,1,label);assert.equal(results.filter(result=>!result.ok&&result.reason===conflictReason).length,records.length-1,label);}finally{await rm(childRoot,{recursive:true,force:true});}
  }

  const expectedFaultPoints=["before-write","after-write","before-file-sync","after-file-sync","before-rename","after-rename","before-directory-sync","after-directory-sync"] as const;
  assert.deepEqual(gateDecisionFaultPoints,expectedFaultPoints);
  for(const [shape,record,indexes] of [["conflict",conflict(),["event"] as readonly string[]],["refused-primary",primary(),["event","primary"] as readonly string[]],["accepted",accepted(),["event","primary","reservation"] as readonly string[]]] as const)for(const point of expectedFaultPoints){
    const directory=await mkdtemp(path.join(tmpdir(),"reelier-decision-crash-"));
    try{
      let fired=false;
      const sink=createFileGateDecisionSink(directory,{faultInjector(observed:string){if(!fired&&observed===point){fired=true;throw new Error(`fault:${point}`);}}});
      await sink.append(record);
      assert.equal(fired,true,`${shape}:${point}`);
      const recovered=createFileGateDecisionSink(directory);
      const lookups=[];
      if(indexes.includes("event"))lookups.push(await recovered.lookupByEvent(record.gateEvent.eventId));
      if(indexes.includes("primary"))lookups.push(await recovered.lookupPrimaryByIngress(record.ingressClaimDigest));
      if(indexes.includes("reservation"))lookups.push(await recovered.lookupAcceptedByReservation(record.reservationId!));
      for(const lookup of lookups)assert.equal(lookup.ok,true,`${shape}:${point}: lookup is never corrupt`);
      if(lookups.every(lookup=>lookup.ok)){assert.equal(new Set(lookups.map(lookup=>lookup.status)).size,1,`${shape}:${point}: all indexes share one visibility state`);assert.ok(lookups[0].status==="found"||lookups[0].status==="absent");}
    }finally{await rm(directory,{recursive:true,force:true});}
  }
});

test("every malformed intrinsic role, signature, digest, event, and reservation combination is corruption",()=>{const conflictEvent={...event,reasonCode:"request-id-conflict"};for(const candidate of [primary({v:"other" as never}),primary({role:"conflict"}),primary({reservationId:"reservation_1"}),primary({signature:{alg:"ed25519",sig:"bad"}}),primary({signerId:""}),primary({ingressClaimDigest:sha("0")}),primary({decisionContextDigest:sha("9")}),primary({gateEventDigest:sha("9")}),primary({gateEvent:{...event,verdict:"accepted",reasonCode:"accepted"}}),primary({gateEvent:conflictEvent,gateEventDigest:authorityDigest(conflictEvent)})])assert.throws(()=>parseGateDecisionRecord(candidate),/invalid gate decision record/i);});
