// BYOK LLM client. Zero deps beyond Node's native fetch. Two wire adapters
// chosen by the resolved baseUrl's host: native Anthropic Messages API for
// api.anthropic.com, OpenAI-compatible chat-completions for everything else
// (OpenRouter, Ollama, Gemini's OpenAI-compat endpoint, Groq, vLLM, ... —
// this is the "almost any LLM" story: point --llm-base-url at any
// OpenAI-compatible endpoint and it works). The model never writes files or
// takes actions directly — completeJson only ever returns parsed JSON to the
// caller, which applies it deterministically (see src/escalate.ts).

export interface LlmCallInput {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmCallResult {
  json: unknown;
  usage: LlmUsage;
}

export interface LlmClient {
  completeJson(input: LlmCallInput): Promise<LlmCallResult>;
}

export interface LlmConfig {
  baseUrl: string;
  apiKey?: string;
  /** Default model for Level 1 (cheap) escalations. */
  model: string;
  /** Default model for Level 2 (re-derivation) escalations. */
  l2Model: string;
}

export interface LlmConfigFlags {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  l2Model?: string;
}

const DEFAULT_BASE_URL = "https://api.anthropic.com";
const DEFAULT_L1_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_L2_MODEL = "claude-sonnet-5";

function isAnthropicHost(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).host === "api.anthropic.com";
  } catch {
    return false;
  }
}

/** Resolve BYOK config: explicit flags > env vars > defaults. Does not require or validate the API key — that's deferred to first actual use, so a --max-level run that never diverges never needs a key. */
export function resolveLlmConfig(flags: LlmConfigFlags = {}): LlmConfig {
  const baseUrl = flags.baseUrl ?? process.env.REELIER_LLM_BASE_URL ?? DEFAULT_BASE_URL;
  const apiKey =
    flags.apiKey ??
    process.env.REELIER_LLM_API_KEY ??
    (isAnthropicHost(baseUrl) ? process.env.ANTHROPIC_API_KEY : undefined);
  const model = flags.model ?? process.env.REELIER_LLM_MODEL ?? DEFAULT_L1_MODEL;
  const l2Model = flags.l2Model ?? process.env.REELIER_LLM_L2_MODEL ?? DEFAULT_L2_MODEL;
  return { baseUrl, apiKey, model, l2Model };
}

function missingKeyError(): Error {
  return new Error(
    "Missing LLM API key. Set REELIER_LLM_API_KEY (or ANTHROPIC_API_KEY when using the default " +
      "api.anthropic.com base URL), or pass --llm-api-key. This is only needed when a step actually " +
      "diverges and --max-level >= 1 triggers an escalation — BYOK spend is opt-in."
  );
}

/** Scan `text` for the first balanced top-level JSON object/array, ignoring braces inside strings. */
function extractFirstJson(text: string): string | undefined {
  const openers = "{[";
  const closers = "}]";
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    if (openers.includes(text[i])) {
      start = i;
      break;
    }
  }
  if (start === -1) return undefined;

  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (openers.includes(ch)) {
      stack.push(ch === "{" ? "}" : "]");
    } else if (closers.includes(ch)) {
      const expected = stack.pop();
      if (expected !== ch) return undefined; // malformed nesting
      if (stack.length === 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
}

async function callAnthropic(
  cfg: LlmConfig,
  input: LlmCallInput
): Promise<{ text: string; usage: LlmUsage }> {
  const url = `${cfg.baseUrl.replace(/\/$/, "")}/v1/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": cfg.apiKey ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: input.model,
      max_tokens: input.maxTokens,
      system: input.system,
      messages: [{ role: "user", content: input.user }],
    }),
  });
  const bodyText = await res.text();
  if (!res.ok) {
    const hint =
      res.status === 400
        ? " (HTTP 400 from Anthropic often means the account is out of credits — check your API console, this is a known gotcha, not necessarily a bad request)"
        : "";
    throw new Error(`Anthropic API request failed: HTTP ${res.status}${hint}: ${bodyText.slice(0, 500)}`);
  }
  let parsed: {
    content?: { type: string; text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  try {
    parsed = JSON.parse(bodyText);
  } catch (err) {
    throw new Error(`Anthropic API returned non-JSON response: ${(err as Error).message}`);
  }
  const text = (parsed.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
  return {
    text,
    usage: {
      inputTokens: parsed.usage?.input_tokens ?? 0,
      outputTokens: parsed.usage?.output_tokens ?? 0,
    },
  };
}

async function callOpenAiCompatible(
  cfg: LlmConfig,
  input: LlmCallInput
): Promise<{ text: string; usage: LlmUsage }> {
  const url = `${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: input.model,
      max_tokens: input.maxTokens,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ],
    }),
  });
  const bodyText = await res.text();
  if (!res.ok) {
    throw new Error(`LLM API request to ${url} failed: HTTP ${res.status}: ${bodyText.slice(0, 500)}`);
  }
  let parsed: {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  try {
    parsed = JSON.parse(bodyText);
  } catch (err) {
    throw new Error(`LLM API returned non-JSON response: ${(err as Error).message}`);
  }
  const text = parsed.choices?.[0]?.message?.content ?? "";
  return {
    text,
    usage: {
      inputTokens: parsed.usage?.prompt_tokens ?? 0,
      outputTokens: parsed.usage?.completion_tokens ?? 0,
    },
  };
}

/** Build a real (network-calling) LlmClient from resolved config. Constructing this does not itself make a network call — the key is only required, and only checked, at the first completeJson call. */
export function createLlmClient(cfg: LlmConfig): LlmClient {
  const call = isAnthropicHost(cfg.baseUrl) ? callAnthropic : callOpenAiCompatible;

  async function attempt(input: LlmCallInput): Promise<{ text: string; usage: LlmUsage }> {
    if (!cfg.apiKey) throw missingKeyError();
    return call(cfg, input);
  }

  return {
    async completeJson(input: LlmCallInput): Promise<LlmCallResult> {
      const first = await attempt(input);
      const firstJsonText = extractFirstJson(first.text);
      if (firstJsonText !== undefined) {
        try {
          return { json: JSON.parse(firstJsonText), usage: first.usage };
        } catch {
          // fall through to retry
        }
      }

      // One retry with a "return only JSON" nudge.
      const retry = await attempt({
        ...input,
        user: `${input.user}\n\nYour previous reply did not parse as a single JSON object. Return ONLY a raw JSON object — no prose, no markdown code fences.`,
      });
      const retryJsonText = extractFirstJson(retry.text);
      const usage: LlmUsage = {
        inputTokens: first.usage.inputTokens + retry.usage.inputTokens,
        outputTokens: first.usage.outputTokens + retry.usage.outputTokens,
      };
      if (retryJsonText !== undefined) {
        try {
          return { json: JSON.parse(retryJsonText), usage };
        } catch {
          // fall through to throw
        }
      }
      throw new Error(
        `LLM did not return parseable JSON after one retry. Last response: ${retry.text.slice(0, 500)}`
      );
    },
  };
}
