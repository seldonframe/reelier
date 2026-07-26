# Outreach drafts, 2026-07-26 — first batch from fieldwork

_Found by `fieldwork hunt` against live GitHub (647 raw hits → 154 qualified candidates), then
each issue read in full before drafting. **These are drafts. Nothing has been sent.** Posting is
a human decision, one message at a time._

Tone bar inherited from wave 1: lead with their problem, disclose I maintain reelier, offer the
PR, invite "feel free to close", one message, zero follow-ups.

## Hit rate, honestly

Four top-ranked candidates were read in full. **Two are genuine fits. Two are not**, and are
listed below with why, because the discipline is worth more than the volume:

| candidate | verdict |
|---|---|
| `gfargo/coco#1830` | **fit** — asks for exactly the mechanism reelier's probe uses |
| `modelcontextprotocol/servers#4545` | **fit** — a version bump silently broke the tool contract |
| `openclaw/openclaw#98377` | **skip** — OAuth refresh lifecycle bug, reelier does not help |
| `olaservo/skilljack-mcp#78` | **skip** — already resolved by their own #80 |

A 50% skip rate on the top of the queue is the system working. Forcing a pitch onto the other
two is the exact behaviour that gets a maintainer to screenshot you.

---

## 1. gfargo/coco#1830 — the strongest lead in the batch

**Their issue:** "test(mcp): add stdio handshake smoke test against the built bundle." They want
to spawn the built binary, complete an `initialize` handshake over stdio, and call `tools/list`.
Their reasoning, verbatim: the existing mocked-transport test "structurally cannot catch the
class of failure that actually shipped", and they cite two real defects from this cycle.

**Why this is a fit and not a stretch:** they are describing the mechanism, not the product. I
built exactly that probe last week for a different reason, and it works.

**Extra context worth having ready if they reply:** their open PR #1970 (bump react 19.2.7 →
19.2.8) leaves every tool's input and output schema unchanged, checked at base
`c36ad0a99e947d2e95d88867f7b9c0ba3bf69f13` and head `9c5ec4e2be6e1d718a28ec0e097d6336b9b123c2`.
Do **not** lead with that. It answers "does it work", not "do I care", and opening with an
unrequested scan of someone's repo reads as intrusive even when it is read-only.

> Your framing here is the part most MCP test suites get wrong. A mocked transport tests the
> server object, and the failures that actually ship are the ones that only exist once a real
> client spawns the real binary in a real cwd. Deferred binding dying outside a git repo is a
> perfect example: nothing at the source level could have caught it.
>
> One thing that made this cheap for me when I built the same smoke test: put the handshake in
> a tiny script the harness runs, rather than driving stdio from the test process. It spawns the
> built bundle, sends `initialize`, sends `tools/list`, writes the tool list to a file and
> exits. The test then just reads the file. That keeps the protocol chatter out of your test
> runner entirely, makes it trivial to run the same script inside a container, and means a
> server that hangs fails as a timeout rather than a wedged test process.
>
> The other thing worth capturing while you are in there: hash each tool's `inputSchema` and
> `outputSchema` and store them. Once you have that, the smoke test doubles as a contract check,
> and a dependency bump that quietly reshapes a tool schema fails CI instead of reaching users.
>
> Disclosure: I maintain reelier (github.com/seldonframe/reelier), which does the recording and
> diffing side of this, so I am not neutral. But the smoke test above is worth having whether or
> not you ever touch it, and I am happy to open the PR with just the script and the test if
> that is useful. If not, feel free to close.

---

## 2. modelcontextprotocol/servers#4545 — the canonical story

**Their issue:** "server-filesystem >=2025.11.25 (registerTool/outputSchema rewrite): 100%
tool-call failure on Claude Desktop." An auto-update to v2026.7.10 broke every tool call, after
the extension had worked for months.

**Why this is a fit:** this is the exact failure reelier exists to catch, discovered the exact
way it always is, which is by users. A `registerTool`/`outputSchema` rewrite changes the
agent-facing contract, and nothing in CI compared the contract before and after.

**Care needed:** this is a busy repo with an active thread. Only post if the thread has not
already converged on a fix, and lead with something useful about the diagnosis rather than the
prevention, or it reads as vulturing someone's outage.

> The detail that stands out here is that it worked for months and broke on an auto-update, with
> the failure landing at dispatch rather than at startup. That combination is hard to catch
> because the server still starts fine, so any health check that only asserts "the process came
> up" stays green.
>
> A cheap check for this class specifically: after the server boots, complete an `initialize`
> handshake and call `tools/list`, then hash each tool's `inputSchema` and `outputSchema`. Run
> it at the merge base and at the head of any dependency or SDK bump and compare the hashes. A
> `registerTool`/`outputSchema` rewrite shows up immediately as a changed hash on the affected
> tools, before it reaches a single user. It needs no model and no API keys, so it is cheap
> enough to run on every bump PR.
>
> Disclosure: I maintain reelier (github.com/seldonframe/reelier), which is a packaged version
> of that idea, so treat me as biased. The check itself is about thirty lines and worth having
> regardless of what you run it with. Happy to open a PR against whatever the right repo is if
> that is welcome, and equally happy to be ignored.

---

## Skipped, with reasons

**`openclaw/openclaw#98377`** — an OAuth access token is not refreshed by the long-running
gateway even though a valid refresh token exists, while a fresh probe refreshes correctly. This
is a token lifecycle bug in a persistent connection. Reelier has nothing to say about it.
Mentioning it here would be a pitch dressed as help.

**`olaservo/skilljack-mcp#78`** — the maintainer's own #80 already fixed it, and the issue is
about catalog discoverability under tool search rather than drift. Nothing to add.

---

## Before sending

- Re-read each thread the same day. Both issues were read on 2026-07-26; a stale comment on a
  resolved thread is worse than silence.
- One message per repo. No follow-ups.
- Record the outcome with `prospect_ledger` so the queue does not resurface them and so a reply
  rate becomes measurable. That number is the only real evidence any of this works.
