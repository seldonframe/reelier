// Approval: the hash-bound, final boundary a write step crosses before it
// ever executes on replay (docs/specs/flight-recorder-v2.md §2). This
// replaces the blanket `--allow-writes`/`--yes` flags as the LAST word on
// whether a specific write executes — a human stamps `step.approve` once
// (via `reelier approve`, src/cli.ts) and the runner (src/runner.ts) refuses
// to execute if the step's tool/args have drifted since, no flag overrides
// that refusal.

import { digestSha256 } from "./canonical-json.js";
import type { Step, StepAttestDecl, StepExpect } from "./skill.js";

/**
 * The exact inputs the approval hash binds. `attest` and `expect` are
 * REQUIRED (though their values may be `undefined`): `Step.attest`/
 * `Step.expect` are optional, so a `Pick` would let a call site build a
 * fresh object literal that silently omits the key and compute a legacy
 * hash for a step that IS attested/state-bound — exactly the bug behind
 * the L2 gate regression (final-review S1/S4). With the keys required,
 * omission is a compile error at every call site.
 */
export type ApprovalHashInput = Pick<Step, "actionTool" | "actionArgs"> & {
  attest: StepAttestDecl | undefined;
  expect: StepExpect | undefined;
};

/**
 * Approval binds the OPERATION SHAPE: tool + args template ({{placeholders}}
 * intact). Environment binding is the manifest's job (preflight fails closed
 * on server/schema drift BEFORE approval is ever evaluated) — that split is
 * what lets `reelier approve` run offline. Spec: flight-recorder-v2 §2.
 *
 * When `attest` is present it's bound into the hash too: a probe's args
 * template is filled with live bindings at run time, so an unreviewed edit
 * to it could exfiltrate a bound value through a probe URL — binding it
 * under `approve` means editing `attest:` on an approved step forces
 * re-approval, exactly like editing `action:`. For steps WITHOUT `attest`
 * the hash input stays byte-identical to before this field existed, so
 * every already-approved skill remains approved.
 *
 * When `expect` is present (state-conditioned approval, wave2 §2.2) it's
 * bound in too: hand-editing `expect:` — or deleting it to quietly
 * un-condition a step — becomes an approval mismatch, refused by the
 * existing final-boundary path, no flag override, zero new enforcement
 * code. Both expect-less branches stay byte-identical to before (I-1).
 */
export function computeApprovalHash(step: ApprovalHashInput): string {
  if (step.expect !== undefined) {
    if (step.attest === undefined) {
      // Unrepresentable via parseSkill (I-12: 'expect' requires 'attest:' on
      // the step) — reaching here is a programmer error at a call site.
      // Refuse loudly rather than hash a state binding with no declared probe.
      throw new Error(
        "computeApprovalHash: 'expect' without 'attest' is unrepresentable (parseSkill enforces the pairing) — refusing to hash a state binding with no declared probe"
      );
    }
    return digestSha256({
      args: step.actionArgs,
      attest: { args: step.attest.args, projection: step.attest.projection ?? null, tool: step.attest.tool },
      // P1.5: `fields` joins the hash ONLY when present — fieldless
      // bindings keep the exact 0.25.0 hash input (identity pinned by test).
      expect: {
        at: step.expect.at,
        keyId: step.expect.keyId,
        pre: step.expect.pre,
        ...(step.expect.fields !== undefined ? { fields: step.expect.fields } : {}),
        // W3-S4 / I-17: `probeArgs` joins the hash ONLY when present, exactly
        // as `fields` does — a binding carrying neither hashes byte-identically
        // to 0.26.0 (pinned against a literal captured digest, not a restated
        // formula). Binding it means hand-editing the committed probe args, or
        // deleting them to quietly un-condition the probe, is an approval
        // mismatch refused by the existing final-boundary path.
        ...(step.expect.probeArgs !== undefined ? { probeArgs: step.expect.probeArgs } : {}),
      },
      tool: step.actionTool,
    });
  }
  if (step.attest === undefined) {
    return digestSha256({ args: step.actionArgs, tool: step.actionTool });
  }
  return digestSha256({
    args: step.actionArgs,
    attest: { args: step.attest.args, projection: step.attest.projection ?? null, tool: step.attest.tool },
    tool: step.actionTool,
  });
}

/** Per-run identity of an executed write: tool + FILLED args + server. Recorded in the receipt; never enforced against external state (spec non-goal). */
export function computeIdempotencyKey(tool: string, server: string | null, filledArgs: unknown): string {
  return digestSha256({ args: filledArgs, server, tool });
}
