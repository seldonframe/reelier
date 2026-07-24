// Golden-file (snapshot) tests over reelier's WIRE FORMATS — the exact bytes
// that get hashed into a digest, pushed to the cloud, or written as a
// SKILL.md that other tools (and other reelier versions) parse. Cloud/CLI
// parser skew has happened before by an accidental shape change slipping
// through unit tests that only assert on individual fields. A golden file
// pins the WHOLE shape (field names, ordering, punctuation) so any drift —
// intended or not — fails loudly with a diff, instead of shipping quietly.
//
// Workflow: regenerate with `UPDATE_GOLDEN=1 npm test` after an INTENTIONAL
// format change; a diff here means the wire format changed — confirm it was
// intended (and that every consumer of the format was updated) before
// regenerating and committing the new fixture.
//
// Coverage note: the badge SVG is rendered on the cloud side, not in this
// CLI repo (no local badge-rendering function exists here) — so there is no
// badge golden in this suite. This file covers the two CLI-owned wire
// formats: the canonical record serialization (+ its digest) and the
// compiled SKILL.md markdown.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, digestSha256 } from "../src/canonical-json.js";
import { compile, renderSkillMd } from "../src/compile.js";
import type { TraceRecord } from "../src/recorder.js";
import type { RunRecord } from "../src/runner.js";

// Fixtures live at test/fixtures/golden (repo-relative — NOT copied by tsc,
// so resolve against the SOURCE tree, not dist-test's compiled location).
// Same convention as test/tsa.test.ts and test/from-session-cli.test.ts.
const GOLDEN_DIR = fileURLToPath(new URL("../../test/fixtures/golden", import.meta.url));

/**
 * Compare `actual` against the fixture at test/fixtures/golden/<name>.
 * With UPDATE_GOLDEN set, writes `actual` as the new fixture and passes
 * (regeneration mode). Otherwise reads the existing fixture and asserts
 * exact equality — a genuine comparison, never a substring/length check.
 */
function matchGolden(name: string, actual: string): void {
  const filePath = path.join(GOLDEN_DIR, name);
  if (process.env.UPDATE_GOLDEN) {
    mkdirSync(GOLDEN_DIR, { recursive: true });
    writeFileSync(filePath, actual, "utf8");
    return;
  }
  if (!existsSync(filePath)) {
    throw new Error(
      `Golden fixture missing: ${filePath}. Run \`UPDATE_GOLDEN=1 npm test\` to generate it, then eyeball + commit it.`
    );
  }
  const expected = readFileSync(filePath, "utf8");
  assert.equal(actual, expected, `Wire format drift detected in golden "${name}" — confirm this was intended, then UPDATE_GOLDEN=1.`);
}

// ---------------------------------------------------------------------------
// 1 & 2. Canonical record serialization + digest stability
// ---------------------------------------------------------------------------
//
// A hand-authored, fully-fixed RunRecord-shaped object: fixed skill name,
// fixed startedAt/finishedAt/ms values, a couple of StepRecords (one with a
// `write` block), fixed totals. No field here is generated at test-run time
// — every value is a literal, so both the serialization and its digest are
// stable across machines, timezones, and runs.

const FIXED_RECORD: RunRecord = {
  skill: "golden-demo-skill",
  startedAt: "2026-01-01T00:00:00.000Z",
  finishedAt: "2026-01-01T00:00:05.250Z",
  passed: true,
  skillContentSha256: "a".repeat(64),
  steps: [
    {
      n: 1,
      title: "Fetch the account",
      level: 0,
      outcome: "passed",
      ms: 120,
      failures: [],
      refs: [],
    },
    {
      n: 2,
      title: "Create the invoice",
      level: 0,
      outcome: "passed",
      ms: 340,
      failures: [],
      write: {
        idempotencyKey: "idem_golden_0001",
        approved: true,
        resource: { id: "inv_golden_0001", version: "1" },
      },
    },
  ],
  totals: {
    steps: 2,
    passed: 2,
    unchecked: 0,
    skipped: 0,
    failed: 0,
    ms: 460,
    llmInputTokens: 0,
    llmOutputTokens: 0,
  },
};

