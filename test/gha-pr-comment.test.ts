import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Plain-JS GitHub Actions helper script, not part of src/, so tsc's rootDir
// mapping doesn't carry it into dist-test alongside this compiled test file.
// Resolved relative to process.cwd() (repo root — how `npm test` always
// invokes this suite) rather than a relative specifier, so the import keeps
// working no matter where tsc places the compiled test. Importing it does
// execute its top-level main(), but main() no-ops (logs one line, returns)
// whenever GITHUB_TOKEN is unset, which it always is under `npm test`.
const ghaPrCommentUrl = pathToFileURL(
  path.resolve(process.cwd(), ".github/scripts/gha-pr-comment.mjs")
).href;
const { renderSkillSection, renderComment } = await import(ghaPrCommentUrl);

const record = {
  passed: true,
  totals: { steps: 3, passed: 3, unchecked: 0, failed: 0, ms: 120, llmInputTokens: 0, llmOutputTokens: 0 },
};

test("renderSkillSection appends the verify/make-your-own CTA when receiptUrl is present", () => {
  const section = renderSkillSection("my-skill", record, {
    maxLevel: "0",
    runExitCode: "0",
    cloudKeySet: "true",
    receiptUrl: "https://www.reelier.com/r/abc123",
  });
  assert.match(section, /\[Verify this receipt\]\(https:\/\/www\.reelier\.com\/r\/abc123\)/);
  assert.match(section, /\[Make your own →\]\(https:\/\/www\.reelier\.com\/\?utm_source=pr-comment\)/);
});

test("renderSkillSection omits the CTA (no broken link) when receiptUrl is absent", () => {
  const section = renderSkillSection("my-skill", record, {
    maxLevel: "0",
    runExitCode: "0",
    cloudKeySet: "true",
    receiptUrl: undefined,
  });
  assert.doesNotMatch(section, /Verify this receipt/);
  assert.doesNotMatch(section, /Make your own/);
});

test("renderSkillSection omits the CTA for local (unpushed) replays even if a stray receiptUrl were passed", () => {
  // cloudKeySet=false takes the "local replay (not pushed)" branch, which
  // never carries a receiptUrl in practice — this pins that the CTA line
  // itself is still gated on receiptUrl, not accidentally always-on.
  const section = renderSkillSection("my-skill", record, {
    maxLevel: "0",
    runExitCode: "0",
    cloudKeySet: "false",
    receiptUrl: undefined,
  });
  assert.match(section, /local replay \(not pushed\)/);
  assert.doesNotMatch(section, /Verify this receipt/);
});

test("renderComment keeps markers and idempotency-relevant structure unchanged, with one CTA per section", () => {
  const withReceipt = renderSkillSection("a", record, {
    maxLevel: "0",
    runExitCode: "0",
    cloudKeySet: "true",
    receiptUrl: "https://www.reelier.com/r/abc123",
  });
  const withoutReceipt = renderSkillSection("b", record, {
    maxLevel: "0",
    runExitCode: "0",
    cloudKeySet: "true",
    receiptUrl: undefined,
  });
  const blocks = new Map([
    ["a", withReceipt],
    ["b", withoutReceipt],
  ]);
  const body = renderComment(blocks, ["a", "b"]);

  assert.match(body, /<!-- reelier-skill:a -->[\s\S]*<!-- \/reelier-skill:a -->/);
  assert.match(body, /<!-- reelier-skill:b -->[\s\S]*<!-- \/reelier-skill:b -->/);
  // Only skill "a" (the one with a receiptUrl) carries the per-section CTA.
  const ctaCount = (body.match(/Verify this receipt/g) ?? []).length;
  assert.equal(ctaCount, 1);
  // Footer is untouched and still present exactly once.
  assert.match(body, /Replayed by \[Reelier\]\(https:\/\/www\.reelier\.com\) — record once, replay at 0 tokens\./);
  const footerCount = (body.match(/Replayed by \[Reelier\]/g) ?? []).length;
  assert.equal(footerCount, 1);
});
