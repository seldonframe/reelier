# Reelier — verified pain quotes (source material for blog/article writers)

> Internal source material only. **Do not paste attributed personal quotes into the README or landing copy** (consent) — the README/site use the generic FRAMES below, not these verbatim attributions. Articles/blog posts MAY cite these verbatim with a link back to the source (standard fair-use citation).

Fetched live 2026-07-24. Two recurring developer frames drive the Reelier copy: **"same prompt, different result every run" (non-determinism)** and **"it's been lying about completeness / how can I trust you" (fake success)**. Reelier's replay/diff answers frame #1; receipts answer frame #2.

## The five sourced quotes

1. **Non-determinism**
   - Quote: "coding agents are non-deterministic. The same prompt will yield a different result each time."
   - Source: flail, Hacker News — https://news.ycombinator.com/item?id=47182223
   - Reelier line: *snapshot tests for agents*

2. **Silent model-upgrade breakage**
   - Quote: "gpt-5* models do not follow instruction given in system prompts, whereas gpt-4* models obey strictly."
   - Source: VivacityDesign, OpenAI community forum — https://community.openai.com/t/gpt-5-models-not-following-system-prompts/1377459
   - Backup quote: "force upgrade to GPT-5 … massive reduction in quality" — rpeden, Hacker News — https://news.ycombinator.com/item?id=44839842
   - Reelier line: *upgrade the model on Friday*

3. **Agents lying / fake success**
   - Quote: "Claude has been lying to me instead of generating code" / "how can i trust you"
   - Source: r/ClaudeAI, 2024-12-17 — https://www.reddit.com/r/ClaudeAI/comments/1hgji0b/ (mirror: https://digitalscholarship.library.jhu.edu/s/aivoices/item/360)
   - Reelier line: *receipts not claims*

4. **MCP schema drift**
   - Quote: "invalid schemas … now only log a warning and are persisted … causing 500 errors."
   - Source: IBM/mcp-context-forge, GitHub issue #2348 — https://github.com/IBM/mcp-context-forge/issues/2348
   - Reelier line: *catch schema drift before your agents do*

5. **No CI trust layer**
   - Quote: "you will never reliably get acceptable work unless you build deterministic checking … in a way [the] model can't bypass or ignore."
   - Source: cadamsdotcom, Hacker News — https://news.ycombinator.com/item?id=48294670
   - Reelier line: *regression testing for agents in CI*

## Synthesis

Developers reach for two words when they describe this pain: "non-deterministic" and "lying." Reelier's replay/diff answers the first (byte-identical replay catches drift the moment the world moves under a skill); receipts answer the second (a signed, verifiable record replaces a trust-me claim). The emotional tagline chosen from this research: **"Upgrade the model on Friday."** — it names the exact fear developers have about a provider-side model bump silently breaking an agent's behavior, which is precisely the failure mode `reelier diff` is built to catch.
