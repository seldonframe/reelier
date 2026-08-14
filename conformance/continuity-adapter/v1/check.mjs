import Ajv2020 from "ajv/dist/2020.js";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = (name) => fileURLToPath(new URL(name, import.meta.url));
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
const candidateSchema = ajv.compile(JSON.parse(readFileSync(here("./candidate.schema.json"), "utf8")));
const reportSchema = ajv.compile(JSON.parse(readFileSync(here("./report.schema.json"), "utf8")));
const nonClaims = Object.freeze({ contentCorrectness: "not-proved", productionReadiness: "not-proved", safety: "not-proved", topology: "not-proved", trafficCompleteness: "not-proved" });
const digest = (letter) => `sha256:${letter.repeat(64)}`;
const binding = Object.freeze({ taskId: "task_1", principalId: "principal_1", workloadId: "workload_1", runtimeSessionId: "session_1", harnessId: "core" });
const request = (id, choices = { label: "ready" }) => Object.freeze({ v: "reelier.outcome-request/v1", requestId: id, sourceRefs: { issue: "issue_1" }, choices });
const opened = Object.freeze({ type: "task.opened", eventId: "event_1", outcome: "Ship bounded release", completionProjection: "bounded projection", nonGoals: ["deployment"] });
const checkpoint = (actor, cursor, events) => Object.freeze({ v: "reelier.continuity-checkpoint/v1", taskId: actor.taskId, expectedCursor: cursor, actorPrincipalId: actor.principalId, workloadId: actor.workloadId, jobCardDigest: digest("a"), authoritySnapshotDigest: digest("b"), proposedEvents: events, evidenceRefs: [] });
const pass = (id, detail) => Object.freeze({ id, status: "passed", detail });
const fail = (id, detail) => Object.freeze({ id, status: "failed", detail });

function closedReport(descriptor, checks) {
  const report = Object.freeze({ v: "reelier.continuity-adapter-conformance-report/v1", status: checks.every((item) => item.status === "passed") ? "passed" : "failed", maturity: "reproduced", adapterId: descriptor?.adapterId ?? null, harnessId: descriptor?.harnessId ?? null, harnessVersion: descriptor?.harnessVersion ?? null, reelierCommit: descriptor?.reelierCommit ?? null, authorityAdapterContractDigest: descriptor?.authorityAdapterContractDigest ?? null, checks: Object.freeze(checks), nonClaims });
  if (!reportSchema(report)) throw new TypeError("conformance report is invalid");
  return report;
}
function invalid(id, detail) { return closedReport(null, [fail(id, detail)]); }
async function scenario(id, factory, options, check) {
  let candidate;
  try { candidate = await factory({ scenarioId: id, ...(options.mutation ? { mutation: options.mutation } : {}) }); return await check(candidate); }
  catch { return fail(id, "candidate refused or violated the public adapter contract"); }
  finally { await candidate?.close(); }
}
async function adapterFor(candidate) { await candidate.provision([opened]); return candidate.adapter(binding); }

