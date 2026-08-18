import { defineState } from "eve/context";
import type { AuthenticatedWorkloadV1 } from "reelier/continuity";
import { ContinuityBindingError } from "./faults.js";

type Binding = Readonly<{ taskId: string; principalId: string; workloadId: string }>;
export type ManagedContext = Readonly<{
  session: Readonly<{
    id: string;
    auth: Readonly<{
      current: Readonly<{ attributes: Readonly<Record<string, string | readonly string[]>>; principalId: string }> | null;
      initiator: Readonly<{ attributes: Readonly<Record<string, string | readonly string[]>>; principalId: string }> | null;
    }>;
  }>;
}>;

const bindingState = defineState<Binding | null>("reelier.continuity.binding/v1", () => null);

function requiredAttribute(
  attributes: Readonly<Record<string, string | readonly string[]>>,
  key: "taskId" | "workloadId",
): string {
  const value = attributes[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new ContinuityBindingError(`authenticated caller is missing ${key}`);
  }
  return value;
}

function fromAuth(auth: NonNullable<ManagedContext["session"]["auth"]["current"]>): Binding {
  if (auth.principalId.length === 0) {
    throw new ContinuityBindingError("authenticated caller is missing principalId");
  }
  return {
    taskId: requiredAttribute(auth.attributes, "taskId"),
    principalId: auth.principalId,
    workloadId: requiredAttribute(auth.attributes, "workloadId"),
  };
}

export function identifyAuthenticatedWorkload(ctx: ManagedContext): AuthenticatedWorkloadV1 {
  const initiator = ctx.session.auth.initiator;
  const current = ctx.session.auth.current;
  if (!initiator || !current) {
    throw new ContinuityBindingError("continuity requires authenticated initiator and current caller");
  }

  let binding = bindingState.get();
  if (binding === null) {
    binding = fromAuth(initiator);
    bindingState.update(() => binding);
  }

  const caller = fromAuth(current);
  if (caller.principalId !== binding.principalId) {
    throw new ContinuityBindingError("cross-principal continuity follow-up refused");
  }
  if (caller.taskId !== binding.taskId) {
    throw new ContinuityBindingError("cross-task continuity follow-up refused");
  }
  if (caller.workloadId !== binding.workloadId) {
    throw new ContinuityBindingError("changed-workload continuity follow-up refused");
  }

  return {
    v: "reelier.authenticated-workload/v1",
    taskId: binding.taskId,
    principalId: binding.principalId,
    workloadId: binding.workloadId,
    runtimeSessionId: ctx.session.id,
    harnessId: "eve@0.39.0",
  };
}
