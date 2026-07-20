#!/usr/bin/env node
// Writes the $GITHUB_STEP_SUMMARY for the Reelier GitHub Action (action.yml
// at the repo root). Reads ONLY the actual run record written by
// `reelier run` (`.reelier/runs/<skill-name>.jsonl`, see SPEC.md §4) — every
// number in the summary is copied from that file. If a field can't be
// found, it's omitted, never guessed (CLAUDE.md "no fabrication" /
// SPEC.md §4.3's totals-honesty rule extends to this consumer too: an
// "unchecked" step is never presented as a passing check).
//
// Env in:
//   SKILL_PATH        path to the .skill.md that was run (relative to cwd)
//   RUN_EXIT_CODE      exit code from `reelier run`
//   CLOUD_PUSH_STATUS  "pushed" | "skipped" | "failed" | "" (not attempted)
//   GITHUB_STEP_SUMMARY  path GitHub Actions gives us to append markdown to
//
// This script never throws to fail the job — the job's pass/fail verdict is
// RUN_EXIT_CODE, decided by action.yml's run step, not by this script.
// This script only ever describes what happened.

import { readFile, appendFile } from "node:fs/promises";
import path from "node:path";

async function appendOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  await appendFile(outputPath, `${name}=${value}\n`);
}

function extractSkillName(source) {
  // Matches parseFrontmatter in src/skill.ts: a leading `---` block with a
  // `name: ...` line. Kept intentionally dumb (no full YAML parse) — this
  // only needs to find the run-record filename, and a failure to match
  // means "omit", not "guess".
  const fmMatch = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return undefined;
  const nameLine = fmMatch[1].split(/\r?\n/).find((l) => /^name:\s*/.test(l));
  if (!nameLine) return undefined;
  return nameLine.replace(/^name:\s*/, "").trim();
}

async function readLastRecord(jsonlPath) {
  let text;
  try {
    text = await readFile(jsonlPath, "utf8");
  } catch {
    return undefined;
  }
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return undefined;
  try {
    return JSON.parse(lines[lines.length - 1]);
  } catch {
    return undefined;
  }
}

function outcomeIcon(outcome) {
  if (outcome === "passed") return "✅";
  if (outcome === "unchecked") return "➖";
  if (outcome === "skipped") return "⏭️";
  return "❌";
}

async function main() {
  const skillPath = process.env.SKILL_PATH;
  const exitCode = process.env.RUN_EXIT_CODE;
  const cloudPushStatus = process.env.CLOUD_PUSH_STATUS || "";
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;

  const lines = [];
  lines.push(`## Reelier replay${skillPath ? `: \`${skillPath}\`` : ""}`);
  lines.push("");

  let skillName;
  try {
    const source = await readFile(skillPath, "utf8");
    skillName = extractSkillName(source);
  } catch {
    // skill file unreadable — already reflected by a non-zero exit code
  }

  const recordPath = skillName ? path.join(".reelier", "runs", `${skillName}.jsonl`) : "";
  await appendOutput("record-path", recordPath);

  const record = skillName ? await readLastRecord(path.join(process.cwd(), ".reelier", "runs", `${skillName}.jsonl`)) : undefined;

  if (!record) {
    lines.push(
      exitCode === "0"
        ? "_No run record was found at `.reelier/runs/<skill-name>.jsonl` even though the replay reported success — see the raw CLI log above for what actually happened._"
        : "_No run record was written — the CLI exited before completing a run. See the raw CLI log above for the failure._"
    );
    lines.push("");
    lines.push(`**Exit code:** \`${exitCode}\``);
  } else {
    const t = record.totals ?? {};
    const passIcon = record.passed ? "✅ PASSED" : "❌ FAILED";
    lines.push(`**Skill:** \`${record.skill ?? skillName}\`  `);
    lines.push(`**Result:** ${passIcon}`);
    lines.push("");
    lines.push("| steps | passed | unchecked | skipped | failed | duration |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    lines.push(
      `| ${t.steps ?? "?"} | ${t.passed ?? "?"} | ${t.unchecked ?? "?"} | ${t.skipped ?? "?"} | ${t.failed ?? "?"} | ${
        t.ms !== undefined ? `${t.ms}ms` : "?"
      } |`
    );
    if ((t.llmInputTokens ?? 0) > 0 || (t.llmOutputTokens ?? 0) > 0) {
      lines.push("");
      lines.push(`**LLM tokens:** ${t.llmInputTokens ?? 0} in / ${t.llmOutputTokens ?? 0} out (escalation ran)`);
    }
    lines.push("");
    lines.push(
      "> `unchecked` = ran without error but asserted nothing — the honest-success rule (SPEC.md §4.3) means it is never counted as a pass."
    );
    lines.push("");

    if (Array.isArray(record.steps) && record.steps.length > 0) {
      lines.push("<details><summary>Per-step detail</summary>");
      lines.push("");
      lines.push("| # | step | outcome | level | ms |");
      lines.push("| --- | --- | --- | --- | --- |");
      for (const s of record.steps) {
        const healed = s.level > 0 ? ` (healed L${s.level})` : "";
        lines.push(`| ${s.n} | ${s.title ?? ""} | ${outcomeIcon(s.outcome)} ${s.outcome}${healed} | ${s.level ?? 0} | ${s.ms ?? "?"} |`);
      }
      lines.push("");
      lines.push("</details>");
    }
  }

  lines.push("");
  if (cloudPushStatus === "pushed") {
    lines.push("**Ledger:** receipt pushed.");
  } else if (cloudPushStatus === "failed") {
    lines.push("**Ledger:** push attempted but failed — see the raw CLI log above.");
  } else if (cloudPushStatus === "skipped") {
    lines.push("_Ledger: not pushed (no `cloud-key` input set)._");
  } else if (cloudPushStatus === "not-attempted") {
    lines.push("_Ledger: push skipped — the replay failed, so nothing was pushed._");
  }

  await appendFile(summaryPath, lines.join("\n") + "\n");
}

main().catch((err) => {
  // Describing the run must never itself crash the job silently — surface
  // it, but still let action.yml's own RUN_EXIT_CODE be the actual verdict.
  console.error(`gha-summary.mjs failed to write the job summary: ${err.message}`);
});
