// S1 of the state-conditioned-approval design (Wave 2 spec §2.2, §10 S1):
// the approval hash covers `expect`. Invariant I-1 (legacy hash identity) is
// pinned with LITERAL digests captured from the pre-expect code — if either
// legacy branch's bytes ever move, these fail before any skill in the wild
// silently un-approves.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeApprovalHash } from "../src/approval.js";
import { digestSha256 } from "../src/canonical-json.js";
import type { StepExpect } from "../src/skill.js";

const ATTEST = { tool: "gbrain.get_page", args: { slug: "demo" }, projection: ["compiled_truth"] };
const EXPECT: StepExpect = {
  at: "2026-07-30T06:58:12.331Z",
  keyId: "3c9a01d2e4f5b6a7",
  pre: `hmac-sha256:${"9f".repeat(32)}`,
};

// ---------------------------------------------------------------------------
// I-1: legacy hash identity — pinned bytes, captured from the pre-expect code
// ---------------------------------------------------------------------------

test("I-1: expect-less, attest-less hash is byte-identical to the pre-expect formula (pinned digest)", () => {
  const h = computeApprovalHash({
    actionTool: "mail.send",
    actionArgs: { subject: "Weekly", to: "ops@example.com" },
    attest: undefined,
    expect: undefined,
  });
  assert.equal(h, "sha256:38a146ac9526011b30375b7e2e88dabef015223698a7c8e382cd5109366bf909");
});

test("I-1: expect-less, attest-bearing hash is byte-identical to the pre-expect formula (pinned digests)", () => {
  const withProjection = computeApprovalHash({
    actionTool: "gbrain.put_page",
    actionArgs: { markdown: "# hi", slug: "demo", title: "Demo" },
    attest: { tool: "gbrain.get_page", args: { slug: "demo" }, projection: ["compiled_truth"] },
    expect: undefined,
  });
  assert.equal(withProjection, "sha256:6ed11e9fe86e9b7c3a2ca7d08677f09a05d1996a2d0150022581113ff6cb63c3");

  const withoutProjection = computeApprovalHash({
    actionTool: "gbrain.put_page",
    actionArgs: { markdown: "# hi", slug: "demo", title: "Demo" },
    attest: { tool: "gbrain.get_page", args: { slug: "demo" } },
    expect: undefined,
  });
  assert.equal(withoutProjection, "sha256:5c377d089f26cb8450dbdbe08a38bcdc737045be1f009254799fabebce1e89bf");
});

// ---------------------------------------------------------------------------
// expect present → covered by the hash (§2.2)
// ---------------------------------------------------------------------------

test("expect present changes the hash — adding, editing, or deleting expect is an approval mismatch", () => {
  const base = { actionTool: "gbrain.put_page", actionArgs: { slug: "demo" }, attest: ATTEST };
  const without = computeApprovalHash({ ...base, expect: undefined });
  const withExpect = computeApprovalHash({ ...base, expect: EXPECT });
  assert.notEqual(withExpect, without);

  const editedPre = computeApprovalHash({ ...base, expect: { ...EXPECT, pre: `hmac-sha256:${"ab".repeat(32)}` } });
  assert.notEqual(editedPre, withExpect);

  const editedAt = computeApprovalHash({ ...base, expect: { ...EXPECT, at: "2026-07-31T00:00:00.000Z" } });
  assert.notEqual(editedAt, withExpect);

  const editedKeyId = computeApprovalHash({ ...base, expect: { ...EXPECT, keyId: "ffffffffffffffff" } });
  assert.notEqual(editedKeyId, withExpect);
});

test("expect-bearing hash matches the spec §2.2 formula exactly", () => {
  const h = computeApprovalHash({
    actionTool: "gbrain.put_page",
    actionArgs: { slug: "demo" },
    attest: ATTEST,
    expect: EXPECT,
  });
  assert.equal(
    h,
    digestSha256({
      args: { slug: "demo" },
      attest: { args: ATTEST.args, projection: ATTEST.projection, tool: ATTEST.tool },
      expect: { at: EXPECT.at, keyId: EXPECT.keyId, pre: EXPECT.pre },
      tool: "gbrain.put_page",
    })
  );
});

test("expect-bearing hash is stable across expect property order", () => {
  const h1 = computeApprovalHash({ actionTool: "t", actionArgs: { a: 1 }, attest: ATTEST, expect: EXPECT });
  const h2 = computeApprovalHash({
    actionTool: "t",
    actionArgs: { a: 1 },
    attest: ATTEST,
    expect: { pre: EXPECT.pre, at: EXPECT.at, keyId: EXPECT.keyId } as StepExpect,
  });
  assert.equal(h1, h2);
});

// ---------------------------------------------------------------------------
// Defensive: expect without attest is unrepresentable by grammar (I-12) —
// reaching the hash with that shape is a programmer error, refused loudly.
// ---------------------------------------------------------------------------

test("expect without attest throws (unrepresentable by parseSkill; never a silent legacy hash)", () => {
  assert.throws(
    () => computeApprovalHash({ actionTool: "t", actionArgs: {}, attest: undefined, expect: EXPECT }),
    /'expect' without 'attest'/
  );
});
