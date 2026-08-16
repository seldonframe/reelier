import Ajv2020 from "ajv/dist/2020.js";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPORT_VERSION = "reelier.agent-adapter-conformance-report/v0";
const schemaPath = fileURLToPath(new URL("./candidate.schema.json", import.meta.url));
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
const validate = ajv.compile(schema);

function passed(id, detail) {
  return Object.freeze({ id, status: "passed", detail });
}

function failed(id, detail) {
  return Object.freeze({ id, status: "failed", detail });
}

function report(adapterId, checks) {
  return Object.freeze({
    v: REPORT_VERSION,
    status: checks.every((check) => check.status === "passed") ? "passed" : "failed",
    adapterId,
    checks: Object.freeze(checks),
  });
}

const universalOperations = Object.freeze([
  "jobs.search",
  "jobs.load",
  "delegations.request",
  "delegations.status",
  "tasks.status",
  "outcomes.invoke",
  "outcomes.status",
]);

const forbiddenOutcomeKeys = new Set([
  "tenant",
  "requester",
  "principalid",
  "grantid",
  "allocationid",
  "jobid",
  "authoritycellid",
  "credential",
  "credentials",
  "provideraccount",
  "endpoint",
  "recipient",
  "amount",
  "body",
  "url",
  "providerargs",
  "providerarguments",
]);

function oneEvent(candidate, operation) {
  const matches = candidate.transcript.filter((event) => event.operation === operation);
  return matches.length === 1 ? matches[0] : undefined;
}

function sameSet(left, right) {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function containsForbiddenKey(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsForbiddenKey);
  return Object.entries(value).some(([key, child]) => forbiddenOutcomeKeys.has(key.toLowerCase()) || containsForbiddenKey(child));
}

function semanticCheck(id, condition, passDetail, failDetail) {
  return condition ? passed(id, passDetail) : failed(id, failDetail);
}

