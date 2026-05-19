/**
 * @puente/shared/mocks
 *
 * Phase 1 mock implementations of all external adapter interfaces.
 * Import from this sub-path to avoid pulling viem into bundles that only
 * need the interface types.
 *
 * Both apps/web and apps/oracle import from this path:
 *   import { createAdapters, MockCarrierApiAdapter } from '@puente/shared/mocks';
 */

export { MockOnRampAdapter } from './onramp';
export { MockOffRampAdapter } from './offramp';
export { MockCarrierApiAdapter } from './carrier';
export { MockKybProvider } from './kyb';
export { MockSanctionsScreeningProvider } from './sanctions';
export { MockTransactionMonitoringProvider } from './kyt';
export {
  createAdapters,
  getAdapters,
  resetAdapters,
  type AdapterSet,
} from './factory';
