## What and why

<!-- One paragraph: the problem and the approach. -->

## Receipts-honest checklist

- [ ] Every new claim/number the code surfaces (to a user, a receipt, a log
      line) comes from real measured/asserted data — nothing estimated or
      hardcoded to look plausible.
- [ ] A step/record that wasn't actually verified is reported as
      `unchecked`/failed, never `passed`.
- [ ] Behavior changes have a test that would fail without this change.
- [ ] `SPEC.md` updated if this changes the trace / `SKILL.md` / run-record /
      proxy / runner format (N/A otherwise).
- [ ] `npm run build && npm test` passes locally.
- [ ] No new intelligence/heuristics snuck into the Level-0 deterministic
      runner path (escalation-ladder changes are the exception — call that
      out explicitly if this PR touches L1/L2).
