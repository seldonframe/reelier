import type { ToolEffectContractV1 } from "../../../src/authority/tool-effect-contract.js";
import {
  digestEffectTransportBindingV1,
  type CliEffectTransportBindingV1,
  type HttpEffectTransportBindingV1,
  type McpEffectTransportBindingV1,
} from "../../../src/authority/host/effect-transports.js";

const sha = (digit: string): string => `sha256:${digit.repeat(64)}`;

export const SLACK_LIKE_BINDING: McpEffectTransportBindingV1 = Object.freeze({
  v: "reelier.effect-transport-binding/v1",
  kind: "mcp",
  operation: "message.send",
  server: "hermetic-slack",
  tool: "send_message",
  serverSchemaDigest: sha("1"),
  toolSchemaDigest: sha("2"),
  readback: null,
});

export const CALENDAR_LIKE_BINDING: HttpEffectTransportBindingV1 = Object.freeze({
  v: "reelier.effect-transport-binding/v1",
  kind: "http",
  operation: "event.create",
  method: "POST",
  origin: "https://calendar.invalid",
  pathTemplate: "/calendars/{host.destination}/events",
  requestSchemaDigest: sha("3"),
  responseProjection: Object.freeze(["/eventId", "/state"]),
  readback: Object.freeze({
    method: "GET",
    pathTemplate: "/calendars/{host.destination}/events/{model.eventId}",
    requestSchemaDigest: sha("4"),
  }),
});

export const SLIDES_LIKE_BINDING: CliEffectTransportBindingV1 = Object.freeze({
  v: "reelier.effect-transport-binding/v1",
  kind: "cli",
  operation: "deck.update",
  executable: "C:/reviewed/bin/slides-tool.exe",
  argvTemplates: Object.freeze(["update", "--deck", "{host.destination}", "--title", "{model.title}"]),
  credentialEnv: "SLIDES_TOKEN",
  envNames: Object.freeze(["SLIDES_TOKEN"]),
  responseProjection: Object.freeze(["/deckId", "/revision"]),
  readbackArgvTemplates: Object.freeze(["show", "--deck", "{host.destination}"]),
});

function contract(input: Readonly<{
  contractId: string;
  provider: string;
  operation: string;
  schemaDigest: string;
  fields: readonly string[];
  semanticIdentity: string;
  binding: McpEffectTransportBindingV1 | HttpEffectTransportBindingV1 | CliEffectTransportBindingV1;
  readback: ToolEffectContractV1["readback"];
  maximumEvidenceGrade: ToolEffectContractV1["maximumEvidenceGrade"];
}>): ToolEffectContractV1 {
  return Object.freeze({
    v: "reelier.tool-effect-contract/v1",
    contractId: input.contractId,
    provider: input.provider,
    operation: input.operation,
    operationDigest: digestEffectTransportBindingV1(input.binding),
    schemaDigest: input.schemaDigest,
    policyDigest: sha("5"),
    effectClass: "idempotent-write",
    model: Object.freeze({ fields: Object.freeze([...input.fields]), maxBytes: 2_048 }),
    bindings: Object.freeze({ credentialRef: "credential", accountRef: "account", destinationRef: "destination", limitRef: "limit" }),
    semanticIdentity: input.semanticIdentity,
    idempotencyKey: `idem_${input.semanticIdentity}`,
    readback: input.readback,
    result: Object.freeze({ success: Object.freeze(["ok"]), conflict: Object.freeze(["conflict"]), definitiveFailure: Object.freeze(["rejected"]), ambiguity: Object.freeze(["unknown"]), }),
    maximumEvidenceGrade: input.maximumEvidenceGrade,
  });
}

export const SLACK_LIKE_CONTRACT = contract({
  contractId: "contract_slack_message",
  provider: "slack-like",
  operation: "message.send",
  schemaDigest: SLACK_LIKE_BINDING.toolSchemaDigest,
  fields: ["channel", "text"],
  semanticIdentity: "message:channel-7:request-1",
  binding: SLACK_LIKE_BINDING,
  readback: null,
  maximumEvidenceGrade: "absent",
});

export const CALENDAR_LIKE_CONTRACT = contract({
  contractId: "contract_calendar_event",
  provider: "calendar-like",
  operation: "event.create",
  schemaDigest: CALENDAR_LIKE_BINDING.requestSchemaDigest,
  fields: ["eventId", "title"],
  semanticIdentity: "event:calendar-4:event-9",
  binding: CALENDAR_LIKE_BINDING,
  readback: Object.freeze({ operation: "event.get", projection: CALENDAR_LIKE_BINDING.responseProjection }),
  maximumEvidenceGrade: "partial",
});

export const SLIDES_LIKE_CONTRACT = contract({
  contractId: "contract_slides_update",
  provider: "slides-like",
  operation: "deck.update",
  schemaDigest: sha("6"),
  fields: ["title"],
  semanticIdentity: "deck:quarterly:revision-2",
  binding: SLIDES_LIKE_BINDING,
  readback: Object.freeze({ operation: "deck.show", projection: SLIDES_LIKE_BINDING.responseProjection }),
  maximumEvidenceGrade: "verified",
});
