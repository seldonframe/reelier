# Wave 3 — bump-safety outreach (Category C)

_2026-07-24. Companion to [wave 1](./2026-07-23-design-partner-outreach.md) (10 contacted) and [wave 2](./2026-07-23-outreach-wave-2-leads.md) (50 leads, first 10 messaged). Every issue number, star count, and quote below was fetched from the GitHub API on this date. Tone bar: the Fedimint #8792 message, not the wave-1 openers._

## Why this wave exists

Waves 1 and 2 sell **manifest/schema drift** (MCP authors) and **agent-workflow regression** (agents in CI). Neither sells what we now ship: `reelier-bump-check.yml`, the Marketplace action, and the landing H1 all sell **"a dependency bump silently changed what your agent does."** Nobody in the previous sheets was selected for that.

Note that `dependabot.yml` is **not** a qualifier — 25/25 of wave-2's Category A repos have one (verified 2026-07-24). The qualifier is: **a version bump demonstrably changed agent behavior without throwing.**

## The finding that shapes every message below

Searched exhaustively (`dependabot broke agent`, `dependabot bump broke llm`, and variants):

> **No public issue attributes an agent behavior change to Dependabot by name.**

The pain is everywhere. The attribution is nowhere. Nobody connects the bump to the drift, because nothing records the behavior on either side of it.

**Two consequences, both binding:**

1. **Never claim a "Dependabot broke it" smoking gun exists.** It doesn't, and being caught inventing one costs more than the wedge is worth.
2. **Do not use our vocabulary in outreach.** Nobody says "dependency bump." They say *"after upgrading from 0.165.1 to 0.177.0"*, *"regression in 1.9.3"*, *"broken after upgrading langchain 0.4 → 1.x"*. Lead with **their** phrasing. Save "bump-safety" for our own pages.

This is also the honest read on the market: it's a problem people **suffer** but have not yet **named**. That is a harder sell than a named problem — and a much better position if we're the ones who name it.

## Targeting principle: frameworks, not victims

The reporters in these threads are victims — they want their bug fixed, not a CI tool. The **framework maintainers** are the buyers: they ship the silent regressions, they own the CI, and their adoption is a credibility signal to every downstream user.

So: message maintainers, using evidence from **their own tracker**.

## The targets (pain verified 2026-07-24)