async function runScenario(id, factory, options) {
  return scenario(id, factory, options, async (candidate) => {
    const adapter = await adapterFor(candidate);
    if (id === "host-identity") return JSON.stringify(await adapter.identify()) === JSON.stringify({ v: "reelier.authenticated-workload/v1", ...binding }) ? pass(id, "identity is host-bound") : fail(id, "identity is not host-bound");
    if (id === "identity-isolation-refuses") { const before = await candidate.counters(); const actor = await adapter.identify(); const attempts = [adapter.open("task_2"), adapter.checkpoint(checkpoint({ ...actor, taskId: "task_2" }, 0, [opened])), adapter.checkpoint(checkpoint({ ...actor, principalId: "other" }, 0, [opened])), adapter.checkpoint(checkpoint({ ...actor, workloadId: "other" }, 0, [opened]))]; const results = await Promise.all(attempts.map(async p => { try { await p; return false; } catch { return true; } })); const after = await candidate.counters(); return results.every(Boolean) && JSON.stringify(before) === JSON.stringify(after) ? pass(id, "cross-identity operations refuse without effects") : fail(id, "cross-identity operation was accepted or changed effects"); }
    if (id === "replacement-projection") { const actor = await adapter.identify(); await adapter.checkpoint(checkpoint(actor, 0, [opened])); const projection = await adapter.open(binding.taskId); return projection.taskId === binding.taskId && projection.cursor === 1 ? pass(id, "resume projection is public and task-scoped") : fail(id, "resume projection is incomplete"); }
    if (id === "resume-is-read-only") { const actor = await adapter.identify(); await adapter.checkpoint(checkpoint(actor, 0, [opened])); const before = await candidate.counters(); await adapter.open(binding.taskId); const after = await candidate.counters(); return before.outcomeRequests === after.outcomeRequests && before.statusReads === after.statusReads && before.providerDispatches === after.providerDispatches ? pass(id, "open is read-only") : fail(id, "open caused outcome, status, or provider dispatch"); }
    if (id === "cursor-contention") { const actor = await adapter.identify(); const first = await adapter.checkpoint(checkpoint(actor, 0, [opened])); const second = await adapter.checkpoint(checkpoint(actor, 0, [opened])); return first.ok && !second.ok && second.reason === "stale-cursor" ? pass(id, "stale cursor refuses") : fail(id, "stale cursor was accepted"); }
    if (id === "ambiguity-blocks-resend") { const outcome = await adapter.requestOutcome(request("request_1")); const actor = await adapter.identify(); await adapter.checkpoint(checkpoint(actor, 0, [opened, { type: "consequence.noted", eventId: "event_2", semanticOperationId: "operation_1", reservationId: "reservation_1", state: "reserved", evidenceDigest: null }, { type: "consequence.noted", eventId: "event_3", semanticOperationId: "operation_1", reservationId: "reservation_1", state: "dispatched", evidenceDigest: null }, { type: "consequence.noted", eventId: "event_4", semanticOperationId: "operation_1", reservationId: "reservation_1", state: "ambiguous", evidenceDigest: null }])); const resume = await adapter.open(binding.taskId); return outcome.lifecycleState === "ambiguous" && resume.sections.nextSafeActions.includes("reconcile-before-retry") ? pass(id, "ambiguity requires reconciliation") : fail(id, "ambiguity permits resend"); }
    if (id === "status-does-not-dispatch") { await adapter.requestOutcome(request("request_1")); const before = await candidate.counters(); await adapter.statusOutcome({ requestId: "request_1" }); const after = await candidate.counters(); return after.statusReads === before.statusReads + 1 && after.providerDispatches === before.providerDispatches ? pass(id, "status is read-only") : fail(id, "status dispatched"); }
    if (id === "semantic-retry-is-idempotent") { await adapter.requestOutcome(request("request_1")); await adapter.requestOutcome(request("request_1")); const same = await candidate.counters(); await adapter.requestOutcome(request("request_2")); const different = await candidate.counters(); return same.providerDispatches === 1 && same.reservations === 1 && different.providerDispatches === 2 && different.reservations === 2 ? pass(id, "exact retry is idempotent and new ID dispatches") : fail(id, "retry or new request ID counters are incorrect"); }
    if (id === "request-id-conflict-refuses") { await adapter.requestOutcome(request("request_1")); const before = await candidate.counters(); const conflict = await adapter.requestOutcome(request("request_1", { label: "changed" })); const after = await candidate.counters(); return conflict.verdict === "refused" && conflict.reasonCode === "request-id-conflict" && before.providerDispatches === after.providerDispatches && before.reservations === after.reservations ? pass(id, "conflicting request ID refuses without effects") : fail(id, "request ID conflict had effects or was accepted"); }
    const actor = await adapter.identify(); const fabricated = { type: "claim.recorded", eventId: "event_2", claimId: "claim_1", statement: "fabricated", status: "verified", evidenceDigest: digest("c") }; try { await adapter.checkpoint(checkpoint(actor, 0, [opened, fabricated])); return fail(id, "fabricated verified evidence was accepted"); } catch { return pass(id, "only verifier-produced evidence can verify"); }
  });
}

export async function checkContinuityAdapterCandidate(modulePath, options = {}) {
  let module; try { module = await import(modulePath); } catch { return invalid("candidate-module", "candidate module could not be loaded"); }
  if (typeof module.createCandidate !== "function") return invalid("candidate-module", "createCandidate export is absent");
  let probe; try { probe = await module.createCandidate({ scenarioId: "descriptor" }); } catch { return invalid("candidate-descriptor", "candidate descriptor is unavailable"); }
  const descriptor = probe?.descriptor; try { await probe?.close(); } catch {}
  if (!candidateSchema(descriptor)) return invalid("closed-schema", "candidate descriptor is not a closed v1 record");
  const ids = ["host-identity", "identity-isolation-refuses", "replacement-projection", "resume-is-read-only", "cursor-contention", "ambiguity-blocks-resend", "status-does-not-dispatch", "semantic-retry-is-idempotent", "request-id-conflict-refuses", "uncertainty-is-honest"];
  const checks = []; for (const id of ids) checks.push(await runScenario(id, module.createCandidate, options));
  return closedReport(descriptor, checks);
}
function main() { if (process.argv.length !== 3) { process.stdout.write(`${JSON.stringify(invalid("usage", "usage: check.mjs <candidate-module>"))}\n`); process.exitCode = 2; return; } checkContinuityAdapterCandidate(pathToFileURL(process.argv[2]).href).then(result => { process.stdout.write(`${JSON.stringify(result)}\n`); process.exitCode = result.status === "passed" ? 0 : 1; }); }
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
