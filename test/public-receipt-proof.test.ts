import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";

const PROOF_DIR = resolve("docs/evidence/receipt-proof");
const REQUIRED_FILES = [
  "README.md",
  "EXECUTABLE-PROOF.md",
  "PROOF-OBSERVATION.md",
  "PROOF-RECEIPT.jsonl",
] as const;
const RETAINED_ARTIFACT_SHA256 = {
  "EXECUTABLE-PROOF.md": "ce262b4ade7f1f27e108baa4c7243abe747cd0462f0a3fec410d6d3651496855",
  "PROOF-OBSERVATION.md": "7668f1d21bf7d8c5d4aa4b20a31343fb50c2c1b94f638f84d739e6f9e2415c41",
  "PROOF-RECEIPT.jsonl": "0f5830b6b2b526a31ef0f8133553c3c1d8d02b3d0458a35d306853d127f9bfe1",
} as const;

function readProofFile(name: (typeof REQUIRED_FILES)[number]): string {
  return readFileSync(resolve(PROOF_DIR, name), "utf8");
}

test("the public receipt proof bundle is complete and internally linked", () => {
  for (const file of REQUIRED_FILES) {
    assert.equal(existsSync(resolve(PROOF_DIR, file)), true, `missing ${file}`);
  }

  for (const markdownFile of REQUIRED_FILES.filter((file) => file.endsWith(".md"))) {
    const markdownPath = resolve(PROOF_DIR, markdownFile);
    const markdown = readFileSync(markdownPath, "utf8");
    const relativeLinks = [...markdown.matchAll(/\[[^\]]+\]\((?!https?:|#)([^)]+)\)/g)];
    for (const [, target] of relativeLinks) {
      assert.equal(
        existsSync(resolve(dirname(markdownPath), target)),
        true,
        `${markdownFile} links to missing ${target}`,
      );
    }
  }
});

test("the retained receipt is byte-bound and contains the bounded observation", () => {
  for (const [file, expectedSha256] of Object.entries(RETAINED_ARTIFACT_SHA256)) {
    const bytes = readFileSync(resolve(PROOF_DIR, file));
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      expectedSha256,
      `${file} bytes changed`,
    );
  }

  const receiptBytes = readFileSync(resolve(PROOF_DIR, "PROOF-RECEIPT.jsonl"));

  const receipt = JSON.parse(receiptBytes.toString("utf8"));
  assert.equal(receipt.skill, "httpbin-echo-check");
  assert.equal(receipt.skillContentSha256, "04748fc814f8a983f941ea2f97e66a6f38ba472e62bab0fe2cbd774a8dfc49df");
  assert.equal(receipt.passed, true);
  assert.equal(receipt.policy.status, "absent");
  assert.deepEqual(receipt.steps.map((step: { outcome: string }) => step.outcome), ["passed"]);
  assert.equal(receipt.totals.unchecked, 0);
});

test("Git preserves the retained proof bytes as LF on every platform", () => {
  const attributes = readFileSync(resolve(".gitattributes"), "utf8");
  assert.match(attributes, /^docs\/evidence\/receipt-proof\/\*\* text eol=lf$/m);
});

test("the reproduction is immutable and the public framing preserves nonclaims", () => {
  const executable = readProofFile("EXECUTABLE-PROOF.md");
  assert.match(executable, /reelier@0\.32\.0/);
  assert.match(
    executable,
    /sha512-XFrsLKdPuw7R0\+gNcvduUIHDj2RE4m9j6eLgmRPKLOKS\+Z1SiQEj0sLEmIkxaUujoM8NUfyzeUgIOXL1kAihrQ==/,
  );
  assert.match(executable, /bd44bf81bbd41915543fb647f433ddb386cc6a1d/);
  assert.match(executable, /04748fc814f8a983f941ea2f97e66a6f38ba472e62bab0fe2cbd774a8dfc49df/);

  const publicIndex = readProofFile("README.md").toLowerCase();
  assert.match(
    publicIndex,
    /https:\/\/www\.reelier\.com\/evidence\/what-agent-receipt-proves/,
  );
  assert.match(publicIndex, /unsigned and untimestamped/);
  assert.match(publicIndex, /does not prove safety/);
  assert.match(publicIndex, /does not prove[^.]*correctness/);
  assert.match(publicIndex, /does not prove[^.]*completeness/);
});
