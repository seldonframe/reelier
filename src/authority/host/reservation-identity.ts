const RAW_RESERVATION_ID = /^sha256:[0-9a-f]{64}$/;

/** Canonical durable/journal identity form for a reservation. The shipped fs-ledger mints raw
 * `sha256:<64hex>` transaction ids; the durable receipt identity and signed journal require a
 * colon-free form. This is the single bridge: raw ledger ids map to `reservation_<64hex>`,
 * every other identity passes through unchanged. The ledger API itself stays raw. */
export function normalizeReservationPublicationId(reservationId: string): string {
  return RAW_RESERVATION_ID.test(reservationId) ? `reservation_${reservationId.slice(7)}` : reservationId;
}
