import { test } from "node:test";
import assert from "node:assert/strict";
import { createLlmClient, resolveLlmConfig } from "../src/llm.js";

test("resolveLlmConfig: flags override env, env overrides defaults", () => {
  const savedBaseUrl = process.env.REELIER_LLM_BASE_URL;
  const savedApiKey = process.env.REELIER_LLM_API_KEY;
  const savedModel = process.env.REELIER_LLM_MODEL;
  try {
    delete process.env.REELIER_LLM_BASE_URL;
    delete process.env.REELIER_LLM_API_KEY;
    delete process.env.REELIER_LLM_MODEL;

    const defaults = resolveLlmConfig();
    assert.equal(defaults.baseUrl, "https://api.anthropic.com");
    assert.equal(defaults.model, "claude-haiku-4-5-20251001");
    assert.equal(defaults.l2Model, "claude-sonnet-5");

    process.env.REELIER_LLM_BASE_URL = "https://openrouter.ai/api/v1";
    process.env.REELIER_LLM_MODEL = "env-model";
    const fromEnv = resolveLlmConfig();
    assert.equal(fromEnv.baseUrl, "https://openrouter.ai/api/v1");
    assert.equal(fromEnv.model, "env-model");

    const fromFlags = resolveLlmConfig({ baseUrl: "https://flag.example/v1", model: "flag-model" });
    assert.equal(fromFlags.baseUrl, "https://flag.example/v1");
    assert.equal(fromFlags.model, "flag-model");
  } finally {
    if (savedBaseUrl === undefined) delete process.env.REELIER_LLM_BASE_URL;
    else process.env.REELIER_LLM_BASE_URL = savedBaseUrl;
    if (savedApiKey === undefined) delete process.env.REELIER_LLM_API_KEY;
    else process.env.REELIER_LLM_API_KEY = savedApiKey;
    if (savedModel === undefined) delete process.env.REELIER_LLM_MODEL;
    else process.env.REELIER_LLM_MODEL = savedModel;
  }
});

test("resolveLlmConfig: ANTHROPIC_API_KEY is only used as a fallback when the baseUrl is api.anthropic.com", () => {
  const savedAnthropic = process.env.ANTHROPIC_API_KEY;
  const savedReelier = process.env.REELIER_LLM_API_KEY;
  try {
    delete process.env.REELIER_LLM_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";

    const anthropicDefault = resolveLlmConfig();
    assert.equal(anthropicDefault.apiKey, "sk-ant-test-key");

    const otherHost = resolveLlmConfig({ baseUrl: "https://openrouter.ai/api/v1" });
    assert.equal(otherHost.apiKey, undefined);
  } finally {
    if (savedAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = savedAnthropic;
    if (savedReelier === undefined) delete process.env.REELIER_LLM_API_KEY;
    else process.env.REELIER_LLM_API_KEY = savedReelier;
  }
});

test("createLlmClient: missing API key throws an actionable error before ever calling fetch", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    throw new Error("should never be reached");
  }) as typeof fetch;

  try {
    const client = createLlmClient({ baseUrl: "https://api.anthropic.com", apiKey: undefined, model: "m", l2Model: "m2" });
    await assert.rejects(
      client.completeJson({ model: "m", system: "s", user: "u", maxTokens: 10 }),
      /Missing LLM API key/
    );
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
