import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { authorityDigest } from "../../src/authority/wire.js";
import {
  createFileGateDecisionSink,
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
    gateEventDigest: authorityDigest(event), signerId: "gate_signer_1", signature: { alg: "ed25519", sig: Buffer.alloc(64, 7).toString("base64") },
    ...overrides,
  });
}

test("the closed reason protocol has the exact approved order and no free-form escape hatch", () => {
  assert.deepEqual(GATE_REFUSAL_REASONS, [
    "request-id-conflict", "authority-state-invalid", "authority-state-rollback", "authority-state-changed",
    "contract-not-found", "contract-not-eligible", "contract-ambiguous", "contract-untrusted",
    "contract-alias-mismatch", "contract-audience-mismatch", "contract-inactive", "contract-revoked",
    "contract-not-yet-valid", "contract-expired", "delegation-invalid", "pack-mismatch", "definition-mismatch",
    "resolver-mismatch", "connector-mismatch", "account-mismatch", "endpoint-not-allowed", "risk-not-allowed",
    "source-read-refused", "source-observation-invalid", "source-projection-invalid", "source-ungrounded", "source-stale",
    "choices-invalid", "compile-refused", "effect-refused", "reservation-idempotency-conflict", "semantic-duplicate",
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
    assert.equal((await sink.lookupByEvent("event_1")).ok, true);
    assert.equal((await sink.lookupPrimaryByIngress(sha("4"))).ok, true);
    assert.deepEqual(await sink.append(primary({ signerId: "other" })), { ok: false, reason: "event-id-conflict" });
    assert.deepEqual(await sink.append(primary({ gateEvent: { ...event, eventId: "event_2" }, gateEventDigest: authorityDigest({ ...event, eventId: "event_2" }) })), { ok: false, reason: "primary-ingress-conflict" });
    const stored = await readFile(path.join(root, "gate-decisions.json"), "utf8");
    await writeFile(path.join(root, "gate-decisions.json"), stored.replace("contract-not-found", "contract-expired"));
    assert.deepEqual(await createFileGateDecisionSink(root).lookupByEvent("event_1"), { ok: false, reason: "corruption" });
  } finally { await rm(root, { recursive: true, force: true }); }
});
