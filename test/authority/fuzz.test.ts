import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { authorityCanonicalBytes, authorityDigest } from "../../src/authority/wire.js";
import { CAPABILITY_LIFETIME_MS, type ReservationIntent } from "../../src/authority/ledger.js";
import { FsAuthorityLedger } from "../../src/authority/host/fs-ledger.js";

const at = Date.parse("2026-08-02T12:00:00.000Z");
const hex = (value: number) => `sha256:${value.toString(16).padStart(64, "0")}`;

test("fixed-seed bounded ledger state-machine fuzz never creates two committed reservations for one ingress or outcome", async () => {
  await fc.assert(fc.asyncProperty(
    fc.array(fc.record({ request: fc.integer({ min: 1, max: 8 }), outcome: fc.integer({ min: 1, max: 8 }), capability: fc.integer({ min: 1, max: 8 }) }), { minLength: 1, maxLength: 30 }),
    async operations => {
      const root = await mkdtemp(path.join(tmpdir(), "reelier-ledger-fuzz-"));
      try {
        const ledger = new FsAuthorityLedger(root, { now: () => at });
        for (const operation of operations) {
          const requestId = `request_${operation.request}`;
          const capabilityId = `capability_${operation.capability}`;
          const requestKey = hex(50 + operation.request);
          const outcomeKey = hex(200 + operation.outcome);
          const effectDigest = hex(300 + operation.outcome);
          const issuedAt = new Date(at).toISOString();
          const expiresAt = new Date(at + CAPABILITY_LIFETIME_MS).toISOString();
          const requestBytes = authorityCanonicalBytes({ v: "reelier.outcome-request/v1", requestId, sourceRefs: { source: `ref_${operation.request}` }, choices: {} });
          const requestDigest = `sha256:${createHash("sha256").update(requestBytes).digest("hex")}`;
          const contractDigest = hex(500);
          const sourceBundleDigest = hex(501);
          const sourceSnapshotDigest = hex(502);
          const authorityStateDigest = hex(503);
          const limits = { maxEffectsPerWindow: 30, windowSeconds: 3600, maxEffectsPerSourceTrigger: 1, maxBodyBytes: 4096 };
          const limitsDigest = authorityDigest({ v: "reelier.capability-limits/internal-v1", contractDigest, limits });
          const capabilityBytes = authorityCanonicalBytes({ v: "reelier.compiled-capability/v1", tenant: "tenant", requester: "requester", definitionAlias: "definition", requestDigest, requestKey, contractDigest, sourceBundleDigest, sourceSnapshotDigest, authorityStateDigest, limits, limitsDigest, capabilityId, outcomeKey, effectDigest, issuedAt, expiresAt });
          const candidate: ReservationIntent = {
            tenant: "tenant", requester: "requester", definitionAlias: "definition", requestId, requestDigest, requestKey,
            canonicalRequestDigest: requestDigest, canonicalRequestBytes: requestBytes,
            capabilityId, capabilityDigest: `sha256:${createHash("sha256").update(capabilityBytes).digest("hex")}`, capabilityBytes,
            contractDigest, sourceBundleDigest, sourceSnapshotDigest, authorityStateDigest, limits, limitsDigest,
            outcomeKey, effectDigest, issuedAt, expiresAt,
            limitSlots: [{ kind: "contract-window", key: hex(400), maximum: 30 }, { kind: "source-trigger", key: hex(401 + operation.request), maximum: 1 }],
          };
          await ledger.reserve(candidate);
        }
        const recovered = await ledger.recover();
        assert.equal(recovered.ok, true);
        if (!recovered.ok) return;
        assert.equal(new Set(recovered.reservations.map((value: { intent: { tenant: string; requester: string; requestId: string } }) => `${value.intent.tenant}\0${value.intent.requester}\0${value.intent.requestId}`)).size, recovered.reservations.length);
        assert.equal(new Set(recovered.reservations.map((value: { intent: { tenant: string; outcomeKey: string } }) => `${value.intent.tenant}\0${value.intent.outcomeKey}`)).size, recovered.reservations.length);
      } finally { await rm(root, { recursive: true, force: true }); }
    },
  ), { seed: 0x3a2026, numRuns: 25 });
});
