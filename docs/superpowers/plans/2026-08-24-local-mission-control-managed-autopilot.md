# Local Mission Control + Managed Autopilot Implementation Plan

**Status:** approved for implementation on the reviewed Operator and Cloud lineages.

**Product contract:** Free Local Mission Control. Paid Managed Autopilot.

## Outcome

`npx reelier@latest init` must produce a useful, local, truthful picture of existing Codex and Claude work in under one minute. It must distinguish harness activity from Outcome truth, surface stalls and exceptions, and support owned stop/resume/recovery without an account. At an exact consequential exit, it may offer one quiet native-or-Autopilot choice. Managed Autopilot then explains the exact capability, accepts the $49 subscription, progressively binds providers and passkey authority, provisions the Cell, executes through the existing governed lifecycle, and returns the verified Outcome to the originating harness.

## Implementation units

1. **Mission truth contracts and journal**
   - Add closed harness, Outcome, attention, evidence, event, mission, and upgrade-intent records.
   - Persist an append-only local journal plus atomic mission/evidence snapshots under `.reelier/operator/`.
   - Reopen deterministically; refuse traversal, linked roots, malformed records, duplicate event IDs, and concurrent writer ambiguity.

2. **Discovery and control**
   - Globally discover Codex and Claude histories and focus the current repository.
   - Normalize only bounded metadata; never persist prompts, reasoning, model output, provider bodies, or credentials.
   - Implement owned launch/status/stop/resume and observe-only imported sessions.

3. **Attention and local evidence**
   - Detect deterministic idle, wall-clock, cost/token, repeated-error, restart-loop, context-growth, repository-drift, and missing-evidence conditions.
   - Reproduce exact Git/test/build evidence before `locally-observed`; harness exit alone remains `completed-unverified`.

4. **CLI and local board**
   - Make bare `reelier init` the Mission Control experience while preserving expert init flags.
   - Add `operator open|run|import|list|status|stop|resume|review|autopilot|doctor`.
   - Serve a loopback-only board with an ephemeral fragment capability, origin/CSRF checks, no remote code, current-repository focus, global switcher, separate state axes, evidence, controls, and exception inbox.

5. **Consequential boundary**
   - Trigger only from canonical Outcome requests, Operator-owned reviewed actions, or observed reviewed writes.
   - Show the harness line once per exact effect; preserve native continuation and report invisible native effects as unknown coverage.
   - Mint a signed, expiring, one-shot `ManagedUpgradeIntentV1` containing only opaque references and digests.

6. **Contextual Managed conversion**
   - Replace stale pricing with Free Mission Control and $49 Managed Personal.
   - Add a mission-context page: exact operations, targets, limits, expiry, credential isolation, authoritative read-back, no-resend recovery, grouped review, and `Continue locally`.
   - Establish GitHub identity, run Stripe Checkout, resume the same onboarding session, then select GitHub/Linear targets, create passkey, confirm exact powers, provision/certify the Cell, and return Ready to the originating harness.

7. **Managed execution and review**
   - Reuse the existing Neon lifecycle, one-shot Cell authority, Vercel broker, reviewed seven-definition pack, authoritative read-back, receipts, and exception states.
   - Never add a second lifecycle, provider-specific kernel branch, provider credential in Fly/Neon, or resend after an uncertain dispatch.

8. **Measurement and release**
   - Add explicit active-attention events and redacted offline benchmark bundles.
   - Reject sessions, effects, PRs, unchecked completions, and duplicate receipts as Outcome counts.
   - Gate beta on installed Windows/Linux packages, real Codex/Claude probes, Cloud build/schema/RLS, Cell certification, Stripe convergence, no-secret audits, accessibility, and setup under one minute.
   - Measure the ten-session free wedge, then ten-Outcome Managed wedge, then a real matched 100-Outcome run. Never extrapolate or market an unproven ratio.

## TDD order

For every behavior: add one focused failing test, verify the failure is the missing behavior, implement the smallest production change, rerun the focused test, then run the surrounding suite. Commit only coherent green units. Documentation-only units use diff and link checks.

## Non-negotiable falsifiers

- Harness completion becomes reconciled without independent evidence.
- A heuristic authorizes an effect or marks it verified.
- Imported sessions are treated as process-owned.
- Prompts, reasoning, credentials, provider bodies, or secrets enter local state, browser state, errors, logs, receipts, or benchmark bundles.
- The CTA appears for local edits, inferred prose, or more than once for one effect.
- Native execution is blocked by the free product.
- Checkout cancellation damages local state or successful payment cannot resume.
- Cell certification failure permits a provider write.
- An ambiguous attempt resends.
- A public 10x/100x claim appears without a matched measured run.
