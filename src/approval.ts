// Approval: the hash-bound, final boundary a write step crosses before it
// ever executes on replay (docs/specs/flight-recorder-v2.md §2). This
// replaces the blanket `--allow-writes`/`--yes` flags as the LAST word on
// whether a specific write executes — a human stamps `step.approve` once
// (via `reelier approve`, src/cli.ts) and the runner (src/runner.ts) refuses
// to execute if the step's tool/args have drifted since, no flag overrides
// that refusal.

import { digestSha256 } from "./canonical-json.js";
import type { Step } from "./skill.js";

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
 */
export function computeApprovalHash(step: Pick<Step, "actionTool" | "actionArgs" | "attest">): string {
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
