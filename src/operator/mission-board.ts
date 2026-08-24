import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
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
:root{color-scheme:light;--paper:#f5f1e8;--sheet:#fffdf8;--ink:#191815;--muted:#716d64;--line:#d9d2c3;--signal:#d14b34;--watch:#bd7a13;--calm:#2e6f62}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}header{display:flex;justify-content:space-between;align-items:baseline;padding:28px 36px 20px;border-bottom:1px solid var(--line)}h1{font:700 24px/1.1 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:-.04em;margin:0}.eyebrow{font:600 11px/1 ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}main{padding:28px 36px 56px;max-width:1440px;margin:auto}.summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;background:var(--line);border:1px solid var(--line);margin-bottom:26px}.metric{background:var(--sheet);padding:18px}.metric strong{display:block;font:700 30px/1 ui-monospace,monospace}.metric span{color:var(--muted);font-size:12px}.toolbar{display:flex;gap:8px;margin-bottom:12px}.filter{border:1px solid var(--line);background:transparent;border-radius:999px;padding:7px 11px;font:600 12px ui-monospace,monospace;cursor:pointer}.filter[aria-pressed=true]{background:var(--ink);color:var(--sheet)}.missions{display:grid;gap:10px}.mission{display:grid;grid-template-columns:minmax(180px,1.5fr) minmax(120px,.8fr) minmax(160px,1fr) minmax(150px,1fr) auto;gap:16px;align-items:center;background:var(--sheet);border:1px solid var(--line);padding:16px}.mission code{font-size:12px}.state{font:650 12px ui-monospace,monospace}.required{color:var(--signal)}.watching{color:var(--watch)}.none{color:var(--calm)}button.action{border:1px solid var(--ink);background:transparent;padding:7px 10px;font:600 12px ui-monospace,monospace;cursor:pointer}button:disabled{opacity:.35;cursor:not-allowed}.empty{padding:48px;border:1px dashed var(--line);text-align:center;color:var(--muted)}#error{color:var(--signal);font:600 13px ui-monospace,monospace;margin-bottom:12px}@media(max-width:800px){header,main{padding-left:18px;padding-right:18px}.summary{grid-template-columns:1fr}.mission{grid-template-columns:1fr 1fr}.mission>*:first-child{grid-column:1/-1}}
</style></head><body><header><div><div class="eyebrow">Local / accountless / truthful</div><h1>Mission Control</h1></div><div class="eyebrow">Harness ≠ Outcome</div></header><main><div id="error" role="alert"></div><section class="summary" aria-label="Mission summary"><div class="metric"><strong id="all-count">—</strong><span>missions</span></div><div class="metric"><strong id="attention-count">—</strong><span>need attention</span></div><div class="metric"><strong id="reconciled-count">—</strong><span>reconciled Outcomes</span></div></section><nav class="toolbar" aria-label="Mission filters"><button class="filter" data-filter="all" aria-pressed="true">All</button><button class="filter" data-filter="required" aria-pressed="false">Attention</button><button class="filter" data-filter="stalled" aria-pressed="false">Stalled</button><button class="filter" data-filter="failed" aria-pressed="false">Failed</button></nav><section id="missions" class="missions" aria-live="polite"></section></main>
<script nonce="${nonce}">(()=>{const cap=location.hash.slice(1);history.replaceState(null,"",location.pathname);let state=[];let filter="all";const q=s=>document.querySelector(s);const el=(t,c,x)=>{const n=document.createElement(t);if(c)n.className=c;if(x!==undefined)n.textContent=x;return n};function visible(m){return filter==="all"||filter==="required"&&m.attentionState==="required"||filter==="stalled"&&m.harnessLifecycle==="stalled"||filter==="failed"&&(m.harnessLifecycle==="failed"||m.outcomeLifecycle==="failed")}function render(){q("#all-count").textContent=String(state.length);q("#attention-count").textContent=String(state.filter(m=>m.attentionState!=="none").length);q("#reconciled-count").textContent=String(state.filter(m=>m.outcomeLifecycle==="reconciled").length);const root=q("#missions");root.replaceChildren();const shown=state.filter(visible);if(!shown.length){root.append(el("div","empty","No missions in this view."));return}for(const m of shown){const row=el("article","mission");const id=el("div");id.append(el("code","",m.missionId));id.append(el("div","eyebrow",m.harness));row.append(id,el("div","state",m.harnessLifecycle),el("div","state",m.outcomeLifecycle),el("div","state "+m.attentionState,m.attentionReasons.join(" · ")||"No attention"));const stop=el("button","action","Stop");stop.disabled=m.processOwnership!=="reelier";stop.onclick=async()=>{const r=await fetch("/api/actions/stop",{method:"POST",headers:{authorization:"Bearer "+cap,"x-reelier-csrf":cap,"content-type":"application/json"},body:JSON.stringify({missionId:m.missionId})});if(!r.ok)q("#error").textContent="Stop refused ("+r.status+")."};row.append(stop);root.append(row)}}document.querySelectorAll(".filter").forEach(b=>b.onclick=()=>{document.querySelectorAll(".filter").forEach(x=>x.setAttribute("aria-pressed","false"));b.setAttribute("aria-pressed","true");filter=b.dataset.filter;render()});fetch("/api/state",{headers:{authorization:"Bearer "+cap}}).then(async r=>{if(!r.ok)throw new Error("Capability refused");state=(await r.json()).missions;render()}).catch(e=>q("#error").textContent=e.message)})();</script></body></html>`;

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

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > 4_096) throw new Error("request body is too large");
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
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
}>): Promise<MissionControlBoardV1> {
  const capability = input.capability ?? randomBytes(32).toString("hex");
  if (!/^[0-9a-f]{64}$/.test(capability)) throw new TypeError("Mission Control browser capability is invalid");
  const now = input.now ?? Date.now;
  const expiresAt = Date.parse(input.expiresAt ?? new Date(now() + 8 * 60 * 60_000).toISOString());
  if (!Number.isFinite(expiresAt)) throw new TypeError("Mission Control capability expiry is invalid");
  const journal = await createMissionControlJournalV1({ root: input.root });
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
      if (!authorized(request, capability, now, expiresAt)) { send(response, 401, JSON.stringify({ error: "capability-refused" })); return; }
      if (request.method === "GET" && url.pathname === "/api/state") {
        send(response, 200, JSON.stringify({ v: "reelier.mission-control-board-state/v1", missions: await journal.reconstruct() }));
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
