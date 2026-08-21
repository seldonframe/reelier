import { isProxy } from "node:util/types";
import {
  assertGitHubLinearProviderReadbackV1,
  assertLinearOutcomeDispatchV1,
  LINEAR_OUTCOME_SERVER_SCHEMA_DIGEST_V1,
  linearOutcomeToolSchemaDigestV1,
  orderedGitHubLinearOperationsV1,
  type GitHubLinearOutcomePackV1,
} from "../packs/github-linear-outcomes.js";
import { authorityDigest } from "../wire.js";
import { mintTrustedEffectTransportExecutorV1, type TrustedEffectTransportExecutorV1 } from "./effect-transports.js";
import { consumeTrustedOutcomePredecessorAuthorizationV1, type TrustedOutcomePredecessorPolicyV1 } from "./outcome-kernel.js";
import { consumeCoordinatorDispatchCallDelegateV1 } from "./dispatch.js";

export interface LinearOutcomeProviderSinkV1 { success(serializedJson: string): void; failure(): void }
export interface LinearOutcomeProviderV1 {
  comment(input: Readonly<Record<string, string>>, sink: LinearOutcomeProviderSinkV1): void;
  readComment(input: Readonly<Record<string, string>>, sink: LinearOutcomeProviderSinkV1): void;
  transitionStatus(input: Readonly<Record<string, string>>, sink: LinearOutcomeProviderSinkV1): void;
  readStatus(input: Readonly<Record<string, string>>, sink: LinearOutcomeProviderSinkV1): void;
}

const TOOLS = Object.freeze({
  linear_evidence_comment_v1: Object.freeze({ operation: "linearEvidenceComment" as const, method: "comment" as const, readback: false }),
  linear_evidence_comment_readback_v1: Object.freeze({ operation: "linearEvidenceComment" as const, method: "readComment" as const, readback: true }),
  linear_status_transition_v1: Object.freeze({ operation: "linearStatusTransition" as const, method: "transitionStatus" as const, readback: false }),
  linear_status_transition_readback_v1: Object.freeze({ operation: "linearStatusTransition" as const, method: "readStatus" as const, readback: true }),
});

