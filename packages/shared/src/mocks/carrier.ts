/**
 * MockCarrierApiAdapter — Phase 1 manual-confirmation stub.
 *
 * In Phase 1, an operator verifies a B/L by hand and calls armVerification()
 * to register the result. The oracle polls verifyBillOfLading() normally —
 * it doesn't know whether the backend is a mock or a real carrier API.
 *
 * Usage:
 *   const carrier = new MockCarrierApiAdapter();
 *   // After manual review, operator arms the result:
 *   carrier.armVerification('MSKU1234567', {
 *     valid: true, shipper: 'Quimex SA de CV',
 *     consignee: 'Singapore ChemCo Pte Ltd', inTransit: true,
 *   });
 *   carrier.armArrival('MSKU1234567', { arrivalTimestamp: Date.now() / 1000, portOfDischarge: 'SGSIN' });
 *
 * The interface is identical to the Phase 2 real carrier implementation, so
 * swapping the adapter is transparent to the oracle.
 */

import type { CarrierApiAdapter, BillOfLadingVerification, ArrivalInfo } from '../adapters/carrier';

export class MockCarrierApiAdapter implements CarrierApiAdapter {
  private readonly verifications = new Map<string, BillOfLadingVerification>();
  private readonly arrivals = new Map<string, ArrivalInfo>();

  /**
   * Register a B/L verification result. Call this when an operator has
   * manually reviewed the bill of lading and approved or rejected it.
   */
  armVerification(blRef: string, result: BillOfLadingVerification): void {
    this.verifications.set(blRef, result);
  }

  /**
   * Register a carrier-confirmed arrival for a B/L reference.
   * The oracle calls this to trigger recordArrival() on-chain.
   */
  armArrival(blRef: string, arrival: ArrivalInfo): void {
    this.arrivals.set(blRef, arrival);
  }

  /** Clear all armed state (useful between tests). */
  reset(): void {
    this.verifications.clear();
    this.arrivals.clear();
  }

  async verifyBillOfLading(blRef: string): Promise<BillOfLadingVerification> {
    const result = this.verifications.get(blRef);
    if (!result) {
      // Not yet reviewed: return pending/unknown status
      return {
        valid: false,
        shipper: '',
        consignee: '',
        inTransit: false,
      };
    }
    return result;
  }

  async getArrival(blRef: string): Promise<ArrivalInfo | null> {
    return this.arrivals.get(blRef) ?? null;
  }
}