test("golden: canonicalJson(RunRecord) — pins field names + key ordering of the serialized/hashed shape", () => {
  matchGolden("canonical-record.json", canonicalJson(FIXED_RECORD));
});

test("golden: digestSha256(RunRecord) — the strongest drift canary; changes if canonicalJson OR the record shape changes at all", () => {
  matchGolden("record-digest.txt", digestSha256(FIXED_RECORD));
});

// ---------------------------------------------------------------------------
// 3. SKILL.md format
// ---------------------------------------------------------------------------
//
// A small, fully-fixed trace (a bind step, an http.get step, an assert step)
// compiled through the real compile() + renderSkillMd() pipeline. Two
// nondeterministic fields get normalized before freezing:
//   - `recorded_with: reelier v<version>` — churns every release, so the
//     version segment is replaced with a fixed placeholder.
//   - the "Compiled from ... on <date>" / changelog date lines — renderSkillMd
//     stamps `new Date()` at render time, so today's date is replaced with a
//     fixed placeholder too.
// Everything else (step ordering, bind/assert/effect formatting, open
// questions, footer) is real compiler output, untouched.

function meta(name: string): TraceRecord {
  return { t: "meta", seq: 0, name, startedAt: "2026-01-01T00:00:00.000Z", wrapped: ["golden-downstream"] };
}

function note(seq: number, text: string): TraceRecord {
  return { t: "note", seq, ts: "2026-01-01T00:00:00.000Z", text };
}

function call(seq: number, i: number, tool: string, args: unknown): TraceRecord {
  return { t: "call", seq, i, ts: "2026-01-01T00:00:00.000Z", tool, args };
}

function result(seq: number, i: number, ok: boolean, body: unknown, ms = 5): TraceRecord {
  return { t: "result", seq, i, ok, ms, body };
}

function mcpJsonResult(json: unknown): unknown {
  return { content: [{ type: "text", text: JSON.stringify(json) }] };
}

const FIXED_TRACE: TraceRecord[] = [
  meta("golden-demo-skill"),
  note(1, "bind the created account id for later steps"),
  call(2, 0, "create_account", { name: "Golden Demo Co" }),
  result(3, 0, true, mcpJsonResult({ id: "acct_golden_0001", name: "Golden Demo Co" })),
  note(4, "fetch the account's public status page"),
  call(5, 1, "http.get", { url: "https://status.example.com/acct_golden_0001" }),
  result(6, 1, true, mcpJsonResult({ status: "ok", accountId: "acct_golden_0001" })),
  note(7, "assert the fetched status is healthy"),
  call(8, 2, "assert_status", { accountId: "acct_golden_0001", expected: "ok" }),
  result(9, 2, true, mcpJsonResult({ ok: true })),
];

/** Strip the two nondeterministic segments renderSkillMd stamps in: the reelier version and today's render date. */
function normalizeSkillMd(md: string): string {
  return md
    .replace(/recorded_with: reelier v\S+/g, "recorded_with: reelier v<NORMALIZED_VERSION>")
    .replace(/\bon \d{4}-\d{2}-\d{2}\b/g, "on <NORMALIZED_DATE>")
    .replace(/^- \d{4}-\d{2}-\d{2} — compiled from/m, "- <NORMALIZED_DATE> — compiled from");
}

test("golden: renderSkillMd(compile(fixedTrace)) — pins the compiled SKILL.md wire format other tools read", () => {
  const compiled = compile(FIXED_TRACE);
  const md = renderSkillMd(compiled, "golden-trace.jsonl");
  const normalized = normalizeSkillMd(md);

  // Sanity: normalization actually fired on this render (guards against the
  // normalizer silently no-op'ing if renderSkillMd's format ever changes).
  assert.ok(!/reelier v\d/.test(normalized), "version was not normalized out of the golden");
  assert.ok(!/\bon \d{4}-\d{2}-\d{2}\b/.test(normalized), "render date was not normalized out of the golden");

  matchGolden("compiled.skill.md", normalized);
});
