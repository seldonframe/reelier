export type OperatorPlanIdV1 = "free-local" | "managed-personal" | "managed-team" | "enterprise-customer-hosted";

export interface OperatorPlanV1 {
  readonly v: "reelier.operator-plan/v1";
  readonly id: OperatorPlanIdV1;
  readonly monthlyPriceUsd: number;
  readonly maxConcurrentExecutions: number;
  readonly managed: boolean;
  readonly customerHosted: boolean;
}

export interface OperatorUsageSnapshotV1 {
  readonly v: "reelier.operator-usage/v1";
  readonly plan: OperatorPlanIdV1;
  readonly governedExecutionUnits: number;
  readonly humanReviews: number;
  readonly receiptsRecorded: number;
  readonly receiptsAreBillable: false;
}

const PLANS: Readonly<Record<OperatorPlanIdV1, OperatorPlanV1>> = Object.freeze({
  "free-local": Object.freeze({ v: "reelier.operator-plan/v1", id: "free-local", monthlyPriceUsd: 0, maxConcurrentExecutions: 1, managed: false, customerHosted: false }),
  "managed-personal": Object.freeze({ v: "reelier.operator-plan/v1", id: "managed-personal", monthlyPriceUsd: 49, maxConcurrentExecutions: 10, managed: true, customerHosted: false }),
  "managed-team": Object.freeze({ v: "reelier.operator-plan/v1", id: "managed-team", monthlyPriceUsd: 299, maxConcurrentExecutions: 50, managed: true, customerHosted: false }),
  "enterprise-customer-hosted": Object.freeze({ v: "reelier.operator-plan/v1", id: "enterprise-customer-hosted", monthlyPriceUsd: 0, maxConcurrentExecutions: 500, managed: false, customerHosted: true }),
});

export function operatorPlanV1(id: OperatorPlanIdV1): OperatorPlanV1 {
  const plan = PLANS[id];
  if (!plan) throw new TypeError("unknown Operator plan");
  return plan;
}

export function createOperatorUsageSnapshotV1(input: {
  readonly plan: OperatorPlanIdV1;
  readonly governedExecutionUnits: number;
  readonly humanReviews: number;
  readonly receiptsRecorded: number;
}): OperatorUsageSnapshotV1 {
  for (const [name, value] of Object.entries(input).slice(1)) if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`invalid usage ${name}`);
  operatorPlanV1(input.plan);
  return Object.freeze({ v: "reelier.operator-usage/v1", plan: input.plan, governedExecutionUnits: input.governedExecutionUnits, humanReviews: input.humanReviews, receiptsRecorded: input.receiptsRecorded, receiptsAreBillable: false });
}

