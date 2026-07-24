# Wave 3, bump-safety outreach

_2026-07-24. Companion to [wave 1](./2026-07-23-design-partner-outreach.md) (10 contacted) and [wave 2](./2026-07-23-outreach-wave-2-leads.md) (50 leads, first 10 messaged). Every issue number and star count below was fetched from the GitHub API on this date._

_Voice rules for every message here: first person singular, no "we". Plain sentence case, no marketing capitals. No em dashes. No arrows, stars or checkmarks. Write it the way you'd actually type it into a GitHub comment box._

## why this wave exists

Waves 1 and 2 sell manifest/schema drift (MCP authors) and agent-workflow regression (agents in CI). Neither sells what we now ship. The Marketplace action, `reelier-bump-check.yml` and the new landing H1 all sell one thing: a dependency bump silently changed what your agent does. Nobody in the previous sheets was picked for that.

Note that having `dependabot.yml` is not a qualifier. 25 out of 25 of wave 2's Category A repos have one, verified 2026-07-24, so it discriminates nothing. The qualifier is a bump that changed behaviour without throwing.

## the finding that shapes every message

Searched exhaustively (`dependabot broke agent`, `dependabot bump broke llm`, and variants):

**No public issue anywhere attributes an agent behaviour change to Dependabot by name.**

The pain is everywhere. The attribution is nowhere. Nobody connects the bump to the drift, because nothing records behaviour on either side of it.

Two consequences, both binding:

1. Never claim a "Dependabot broke it" smoking gun exists. It doesn't, and getting caught inventing one costs more than the wedge is worth.
2. Never use our vocabulary in outreach. Nobody says "dependency bump". They say "after upgrading from 0.165.1 to 0.177.0", or "regression in 1.9.3", or "tool calling broke after upgrading langchain 0.4 to 1.x". Lead with their phrasing. Keep "bump-safety" on our own pages.

That is also the honest market read. This is a problem people suffer but have not named. Harder to sell than a named problem, and a much better position if we are the ones who name it.

## targeting principle: frameworks, not victims

The reporters in these threads are victims. They want their bug fixed, not a CI tool. The framework maintainers are the buyers: they ship the silent regressions, they own the CI, and their adoption is a signal to every downstream user.

So message maintainers, using evidence from their own tracker.

## tier 0, repos that bump agent SDKs on a schedule

These are the real ICP. Each one bumps agent SDKs on a cadence and cannot verify the result. All three criteria verified 2026-07-24: agent SDK in deps, bump automation configured, observable pain.