| # | Repo | ★ | The evidence (their own issues) | Why the check helps them specifically |
|---|------|---|--------------------------------|----------------------------------------|
| 1 | [crewAIInc/crewAI](https://github.com/crewAIInc/crewAI) | 56.1k | [#3462](https://github.com/crewAIInc/crewAI/issues/3462) tools fire **twice** after 0.165.1→0.177.0 (closed *not planned* — unreproducible) · [#4495](https://github.com/crewAIInc/crewAI/issues/4495) 1.6.1→1.9.3 drops tool args → infinite retry loop (30 comments) | Two silent regressions across minor bumps, one unreproducible. A recorded call-sequence turns both into a diff. |
| 2 | [agno-agi/agno](https://github.com/agno-agi/agno) | 41.4k | [#3534](https://github.com/agno-agi/agno/issues/3534) 1.6.0: duplicate streamed content, inconsistent `run_id`, tool renamed `aforward_task_to_member`→`forward_task_to_member` (20c) · [#3493](https://github.com/agno-agi/agno/issues/3493) patch 1.5.4→1.5.8 broke nested-model schema gen | A **rename** in a minor and a schema break in a *patch*. Both kept running. |
| 3 | [huggingface/smolagents](https://github.com/huggingface/smolagents) | 28.5k | [#1885](https://github.com/huggingface/smolagents/issues/1885) 1.17.0→1.23.0: 10–15s → **150s every run**, output lost its `final_answer()` wrapper, agent now hits `max_steps`. **1 comment, effectively unanswered** | Three behavior changes in one minor, no error. Unanswered = a reply is likely. |
| 4 | [pydantic/pydantic-ai](https://github.com/pydantic/pydantic-ai) | 18.8k | [#2504](https://github.com/pydantic/pydantic-ai/issues/2504) **openai 1.99.1→1.99.2 (a PATCH)** changed tool type mappings → `TypeError` only on replayed history · [#5273](https://github.com/pydantic/pydantic-ai/issues/5273) `model=` string **silently resets** provider auth | The single best "auto-merged patch" artifact in the set. First request passes, later ones die. |
| 5 | [langchain-ai/langchainjs](https://github.com/langchain-ai/langchainjs) | 18.0k | [#9450](https://github.com/langchain-ai/langchainjs/issues/9450) 0.4→1.x: tool args arrive **stringified**, calls land in `invalid_tool_calls` as "Malformed args" — no exception (13c, fixed in #9544) | Failure mode is a silent bucket-swap, invisible to tests that assert no throw. |
| 6 | [vercel/ai](https://github.com/vercel/ai) | 25.8k | [#10977](https://github.com/vercel/ai/issues/10977) 4.3.19→5.0.95: no final assistant message after a tool call; stream just ends `[DONE]`. Reporter **couldn't tell which of 3 packages** caused it (closed *not planned*) | "Which package did this" is precisely what a per-step diff answers. |
| 7 | [assistant-ui/assistant-ui](https://github.com/assistant-ui/assistant-ui) | 11.2k | [#2336](https://github.com/assistant-ui/assistant-ui/issues/2336) after AI SDK v5, frontend tools stop counting as tool calls → `stopWhen` never increments | Loop-termination silently wrong — worst possible class, unbounded cost. |
| 8 | [openai/openai-node](https://github.com/openai/openai-node) | 11.1k | [#1840](https://github.com/openai/openai-node/issues/1840) a `chore: codegen related update` (`583240f`, v6.34.0) removed the 60s `Retry-After` cap → an agent that backed off ~8s can now **sleep an hour**. **OPEN, 0 comments**, not in the changelog | Cleanest artifact that exists: a chore-level commit changing runtime behavior, no changelog, no test. |

**Handle with care:** #8 is an OpenAI-owned repo and the issue has no replies — a substantive technical comment is welcome there, a tool pitch is not. Lead with the retry-semantics analysis; mention nothing else unless asked.

## Tier 0 — repos that bump agent SDKs on a schedule (the true ICP)

The targets above are frameworks that *shipped* silent regressions. These are repos that **bump agent SDKs on a cadence and cannot verify the result** — the exact buyer for `reelier-bump-check.yml`. All three criteria verified 2026-07-24 (agent SDK in deps · bump automation configured · observable pain).

| # | Repo | ★ | Why it's the ICP |
|---|------|---|------------------|
| 0 | **[preset-io/agor](https://github.com/preset-io/agor)** | 1.3k | **The warmest lead in the entire corpus.** `.github/dependabot.yml` has a group literally named **`agent-sdks`** matching `@anthropic-ai/* @openai/* @google/* @modelcontextprotocol/* @opencode-ai/*`, weekly. `dependabot[bot]` is the **#3 contributor (57 commits)**. [PR #1952](https://github.com/preset-io/agor/pull/1952) — a 5-SDK batch incl. `@google/gemini-cli-core` **0.31.0 → 0.52.0** — **has been open and `blocked` since 2026-07-17**. Prior proof it bites: [PR #1264](https://github.com/preset-io/agor/pull/1264), a codex-sdk bump surfaced that they were reading lifetime cumulative tokens as current context occupancy (context% pinned >100%). |
| 0b | **[github/github-mcp-server](https://github.com/github/github-mcp-server)** | 31.7k | **They already built half of this.** `mcp-diff.yml` pins `SamMorrowDrums/mcp-server-diff@v3.0.0` with an inline comment about keeping *"the go-sdk v1.6.1 → v1.7.0-pre.1 bump an honest, signal-only diff."* But it diffs **declared schemas**, not observed behavior — and [#1877](https://github.com/github/github-mcp-server/issues/1877)/[PR #2417](https://github.com/github/github-mcp-server/pull/2417) (the `inputs` param silently stripped under OpenAI strict mode) is exactly the bug a schema diff catches late and a replay catches immediately. |
| 0c | **[adamjmurray/producer-pal](https://github.com/adamjmurray/producer-pal)** | 228 | Solo maintainer. Dependabot groups named **`ai-libraries`** and **`anthropic`**, landing **2–8 SDKs per weekly PR** (#1004, #997, #983, #951, #946, #936, #917, #907…). Sets `cooldown: semver-major 30 days` — an explicit written admission he cannot verify fresh bumps. The agent drives Ableton Live, so drift is audible. |
| 0d | **[d-morrison/gha](https://github.com/d-morrison/gha)** | 0 | **They wrote our spec themselves.** [Issue #152](https://github.com/d-morrison/gha/issues/152): their `claude.yml` hardcodes a mirror of `claude-code-action`'s internal `SENSITIVE_PATHS`, and the ask is to fetch it at the pinned SHA on every bump and *fail the job* if the sets diverge. They were doing it by hand. Tiny repo, but it's central reusable CI for `d-morrison`/`UCD-SERG`/`ucdavis`. |
| 0e | [Arize-ai/openinference](https://github.com/Arize-ai/openinference) | 1.1k | Monkey-patches `anthropic`/`openai`/`langchain` clients, so bumps break spans with **zero type-level signal**. Their `dependabot.yml` sets `ignore: '*'` for all major/minor/patch — they **turned normal bumps off** because they can't verify them. [#3397](https://github.com/Arize-ai/openinference/issues/3397) open. |
| 0f | [kesslerio/attio-mcp-server](https://github.com/kesslerio/attio-mcp-server) | 69 | 34 of last 100 PRs are dependabot. Hand-rolls e2e contract assertions that keep rotting: [#857](https://github.com/kesslerio/attio-mcp-server/issues/857)/[PR #860](https://github.com/kesslerio/attio-mcp-server/pull/860) "regressions caused by Attio workspace drift". |

**Partnership, not a lead: [SamMorrowDrums/mcp-server-diff](https://github.com/SamMorrowDrums/mcp-server-diff)** (9★) — "a reusable workflow for testing MCP server conformance between versions." He built the **static** half of this product and is also the top human contributor to `github/github-mcp-server`. Approach as a complement, never as a competing pitch. Highest-intent single human found.

### Corrections to the table above
- **pydantic/pydantic-ai** has `dependabot.yml` but **0 bot PRs in the last 100** — criterion 2 is nominal. The #2504 story still stands (it's about a dep *they consume*), but don't frame the ask as "add this to your Dependabot flow."
- **cloudflare/mcp-server-cloudflare** has the best raw pain found ([#378](https://github.com/cloudflare/mcp-server-cloudflare/issues/378), [#391](https://github.com/cloudflare/mcp-server-cloudflare/issues/391) — optional params emit `{"not":{}}`, breaking strict function-calling on Kimi/Gemini/OpenAI) but has **no bump automation at all**. Different conversation; don't force this wedge.
- Verified **no bump automation**: `microsoft/playwright-mcp`, `GLips/Figma-Context-MCP`, `sooperset/mcp-atlassian`, `browserbase/mcp-server-browserbase` — note `mcp-atlassian` is a wave-2 target, so that pitch needs adjusting.

## Message drafts

Rules (unchanged from wave 1): **one message, zero follow-ups, disclose that we maintain reelier, offer the PR, invite "feel free to close."** Every message must be useful to them even if they never install anything — if you delete the reelier paragraph and the message still has value, it passes. If it collapses, rewrite it.

---

### 0. preset-io/agor — comment in [PR #1952](https://github.com/preset-io/agor/pull/1952) — **SEND THIS FIRST**

_The bump is open and blocked right now. This is the only message in the corpus where we arrive while the pain is live. Time-sensitive: worthless once they merge it._

> This PR is a decent illustration of a gap that doesn't have a good answer yet: five agent SDKs moving at once — `@google/gemini-cli-core` alone going 0.31.0 → 0.52.0 — and no cheap way to show that agor still drives Codex, Claude and Gemini the way it did last week.
>
> Type-checks and unit tests will tell you it compiles. They won't tell you whether an orchestrated session still issues the same sequence of tool calls with the same arguments. #1264 is the version of this that already bit you: the codex-sdk bump surfaced that `total_token_usage.total_tokens` was lifetime-cumulative rather than current occupancy — and the symptom was a number being wrong, not anything failing.
>
> One approach that needs no new trust: record one orchestrated session against the current lockfile as an ordered list of tool calls + arguments, then replay that recording on the bump branch and diff it. No model spend, deterministic, and the failure is legible — "step 7 called `X` with `{…}`, now calls it with `{…}`."
>
> For a *grouped* bump that's also how you bisect: replay once per SDK to find which of the five actually moved the behavior, instead of ungrouping the PR and re-running everything by hand.
>
> Disclosure: I maintain an open-source tool that does this ([reelier](https://github.com/seldonframe/reelier), MIT). Glad to open a PR wiring it to one agor session so #1952 has a concrete before/after you can judge on the merits. Equally fine if you'd rather take the record-and-replay idea and build it in-house — it's a couple hundred lines if you only need your own shape. Happy to be ignored.

---

### 0b. github/github-mcp-server — comment on `mcp-diff.yml` (or a new issue)

_Handle with respect: they already built the static half, and `SamMorrowDrums` maintains both this and `mcp-server-diff`. Extend, never compete._

> The comment in `mcp-diff.yml` about keeping the go-sdk v1.6.1 → v1.7.0-pre.1 bump "an honest, signal-only diff" is exactly the right instinct, and I think there's a natural second half worth naming.
>
> A schema diff answers *"did the declared tool surface change."* #1877 / #2417 is the case where that isn't sufficient: `inputs` was silently stripped from `actions_run_trigger` under OpenAI strict mode, so the declared schema and the shape a strict client actually received had diverged. The tool list looked stable; what models could *do* with it wasn't.
>
> The complementary check is behavioral — record one client↔server session as an ordered list of tool calls and results, replay it against the bumped SDK, diff. That catches the layer a schema comparison structurally can't see: strict-mode coercions, dropped optional fields, changed error shapes, transport-level omissions.
>
> Disclosure: I maintain [reelier](https://github.com/seldonframe/reelier) (MIT), which does the replay half. To be clear about ordering, the static diff is the cheaper gate and should stay first — this is a complement to `mcp-server-diff`, not a replacement for it. Happy to open a PR adding a replay step so you can see whether it earns its runtime; if it doesn't, close it.

---

### 0c. adamjmurray/producer-pal — new issue

> The `cooldown: semver-major 30 days` on the `anthropic` and `ai-libraries` groups is a nicely honest piece of config — it's a *waiting period standing in for a check*, because there isn't a cheap way to prove an 8-SDK batch didn't change how the agent drives Live.
>
> The awkward part of that trade is that time doesn't actually verify anything. If `@ai-sdk/*` changes how tool arguments are serialized, waiting 30 days means you find out 30 days later, from a session where the wrong clip got modified.
>
> Something that would give you a real gate cheaply: record one representative session — create a clip, set notes, read state back — as an ordered list of tool calls with arguments, and replay it on each weekly bump PR. It runs without a model (so it costs nothing per run and can't itself drift), and it fails on a diff rather than on an exception, which is the failure mode that actually bites here.
>
> Disclosure: I maintain [reelier](https://github.com/seldonframe/reelier) (MIT) which does this, and I'd genuinely enjoy wiring it up for a Live-controlling agent — happy to open the PR so you can look at a diff rather than a README. If it's not useful, close it; the cooldown config was a reasonable call either way.

---

### 0d. d-morrison/gha — comment in [#152](https://github.com/d-morrison/gha/issues/152)

_They specified this themselves. Shortest message in the set — they don't need convincing, only generalizing._

> You've written the spec for a general problem here. #152 is "fetch `restore-config.ts` at the pinned SHA on every bump and fail if `SENSITIVE_PATHS` diverged from our mirror" — a bump-safety check where the compared artifact happens to be one constant.
>
> The generalization worth considering: the thing that drifts under an action bump usually isn't only a constant, it's what the workflow *does* — which files it touches, which tools it calls, in what order. Same check shape, wider artifact: record the workflow's actual behavior once, replay on each bump, fail on a diff.
>
> Disclosure: I maintain [reelier](https://github.com/seldonframe/reelier) (MIT) which does the general version. Your specific fix is smaller and probably worth doing regardless — I'd just note that once you've built the SHA-fetch machinery, the general check is nearly free. Happy to PR either. Feel free to close.

---

### 1. crewAIInc/crewAI — new issue

> Two closed regressions here have the same shape, and I think the shape is the interesting part:
>
> - **#3462** (0.165.1 → 0.177.0): every tool fires twice, milliseconds apart. Closed as not-planned because it couldn't be reproduced.
> - **#4495** (1.6.1 → 1.9.3): the custom `BaseTool` wrapper stops receiving `query`, and the framework retries the failing tool in a loop.
>
> Neither threw. Neither failed a test. Both were found by users after a version bump, and one is still unexplained.
>
> Two thoughts from working on this class of bug:
>
> **1. "Couldn't reproduce" is usually a recording problem, not a mystery.** What makes #3462 hard is that the evidence — the actual ordered sequence of tool calls with their arguments — is gone by the time someone writes the report. If a single known-good run were captured as an ordered call list, "tools fire twice" stops being a narrative and becomes a diff: 2n calls where the baseline had n. Same for #4495 — a missing `query` arg shows up as a changed argument on step k, not as a support thread.
>
> **2. The gap is a behavioral baseline, not more unit tests.** Unit tests assert that code doesn't throw. Both of these were regressions in *what the agent did* while everything kept returning successfully. That needs a recorded reference run you can replay and compare against, which is a different artifact from a test suite.
>
> Disclosure: I maintain an open-source tool that does exactly this ([reelier](https://github.com/seldonframe/reelier), MIT) — it records one agent run's tool calls into a file, replays it deterministically with no model calls, and diffs the calls step by step, so a bump that changes the sequence fails CI instead of reaching users. It would have caught #3462 as a step-count diff.
>
> Happy to open the PR wiring it to one crew as a proof, if that's welcome — and equally happy if you'd rather just take idea #1 and build it yourselves. If neither is useful, close freely.

---

### 2. huggingface/smolagents — comment in [#1885](https://github.com/huggingface/smolagents/issues/1885)

_(Warmest target: unanswered, and the reporter is stuck.)_

> This report has three distinct behavior changes bundled into one version bump, and separating them will probably make it tractable:
>
> 1. runtime 10–15s → ~150s on *every* run (the caching benefit disappeared),
> 2. the output lost its `final_answer()` wrapper,
> 3. the agent now reaches `max_steps` where it used to terminate.
>
> (3) is very likely *caused* by (2) — if the terminal call's shape changed, the loop no longer recognizes the stop condition and just runs until the ceiling. That would also explain (1) entirely, without any caching regression: more steps, more calls, ~10x the wall time. Worth testing that theory first, since it collapses three symptoms into one root cause.
>
> A concrete way to confirm: capture the ordered list of tool calls for one task on 1.17.0 and the same task on 1.23.0, and compare step counts and the final step's shape. If 1.23.0 shows the same first n steps and then keeps going, it's the terminator, not the cache.
>
> Disclosure: I maintain an open-source tool for that comparison ([reelier](https://github.com/seldonframe/reelier), MIT) — records a run's tool calls, replays deterministically at zero model cost, diffs two runs step by step. But the diagnosis above stands on its own; you can do it with logging if you'd rather not add a dependency. Happy to help either way, and feel free to ignore this if you're already on it.

---

### 3. pydantic/pydantic-ai — new issue

> #2504 is, I think, the most under-appreciated failure mode in this space and worth writing down explicitly.
>
> `openai` **1.99.1 → 1.99.2** — a patch — changed tool type mappings, and the result is that replaying message history containing tool calls raises `TypeError: Cannot instantiate typing.Union`. The first request in a session succeeds; later ones die. So it passes a smoke test, passes CI, and fails in production on multi-turn conversations.
>
> That combination — patch version, no API change, breaks only on the second turn — is exactly what automated dependency updates merge without a human ever looking. #5273 (a `model=` string silently resetting provider auth) has the same property: no error, wrong behavior.
>
> The general point: for agent frameworks, the dependency contract isn't the type signature, it's the **runtime call sequence**. Nothing in a normal test suite pins that. A recorded multi-turn run replayed on every dependency PR would have caught #2504 on the second turn, which is where it actually breaks.
>
> Disclosure: I maintain [reelier](https://github.com/seldonframe/reelier) (MIT), which does that — records the tool-call sequence, replays it with no model calls, fails closed on a diff. Glad to open a PR adding it to one example agent so you can see the diff format on a real regression, or to leave you with just the multi-turn-replay idea, which matters more than the tool. Close freely if it's not a fit.

---

### 4. openai/openai-node — comment in [#1840](https://github.com/openai/openai-node/issues/1840)

_(Analysis only. No pitch — this is an OpenAI repo and the issue has no replies.)_

> Worth underlining how this one fails, because the blast radius is bigger than a retry tweak.
>
> Removing the 60s ceiling on `Retry-After` means the SDK now honors whatever the server sends. For an interactive client that's a long pause. For an **agent** it's worse: a tool call that used to back off ~8s can block for an hour inside a step, holding the loop, the context, and in hosted environments the billed runtime. Nothing errors — the agent is simply asleep, and any wall-clock timeout above it fires instead, producing a failure that looks nothing like a rate limit.
>
> Two things that would help downstream users regardless of whether the cap comes back:
>
> 1. a documented client-side `maxRetryDelay` (or equivalent) so callers can bound it explicitly rather than inheriting server behavior, and
> 2. a changelog line whenever codegen changes runtime timing — `chore: codegen related update` gives consumers no way to notice that a behavioral default moved.
>
> Happy to send a PR for either if that'd be welcome.

---

### 5. agno-agi/agno — new issue

> #3534 contains a detail that I think deserves its own conversation: in a **minor** release, `aforward_task_to_member` became `forward_task_to_member`.
>
> A renamed tool is a contract change for every agent holding the old name — and unlike a renamed function, nothing fails to compile. The model just stops being able to call it, then improvises around the gap. Combined with the other two symptoms in that issue (duplicate content across event types, inconsistent `run_id`), the release "worked" while producing different output.
>
> #3493 is the same story one notch quieter: a **patch** (1.5.4 → 1.5.8) made schema generation reject `Field(description=...)` on nested models.
>
> The structural fix is a snapshot of the agent-facing surface — tool names and their schemas — diffed on every release, so a rename fails CI as a contract break rather than being discovered by users. That's a small artifact to maintain and it makes renames safe rather than forbidden: you see the diff and decide.
>
> Disclosure: I maintain [reelier](https://github.com/seldonframe/reelier) (MIT), which snapshots that surface and also replays a recorded run to catch behavior changes the schema alone won't show. Happy to open the PR against one example team so you can see what the diff looks like — or to leave you with the snapshot idea, which you could implement in an afternoon without us. Feel free to close.

---

### 6. langchain-ai/langchainjs — comment in [#9450](https://github.com/langchain-ai/langchainjs/issues/9450)

> Now that #9544 has fixed this, the failure mode seems worth a regression test of an unusual kind — because the reason it was painful wasn't the bug, it was the **silence**.
>
> Tool args arriving stringified didn't throw. The calls were quietly re-bucketed into `invalid_tool_calls` as "Malformed args," so from the outside the agent simply stopped using its tools and started improvising. Any test asserting "no exception" passes; any test asserting "the model called `search` with `{query: ...}`" fails immediately.
>
> Concretely: a test that asserts `tool_calls.length > 0 && invalid_tool_calls.length === 0` on a fixed fixture would have caught the 0.4 → 1.x change at the boundary. That's cheap and doesn't need model access if the provider response is recorded.
>
> Disclosure: I maintain [reelier](https://github.com/seldonframe/reelier) (MIT) which generalizes this — record a run's tool calls once, replay with zero model calls, diff step by step — but the one-line assertion above is most of the value and costs you nothing. Happy to PR either version. Close freely if you've already covered it.

---

## What to send first

1. **agor PR #1952 — today.** The only message here that lands while the pain is live and open. It expires the moment they merge; every day of delay is decay. Nothing else in the corpus has this property.
2. **smolagents #1885** — unanswered, reporter is stuck, and the diagnosis is useful whether or not they ever install anything. Highest reply probability, lowest spam risk.
3. **d-morrison #152** — they wrote the spec themselves; the message is short and needs no persuasion.
4. **producer-pal** — solo maintainer, warm, small enough that a real conversation is likely.

Then reassess before touching the big repos (github-mcp-server, crewAI, pydantic-ai). **Do not send them all the same day.** If the first four get no reply, the problem is the message — sending six more just burns the targets, and these are not replenishable.

Separately and not as outreach: **`SamMorrowDrums`** is worth a genuine conversation about `mcp-server-diff`. He independently built the static half of this thesis and maintains `github/github-mcp-server`. That's a peer conversation about a complementary tool, and it should not be run out of this sheet's template.

## Risk to keep in view

Commenting on other projects' issue trackers to surface a tool is one drive-by away from reading as spam, and the reputational cost lands on reelier permanently. The tests each message must pass:

- Delete the reelier paragraph. Does the message still help them? If no, don't send it.
- Would this be a good comment if we sold nothing?
- One message. No follow-up. Ever.