/** Callback-only adapter over a host-provided Linear port. It owns no SDK, credential, storage, or retry state. */
export function createLinearOutcomeExecutorV1(input: Readonly<{ pack: GitHubLinearOutcomePackV1; provider: LinearOutcomeProviderV1; predecessorPolicy: TrustedOutcomePredecessorPolicyV1 }>): TrustedEffectTransportExecutorV1 {
  const root = exactRecord(input, ["pack", "provider", "predecessorPolicy"], "Linear outcome executor input");
  const provider = providerPort(root.provider);
  const pack = root.pack as GitHubLinearOutcomePackV1;
  const predecessorPolicy = root.predecessorPolicy as TrustedOutcomePredecessorPolicyV1;
  orderedGitHubLinearOperationsV1(pack, "linear-only");
  return mintTrustedEffectTransportExecutorV1({ mcp: {
    inspectSchemas(request, sink): void {
      try {
        if (request.server !== "reelier.linear.outcomes") throw new TypeError("Linear outcome server is invalid");
        sink.success(JSON.stringify({ serverSchemaDigest: LINEAR_OUTCOME_SERVER_SCHEMA_DIGEST_V1, toolSchemaDigest: linearOutcomeToolSchemaDigestV1(request.tool) }));
      } catch { sink.failure(); }
    },
    call(request, sink): void {
      let tool: (typeof TOOLS)[keyof typeof TOOLS], providerInput: Readonly<Record<string, string>>;
      try {
        if (request.server !== "reelier.linear.outcomes" || request.serverSchemaDigest !== LINEAR_OUTCOME_SERVER_SCHEMA_DIGEST_V1 || request.toolSchemaDigest !== linearOutcomeToolSchemaDigestV1(request.tool)) throw new TypeError("Linear outcome transport binding is invalid");
        tool = TOOLS[request.tool as keyof typeof TOOLS];
        if (!tool) throw new TypeError("Linear outcome tool is not reviewed");
        const reviewed = pack.operations[tool.operation];
        if (request.authority.contractDigest !== reviewed.metadata.contractDigest || request.authority.bindingDigest !== authorityDigest(reviewed.binding)) throw new TypeError("Linear outcome compiler authority is invalid");
        if (typeof request.authority.requestId !== "string" || typeof request.authority.governedEffectDigest !== "string") throw new TypeError("Linear outcome write requires authenticated governed authority");
        providerInput = assertLinearOutcomeDispatchV1(pack, tool.operation, request.arguments.model, request.arguments.host);
        if (!tool.readback && tool.operation === "linearEvidenceComment" && !consumeCoordinatorDispatchCallDelegateV1(request.authority, { reservationId: request.authority.reservationId, effectDigest: request.authority.governedEffectDigest })) throw new TypeError("Linear comment requires the exact coordinator call capability");
        if (!tool.readback && tool.operation === "linearStatusTransition" && !consumeTrustedOutcomePredecessorAuthorizationV1(predecessorPolicy, { reservationId: request.authority.reservationId, successorContractDigest: request.authority.contractDigest, dispatchAuthority: request.authority })) throw new TypeError("Linear status requires the exact coordinator call and predecessor authorization");
      } catch { sink.success(JSON.stringify({ outcome: "refused", data: {} })); return; }
      let settled = false;
      const providerSink = Object.freeze({
        success(serializedJson: string): void {
          if (settled) return; settled = true;
          try {
            const raw = parseSerialized(serializedJson);
            if (tool.readback) {
              const data = assertGitHubLinearProviderReadbackV1(pack, tool.operation, raw);
              sink.success(JSON.stringify({ outcome: "applied", data }));
              return;
            }
            const envelope = exactRecord(raw, ["outcome", "data"], "Linear provider response");
            if (typeof envelope.outcome !== "string" || !["applied", "exact-existing", "conflict", "refused", "uncertain"].includes(envelope.outcome)) throw new TypeError("Linear provider outcome is invalid");
            const data = envelope.outcome === "applied" || envelope.outcome === "exact-existing" ? assertGitHubLinearProviderReadbackV1(pack, tool.operation, envelope.data) : {};
            sink.success(JSON.stringify({ outcome: envelope.outcome, data }));
          } catch { sink.success(JSON.stringify({ outcome: tool.readback ? "conflict" : "refused", data: {} })); }
        },
        failure(): void { if (settled) return; settled = true; sink.success(JSON.stringify({ outcome: "uncertain", data: {} })); },
      });
      try { if (provider[tool.method](providerInput, providerSink) !== undefined) providerSink.failure(); }
      catch { providerSink.failure(); }
    },
  } });
}

function providerPort(value: unknown): LinearOutcomeProviderV1 {
  const raw = exactRecord(value, ["comment", "readComment", "transitionStatus", "readStatus"], "Linear outcome provider");
  for (const key of ["comment", "readComment", "transitionStatus", "readStatus"] as const) if (typeof raw[key] !== "function") throw new TypeError("Linear outcome provider methods must be inert callbacks");
  return Object.freeze({ comment: raw.comment as LinearOutcomeProviderV1["comment"], readComment: raw.readComment as LinearOutcomeProviderV1["readComment"], transitionStatus: raw.transitionStatus as LinearOutcomeProviderV1["transitionStatus"], readStatus: raw.readStatus as LinearOutcomeProviderV1["readStatus"] });
}

function parseSerialized(value: unknown): unknown { if (typeof value !== "string" || Buffer.byteLength(value) > 1_048_576) throw new TypeError("Linear provider response must be bounded JSON"); return JSON.parse(value) as unknown; }
function exactRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) throw new TypeError(`${label} must be an inert closed record`); const prototype = Object.getPrototypeOf(value); if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} must be an inert closed record`); const ownKeys = Reflect.ownKeys(value); if (ownKeys.length !== keys.length || ownKeys.some(key => typeof key !== "string" || !keys.includes(key))) throw new TypeError(`${label} is not closed`); const result: Record<string, unknown> = Object.create(null); for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw new TypeError(`${label} requires inert data properties`); result[key] = descriptor.value; } return result; }
