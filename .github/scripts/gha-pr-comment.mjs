#!/usr/bin/env node
// Upserts ONE sticky PR comment carrying the replay receipt (action.yml at
// the repo root, feature "sticky PR receipt comment"). Node (not curl+jq)
// because it needs to: parse the run record JSON, read/replace ONE named
// section inside a comment that may carry other skills' sections too, and
// make two authenticated GitHub REST calls — all things the global `fetch`
// already available in the Node 20 setup this action installs handles more
// reliably than shelling out to curl for JSON bodies with unpredictable
// content (skill titles, failure messages).
//
// NEVER fails the job: every code path below either upserts the comment or
// prints exactly one warning line and exits 0. The job's pass/fail verdict
// is decided by action.yml's own "Fail the check if the replay failed" step,
// never by this script.
//
// Matrix-safe by section: the comment carries one sticky marker
// (`<!-- reelier-receipts -->`) and one sub-section per skill
// (`<!-- reelier-skill:<name> -->...<!-- /reelier-skill:<name> -->`). Each
// invocation only replaces (or appends) its OWN skill's section, leaving
// every other skill's section byte-identical. Benign race: two matrix jobs
// finishing at the same moment can both GET the same starting body and both
// PATCH — the second write wins and the first job's section is dropped
// until that skill's next run. No locking is built for this; see the
// comment on the workflow trigger for the same note.

import { readFile } from "node:fs/promises";
import path from "node:path";

const STICKY_MARKER = "<!-- reelier-receipts -->";
const FOOTER_MARKER = "<!-- reelier-footer -->";
const FOOTER_TEXT =
  "Replayed by [Reelier](https://www.reelier.com) — record once, replay at 0 tokens.";

function warn(msg) {
  console.error(`WARNING: ${msg} — the replay's own pass/fail is unaffected.`);
}

// Same deliberately-dumb frontmatter scan as gha-summary.mjs (no full YAML
// parser) — a miss here means "omit", never "guess".
function extractSkillName(source) {
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

/** Growth-loop CTA appended only when a public receipt permalink exists — omitted (never a broken link) when the run wasn't shared/pushed. */
function renderVerifyCta(receiptUrl) {
  return `🔍 [Verify this receipt](${receiptUrl}) · [Make your own →](https://www.reelier.com/?utm_source=pr-comment)`;
}

/** The markdown between (not including) this skill's own markers. Never fabricates a number the run record doesn't carry. */
export function renderSkillSection(name, record, { maxLevel, runExitCode, cloudKeySet, receiptUrl }) {
  if (!record) {
    const icon = runExitCode === "0" ? "✓" : "✗";
    return [
      `### ${icon} ${name}`,
      `- run exited ${runExitCode} — no run record found at \`.reelier/runs/${name}.jsonl\``,
    ].join("\n");
  }

  const t = record.totals ?? {};
  const icon = record.passed ? "✓" : "✗";
  const lines = [`### ${icon} ${name}`];

  const okCount = t.passed ?? "?";
  const totalSteps = t.steps ?? "?";
  lines.push(`- steps: ${okCount}/${totalSteps} passed`);
  if ((t.unchecked ?? 0) > 0) lines.push(`- unchecked: ${t.unchecked}`);
  if ((t.failed ?? 0) > 0) lines.push(`- failed: ${t.failed}`);
  lines.push(`- duration: ${t.ms !== undefined ? `${t.ms}ms` : "?"}`);

  // "0 LLM tokens" is only ever printed when this replay actually ran at
  // max-level 0 AND the record's own token fields are actually zero — never
  // assumed from the input alone.
  const tokensIn = t.llmInputTokens ?? 0;
  const tokensOut = t.llmOutputTokens ?? 0;
  if (maxLevel === "0" && tokensIn === 0 && tokensOut === 0) {
    lines.push("- 0 LLM tokens");
  } else if (tokensIn > 0 || tokensOut > 0) {
    lines.push(`- ${tokensIn} in / ${tokensOut} out LLM tokens`);
  } else {
    lines.push("- 0 LLM tokens");
  }

  if (cloudKeySet !== "true") {
    lines.push("- local replay (not pushed)");
  } else if (receiptUrl) {
    lines.push(`- [receipt](${receiptUrl})`);
  } else {
    lines.push("- pushed to ledger (private — no public receipt; push with `--share` for one)");
  }

  // Growth-loop CTA: only when there's a real public permalink to point at —
  // never a broken link when the run wasn't shared/pushed.
  if (receiptUrl) lines.push(renderVerifyCta(receiptUrl));

  return lines.join("\n");
}

/** Parse every `<!-- reelier-skill:NAME -->...<!-- /reelier-skill:NAME -->` block out of an existing comment body, in original order. */
function parseSkillBlocks(body) {
  const blocks = new Map();
  const order = [];
  const re = /<!-- reelier-skill:([^\s>]+) -->\n([\s\S]*?)\n<!-- \/reelier-skill:\1 -->/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    if (!blocks.has(m[1])) order.push(m[1]);
    blocks.set(m[1], m[2]);
  }
  return { blocks, order };
}

