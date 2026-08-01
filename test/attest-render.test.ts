// test/attest-render.test.ts
// Pure formatter unit tests for src/attest-render.ts — pinned BEFORE the CLI
// wiring (src/cli.ts onStep) so the line text/shape is locked down
// independent of any actual run. Mirrors reelier-cloud's
// src/lib/attest.ts attestSummaryText/stepAttestLine conventions, adapted
// for the CLI's plain-text (no className) output plus the pre-state fact
// line, which the cloud's PublicStepAttest deliberately does not carry.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderAttestLines, attestSummaryLine, preStateLine, abbreviateHash } from "../src/attest-render.js";
import type { StepAttest } from "../src/runner.js";

test("abbreviateHash: keeps the sha256: prefix and shows head…tail of the hex", () => {
  const hash = "sha256:9f3ac41200aa00bb00cc00dd00ee00ff112233445566778899aabbccddeec412";
  assert.equal(abbreviateHash(hash), "sha256:9f3a…c412");
});

test("abbreviateHash: a malformed/short hash is returned verbatim (never throws, never fabricates)", () => {
  assert.equal(abbreviateHash("sha256:short"), "sha256:short");
  assert.equal(abbreviateHash(""), "");
});

test("attestSummaryLine: declared-probe exact with a delta names the changed fields", () => {
  const a: StepAttest = {
    method: "declared-probe",
    confidence: "exact",
    delta: { changed: 2, fields: ["body.etag", "body.updated_at"] },
  };
  assert.equal(attestSummaryLine(a), "state: exact — 2 fields changed (body.etag, body.updated_at)");
});

test("attestSummaryLine: exact with zero changed fields reads 'no observed change'", () => {
  const a: StepAttest = { method: "declared-probe", confidence: "exact", delta: { changed: 0 } };
  assert.equal(attestSummaryLine(a), "state: exact — no observed change");
});

test("attestSummaryLine: exact singular field noun", () => {
  const a: StepAttest = { method: "declared-probe", confidence: "exact", delta: { changed: 1, fields: ["body.etag"] } };
  assert.equal(attestSummaryLine(a), "state: exact — 1 field changed (body.etag)");
});

test("attestSummaryLine: partial/absent render honestly with the reason, never a pass color implied", () => {
  const a: StepAttest = { method: "response-derived", confidence: "partial", reason: "dispatch-failed" };
  assert.equal(attestSummaryLine(a), "state: partial — dispatch-failed");
});

test("attestSummaryLine: partial/absent with no reason still names confidence", () => {
  const a: StepAttest = { method: "declared-probe", confidence: "absent" };
  assert.equal(attestSummaryLine(a), "state: absent");
});

test("attestSummaryLine: pending renders honestly", () => {
  const a: StepAttest = { method: "declared-probe", confidence: "pending", reason: "probe-in-flight" };
  assert.equal(attestSummaryLine(a), "state: pending — probe-in-flight");
});

test("preStateLine: declared-probe with pre renders the captured-at + abbreviated commitment", () => {
  const a: StepAttest = {
    method: "declared-probe",
    confidence: "exact",
    pre: { hash: "sha256:9f3ac41200aa00bb00cc00dd00ee00ff112233445566778899aabbccddeec412", at: "2026-07-29T14:02:11Z" },
    post: { hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000", at: "2026-07-29T14:02:12Z" },
    delta: { changed: 0 },
  };
  assert.equal(
    preStateLine(a),
    "state before this write: captured 2026-07-29T14:02:11Z · commitment sha256:9f3a…c412",
  );
});

test("preStateLine: never renders for response-derived (no real pre-state observation exists — would be fabrication)", () => {
  const a: StepAttest = {
    method: "response-derived",
    confidence: "partial",
    post: { hash: "sha256:abcd000000000000000000000000000000000000000000000000000000001234", at: "2026-07-29T14:02:12Z" },
  };
  assert.equal(preStateLine(a), undefined);
});

test("preStateLine: declared-probe without a captured pre (e.g. probe timed out) renders nothing", () => {
  const a: StepAttest = { method: "declared-probe", confidence: "absent", reason: "pre-probe-failed: timeout" };
  assert.equal(preStateLine(a), undefined);
});

test("renderAttestLines: declared-probe exact with pre+post yields the summary line then the pre-state line", () => {
  const a: StepAttest = {
    method: "declared-probe",
    confidence: "exact",
    pre: { hash: "sha256:9f3ac41200aa00bb00cc00dd00ee00ff112233445566778899aabbccddeec412", at: "2026-07-29T14:02:11Z" },
    post: { hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000", at: "2026-07-29T14:02:12Z" },
    delta: { changed: 2, fields: ["body.etag", "body.updated_at"] },
  };
  assert.deepEqual(renderAttestLines(a), [
    "state: exact — 2 fields changed (body.etag, body.updated_at)",
    "state before this write: captured 2026-07-29T14:02:11Z · commitment sha256:9f3a…c412",
  ]);
});

test("renderAttestLines: response-derived never gets a second (pre-state) line", () => {
  const a: StepAttest = {
    method: "response-derived",
    confidence: "partial",
    post: { hash: "sha256:abcd000000000000000000000000000000000000000000000000000000001234", at: "2026-07-29T14:02:12Z" },
  };
  assert.deepEqual(renderAttestLines(a), ["state: partial"]);
});

test("renderAttestLines: absent/partial never renders a pre-state line even if method is declared-probe but pre is missing", () => {
  const a: StepAttest = { method: "declared-probe", confidence: "partial", reason: "probe-failed: boom" };
  assert.deepEqual(renderAttestLines(a), ["state: partial — probe-failed: boom"]);
});
