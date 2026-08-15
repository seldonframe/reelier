import test from "node:test";
import assert from "node:assert/strict";
import { createGovernedAuthorityCell } from "../../src/authority/host/governed-cell.js";
import { __testSetAuthorityCellHostPlatform } from "../../src/authority/host/platform.js";
import { profileGovernanceFixture } from "./profile-governance-fixture.js";

test("governed Cell refuses Windows before config, reference, options, or filesystem access", async () => {
  const restore = __testSetAuthorityCellHostPlatform("win32");
  let accesses = 0;
  const inaccessible = new Proxy({}, { get() { accesses += 1; throw new Error("dependency accessed"); }, ownKeys() { accesses += 1; throw new Error("dependency accessed"); } });
  try { await assert.rejects(() => createGovernedAuthorityCell(inaccessible as never, inaccessible as never, inaccessible as never), /AUTHORITY_CELL_LINUX_REQUIRED|requires Linux/i); }
  finally { restore(); }
  assert.equal(accesses, 0);
});

test("governed receipt and binding signing capabilities are one all-or-nothing authority", async () => {
  profileGovernanceFixture();
  const restore = __testSetAuthorityCellHostPlatform("linux");
  const config = { version: 1 as const, tenant: "tenant_1", requester: "operator", definitions: [], ledgerDir: "ledger", decisionDir: "decisions", receiptDir: "receipts", endpoints: [] };
  const reference = { v: "reelier.governed-authority-cell-reference/v1" as const, tenant: "tenant_1", governanceRef: "governance_1", expectedManifestDigest: `sha256:${"1".repeat(64)}`, expectedTrustHeadDigest: `sha256:${"2".repeat(64)}` };
  let signerReads = 0;
  const signing = new Proxy({}, { ownKeys() { signerReads += 1; return []; }, get() { signerReads += 1; throw new Error("signer read"); } });
  try {
    await assert.rejects(() => createGovernedAuthorityCell(config, reference, { receiptSigningAuthority: signing } as never), /pair|authority binding signer|receipt signing/i);
    await assert.rejects(() => createGovernedAuthorityCell(config, reference, { authorityBindingSigner: signing } as never), /pair|receipt signing/i);
  } finally { restore(); }
  assert.equal(signerReads, 0);
});

test("public governed Linux factory evidence is registered on every platform", { skip: process.platform === "linux" ? false : "requires an already-available Linux Node executor" }, async () => {
  const host = await import("reelier/authority/host");
  assert.equal(typeof host.createGovernedAuthorityCell, "function");
});

test("governed Cell rejects non-data and unpaired capabilities before invocation", async () => {
  const restore = __testSetAuthorityCellHostPlatform("linux");
  let getters = 0;
  const reference = Object.defineProperty({ v: "reelier.governed-authority-cell-reference/v1", tenant: "tenant_1", governanceRef: "governance_1", expectedManifestDigest: `sha256:${"0".repeat(64)}` }, "expectedTrustHeadDigest", { enumerable: true, get() { getters += 1; return `sha256:${"0".repeat(64)}`; } });
  const config = { version: 1 as const, tenant: "tenant_1", requester: "operator", definitions: [], ledgerDir: "ledger", decisionDir: "decisions", receiptDir: "receipts", endpoints: [] };
  try {
    await assert.rejects(() => createGovernedAuthorityCell(config, reference as never, {}), /own data|exact fields|plain record/i);
    await assert.rejects(() => createGovernedAuthorityCell(config, { v: "reelier.governed-authority-cell-reference/v1", tenant: "tenant_1", governanceRef: "governance_1", expectedManifestDigest: `sha256:${"0".repeat(64)}`, expectedTrustHeadDigest: `sha256:${"0".repeat(64)}` }, { signedTopologyEvidence: {} as never }), /topology signer|paired/i);
  } finally { restore(); }
  assert.equal(getters, 0);
});
