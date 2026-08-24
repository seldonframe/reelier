import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { createMissionEvidenceStoreV1 } from "./mission-evidence.js";
import { createMissionControlJournalV1 } from "./mission-journal.js";

export type MissionControlBoardV1 = Readonly<{
  origin: string;
  url: string;
  close(): Promise<void>;
}>;

const BOARD_HTML = (nonce: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reelier Mission Control</title>
<style nonce="${nonce}">
:root{color-scheme:light;--paper:#e8eef1;--sheet:#f8fbfc;--ink:#102126;--muted:#5c6c72;--line:#bac8ce;--signal:#c54632;--watch:#a9660b;--calm:#007a6e;--harness:#2458d3;--outcome:#007a6e}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Aptos,"Segoe UI",system-ui,sans-serif}button,select,textarea{min-height:44px}header{display:flex;justify-content:space-between;align-items:baseline;padding:28px 36px 20px;border-bottom:1px solid var(--line)}h1{font:700 26px/1.05 "Bahnschrift SemiCondensed",Aptos,"Segoe UI",sans-serif;letter-spacing:-.03em;margin:0}.eyebrow{font:600 11px/1 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}main{padding:28px 36px 56px;max-width:1440px;margin:auto}.summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;background:var(--line);border:1px solid var(--line);margin-bottom:26px}.metric{background:var(--sheet);padding:18px}.metric strong{display:block;font:700 30px/1 ui-monospace,SFMono-Regular,Consolas,monospace}.metric span{color:var(--muted);font-size:12px}.new-mission{display:grid;grid-template-columns:160px 1fr auto;gap:8px;margin-bottom:18px}.new-mission select,.new-mission textarea{border:1px solid var(--line);background:var(--sheet);color:var(--ink);padding:10px;font:13px ui-monospace,SFMono-Regular,Consolas,monospace;resize:vertical}.toolbar{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap}.filter{border:1px solid var(--line);background:transparent;border-radius:999px;padding:7px 11px;font:600 12px ui-monospace,SFMono-Regular,Consolas,monospace;cursor:pointer}.filter[aria-pressed=true]{background:var(--ink);color:var(--sheet)}.missions{display:grid;gap:10px}.mission{display:grid;grid-template-columns:minmax(180px,1.5fr) minmax(150px,.9fr) minmax(170px,1fr) minmax(150px,1fr) auto;gap:16px;align-items:center;background:var(--sheet);border:1px solid var(--line);padding:16px}.mission code{font-size:12px}.state{font:650 12px ui-monospace,SFMono-Regular,Consolas,monospace;padding:8px 10px;border-left:3px solid var(--line)}.harness-axis{border-color:var(--harness)}.outcome-axis{border-color:var(--outcome)}.required{color:var(--signal)}.watching{color:var(--watch)}.none{color:var(--calm)}button.action{border:1px solid var(--ink);background:transparent;padding:7px 10px;font:600 12px ui-monospace,SFMono-Regular,Consolas,monospace;cursor:pointer}button:disabled{opacity:.35;cursor:not-allowed}button:focus-visible,select:focus-visible,textarea:focus-visible{outline:3px solid var(--harness);outline-offset:2px}.empty{padding:48px;border:1px dashed var(--line);text-align:center;color:var(--muted)}#error{color:var(--signal);font:600 13px ui-monospace,SFMono-Regular,Consolas,monospace;margin-bottom:12px}@media(max-width:800px){header,main{padding-left:18px;padding-right:18px}.summary{grid-template-columns:1fr}.new-mission,.mission{grid-template-columns:1fr}.mission>*:first-child{grid-column:1/-1}}
:root{--watch:#9f600a}.mission>:nth-child(2){border-color:var(--harness)}.mission>:nth-child(3){border-color:var(--outcome)}.axis-key{display:grid;grid-template-columns:minmax(180px,1.5fr) minmax(150px,.9fr) minmax(170px,1fr) minmax(150px,1fr) auto;gap:16px;padding:0 16px 8px;color:var(--muted);font:600 11px/1 ui-monospace,SFMono-Regular,Consolas,monospace}.axis-key .harness-key{grid-column:2;color:var(--harness)}.axis-key .outcome-key{grid-column:3;color:var(--outcome)}@media(max-width:800px){.axis-key{display:flex;gap:18px;padding-left:0}}
button{min-width:44px}
</style></head><body><header><div><div class="eyebrow">Local / accountless / truthful</div><h1>Mission Control</h1></div><div class="eyebrow">Harness ≠ Outcome</div></header><main><div id="error" role="alert"></div><section class="summary" aria-label="Mission summary"><div class="metric"><strong id="all-count">—</strong><span>missions</span></div><div class="metric"><strong id="attention-count">—</strong><span>need attention</span></div><div class="metric"><strong id="reconciled-count">—</strong><span>reconciled Outcomes</span></div></section><form id="run-form" class="new-mission"><select id="run-harness" aria-label="Harness"><option value="codex">Codex</option><option value="claude-code">Claude Code</option></select><textarea id="run-task" required maxlength="128000" rows="1" aria-label="Mission task" placeholder="Give one strong executor a bounded task"></textarea><button class="action" type="submit">Run mission</button></form><nav class="toolbar" aria-label="Workspace scope"><button class="filter scope" data-scope="current" aria-pressed="true" type="button">Current repository</button><button class="filter scope" data-scope="global" aria-pressed="false" type="button">All work</button></nav><nav class="toolbar" aria-label="Mission filters"><button class="filter state-filter" data-filter="all" aria-pressed="true" type="button">All</button><button class="filter state-filter" data-filter="required" aria-pressed="false" type="button">Exception inbox</button><button class="filter state-filter" data-filter="stalled" aria-pressed="false" type="button">Stalled</button><button class="filter state-filter" data-filter="failed" aria-pressed="false" type="button">Failed</button></nav><div class="axis-key" aria-label="Mission state axes"><span class="harness-key">Harness state: process truth</span><span class="outcome-key">Outcome state: evidence truth</span></div><section id="missions" class="missions" aria-live="polite"></section></main>
<script nonce="${nonce}">(()=>{const cap=location.hash.slice(1);history.replaceState(null,"",location.pathname);let state=[];let currentWorkspaceDigest="";let scope="current";let filter="all";let loading=false;const q=s=>document.querySelector(s);const el=(t,c,x)=>{const n=document.createElement(t);if(c)n.className=c;if(x!==undefined)n.textContent=x;return n};const post=(path,body)=>fetch(path,{method:"POST",headers:{authorization:"Bearer "+cap,"x-reelier-csrf":cap,"content-type":"application/json"},body:JSON.stringify(body)});function visible(m){const inScope=scope==="global"||m.workspaceDigest===currentWorkspaceDigest;return inScope&&(filter==="all"||filter==="required"&&m.attentionState==="required"||filter==="stalled"&&m.harnessLifecycle==="stalled"||filter==="failed"&&(m.harnessLifecycle==="failed"||m.outcomeLifecycle==="failed"))}function render(){q("#all-count").textContent=String(state.length);q("#attention-count").textContent=String(state.filter(m=>m.attentionState!=="none").length);q("#reconciled-count").textContent=String(state.filter(m=>m.outcomeLifecycle==="reconciled").length);const root=q("#missions");root.replaceChildren();const shown=state.filter(visible);if(!shown.length){root.append(el("div","empty","No missions in this view."));return}for(const m of shown){const row=el("article","mission");const id=el("div");id.append(el("code","",m.missionId));id.append(el("div","eyebrow",m.harness+" · "+(m.workspaceDigest===currentWorkspaceDigest?"current repository":"other workspace")));id.append(el("div","eyebrow","Last activity: "+m.updatedAt));row.append(id,el("div","state",m.harnessLifecycle),el("div","state",m.outcomeLifecycle),el("div","state "+m.attentionState,m.attentionReasons.join(" · ")||"No attention"));const actions=el("div");const evidence=el("button","action","Evidence ("+m.evidenceRefs.length+")");evidence.disabled=m.evidenceRefs.length===0;evidence.onclick=async()=>{const r=await post("/api/evidence",{missionId:m.missionId});if(!r.ok){q("#error").textContent="Evidence refused ("+r.status+").";return}const body=await r.json();const details=el("div","eyebrow",body.evidence.map(x=>x.kind+": "+x.status+" · "+x.evidenceRef).join(" | "));details.style.gridColumn="1 / -1";row.append(details)};const resumable=m.processOwnership==="reelier"&&!m.imported&&["stopped","failed","exited","unreachable"].includes(m.harnessLifecycle);const resume=el("button","action","Resume");resume.disabled=!resumable;resume.onclick=async()=>{const r=await post("/api/actions/resume",{missionId:m.missionId});if(!r.ok)q("#error").textContent="Resume refused ("+r.status+").";else q("#error").textContent="Resume started for "+m.missionId+"."};const stop=el("button","action","Stop");stop.disabled=m.processOwnership!=="reelier"||m.harnessLifecycle!=="running";stop.onclick=async()=>{const r=await post("/api/actions/stop",{missionId:m.missionId});if(!r.ok)q("#error").textContent="Stop refused ("+r.status+")."};actions.append(evidence,resume,stop);row.append(actions);root.append(row)}}async function loadState(){if(loading)return;loading=true;try{const r=await fetch("/api/state",{headers:{authorization:"Bearer "+cap}});if(!r.ok)throw new Error("Capability refused");const body=await r.json();state=body.missions;currentWorkspaceDigest=body.currentWorkspaceDigest;render()}catch(e){q("#error").textContent=e.message}finally{loading=false}}document.querySelectorAll(".state-filter").forEach(b=>b.onclick=()=>{document.querySelectorAll(".state-filter").forEach(x=>x.setAttribute("aria-pressed","false"));b.setAttribute("aria-pressed","true");filter=b.dataset.filter;render()});document.querySelectorAll(".scope").forEach(b=>b.onclick=()=>{document.querySelectorAll(".scope").forEach(x=>x.setAttribute("aria-pressed","false"));b.setAttribute("aria-pressed","true");scope=b.dataset.scope;render()});q("#run-form").onsubmit=async event=>{event.preventDefault();const task=q("#run-task").value;const harness=q("#run-harness").value;const r=await post("/api/actions/run",{harness,task});if(!r.ok){q("#error").textContent="Mission start refused ("+r.status+").";return}q("#run-task").value="";q("#error").textContent="Mission started with "+harness+".";void loadState()};void loadState();setInterval(loadState,2000)})();</script></body></html>`;

function authorized(request: IncomingMessage, capability: string, now: () => number, expiresAt: number): boolean {
  const header = request.headers.authorization;
  if (now() >= expiresAt || typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice("Bearer ".length), "utf8");
  const expected = Buffer.from(capability, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function send(response: ServerResponse, status: number, body: string, type = "application/json; charset=utf-8"): void {
  response.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" });
  response.end(body);
}

async function readJson(request: IncomingMessage, maximumBytes = 4_096): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > maximumBytes) throw new Error("request body is too large");
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function parseMissionRun(value: unknown): Readonly<{ harness: "codex" | "claude-code"; task: string }> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).length !== 2) throw new Error("mission run shape is invalid");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (!descriptors.harness || !("value" in descriptors.harness) || !descriptors.harness.enumerable || !descriptors.task || !("value" in descriptors.task) || !descriptors.task.enumerable) throw new Error("mission run must be inert");
  if ((descriptors.harness.value !== "codex" && descriptors.harness.value !== "claude-code") || typeof descriptors.task.value !== "string" || descriptors.task.value.length === 0 || descriptors.task.value.length > 128_000) throw new Error("mission run input is invalid");
  return Object.freeze({ harness: descriptors.harness.value, task: descriptors.task.value });
}

function parseMissionAction(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value) || Reflect.ownKeys(value).length !== 1 || !Object.hasOwn(value, "missionId")) throw new Error("action shape is invalid");
  const descriptor = Object.getOwnPropertyDescriptor(value, "missionId");
  if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(descriptor.value)) throw new Error("mission id is invalid");
  return descriptor.value;
}

export async function createMissionControlBoardV1(input: Readonly<{
  root: string;
  capability?: string;
  expiresAt?: string;
  now?: () => number;
  stopMission?: (missionId: string) => Promise<void>;
  resumeMission?: (missionId: string) => Promise<void>;
  runMission?: (input: Readonly<{ harness: "codex" | "claude-code"; task: string }>) => Promise<void>;
}>): Promise<MissionControlBoardV1> {
  const capability = input.capability ?? randomBytes(32).toString("hex");
  if (!/^[0-9a-f]{64}$/.test(capability)) throw new TypeError("Mission Control browser capability is invalid");
  const now = input.now ?? Date.now;
  const expiresAt = Date.parse(input.expiresAt ?? new Date(now() + 8 * 60 * 60_000).toISOString());
  if (!Number.isFinite(expiresAt)) throw new TypeError("Mission Control capability expiry is invalid");
  const journal = await createMissionControlJournalV1({ root: input.root });
  const evidenceStore = await createMissionEvidenceStoreV1({ root: input.root });
  const currentWorkspaceDigest = `sha256:${createHash("sha256").update(path.resolve(input.root), "utf8").digest("hex")}`;
  const nonce = randomBytes(18).toString("base64");
  let origin = "";
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", origin || "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/") {
        const html = BOARD_HTML(nonce);
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
          "referrer-policy": "no-referrer",
          "x-content-type-options": "nosniff",
        });
        response.end(html);
        return;
      }
      if (request.method === "GET" && url.pathname === "/favicon.ico") {
        response.writeHead(204, { "cache-control": "no-store" });
        response.end();
        return;
      }
      if (!authorized(request, capability, now, expiresAt)) { send(response, 401, JSON.stringify({ error: "capability-refused" })); return; }
      if (request.method === "GET" && url.pathname === "/api/state") {
        const missions = [...await journal.reconstruct()].sort((left, right) => Number(right.workspaceDigest === currentWorkspaceDigest) - Number(left.workspaceDigest === currentWorkspaceDigest));
        send(response, 200, JSON.stringify({ v: "reelier.mission-control-board-state/v1", currentWorkspaceDigest, missions }));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/actions/run") {
        if (request.headers.origin !== origin || request.headers["x-reelier-csrf"] !== capability) { send(response, 403, JSON.stringify({ error: "origin-or-csrf-refused" })); return; }
        const run = parseMissionRun(await readJson(request, 130_000));
        if (!input.runMission) { send(response, 501, JSON.stringify({ error: "run-unavailable" })); return; }
        void input.runMission(run).catch(() => undefined);
        send(response, 202, JSON.stringify({ status: "mission-started" }));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/actions/stop") {
        if (request.headers.origin !== origin || request.headers["x-reelier-csrf"] !== capability) { send(response, 403, JSON.stringify({ error: "origin-or-csrf-refused" })); return; }
        const missionId = parseMissionAction(await readJson(request));
        const mission = (await journal.reconstruct()).find((item) => item.missionId === missionId);
        if (!mission) { send(response, 404, JSON.stringify({ error: "mission-not-found" })); return; }
        if (mission.processOwnership !== "reelier" || mission.imported) { send(response, 409, JSON.stringify({ error: "mission-not-owned" })); return; }
        if (!input.stopMission) { send(response, 501, JSON.stringify({ error: "stop-unavailable" })); return; }
        await input.stopMission(missionId);
        send(response, 200, JSON.stringify({ status: "stopped", missionId }));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/actions/resume") {
        if (request.headers.origin !== origin || request.headers["x-reelier-csrf"] !== capability) { send(response, 403, JSON.stringify({ error: "origin-or-csrf-refused" })); return; }
        const missionId = parseMissionAction(await readJson(request));
        const mission = (await journal.reconstruct()).find((item) => item.missionId === missionId);
        if (!mission) { send(response, 404, JSON.stringify({ error: "mission-not-found" })); return; }
        if (mission.processOwnership !== "reelier" || mission.imported || !["stopped", "failed", "exited", "unreachable"].includes(mission.harnessLifecycle)) { send(response, 409, JSON.stringify({ error: "mission-not-resumable" })); return; }
        if (!input.resumeMission) { send(response, 501, JSON.stringify({ error: "resume-unavailable" })); return; }
        void input.resumeMission(missionId).catch(() => undefined);
        send(response, 202, JSON.stringify({ status: "resume-started", missionId }));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/evidence") {
        if (request.headers.origin !== origin || request.headers["x-reelier-csrf"] !== capability) { send(response, 403, JSON.stringify({ error: "origin-or-csrf-refused" })); return; }
        const missionId = parseMissionAction(await readJson(request));
        const mission = (await journal.reconstruct()).find((item) => item.missionId === missionId);
        if (!mission) { send(response, 404, JSON.stringify({ error: "mission-not-found" })); return; }
        const evidence = [];
        for (const evidenceRef of mission.evidenceRefs) {
          const item = await evidenceStore.load(evidenceRef);
          if (!item) { send(response, 409, JSON.stringify({ error: "mission-evidence-missing" })); return; }
          evidence.push(item);
        }
        send(response, 200, JSON.stringify({ v: "reelier.mission-control-evidence-list/v1", missionId, evidence }));
        return;
      }
      send(response, 404, JSON.stringify({ error: "not-found" }));
    } catch {
      send(response, 400, JSON.stringify({ error: "request-invalid" }));
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") { server.close(); throw new Error("Mission Control loopback address is unavailable"); }
  origin = `http://127.0.0.1:${address.port}`;
  return Object.freeze({
    origin,
    url: `${origin}/#${capability}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  });
}