function semanticChecks(candidate) {
  const search = oneEvent(candidate, "jobs.search");
  const load = oneEvent(candidate, "jobs.load");
  const delegation = oneEvent(candidate, "delegations.request");
  const invoke = oneEvent(candidate, "outcomes.invoke");
  const status = oneEvent(candidate, "outcomes.status");
  const observed = candidate.coverageProbes.filter((probe) => probe.mode === "observed");
  const enforced = candidate.coverageProbes.filter((probe) => probe.mode === "enforced");
  const live = candidate.descriptor.execution === "live-candidate";
  const liveOperations = candidate.transcript.map((event) => event.operation);
  const liveEvidenceConforms = !live || (
    candidate.liveEvidence?.execution === "eve-process-tool-loop"
    && candidate.liveEvidence?.contract?.v === "reelier.adapter-contract/v1"
    && candidate.liveEvidence?.contract?.bound === true
    && candidate.liveEvidence.contract.digest === candidate.descriptor.authorityContract.digest
    && candidate.liveEvidence.preFreezeRefusal === true
    && JSON.stringify(liveOperations) === JSON.stringify(candidate.liveEvidence.semanticOperations)
    && candidate.liveEvidence.semanticOperations.length === 7
  );

  const operationsConform = sameSet(candidate.descriptor.operations, universalOperations)
    && candidate.descriptor.hardCodedJobRefs.length === 0
    && liveEvidenceConforms;

  const discoveredRefs = search?.response.jobs.map((job) => job.jobRef) ?? [];
  const discoveryConforms = Boolean(
    search && load && invoke
    && new Set(discoveredRefs).size === discoveredRefs.length
    && discoveredRefs.includes(load.request.jobRef)
    && load.response.jobRef === load.request.jobRef
    && invoke.request.jobRef === load.response.jobRef,
  );

  const outcomeKeys = invoke ? Object.keys(invoke.request).sort() : [];
  const inputConforms = Boolean(
    invoke
    && sameSet(outcomeKeys, ["choices", "jobRef", "requestId", "sourceRefs"])
    && !containsForbiddenKey(invoke.request),
  );

  const delegationConforms = Boolean(
    delegation
    && delegation.request.taskId === candidate.session.taskId
    && delegation.request.parentAllocationId === candidate.session.allocationId
    && delegation.request.childPrincipalId !== candidate.session.principalId
    && delegation.response.principalId === delegation.request.childPrincipalId
    && delegation.response.allocationId !== candidate.session.allocationId
    && delegation.response.effects === delegation.request.effects
    && delegation.request.effects > 0
    && delegation.request.effects < candidate.session.remainingEffects,
  );

  const claims = status?.response.claims;
  const lifecycleConforms = Boolean(
    invoke && status && claims
    && invoke.response.verdict === "refused"
    && invoke.response.reasonCode === "adapter-contract-pending"
    && invoke.response.lifecycleState === "refused"
    && !("receiptRef" in invoke.response)
    && status.request.requestId === invoke.request.requestId
    && status.response.lifecycleState === "refused"
    && status.response.pass === false
    && claims.authorization === "unchecked"
    && claims.dispatch === "absent"
    && claims.providerAcknowledgment === "absent"
    && claims.reconciliation === "absent"
    && claims.topology === "unchecked"
    && claims.completeness === "unchecked",
  );

  const observedConforms = observed.length === 1
    && observed[0].activation === "available"
    && observed[0].topology === "unchecked"
    && observed[0].completeness === "unchecked";

  const enforcedConforms = enforced.length === 1
    && enforced[0].activation === "unavailable"
    && enforced[0].topology !== "verified"
    && enforced[0].completeness !== "verified";

  return [
    semanticCheck("universal-operations", operationsConform, "adapter exposes only the universal semantic operation set", "adapter operation set is missing, widened, or hard-coded"),
    semanticCheck("dynamic-job-discovery", discoveryConforms, "loaded and invoked job references originate in catalog discovery", "job reference was not preserved from catalog discovery"),
    semanticCheck("host-bound-outcome-input", inputConforms, "Outcome input contains no authenticated identity or provider authority", "Outcome input contains an identity or provider-authority override"),
    semanticCheck("attenuated-child-principal", delegationConforms, "child principal and effect allocation are distinct and narrower", "child delegation does not attenuate the parent session"),
    semanticCheck("pre-freeze-no-dispatch", lifecycleConforms, "pending Adapter Contract refuses without dispatch or a passing receipt", "pre-freeze lifecycle implies dispatch, success, or upgraded evidence"),
    semanticCheck("observed-coverage-honesty", observedConforms, "observed mode remains available with unchecked topology and completeness", "observed mode upgrades topology or completeness"),
    semanticCheck("enforced-mode-unavailable", enforcedConforms, "enforced mode remains unavailable without verified topology", "enforced mode activates or upgrades claims before topology verifies"),
  ];
}

export function checkCandidate(value) {
  if (!validate(value)) {
    return report(null, [failed("closed-schema", ajv.errorsText(validate.errors, { separator: "; " }))]);
  }
  return report(value.descriptor.adapterId, semanticChecks(structuredClone(value)));
}

function usageReport() {
  return report(null, [failed("usage", "usage: check.mjs <candidate.json>")]);
}

function unreadableCandidateReport() {
  return report(null, [failed("closed-schema", "candidate could not be read or parsed")]);
}

function writeReport(value, exitCode) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
  process.exitCode = exitCode;
}

function main() {
  if (process.argv.length !== 3) {
    writeReport(usageReport(), 2);
    return;
  }
  let value;
  try {
    value = JSON.parse(readFileSync(process.argv[2], "utf8"));
  } catch {
    writeReport(unreadableCandidateReport(), 1);
    return;
  }
  const result = checkCandidate(value);
  writeReport(result, result.status === "passed" ? 0 : 1);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
