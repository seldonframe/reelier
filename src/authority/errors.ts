export const GATE_REFUSAL_REASONS = Object.freeze([
  "request-id-conflict","authority-state-invalid","authority-state-rollback","authority-state-changed",
  "contract-not-found","contract-not-eligible","contract-ambiguous","contract-untrusted",
  "contract-alias-mismatch","contract-audience-mismatch","contract-inactive","contract-revoked","contract-not-yet-valid","contract-expired","delegation-invalid",
  "pack-mismatch","definition-mismatch","resolver-mismatch","connector-mismatch","account-mismatch","endpoint-not-allowed","risk-not-allowed",
  "source-read-refused","source-observation-invalid","source-projection-invalid","source-ungrounded","source-stale",
  "choices-invalid","compile-refused","effect-refused","effect-endpoint-not-allowed","effect-risk-not-allowed","reservation-idempotency-conflict","semantic-duplicate","capability-integrity","capability-already-reserved","limit-exceeded","not-yet-valid","expired","clock-rollback","integrity-failure","busy","lock-owner-unverifiable","corruption",
] as const);
export type GateRefusalReason = typeof GATE_REFUSAL_REASONS[number];

export const GATE_UNAVAILABLE_REASONS = Object.freeze([
  "clock-unavailable","ingress-ledger-unavailable","authority-state-unavailable","source-read-unavailable","capability-id-unavailable","event-id-unavailable","signer-unavailable","sink-unavailable","decision-missing","internal-integrity-unavailable",
] as const);
export type GateUnavailableReason = typeof GATE_UNAVAILABLE_REASONS[number];

export type AuthorityBoundaryStage = "source"|"choices"|"compile"|"effect";
export class AuthorityBoundaryError extends Error {
  readonly stage:AuthorityBoundaryStage;
  readonly authorityCode:GateRefusalReason;
  constructor(stage:AuthorityBoundaryStage,authorityCode:GateRefusalReason,message="authority boundary refused") { super(message);this.name="AuthorityBoundaryError";this.stage=stage;this.authorityCode=authorityCode; }
}
