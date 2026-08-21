import { buildAgentToolOpenApiV1 } from "./agent-tool-contracts.js";

/** Canonical transport projection only. This document certifies request/response ABI compatibility;
 * it carries no claim that a harness or provider was live-tested. */
export const authorityAgentToolOpenApiV1 = buildAgentToolOpenApiV1();
