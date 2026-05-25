/**
 * SupabaseMockCarrierAdapter — Phase 1 carrier adapter backed by Supabase.
 *
 * Replaces the in-memory MockCarrierApiAdapter for the running oracle process.
 * State is persisted in the mock_carrier_verifications table, so the arm-bl.ts
 * script can arm a verification from a separate process.
 *
 * Pattern matches what the real Phase 2 carrier adapter will do: the carrier
 * (or an operator) writes to an external data source; the oracle reads from it.
 * Swapping this class for a MaerskCarrierAdapter requires no changes to oracle.ts.
 *
 * MockCarrierApiAdapter in packages/shared remains the correct implementation
 * for unit tests where Supabase is not available.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CarrierApiAdapter, BillOfLadingVerification, ArrivalInfo } from '@puente/shared';

export class SupabaseMockCarrierAdapter implements CarrierApiAdapter {
  constructor(private readonly db: SupabaseClient) {}

  async verifyBillOfLading(blRef: string): Promise<BillOfLadingVerification> {
    const { data, error } = await this.db
      .from('mock_carrier_verifications')
      .select('valid, shipper, consignee, in_transit')
      .eq('bl_ref', blRef)
      .maybeSingle();

    if (error) {
      console.warn('[carrier] Supabase error reading verification for', blRef, ':', error.message);
      return { valid: false, shipper: '', consignee: '', inTransit: false };
    }

    if (!data) {
      return { valid: false, shipper: '', consignee: '', inTransit: false };
    }

    return {
      valid:     data.valid     as boolean,
      shipper:   data.shipper   as string,
      consignee: data.consignee as string,
      inTransit: data.in_transit as boolean,
    };
  }

  async getArrival(_blRef: string): Promise<ArrivalInfo | null> {
    // Arrival arming via Supabase is Phase 2. The oracle's recordArrival path
    // is not exercised in the seed-test-transaction flow — arrivals are triggered
    // by a separate operator action after B/L verification completes.
    return null;
  }
}
