import { createHash } from "node:crypto";
import type {
  AuthorityAgentToolContextV1,
  AuthorityAgentToolOutcomeV1,
  AuthorityAgentToolsV1,
} from "../authority/host/agent-tools.js";
import type { OperatorHarnessIdV1 } from "./harness.js";
import {
  createOperatorHarnessProcessV1,
  type OperatorHarnessEventV1,
  type OperatorHarnessProcessV1,
} from "./process.js";

export interface OperatorCellRequestV1 {
  readonly outcomeRef: string;
  readonly requestId: string;
  readonly sourceRefs: Readonly<Record<string, string>>;
  readonly choices: Readonly<Record<string, string | number | boolean | null>>;
}

export interface OperatorSupervisorStateV1 {
  readonly v: "reelier.operator-session/v1";
  readonly sessionId: string;
  readonly harness: OperatorHarnessIdV1;
  readonly requestId: string;
  readonly promptDigest: string;
  readonly harnessLifecycle: "running" | "stopped" | "completed" | "failed";
  readonly cellVerdict: AuthorityAgentToolOutcomeV1["verdict"] | "unchecked";
  readonly cellLifecycle: string;
  readonly receiptRef?: string;
}

export interface OperatorSupervisorV1 {
  start(input: {
    readonly harness: OperatorHarnessIdV1;
    readonly cwd: string;
    readonly prompt: string;
    readonly cellRequest: OperatorCellRequestV1;
    readonly context: AuthorityAgentToolContextV1;
  }): Promise<OperatorSupervisorStateV1>;
  observe(sessionId: string): Promise<readonly OperatorHarnessEventV1[]>;
  status(sessionId: string): Promise<OperatorSupervisorStateV1>;
  stop(sessionId: string): Promise<OperatorSupervisorStateV1>;
}

interface SessionRecord {
  readonly process: OperatorHarnessProcessV1;
  readonly request: OperatorCellRequestV1;
  readonly context: AuthorityAgentToolContextV1;
  state: OperatorSupervisorStateV1;
  events: OperatorHarnessEventV1[];
}

function promptDigest(prompt: string): string {
  return `sha256:${createHash("sha256").update(prompt, "utf8").digest("hex")}`;
}

function safeState(state: OperatorSupervisorStateV1): OperatorSupervisorStateV1 {
  return Object.freeze({ ...state });
}

function applyCell(state: OperatorSupervisorStateV1, result: AuthorityAgentToolOutcomeV1): OperatorSupervisorStateV1 {
  return safeState({
    ...state,
    cellVerdict: result.verdict,
    cellLifecycle: result.lifecycleState,
    ...(result.receiptRef ? { receiptRef: result.receiptRef } : {}),
  });
}

export function createOperatorSupervisorV1(input: {
  readonly cell: Pick<AuthorityAgentToolsV1, "outcomeRequest" | "outcomeStatus">;
  readonly processFactory?: ReturnType<typeof createOperatorHarnessProcessV1>;
}): OperatorSupervisorV1 {
  const processes = input.processFactory ?? createOperatorHarnessProcessV1();
  const sessions = new Map<string, SessionRecord>();

  return Object.freeze({
    async start(request: Parameters<OperatorSupervisorV1["start"]>[0]): Promise<OperatorSupervisorStateV1> {
      if (typeof request.prompt !== "string" || request.prompt.length === 0 || request.prompt.length > 128_000) throw new Error("operator prompt is invalid");
      const process = await processes.launch({ harness: request.harness, cwd: request.cwd, prompt: request.prompt });
      const initial = safeState({
        v: "reelier.operator-session/v1",
        sessionId: process.sessionId,
        harness: request.harness,
        requestId: request.cellRequest.requestId,
        promptDigest: promptDigest(request.prompt),
        harnessLifecycle: "running",
        cellVerdict: "unchecked",
        cellLifecycle: "unchecked",
      });
      const record: SessionRecord = { process, request: request.cellRequest, context: request.context, state: initial, events: [] };
      sessions.set(process.sessionId, record);
      try {
        const result = await input.cell.outcomeRequest(request.cellRequest, request.context);
        record.state = applyCell(record.state, result);
      } catch {
        record.state = safeState({ ...record.state, cellVerdict: "refused", cellLifecycle: "unavailable" });
      }
      return record.state;
    },

    async observe(sessionId: string): Promise<readonly OperatorHarnessEventV1[]> {
      const record = sessions.get(sessionId);
      if (!record) throw new Error("operator session is unknown");
      for await (const item of record.process.events) {
        record.events.push(item);
        if (item.kind === "completed") record.state = safeState({ ...record.state, harnessLifecycle: "completed" });
        if (item.kind === "failed") record.state = safeState({ ...record.state, harnessLifecycle: "failed" });
      }
      return Object.freeze([...record.events]);
    },

    async status(sessionId: string): Promise<OperatorSupervisorStateV1> {
      const record = sessions.get(sessionId);
      if (!record) throw new Error("operator session is unknown");
      const result = await input.cell.outcomeStatus({ requestId: record.request.requestId }, record.context);
      record.state = applyCell(record.state, result);
      return record.state;
    },

    async stop(sessionId: string): Promise<OperatorSupervisorStateV1> {
      const record = sessions.get(sessionId);
      if (!record) throw new Error("operator session is unknown");
      await record.process.stop();
      record.state = safeState({ ...record.state, harnessLifecycle: "stopped" });
      return record.state;
    },
  });
}