| repo | stars | why it's the ICP |
|------|-------|------------------|
| [preset-io/agor](https://github.com/preset-io/agor) | 1.3k | Warmest lead in the whole corpus. `.github/dependabot.yml` has a group literally named `agent-sdks` matching `@anthropic-ai/*`, `@openai/*`, `@google/*`, `@modelcontextprotocol/*`, `@opencode-ai/*`, weekly. `dependabot[bot]` is the number 3 contributor with 57 commits. [PR #1952](https://github.com/preset-io/agor/pull/1952), a 5 SDK batch including `@google/gemini-cli-core` 0.31.0 to 0.52.0, has been open and blocked since 2026-07-17. Prior proof it bites: [PR #1264](https://github.com/preset-io/agor/pull/1264). |
| [github/github-mcp-server](https://github.com/github/github-mcp-server) | 31.7k | They already built half of this. `mcp-diff.yml` pins `SamMorrowDrums/mcp-server-diff@v3.0.0` with an inline comment about keeping the go-sdk bump "an honest, signal-only diff". But it diffs declared schemas, not observed behaviour, and [#1877](https://github.com/github/github-mcp-server/issues/1877) / [PR #2417](https://github.com/github/github-mcp-server/pull/2417) (the `inputs` param silently stripped under OpenAI strict mode) is exactly what a schema diff catches late. |
| [adamjmurray/producer-pal](https://github.com/adamjmurray/producer-pal) | 228 | Solo maintainer. Dependabot groups named `ai-libraries` and `anthropic`, landing 2 to 8 SDKs per weekly PR (#1004, #997, #983, #951, #946, #936, #917, #907). Sets `cooldown: semver-major 30 days`, which is a written admission he cannot verify fresh bumps. The agent drives Ableton Live, so drift is audible. |
| [d-morrison/gha](https://github.com/d-morrison/gha) | 0 | They wrote our spec themselves. [Issue #152](https://github.com/d-morrison/gha/issues/152): their `claude.yml` hardcodes a mirror of `claude-code-action`'s internal `SENSITIVE_PATHS`, and the ask is to fetch it at the pinned SHA on every bump and fail the job if the sets diverge. They were doing it by hand. Tiny repo, but it is central reusable CI for `d-morrison`, `UCD-SERG` and `ucdavis`. |
| [Arize-ai/openinference](https://github.com/Arize-ai/openinference) | 1.1k | Monkey-patches `anthropic`, `openai` and `langchain` clients, so bumps break spans with zero type-level signal. Their `dependabot.yml` sets `ignore: '*'` for all major/minor/patch, meaning they turned normal bumps off because they cannot verify them. [#3397](https://github.com/Arize-ai/openinference/issues/3397) is open. |
| [kesslerio/attio-mcp-server](https://github.com/kesslerio/attio-mcp-server) | 69 | 34 of the last 100 PRs are dependabot. Hand-rolls e2e contract assertions that keep rotting: [#857](https://github.com/kesslerio/attio-mcp-server/issues/857) and [PR #860](https://github.com/kesslerio/attio-mcp-server/pull/860), "regressions caused by Attio workspace drift". |

Partnership, not a lead: [SamMorrowDrums/mcp-server-diff](https://github.com/SamMorrowDrums/mcp-server-diff), 9 stars, "a reusable workflow for testing MCP server conformance between versions". He built the static half of this thesis and is also the top human contributor to `github/github-mcp-server`. Approach as a peer with a complementary tool, never as a competing pitch.

## tier 1, frameworks that shipped silent regressions

| repo | stars | the evidence, from their own tracker |
|------|-------|--------------------------------------|
| [crewAIInc/crewAI](https://github.com/crewAIInc/crewAI) | 56.1k | [#3462](https://github.com/crewAIInc/crewAI/issues/3462) tools fire twice after 0.165.1 to 0.177.0, closed as not planned because it could not be reproduced. [#4495](https://github.com/crewAIInc/crewAI/issues/4495) 1.6.1 to 1.9.3 drops tool args, causing an infinite retry loop, 30 comments. |
| [agno-agi/agno](https://github.com/agno-agi/agno) | 41.4k | [#3534](https://github.com/agno-agi/agno/issues/3534) 1.6.0 duplicated streamed content, inconsistent `run_id`, and renamed a tool from `aforward_task_to_member` to `forward_task_to_member`. [#3493](https://github.com/agno-agi/agno/issues/3493) a patch, 1.5.4 to 1.5.8, broke nested-model schema generation. |
| [huggingface/smolagents](https://github.com/huggingface/smolagents) | 28.5k | [#1885](https://github.com/huggingface/smolagents/issues/1885) 1.17.0 to 1.23.0 took runs from 10 to 15s up to 150s every time, lost the `final_answer()` wrapper, and the agent now hits `max_steps`. One comment, effectively unanswered. |
| [pydantic/pydantic-ai](https://github.com/pydantic/pydantic-ai) | 18.8k | [#2504](https://github.com/pydantic/pydantic-ai/issues/2504) openai 1.99.1 to 1.99.2, a patch, changed tool type mappings so replayed history raises `TypeError`. [#5273](https://github.com/pydantic/pydantic-ai/issues/5273) a `model=` string silently resets provider auth. |
| [langchain-ai/langchainjs](https://github.com/langchain-ai/langchainjs) | 18.0k | [#9450](https://github.com/langchain-ai/langchainjs/issues/9450) 0.4 to 1.x, tool args arrive stringified and calls land in `invalid_tool_calls` as "Malformed args", with no exception. |
| [vercel/ai](https://github.com/vercel/ai) | 25.8k | [#10977](https://github.com/vercel/ai/issues/10977) 4.3.19 to 5.0.95, no final assistant message after a tool call. The reporter could not tell which of 3 packages caused it. |
| [assistant-ui/assistant-ui](https://github.com/assistant-ui/assistant-ui) | 11.2k | [#2336](https://github.com/assistant-ui/assistant-ui/issues/2336) after the AI SDK v5 bump, frontend tools stop counting as tool calls so `stopWhen` never increments. |
| [openai/openai-node](https://github.com/openai/openai-node) | 11.1k | [#1840](https://github.com/openai/openai-node/issues/1840) a `chore: codegen related update` removed the 60s `Retry-After` cap, so an agent that backed off 8s can now sleep an hour. Open, zero comments, not in the changelog. |

### corrections to prior sheets

- pydantic-ai has `dependabot.yml` but zero bot PRs in its last 100, so criterion 2 is nominal only. The #2504 story still stands because it is about a dep they consume, but do not frame the ask as "add this to your Dependabot flow".
- `sooperset/mcp-atlassian`, a wave 2 target, has no bump automation at all. That pitch needs adjusting.
- `cloudflare/mcp-server-cloudflare` has the best raw pain found ([#378](https://github.com/cloudflare/mcp-server-cloudflare/issues/378) and [#391](https://github.com/cloudflare/mcp-server-cloudflare/issues/391), optional params emitting `{"not":{}}` and breaking strict function calling on Kimi, Gemini and OpenAI) but no bump automation. Different conversation, do not force this wedge.
- Verified as having no bump automation: `microsoft/playwright-mcp`, `GLips/Figma-Context-MCP`, `sooperset/mcp-atlassian`, `browserbase/mcp-server-browserbase`.

## the messages

Rules: one message, zero follow-ups, disclose that I maintain reelier, offer the PR, invite them to close it.

The test every message has to pass: delete the reelier paragraph. Does the message still help them? If yes, send it. If it collapses, rewrite it.

---

### agor, comment in [PR #1952](https://github.com/preset-io/agor/pull/1952). send this one first.

Time sensitive. This is the only message here that arrives while the pain is live and open, and it is worthless once they merge.

> five agent SDKs moving in one PR, with gemini-cli-core going 0.31.0 to 0.52.0, and no cheap way to show that agor still drives codex, claude and gemini the way it did last week. i don't think anyone has a good answer for that yet.
>
> typecheck and unit tests tell you it compiles. they don't tell you whether an orchestrated session still makes the same tool calls with the same arguments. #1264 is the version of this that already bit you: the codex-sdk bump surfaced that `total_token_usage.total_tokens` is lifetime cumulative rather than current occupancy, and the symptom was a number being wrong, not anything failing.
>
> one approach that doesn't require trusting anything new: record one orchestrated session against the current lockfile as an ordered list of tool calls plus arguments, then replay that recording on the bump branch and diff it. no model spend, deterministic, and the failure is readable. "step 7 called X with these args, now calls it with these".
>
> for a grouped bump that's also how you bisect. replay once per SDK to find which of the five actually moved the behaviour, instead of splitting the PR apart and rerunning everything by hand.
>
> disclosure: i maintain an open source tool that does this (reelier, MIT, github.com/seldonframe/reelier). happy to open a PR wiring it to one agor session so this PR has a concrete before and after you can judge on the merits. equally fine if you'd rather take the record-and-replay idea and build it in house, it's a couple hundred lines if you only need your own shape. feel free to ignore this.

---

### smolagents, comment in [#1885](https://github.com/huggingface/smolagents/issues/1885)

Warmest of the framework targets. Unanswered, and the reporter is stuck.

> there are three separate behaviour changes bundled in this report, and splitting them will probably make it tractable:
>
> 1. runtime went from 10 to 15s up to about 150s on every run
> 2. the output lost its `final_answer()` wrapper
> 3. the agent now reaches `max_steps` where it used to stop
>
> my guess is that 3 is caused by 2. if the terminal call's shape changed, the loop no longer recognises the stop condition and just runs to the ceiling. that would also explain 1 completely without any caching regression: more steps, more calls, roughly 10x the wall time. worth testing that first since it collapses three symptoms into one root cause.
>
> a concrete way to check: capture the ordered list of tool calls for one task on 1.17.0 and the same task on 1.23.0, then compare step counts and the shape of the final step. if 1.23.0 shows the same first n steps and then keeps going, it's the terminator and not the cache.
>
> disclosure: i maintain an open source tool for that comparison (reelier, MIT, github.com/seldonframe/reelier) which records a run's tool calls and replays them at zero model cost so you can diff two runs step by step. but the diagnosis above stands on its own and you can do it with logging if you'd rather not add a dependency. happy to help either way, and ignore this if you're already on it.

---

### d-morrison/gha, comment in [#152](https://github.com/d-morrison/gha/issues/152)

They specified this themselves, so the message is short. They don't need convincing, only generalising.

> you've written the spec for a more general problem here. this issue is "fetch `restore-config.ts` at the pinned SHA on every bump and fail if `SENSITIVE_PATHS` diverged from our mirror", which is a bump-safety check where the compared artifact happens to be one constant.
>
> the generalisation worth considering: the thing that drifts under an action bump usually isn't only a constant, it's what the workflow does. which files it touches, which tools it calls, in what order. same check shape, wider artifact. record the workflow's behaviour once, replay on each bump, fail on a diff.
>
> disclosure: i maintain an open source tool that does the general version (reelier, MIT, github.com/seldonframe/reelier). your specific fix is smaller and probably worth doing regardless, i'd just note that once you've built the SHA-fetch machinery the general check is nearly free. happy to PR either one. feel free to close.

---

### producer-pal, new issue

> the `cooldown: semver-major 30 days` on the `anthropic` and `ai-libraries` groups is a nicely honest bit of config. it's a waiting period standing in for a check, because there isn't a cheap way to prove an 8 SDK batch didn't change how the agent drives Live.
>
> the awkward part of that trade is that time doesn't actually verify anything. if `@ai-sdk/*` changes how tool arguments get serialised, waiting 30 days just means you find out 30 days later, from a session where the wrong clip got modified.
>
> something that would give you a real gate cheaply: record one representative session (create a clip, set notes, read state back) as an ordered list of tool calls with arguments, and replay it on each weekly bump PR. it runs without a model so it costs nothing per run and can't drift itself, and it fails on a diff rather than on an exception, which is the failure mode that actually bites here.
>
> disclosure: i maintain an open source tool that does this (reelier, MIT, github.com/seldonframe/reelier), and i'd genuinely enjoy wiring it up for an agent that drives Live. happy to open the PR so you can look at a real diff instead of a readme. if it's not useful, close it, the cooldown was a reasonable call either way.

---

### github-mcp-server, comment on `mcp-diff.yml` or a new issue

Handle with respect. They already built the static half, and SamMorrowDrums maintains both this and mcp-server-diff. Extend, never compete.

> the comment in `mcp-diff.yml` about keeping the go-sdk v1.6.1 to v1.7.0-pre.1 bump "an honest, signal-only diff" is the right instinct, and i think there's a natural second half to it.
>
> a schema diff answers "did the declared tool surface change". #1877 and #2417 are the case where that isn't enough: `inputs` got silently stripped from `actions_run_trigger` under OpenAI strict mode, so the declared schema and the shape a strict client actually received had diverged. the tool list looked stable, what models could do with it wasn't.
>
> the complementary check is behavioural. record one client to server session as an ordered list of tool calls and results, replay it against the bumped SDK, diff. that catches the layer a schema comparison structurally can't see: strict-mode coercions, dropped optional fields, changed error shapes, transport-level omissions.
>
> disclosure: i maintain an open source tool that does the replay half (reelier, MIT, github.com/seldonframe/reelier). to be clear about ordering, the static diff is the cheaper gate and should stay first, this is a complement to mcp-server-diff rather than a replacement. happy to open a PR adding a replay step so you can see whether it earns its runtime, and to close it if it doesn't.

---

### crewAI, new issue

> two closed regressions here have the same shape, and i think the shape is the interesting part.
>
> #3462, 0.165.1 to 0.177.0: every tool fires twice, milliseconds apart. closed as not planned because it couldn't be reproduced.
> #4495, 1.6.1 to 1.9.3: the custom `BaseTool` wrapper stops receiving `query`, and the framework retries the failing tool in a loop.
>
> neither threw. neither failed a test. both were found by users after a version bump, and one is still unexplained.
>
> two thoughts from working on this class of bug:
>
> "couldn't reproduce" is usually a recording problem rather than a mystery. what makes #3462 hard is that the evidence, the actual ordered sequence of tool calls with their arguments, is gone by the time someone writes the report. if a single known-good run were captured as an ordered call list, "tools fire twice" stops being a narrative and becomes a diff: 2n calls where the baseline had n. same for #4495, where a missing `query` arg shows up as a changed argument on step k instead of a support thread.
>
> the gap is a behavioural baseline, not more unit tests. unit tests assert that code doesn't throw. both of these were regressions in what the agent did while everything kept returning successfully, and that needs a recorded reference run you can replay and compare against.
>
> disclosure: i maintain an open source tool that does exactly this (reelier, MIT, github.com/seldonframe/reelier). it records one run's tool calls into a file, replays it deterministically with no model calls, and diffs step by step, so a bump that changes the sequence fails CI instead of reaching users. it would have caught #3462 as a step count diff. happy to open the PR wiring it to one crew as a proof if that's welcome, and equally happy if you'd rather just take the first idea and build it yourselves. close freely.

---

### pydantic-ai, new issue

> #2504 is probably the most under-appreciated failure mode in this space and worth writing down explicitly.
>
> openai 1.99.1 to 1.99.2, a patch, changed tool type mappings, and the result is that replaying message history containing tool calls raises `TypeError: Cannot instantiate typing.Union`. the first request in a session succeeds, later ones die. so it passes a smoke test, passes CI, and fails in production on multi-turn conversations.
>
> that combination, patch version, no API change, only breaks on the second turn, is exactly what automated dependency updates merge without a human looking. #5273 has the same property: a `model=` string silently resetting provider auth, no error, wrong behaviour.
>
> the general point is that for agent frameworks the dependency contract isn't the type signature, it's the runtime call sequence, and nothing in a normal test suite pins that. a recorded multi-turn run replayed on every dependency PR would have caught #2504 on the second turn, which is where it actually breaks.
>
> disclosure: i maintain an open source tool that does this (reelier, MIT, github.com/seldonframe/reelier). glad to open a PR adding it to one example agent so you can see the diff format on a real regression, or to just leave you with the multi-turn replay idea, which matters more than the tool. close freely if it's not a fit.

---

### langchainjs, comment in [#9450](https://github.com/langchain-ai/langchainjs/issues/9450)

> now that #9544 has fixed this, the failure mode seems worth an unusual kind of regression test, because the painful part wasn't the bug, it was the silence.
>
> tool args arriving stringified didn't throw. the calls were quietly re-bucketed into `invalid_tool_calls` as "Malformed args", so from the outside the agent simply stopped using its tools and started improvising. any test asserting "no exception" passes. any test asserting "the model called `search` with `{query: ...}`" fails immediately.
>
> concretely, a test asserting `tool_calls.length > 0 && invalid_tool_calls.length === 0` against a fixed fixture would have caught the 0.4 to 1.x change at the boundary. that's cheap, and it doesn't need model access if the provider response is recorded.
>
> disclosure: i maintain an open source tool that generalises this (reelier, MIT, github.com/seldonframe/reelier), recording a run's tool calls once and replaying with zero model calls to diff step by step. but the one line assertion above is most of the value and costs you nothing. happy to PR either version, and close freely if you've already covered it.

---

### openai-node, comment in [#1840](https://github.com/openai/openai-node/issues/1840)

Analysis only, no pitch. This is an OpenAI owned repo and the issue has no replies. A substantive technical comment is welcome there, a tool mention is not.

> worth underlining how this one fails, because the blast radius is wider than a retry tweak.
>
> removing the 60s ceiling on `Retry-After` means the SDK now honours whatever the server sends. for an interactive client that's a long pause. for an agent it's worse: a tool call that used to back off about 8s can block for an hour inside a step, holding the loop, the context, and in hosted environments the billed runtime. nothing errors, the agent is just asleep, and whatever wall-clock timeout sits above it fires instead, producing a failure that looks nothing like a rate limit.
>
> two things that would help downstream users either way:
>
> 1. a documented client side `maxRetryDelay` or equivalent, so callers can bound this explicitly instead of inheriting server behaviour
> 2. a changelog line whenever codegen changes runtime timing. `chore: codegen related update` gives consumers no way to notice that a behavioural default moved
>
> happy to send a PR for either if that'd be welcome.

## send order

1. agor PR #1952, today. It is the only message that lands while the pain is live and open, and it expires the moment they merge. Every day of delay is decay.
2. smolagents #1885. Unanswered, reporter is stuck, and the diagnosis is useful whether or not they install anything. Highest reply probability, lowest spam risk.
3. d-morrison #152. They wrote the spec themselves, so it needs no persuasion.
4. producer-pal. Solo maintainer, warm, small enough that a real conversation is likely.

Then stop and reassess before touching the big repos (github-mcp-server, crewAI, pydantic-ai, langchainjs). Do not send them all on the same day. If the first four get no reply, the problem is the message, and sending six more just burns targets that are not replenishable.

Separately, and not as outreach: SamMorrowDrums is worth a real conversation about mcp-server-diff. He independently built the static half of this thesis and maintains github-mcp-server. That's a peer conversation and should not run out of this sheet's template.

## the risk worth keeping in view

Commenting on other projects' issue trackers to surface a tool is one drive-by away from reading as spam, and that cost lands on reelier permanently.

Before sending anything:

- delete the reelier paragraph. does the message still help them?
- would this be a good comment if I sold nothing?
- one message, no follow-up, ever.
