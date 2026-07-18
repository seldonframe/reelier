// Task 2 — Arm A: agent WITHOUT Reelier, for the variance-surfacing
// benchmark (npm registry versions/aggregation task). Structurally the same
// loop as agent-arm.mjs (task 1): one http_get tool, one Anthropic Messages
// API tool-use loop, raw fetch, zero deps. Reuses agent-arm.mjs's model +
// pricing constants and REGISTRY_URL so both tasks report against the same
// model/pricing basis. The system/user prompt and output schema differ
// because this task asks the agent to COUNT and ENUMERATE, not just copy
// three scalar fields — that's the deliberate variance surface (see the
// task brief: total_versions/prerelease_count are a reasoning step,
// all_versions is a long list an agent may truncate/reorder/drop entries
// from).

import { pathToFileURL } from "node:url";
import { getAnthropicApiKey } from "./env.mjs";
import { MODEL, INPUT_PRICE_PER_MTOK, OUTPUT_PRICE_PER_MTOK, REGISTRY_URL } from "./agent-arm.mjs";

export { MODEL, INPUT_PRICE_PER_MTOK, OUTPUT_PRICE_PER_MTOK, REGISTRY_URL };

const HTTP_GET_BODY_CAP = 50_000;

const SYSTEM_PROMPT =
  "You are a tool-using agent. You have one tool, http_get, which fetches " +
  "a URL and returns its response body as text. Use http_get to fetch the " +
  "URL the user gives you, then read the JSON response and return ONLY a " +
  "JSON object with exactly these keys: latest (string, the value of " +
  "dist-tags.latest), total_versions (number, the count of keys in the " +
  "versions object), prerelease_count (number, count of published " +
  "versions whose version string contains a hyphen, e.g. -beta or -rc), " +
  "all_versions (array of strings, EVERY published version string found " +
  "as a key in the versions object — do not omit or summarize any, do " +
  "not write '...and N more', list every single one). Return ONLY the " +
  "JSON object — no prose, no markdown code fences, no explanation.";

const USER_PROMPT =
  `Fetch npm registry metadata for @seldonframe/reelier from ${REGISTRY_URL}. ` +
  `Return ONLY JSON: {latest: string, total_versions: number, ` +
  `prerelease_count: number (count of published versions whose string ` +
  `contains a hyphen, e.g. -beta/-rc), all_versions: string[] (every ` +
  `published version string)}.`;

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
      // Higher cap than task 1: the response includes a full array of
      // version strings, not just 3 scalars.
      max_tokens: 2048,
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
 * Extract a JSON object leniently from free-form agent text: find the
 * first `{...}` block and JSON.parse it. Returns `{ parsed: null,
 * parseError }` if nothing parses.
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
 * Run one full tool-use loop for the npm-versions task. Returns per-run
 * measurements: tokensIn/tokensOut (summed across every turn's usage
 * field), ms (wall clock for the whole loop), the final raw text output,
 * and the leniently-parsed {latest, total_versions, prerelease_count,
 * all_versions} (or a parse error).
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
//   node task2-agent-arm.mjs
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const apiKey = await getAnthropicApiKey();
  const result = await runAgentOnce(apiKey);
  console.log(JSON.stringify(result, null, 2));
}
