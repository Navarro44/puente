/**
 * CarrierApiAdapter — bill-of-lading verification and arrival tracking.
 *
 * Phase 1: manual-confirmation stub. An operator reviews the B/L by hand
 * and the oracle service calls verifyBillOfLading() which returns a canned
 * positive result. The interface is identical to the Phase 2 automated version
 * so the swap is transparent to all call sites.
 * Phase 2+: Maersk developer API; COSCO via Vizion / project44.
 */

export interface BillOfLadingVerification {
  /** True iff the B/L number is recognised by the carrier and the reference is valid. */
  valid: boolean;
  /** Shipper name/entity as recorded by the carrier. */
  shipper: string;
  /** Consignee name/entity as recorded by the carrier. */
  consignee: string;
  /** True iff the container is currently in transit (not yet delivered). */
  inTransit: boolean;
  /** Port where the cargo was loaded, e.g., "CNSHA" (Shanghai). */
  portOfLoading?: string;
  /** Port of delivery, e.g., "SGSIN" (Singapore). */
  portOfDischarge?: string;
  /** Vessel name, if available. */
  vessel?: string;
  /** Container number(s) covered by this B/L, if resolvable. */
  containerNumbers?: string[];
}

export interface ArrivalInfo {
  /** Unix timestamp (seconds) of carrier-confirmed arrival at the port of discharge. */
  arrivalTimestamp: number;
  /** Port of discharge code where arrival occurred. */
  portOfDischarge: string;
}

export interface CarrierApiAdapter {
  /**
   * Verify a bill of lading reference against the carrier's system.
   * Called by the oracle when the supplier submits a B/L via confirmShipment().
   * A valid result with matching shipper/consignee triggers the on-chain verifyBL().
   *
   * @param blRef  The bytes32 B/L reference submitted on-chain (decoded string form).
   */
  verifyBillOfLading(blRef: string): Promise<BillOfLadingVerification>;

  /**
   * Check whether the carrier has recorded arrival of the shipment.
   * The oracle polls this to determine when to call recordArrival() on-chain,
   * which starts the 14-day buyer-confirmation timeout clock.
   *
   * @returns ArrivalInfo if the carrier has confirmed arrival; null if not yet arrived.
   */
  getArrival(blRef: string): Promise<ArrivalInfo | null>;
}
