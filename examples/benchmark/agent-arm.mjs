// Arm A — agent WITHOUT Reelier: a minimal Anthropic Messages API tool-use
// loop, driven with raw fetch (zero deps, per the benchmark brief). One
// tool (http_get), one task, repeated N times so we can measure real
// tokens/cost/latency/variance per run.
//
// Model: claude-haiku-4-5-20251001. This deliberately UNDERSTATES the real
// gap Reelier closes — frontier models (Opus/Sonnet-tier) cost roughly
// 10-30x more per token than Haiku, so a benchmark run on a frontier model
// would show a larger, not smaller, cost delta between the two arms. Haiku
// was chosen as the conservative floor.

import { pathToFileURL } from "node:url";
import { getAnthropicApiKey } from "./env.mjs";

export const MODEL = "claude-haiku-4-5-20251001";
// Haiku 4.5 list pricing (per the claude-api skill's cached pricing table,
// 2026-06-24): $1.00 / MTok input, $5.00 / MTok output.
export const INPUT_PRICE_PER_MTOK = 1.0;
export const OUTPUT_PRICE_PER_MTOK = 5.0;

export const REGISTRY_URL = "https://registry.npmjs.org/@seldonframe/reelier";

const HTTP_GET_BODY_CAP = 50_000;

const SYSTEM_PROMPT =
  "You are a tool-using agent. You have one tool, http_get, which fetches " +
  "a URL and returns its response body as text. Use http_get to fetch the " +
  "URL the user gives you, then read the JSON response and return ONLY a " +
  "JSON object with exactly these keys: version (the dist-tags.latest " +
  "string), license (the license string), tarball (the tarball URL of the " +
  "latest version, from versions[<the latest version>].dist.tarball). " +
  "Return ONLY the JSON object — no prose, no markdown code fences, no " +
  "explanation.";

const USER_PROMPT =
  `Fetch the npm registry metadata for the package @seldonframe/reelier ` +
  `from ${REGISTRY_URL} and return a JSON object with exactly these keys: ` +
  `version (the dist-tags.latest string), license (the license string), ` +
  `tarball (the tarball URL of the latest version from ` +
  `versions[latest].dist.tarball).`;

const TOOLS = [
  {
    name: "http_get",
    description: "Fetch a URL via HTTP GET and return the response body as text.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to fetch." },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
];

async function httpGetTool(url) {
  const res = await fetch(url, { method: "GET" });
  const text = await res.text();
  const capped = text.length > HTTP_GET_BODY_CAP ? text.slice(0, HTTP_GET_BODY_CAP) : text;
  return { status: res.status, body: capped, truncated: text.length > HTTP_GET_BODY_CAP };
}

async function callMessages(apiKey, messages) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    }),
  });
  const json = await res.json();
  if (!res.ok) {
    const msg = json?.error?.message ?? JSON.stringify(json);
    throw new Error(`Anthropic API error (${res.status}): ${msg}`);
  }
  return json;
}

/**
 * Extract a {version, license, tarball} object leniently from free-form
 * agent text: find the first `{...}` block and JSON.parse it. Returns
 * `{ parsed: null, parseError }` if nothing parses.
 */
function extractJsonObject(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    return { parsed: null, parseError: "no JSON object found in agent output" };
  }
  const candidate = text.slice(start, end + 1);
  try {
    const parsed = JSON.parse(candidate);
    return { parsed, parseError: null };
  } catch (err) {
    return { parsed: null, parseError: `JSON.parse failed: ${err.message}` };
  }
}

/**
 * Run one full tool-use loop for the npm-info task. Returns per-run
 * measurements: tokensIn/tokensOut (summed across every turn's usage
 * field), ms (wall clock for the whole loop), the final raw text output,
 * and the leniently-parsed {version, license, tarball} (or a parse error).
 */
export async function runAgentOnce(apiKey, { maxToolTurns = 5 } = {}) {
  const startedAt = Date.now();
  let tokensIn = 0;
  let tokensOut = 0;
  const messages = [{ role: "user", content: USER_PROMPT }];
  let finalText = "";
  let turns = 0;
  let error = null;

  try {
    for (;;) {
      turns++;
      if (turns > maxToolTurns + 1) {
        throw new Error(`exceeded maxToolTurns (${maxToolTurns}) without an end_turn`);
      }

      const response = await callMessages(apiKey, messages);
      tokensIn += response.usage?.input_tokens ?? 0;
      tokensOut += response.usage?.output_tokens ?? 0;

      messages.push({ role: "assistant", content: response.content });

      if (response.stop_reason === "tool_use") {
        const toolResults = [];
        for (const block of response.content) {
          if (block.type !== "tool_use") continue;
          if (block.name !== "http_get") {
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: `Unknown tool: ${block.name}`,
              is_error: true,
            });
            continue;
          }
          try {
            const result = await httpGetTool(block.input.url);
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: JSON.stringify(result),
            });
          } catch (err) {
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: `http_get failed: ${err.message}`,
              is_error: true,
            });
          }
        }
        messages.push({ role: "user", content: toolResults });
        continue;
      }

      // end_turn (or any other terminal stop reason) — collect text and stop.
      finalText = response.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      break;
    }
  } catch (err) {
    error = err.message;
  }

  const ms = Date.now() - startedAt;
  const { parsed, parseError } = error ? { parsed: null, parseError: null } : extractJsonObject(finalText);
  const costUsd =
    (tokensIn / 1_000_000) * INPUT_PRICE_PER_MTOK + (tokensOut / 1_000_000) * OUTPUT_PRICE_PER_MTOK;

  return {
    tokensIn,
    tokensOut,
    ms,
    finalText,
    parsed,
    parseError: error ? `run error: ${error}` : parseError,
    costUsd,
    error,
  };
}

// Allow standalone invocation for manual smoke testing:
//   node agent-arm.mjs
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const apiKey = await getAnthropicApiKey();
  const result = await runAgentOnce(apiKey);
  console.log(JSON.stringify(result, null, 2));
}