export function renderComment(blocks, order) {
  const parts = [STICKY_MARKER, "", "## Reelier receipts", ""];
  for (const name of order) {
    parts.push(`<!-- reelier-skill:${name} -->`);
    parts.push(blocks.get(name));
    parts.push(`<!-- /reelier-skill:${name} -->`);
    parts.push("");
  }
  parts.push(FOOTER_MARKER);
  parts.push(FOOTER_TEXT);
  return parts.join("\n");
}

async function githubRequest(apiUrl, token, method, urlPath, body) {
  const res = await fetch(`${apiUrl}${urlPath}`, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return res;
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const prNumber = process.env.PR_NUMBER;
  const skillPath = process.env.SKILL_PATH;
  const maxLevel = process.env.MAX_LEVEL ?? "0";
  const runExitCode = process.env.RUN_EXIT_CODE ?? "";
  const cloudKeySet = process.env.CLOUD_KEY_SET ?? "false";
  const receiptUrl = process.env.RECEIPT_URL || undefined;
  const repo = process.env.GITHUB_REPOSITORY; // owner/repo, set by Actions itself
  const apiUrl = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");

  if (!token) {
    console.log("no pull-requests: write permission — see docs/REFERENCE.md 'CI: replay on every PR' — skipping PR comment.");
    return;
  }
  if (!prNumber) {
    console.log("no pull request number in this event — skipping PR comment.");
    return;
  }
  if (!repo) {
    warn("GITHUB_REPOSITORY was not set by the runner");
    return;
  }

  let source;
  try {
    source = await readFile(skillPath, "utf8");
  } catch (err) {
    warn(`could not read skill file ${skillPath} (${err.message})`);
    return;
  }
  const skillName = extractSkillName(source) ?? path.basename(skillPath).replace(/\.skill\.md$/, "");
  // The raw name (PR-controlled content) plays three roles with different
  // safety needs: the run-record FILENAME must use it verbatim; the heading
  // gets it with HTML-comment-capable characters stripped; the section
  // MARKER must be slug-safe or the upsert regex can't round-trip it (a
  // space or ">" in a marker breaks re-matching → duplicate sections
  // appended forever) — and a crafted name could otherwise forge marker
  // boundaries.
  const displayName = skillName.replace(/[<>]/g, "");
  const skillSlug = skillName.replace(/[^A-Za-z0-9._-]/g, "-");

  const record = await readLastRecord(path.join(process.cwd(), ".reelier", "runs", `${skillName}.jsonl`));
  const section = renderSkillSection(displayName, record, { maxLevel, runExitCode, cloudKeySet, receiptUrl });

  let listRes;
  try {
    // Known limit: first page only. On a PR with >100 comments where the
    // sticky one has scrolled past page 1, a duplicate gets posted — an
    // accepted edge; pagination is not worth the extra calls per run.
    listRes = await githubRequest(apiUrl, token, "GET", `/repos/${repo}/issues/${prNumber}/comments?per_page=100`);
  } catch (err) {
    warn(`listing PR comments failed (${err.message})`);
    return;
  }
  if (listRes.status === 403 || listRes.status === 404) {
    console.log(
      `no pull-requests: write permission (HTTP ${listRes.status} listing comments) — see docs/REFERENCE.md 'CI: replay on every PR' — skipping PR comment.`
    );
    return;
  }
  if (!listRes.ok) {
    warn(`listing PR comments returned HTTP ${listRes.status}`);
    return;
  }

  let comments;
  try {
    comments = await listRes.json();
  } catch (err) {
    warn(`PR comments list was not valid JSON (${err.message})`);
    return;
  }

  const existing = Array.isArray(comments) ? comments.find((c) => typeof c.body === "string" && c.body.includes(STICKY_MARKER)) : undefined;

  const { blocks, order } = existing ? parseSkillBlocks(existing.body) : { blocks: new Map(), order: [] };
  if (!blocks.has(skillSlug)) order.push(skillSlug);
  blocks.set(skillSlug, section);
  const newBody = renderComment(blocks, order);

  let writeRes;
  try {
    if (existing) {
      writeRes = await githubRequest(apiUrl, token, "PATCH", `/repos/${repo}/issues/comments/${existing.id}`, { body: newBody });
    } else {
      writeRes = await githubRequest(apiUrl, token, "POST", `/repos/${repo}/issues/${prNumber}/comments`, { body: newBody });
    }
  } catch (err) {
    warn(`${existing ? "updating" : "creating"} the PR comment failed (${err.message})`);
    return;
  }
  if (writeRes.status === 403) {
    console.log(
      "no pull-requests: write permission (HTTP 403 writing the comment) — see docs/REFERENCE.md 'CI: replay on every PR' — skipping PR comment."
    );
    return;
  }
  if (!writeRes.ok) {
    warn(`${existing ? "updating" : "creating"} the PR comment returned HTTP ${writeRes.status}`);
    return;
  }

  console.log(`PR receipt comment ${existing ? "updated" : "created"} for skill '${skillName}'.`);
}

main().catch((err) => {
  warn(`unexpected error (${err.message})`);
});
