/**
 * Adapter factory — selects mock vs. real implementations per adapter based
 * on environment variables.
 *
 * Phase 1: all adapters resolve to their mock implementations. Real
 * implementations are deliberately absent from the codebase.
 *
 * Configuration (defaults to 'mock' for every adapter in Phase 1):
 *   ADAPTER_ONRAMP    = 'mock'   (Phase 2: 'bitso' or equivalent)
 *   ADAPTER_OFFRAMP   = 'mock'   (Phase 2: 'straitsX' | 'tripleA')
 *   ADAPTER_CARRIER   = 'mock'   (Phase 2: 'maersk' | 'vizion')
 *   ADAPTER_KYB       = 'mock'   (Phase 2: 'tianyancha' | 'qichacha')
 *   ADAPTER_SANCTIONS = 'mock'   (Phase 2: 'complyAdvantage' | 'chainalysis')
 *   ADAPTER_KYT       = 'mock'   (Phase 2: 'chainalysis' | 'trmLabs')
 *
 * Usage:
 *   import { createAdapters } from '@puente/shared/mocks';
 *   const adapters = createAdapters();
 *   const quote = await adapters.onRamp.quote(100_000n, 'MXN');
 */

import type { OnRampAdapter } from '../adapters/onramp';
import type { OffRampAdapter } from '../adapters/offramp';
import type { CarrierApiAdapter } from '../adapters/carrier';
import type { KybProvider } from '../adapters/kyb';
import type { SanctionsScreeningProvider } from '../adapters/sanctions';
import type { TransactionMonitoringProvider } from '../adapters/kyt';

import { MockOnRampAdapter } from './onramp';
import { MockOffRampAdapter } from './offramp';
import { MockCarrierApiAdapter } from './carrier';
import { MockKybProvider } from './kyb';
import { MockSanctionsScreeningProvider } from './sanctions';
import { MockTransactionMonitoringProvider } from './kyt';

export interface AdapterSet {
  onRamp: OnRampAdapter;
  offRamp: OffRampAdapter;
  carrier: CarrierApiAdapter;
  kyb: KybProvider;
  sanctions: SanctionsScreeningProvider;
  kyt: TransactionMonitoringProvider;
}

function requireMock(adapterName: string, value: string): void {
  if (value !== 'mock') {
    throw new Error(
      `Adapter "${adapterName}" is configured as "${value}" but real implementations ` +
      `are not available in Phase 1. Set ADAPTER_${adapterName.toUpperCase()}=mock ` +
      `or remove the environment variable to use the default mock.`
    );
  }
}

/**
 * Instantiate the full adapter set from environment configuration.
 * In Phase 1, all env vars default to 'mock'.
 */
export function createAdapters(): AdapterSet {
  const onRampImpl    = process.env.ADAPTER_ONRAMP    ?? 'mock';
  const offRampImpl   = process.env.ADAPTER_OFFRAMP   ?? 'mock';
  const carrierImpl   = process.env.ADAPTER_CARRIER   ?? 'mock';
  const kybImpl       = process.env.ADAPTER_KYB       ?? 'mock';
  const sanctionsImpl = process.env.ADAPTER_SANCTIONS ?? 'mock';
  const kytImpl       = process.env.ADAPTER_KYT       ?? 'mock';

  requireMock('ONRAMP',    onRampImpl);
  requireMock('OFFRAMP',   offRampImpl);
  requireMock('CARRIER',   carrierImpl);
  requireMock('KYB',       kybImpl);
  requireMock('SANCTIONS', sanctionsImpl);
  requireMock('KYT',       kytImpl);

  return {
    onRamp:    new MockOnRampAdapter(),
    offRamp:   new MockOffRampAdapter(),
    carrier:   new MockCarrierApiAdapter(),
    kyb:       new MockKybProvider(),
    sanctions: new MockSanctionsScreeningProvider(),
    kyt:       new MockTransactionMonitoringProvider(),
  };
}

/**
 * Convenience: create a singleton adapter set and cache it for the process
 * lifetime. Call reset() on individual mocks between integration tests.
 */
let _singleton: AdapterSet | null = null;

export function getAdapters(): AdapterSet {
  if (!_singleton) _singleton = createAdapters();
  return _singleton;
}

/** Reset the singleton (useful in test teardown). */
export function resetAdapters(): void {
  _singleton = null;
}
