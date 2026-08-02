import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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
          const candidate: ReservationIntent = {
            tenant: "tenant", requester: "requester", requestId: `request_${operation.request}`,
            canonicalRequestDigest: hex(operation.request), canonicalRequestBytes: Buffer.from(`request:${operation.request}`),
            capabilityId: `capability_${operation.capability}`, capabilityDigest: hex(100 + operation.capability), capabilityBytes: Buffer.from(`capability:${operation.capability}`),
            outcomeKey: hex(200 + operation.outcome), effectDigest: hex(300 + operation.outcome),
            issuedAt: new Date(at).toISOString(), expiresAt: new Date(at + CAPABILITY_LIFETIME_MS).toISOString(),
            limitSlots: [{ key: hex(400), maximum: 30 }],
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
