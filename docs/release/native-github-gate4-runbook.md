# Native GitHub labels — Gate 4 runbook

Task 12 authors the authoritative verification ceremony; it does not run it. The workflow is
manual (`workflow_dispatch`), protected by the `native-github-live` environment, and accepts only
an immutable candidate ID, retained artifact bundle path, and an out-of-band checker public-key
path. It has no provider credentials, automatic trigger, retry, promotion, or release write.

The offline verifier consumes the exact signed Ubuntu and Windows job artifacts. It checks the
candidate and every Task 8/9/portable/lane/checker binding, artifact signatures, timestamps,
repository and toolchain provenance, portable graph/count parity, terminal/reconciliation/no-resend
facts, Windows refusal before native mutation, reviewed skips, and secret/canary absence.

Gate 4 states are explicit:

- `not-run`: no hosted bundle exists.
- `insufficient`: an offline fixture or incomplete bundle was supplied.
- `failed`: a retained bundle is present but a required binding or proof fails.
- `ready-for-founder-decision`: both hosted jobs supplied clean, signed, parity-checked evidence.

The verifier never turns an offline fixture into hosted evidence. It never signs `approved` on its
own. A founder must review a `ready-for-founder-decision` result and separately sign the final
decision. `approved` is invalid unless live provider evidence is explicitly `verified`; otherwise
the decision remains `blocked` or `refused`.

Hosted ceremony, when separately approved:

1. Confirm the exact candidate digest and disposable target in writing.
2. Retain the immutable Ubuntu/Windows artifact bytes and their job/run IDs; do not fetch replacements.
3. Dispatch exactly one manual workflow run with the protected environment approval.
4. Run the packed offline verifier against those retained bytes and the pinned checker public key.
5. Review the explicit state and reasons. Do not treat a `2xx`, a hermetic result, or a missing
   post-state as delivery, correctness, exactly-once behavior, or completeness.

No hosted run, provider call, credential use, GitHub write, merge, push, or Gate 4 approval is
claimed by Task 12 authoring.
