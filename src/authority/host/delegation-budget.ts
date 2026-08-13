import { mkdir, readFile, rm, stat, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { authorityDigest } from "../wire.js";

export interface BudgetAllocation {
  readonly allocationId: string;
  readonly taskId: string;
  readonly parentAllocationId: string | null;
  readonly effects: number;
  readonly reserved: number;
  readonly consumed: number;
  readonly returned: number;
  readonly remaining: number;
  readonly revoked: boolean;
}

export interface DelegationBudgetLedgerEvent {
  readonly v: "reelier.delegation-budget-event/v1";
  readonly type: string;
  readonly allocationId: string;
  readonly taskId: string;
  readonly effects: number;
  readonly reservationId?: string;
  readonly at: string;
  readonly eventDigest: string;
}

interface PersistedAllocation {
  allocationId: string;
  taskId: string;
  parentAllocationId: string | null;
  effects: number;
  reserved: number;
  consumed: number;
  returned: number;
  revoked: boolean;
}

interface PersistedState {
  version: 1;
  tasks: Record<string, { taskId: string; revoked: boolean }>;
  allocations: Record<string, PersistedAllocation>;
  events: readonly Record<string, unknown>[];
  operations?: Record<string, { kind: "consume" | "return"; allocationId: string; effects: number }>;
}

type Mutation<T> = (state: PersistedState) => T;

/** A small durable, lock-serialized budget tree used by the Authority Cell. */
export class FsDelegationBudgetLedger {
  private readonly statePath: string;
  private readonly lockPath: string;
  private readonly lockTimeoutMs: number;

  constructor(private readonly root: string, options: Readonly<{ lockTimeoutMs?: number }> = {}) {
    this.statePath = path.join(root, "delegation-budget.json");
    this.lockPath = path.join(root, "delegation-budget.lock");
    this.lockTimeoutMs = options.lockTimeoutMs ?? 10_000;
  }

  async createRoot(input: Readonly<{ taskId: string; allocationId: string; effects: number }>): Promise<BudgetAllocation> {
    assertEffects(input.effects);
    return this.mutate(state => {
      const existing = state.allocations[input.allocationId];
      if (existing) {
        if (existing.parentAllocationId !== null || existing.taskId !== input.taskId || existing.effects !== input.effects) throw new TypeError("budget allocation identity conflict");
        return view(existing);
      }
      if (state.tasks[input.taskId]) throw new TypeError("budget task already has a root allocation");
      state.tasks[input.taskId] = { taskId: input.taskId, revoked: false };
      const allocation: PersistedAllocation = { allocationId: input.allocationId, taskId: input.taskId, parentAllocationId: null, effects: input.effects, reserved: 0, consumed: 0, returned: 0, revoked: false };
      state.allocations[input.allocationId] = allocation;
      appendEvent(state, "allocated", allocation, input.effects);
      return view(allocation);
    });
  }

  async allocate(input: Readonly<{ allocationId: string; parentAllocationId: string; effects: number; maxFanOut: number }>): Promise<BudgetAllocation> {
    assertAllocationEffects(input.effects);
    if (!Number.isInteger(input.maxFanOut) || input.maxFanOut < 0) throw new RangeError("delegation fan-out must be a non-negative integer");
    return this.mutate(state => {
      const parent = requireAllocation(state, input.parentAllocationId);
      const existing = state.allocations[input.allocationId];
      if (existing) {
        if (existing.revoked || state.tasks[existing.taskId]?.revoked) throw new Error("budget task revoked");
        if (existing.parentAllocationId !== input.parentAllocationId || existing.effects !== input.effects) throw new TypeError("budget allocation identity conflict");
        return view(existing);
      }
      assertActive(state, parent);
      const activeChildren = Object.values(state.allocations).filter(candidate => candidate.parentAllocationId === parent.allocationId && !candidate.revoked).length;
      if (activeChildren >= input.maxFanOut) throw new RangeError("delegation fan-out exceeds parent policy");
      if (input.effects > capacity(parent)) throw new RangeError("budget allocation exceeds remaining parent budget");
      const allocation: PersistedAllocation = { allocationId: input.allocationId, taskId: parent.taskId, parentAllocationId: parent.allocationId, effects: input.effects, reserved: 0, consumed: 0, returned: 0, revoked: false };
      state.allocations[input.allocationId] = allocation;
      reserveInAncestors(state, parent, input.effects);
      appendEvent(state, "allocated", allocation, input.effects);
      return view(allocation);
    });
  }

  async consume(input: Readonly<{ allocationId: string; effects: number }>): Promise<BudgetAllocation> {
    assertEffects(input.effects);
    return this.mutate(state => {
      const allocation = requireAllocation(state, input.allocationId);
      assertActive(state, allocation);
      if (input.effects > consumable(allocation)) throw new RangeError("budget consumption exceeds remaining allocation");
      allocation.consumed += input.effects;
      bumpAncestors(state, allocation, input.effects, "consume");
      appendEvent(state, "consumed", allocation, input.effects);
      return view(allocation);
    });
  }

  /** Consume an effect exactly once for a reservation. Retries return the prior view. */
  async consumeOnce(input: Readonly<{ allocationId: string; reservationId: string; effects: number }>): Promise<BudgetAllocation> {
    assertEffects(input.effects);
    return this.mutate(state => {
      const key = `consume:${input.reservationId}`;
      const prior = state.operations?.[key];
      if (prior) {
        if (prior.allocationId !== input.allocationId || prior.effects !== input.effects) throw new TypeError("budget operation identity conflict");
        return view(requireAllocation(state, input.allocationId));
      }
      const allocation = requireAllocation(state, input.allocationId);
      assertActive(state, allocation);
      if (input.effects > consumable(allocation)) throw new RangeError("budget consumption exceeds remaining allocation");
      allocation.consumed += input.effects;
      bumpAncestors(state, allocation, input.effects, "consume");
      appendEvent(state, "consumed", allocation, input.effects, input.reservationId);
      state.operations ??= {};
      state.operations[key] = { kind: "consume", allocationId: input.allocationId, effects: input.effects };
      return view(allocation);
    });
  }

  async returnUnused(input: Readonly<{ allocationId: string; effects: number }>): Promise<BudgetAllocation> {
    assertEffects(input.effects);
    return this.mutate(state => {
      const allocation = requireAllocation(state, input.allocationId);
      if (input.effects > consumable(allocation)) throw new RangeError("budget return exceeds remaining allocation");
      allocation.returned += input.effects;
      bumpAncestors(state, allocation, input.effects, "return");
      appendEvent(state, "returned", allocation, input.effects);
      return view(allocation);
    });
  }

  /** Return an effect exactly once for a reservation cancellation/not-applied result. */
  async returnOnce(input: Readonly<{ allocationId: string; reservationId: string; effects: number }>): Promise<BudgetAllocation> {
    assertEffects(input.effects);
    return this.mutate(state => {
      const key = `return:${input.reservationId}`;
      const prior = state.operations?.[key];
      if (prior) {
        if (prior.allocationId !== input.allocationId || prior.effects !== input.effects) throw new TypeError("budget operation identity conflict");
        return view(requireAllocation(state, input.allocationId));
      }
      const allocation = requireAllocation(state, input.allocationId);
      if (input.effects > consumable(allocation)) throw new RangeError("budget return exceeds remaining allocation");
      allocation.returned += input.effects;
      bumpAncestors(state, allocation, input.effects, "return");
      appendEvent(state, "returned", allocation, input.effects, input.reservationId);
      state.operations ??= {};
      state.operations[key] = { kind: "return", allocationId: input.allocationId, effects: input.effects };
      return view(allocation);
    });
  }

  /** Release a consumed effect after authoritative not-applied reconciliation. */
  async releaseConsumedOnce(input: Readonly<{ allocationId: string; reservationId: string; effects: number }>): Promise<BudgetAllocation> {
    assertEffects(input.effects);
    return this.mutate(state => {
      const key = `release:${input.reservationId}`;
      const prior = state.operations?.[key];
      if (prior) {
        if (prior.allocationId !== input.allocationId || prior.effects !== input.effects) throw new TypeError("budget operation identity conflict");
        return view(requireAllocation(state, input.allocationId));
      }
      const allocation = requireAllocation(state, input.allocationId);
      if (input.effects > allocation.consumed) throw new RangeError("budget release exceeds consumed allocation");
      allocation.consumed -= input.effects;
      releaseAncestors(state, allocation, input.effects);
      appendEvent(state, "released", allocation, input.effects, input.reservationId);
      state.operations ??= {};
      state.operations[key] = { kind: "return", allocationId: input.allocationId, effects: input.effects };
      return view(allocation);
    });
  }

  async revokeTask(taskId: string): Promise<void> {
    await this.mutate(state => {
      const task = state.tasks[taskId];
      if (!task) throw new TypeError("budget task not found");
      task.revoked = true;
      for (const allocation of Object.values(state.allocations)) if (allocation.taskId === taskId) allocation.revoked = true;
      appendEvent(state, "revoked", { allocationId: taskId, taskId }, 0);
    });
  }

  async get(allocationId: string): Promise<BudgetAllocation | undefined> {
    const state = await this.readState();
    const allocation = state.allocations[allocationId];
    return allocation ? view(allocation) : undefined;
  }

  async eventsForTask(taskId: string): Promise<readonly DelegationBudgetLedgerEvent[]> {
    if (typeof taskId !== "string" || taskId.length === 0) throw new TypeError("budget task id is invalid");
    const state = await this.readState();
    return Object.freeze(state.events.filter(event => event.taskId === taskId).map(parseBudgetEvent));
  }

  private async mutate<T>(operation: Mutation<T>): Promise<T> {
    await mkdir(this.root, { recursive: true });
    const release = await this.acquireLock();
    try {
      const state = await this.readState();
      const result = operation(state);
      await this.writeState(state);
      return result;
    } finally {
      await release();
    }
  }

  private async readState(): Promise<PersistedState> {
    try {
      const parsed = JSON.parse(await readFile(this.statePath, "utf8")) as PersistedState;
      if (parsed.version !== 1 || !parsed.tasks || !parsed.allocations || !Array.isArray(parsed.events)) throw new Error("invalid budget state");
      parsed.operations ??= {};
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, tasks: {}, allocations: {}, events: [], operations: {} };
      throw new Error("invalid delegation budget state", { cause: error });
    }
  }

  private async writeState(state: PersistedState): Promise<void> {
    const temporary = `${this.statePath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
    await writeFile(temporary, JSON.stringify(state), { encoding: "utf8" });
    await rename(temporary, this.statePath);
  }

  private async acquireLock(): Promise<() => Promise<void>> {
    const started = Date.now();
    for (;;) {
      try {
        await mkdir(this.lockPath);
        return async () => { await rm(this.lockPath, { recursive: true, force: true }); };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        try {
          const age = Date.now() - (await stat(this.lockPath)).mtimeMs;
          if (age > this.lockTimeoutMs * 2) await rm(this.lockPath, { recursive: true, force: true });
        } catch { /* another contender may have removed it */ }
        if (Date.now() - started >= this.lockTimeoutMs) throw new Error("delegation budget ledger busy");
        await new Promise(resolve => setTimeout(resolve, 5));
      }
    }
  }
}

function assertEffects(effects: number): void {
  if (!Number.isInteger(effects) || effects <= 0) throw new RangeError("budget effects must be a positive integer");
}

function assertAllocationEffects(effects: number): void {
  if (!Number.isInteger(effects) || effects < 0) throw new RangeError("budget effects must be a non-negative integer");
}

function requireAllocation(state: PersistedState, allocationId: string): PersistedAllocation {
  const allocation = state.allocations[allocationId];
  if (!allocation) throw new TypeError("budget allocation not found");
  return allocation;
}

function assertActive(state: PersistedState, allocation: PersistedAllocation): void {
  if (allocation.revoked || state.tasks[allocation.taskId]?.revoked) throw new Error("budget task revoked");
}

function available(allocation: PersistedAllocation): number {
  return allocation.parentAllocationId === null
    ? capacity(allocation)
    : allocation.effects - allocation.consumed - allocation.returned - allocation.reserved;
}

function capacity(allocation: PersistedAllocation): number {
  return allocation.effects - allocation.consumed - allocation.reserved;
}

function consumable(allocation: PersistedAllocation): number {
  return allocation.parentAllocationId === null ? capacity(allocation) : available(allocation);
}

function bumpAncestors(state: PersistedState, allocation: PersistedAllocation, effects: number, kind: "reserve" | "consume" | "return"): void {
  let current: PersistedAllocation | undefined = allocation;
  while (current?.parentAllocationId) {
    const parent = requireAllocation(state, current.parentAllocationId);
    if (kind === "reserve") parent.reserved += effects;
    else {
      parent.reserved -= effects;
      if (parent.reserved < 0) throw new Error("budget reservation underflow");
      if (kind === "consume") parent.consumed += effects;
      else parent.returned += effects;
    }
    current = parent;
  }
}

function releaseAncestors(state: PersistedState, allocation: PersistedAllocation, effects: number): void {
  let current: PersistedAllocation | undefined = allocation;
  while (current?.parentAllocationId) {
    const parent = requireAllocation(state, current.parentAllocationId);
    if (parent.consumed < effects) throw new Error("budget consumed underflow");
    parent.consumed -= effects;
    current = parent;
  }
}

function reserveInAncestors(state: PersistedState, allocation: PersistedAllocation, effects: number): void {
  let current: PersistedAllocation | undefined = allocation;
  while (current) {
    current.reserved += effects;
    current = current.parentAllocationId ? requireAllocation(state, current.parentAllocationId) : undefined;
  }
}

function appendEvent(state: PersistedState, type: string, allocation: Readonly<{ allocationId: string; taskId: string }>, effects: number, reservationId?: string): void {
  const body = { v: "reelier.delegation-budget-event/v1", type, allocationId: allocation.allocationId, taskId: allocation.taskId, effects, ...(reservationId ? { reservationId } : {}), at: new Date().toISOString() };
  state.events = [...state.events, { ...body, eventDigest: authorityDigest(body) }];
}

function parseBudgetEvent(value: Record<string, unknown>): DelegationBudgetLedgerEvent {
  const keys = ["v", "type", "allocationId", "taskId", "effects", ...(value.reservationId === undefined ? [] : ["reservationId"]), "at", "eventDigest"];
  if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key)) || value.v !== "reelier.delegation-budget-event/v1" || typeof value.type !== "string" || typeof value.allocationId !== "string" || typeof value.taskId !== "string" || !Number.isSafeInteger(value.effects) || (value.effects as number) < 0 || (value.reservationId !== undefined && typeof value.reservationId !== "string") || typeof value.at !== "string" || new Date(value.at).toISOString() !== value.at || typeof value.eventDigest !== "string") throw new TypeError("delegation budget event is invalid");
  const { eventDigest, ...body } = value;
  if (eventDigest !== authorityDigest(body)) throw new TypeError("delegation budget event digest is invalid");
  return Object.freeze(value as unknown as DelegationBudgetLedgerEvent);
}

function view(allocation: PersistedAllocation): BudgetAllocation {
  return Object.freeze({ ...allocation, remaining: available(allocation) });
}
