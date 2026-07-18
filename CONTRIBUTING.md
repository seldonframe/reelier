# Contributing to Reelier

## Dev setup

```sh
git clone https://github.com/seldonframe/reelier.git
cd reelier
npm ci
npm run build   # tsc -p tsconfig.json
npm test        # tsc -p tsconfig.test.json && node --test dist-test/test/*.test.js
```

Node >= 20 required (see `engines` in `package.json`). No other services or
API keys are needed to build or run the test suite — the escalation-ladder
tests exercise the LLM wire adapters against fakes, never a live API.

## The design constitution (brief)

Every step in a skill is five atoms — **intent, action, assert, bind,
effect** (see the README's "The five atoms" section). Reelier is a **thin
harness**: the runner, parser, and CLI don't get smarter over time, they get
more skills recorded against them. Concretely, that means:

- **No intelligence in the runner.** Level 0 (the default, always-on path)
  is pure deterministic replay — no heuristics, no fuzzy matching, no
  "probably fine." If a step needs judgment, that's what the (strictly
  opt-in) escalation ladder is for, not a shortcut in the runner itself.
- **No claim without a receipt.** Every number a user sees (replay time,
  token count, pass/fail) comes from an actual `RunRecord` this process
  produced — never estimated, never hardcoded, never "close enough." A step
  with zero assertions is recorded as `"unchecked"`, never `"passed"`.
- **Tests must be able to fail.** A test that can't fail on a real
  regression isn't a test. Prefer asserting on the actual structured output
  (parsed JSON, specific field values) over asserting "it didn't throw." If
  you're adding a fixture, make sure a plausible bug would actually break
  it.
- **Honest gaps over fabricated success.** When the compiler or runner can't
  confidently derive something (an assertion, a bind, an effect class), it
  says so as an open question or a failure — it never silently guesses and
  moves on. See "Compile" in the README for what this looks like in
  practice.

## PR expectations

- **Behavior changes need tests.** A new assert/bind form, a new CLI flag, a
  new compiler heuristic — each needs a test that would fail without the
  change.
- **Effect-verb additions belong in `src/effect-verbs.ts`.** Add the token to
  the conservative effect class and include a compiler test showing a
  representative tool name classifies as expected without an open question.
- **Format changes need `SPEC.md` updated in the same PR.** `SPEC.md` is the
  normative reference for the trace / `SKILL.md` / run-record / proxy /
  runner formats; it can't drift from what the code actually does.
- **Keep the blast radius small.** One logical change per PR. If a fix
  starts cascading across unrelated files, that's a sign to split it.
- **Explain the "why," not just the "what."** A one-paragraph PR description
  of the problem and the approach saves a reviewer from having to
  reverse-engineer intent from a diff.

## Maker != checker

PRs get adversarial review, not a rubber stamp. Whoever reviews your PR is
expected to try to break it — feed it a malformed trace, an unexpected
observation shape, a race on write-back — not just skim for style. If a
reviewer pushes back hard on something, that's the process working, not a
personal judgment. The same standard applies in reverse when you're
reviewing someone else's PR.
