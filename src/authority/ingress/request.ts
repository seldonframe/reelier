/** The one Outcome-request derivation BOTH Authority Cell ingresses use.
 *
 * The MCP tool call and the HTTP route must hand `handler.invoke` the same value from the same
 * authenticated context, or the two transports would authorize differently and only one of them
 * would be the tested one. Neither ingress derives an authorization of its own: authorization is
 * the host runtime's, reached identically from here. */

export const OUTCOME_REQUEST_V1 = "reelier.outcome-request/v1";

/** Stamps the closed envelope version on a request that omitted it, and preserves one that is
 * already present so a caller cannot have its declared version silently rewritten. A value that is
 * not a plain record is returned untouched: the gate refuses it, and guessing a shape for it here
 * would hide that refusal behind a transport-level one. */
export function normalizeOutcomeRequestV1(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const raw = value as Record<string, unknown>;
  return raw.v === undefined ? { v: OUTCOME_REQUEST_V1, ...raw } : value;
}

/** Binds the opaque job reference the HTTP route carries in its PATH into the same request field
 * the MCP tool carries in its arguments, so both ingresses reach `handler.invoke` with one shape.
 *
 * The route's reference wins and a body naming a DIFFERENT one is refused rather than silently
 * rebound: a request whose path and body disagree about what is being invoked has no safe reading,
 * and picking either one for the caller would make the refusal that follows unanswerable. */
export function bindInvokeJobRef(value: unknown, jobRef: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("invoke request must be a JSON object");
  const raw = value as Record<string, unknown>;
  if (raw.jobRef !== undefined && raw.jobRef !== jobRef) throw new TypeError("invoke request body names a different job reference than the route");
  return { ...raw, jobRef };
}
