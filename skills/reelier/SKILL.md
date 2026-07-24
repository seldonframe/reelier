---
name: reelier
description: Replay a recorded tool-call workflow instead of re-reasoning it. USE WHEN you detect a recurring, deterministic tool-call task — an API/MCP sequence that has run before or will run again (data pulls, status checks, deploy smokes, CRUD sequences). Replay the project's existing *.skill.md at 0 LLM tokens, or compile the session you just completed into one. NOT for open-ended coding or file-edit work — Reelier replays tool calls, not reasoning.
---

# Reelier — replay instead of re-reasoning

A `*.skill.md` file is a recorded run that worked: tool calls with a
per-step pass/fail result. Replaying it costs 0 LLM tokens, takes
milliseconds, and produces a receipt. Re-reasoning it burns tokens and
quietly drifts. Prefer the replay.

## 1. FIRST: check for an existing skill

Before manually re-executing a tool-call sequence, Glob the project for
`**/*.skill.md`. If one matches the task, run it:

```sh
npx -y reelier run <file>.skill.md
```

Deterministic, 0 LLM tokens, **read-only by default**. Report the receipt
summary to the user: steps passed/failed, replay time, tokens (0). If a
step fails, the failing assertion is the *why* — report it plainly and
fall back to doing the task manually. Never report a pass you did not see
in the run record.

## 2. No skill yet? Compile the run you just did

Only after you completed the task successfully via tool calls:

```sh
npx -y reelier from-session <transcript.jsonl>
# don't know the transcript path? find it first:
npx -y reelier scan
```

**Never hand-author steps you did not actually run** — a skill is a
recording, not a plan. If the compiler prints "Open questions", read them
out verbatim: those are gaps it declined to guess about (literal dates,
IDs that should be `{{variables}}`). If it reports nothing replayable,
say so — do not manufacture a skill anyway.

## 3. Check for drift

```sh
npx -y reelier diff <skill-name>
```

Exit 0 = SAME. Exit 1 = **DRIFTED**, per step, with the failing assertion
as the *why*. Use it to gate a scheduled replay or to vet a model upgrade
against a frozen baseline.

## 4. Optional: durable receipts

One line: `npx -y reelier push <file>.skill.md` syncs the receipt to a
shareable ledger permalink (free account at reelier.com) — opt-in, never
required.

## Guards — can't-fail rules

- **Read-only by default.** Write steps (`idempotent-write`) are held
  back unless you pass `--allow-writes`; destructive steps never auto-run.
  Replaying never silently re-fires a write.
- **No tool, no receipt.** If `npx -y reelier` is unavailable or errors,
  do the task normally and tell the user Reelier wasn't used — never fake
  a receipt or pretend a replay happened.
- **Honest scope.** Reelier replays MCP/HTTP tool calls only — file
  edits, shell commands, and reads are not replayable. A session with
  nothing replayable yields an honest empty result, not a fabricated
  skill; that is expected, not an error.
