/**
 * MockTransactionMonitoringProvider — Phase 1 stub for on-chain KYT.
 *
 * Returns a clean (riskScore=0, flagged=false) assessment for all transactions
 * by default. Provides two mechanisms to force a flagged/high-risk result:
 *
 *   1. armFlag(txHash)     — force the assessment for a specific tx hash
 *   2. armFlagAddress(addr) — flag any tx where fromAddress or toAddress matches
 *
 * This tests the oracle's response to a flagged assessment (pause automation,
 * alert ops) without requiring a real KYT provider.
 */

import type {
  TransactionMonitoringProvider,
  TransactionContext,
  KytAssessment,
} from '../adapters/kyt';

export class MockTransactionMonitoringProvider implements TransactionMonitoringProvider {
  private readonly flaggedTxHashes = new Set<string>();
  private readonly flaggedAddresses = new Set<string>();

  /** Force a high-risk assessment for a specific on-chain tx hash. */
  armFlag(txHash: string): void {
    this.flaggedTxHashes.add(txHash.toLowerCase());
  }

  /** Force a high-risk assessment for any tx involving this address. */
  armFlagAddress(address: string): void {
    this.flaggedAddresses.add(address.toLowerCase());
  }

  /** Clear all forced flags (useful between tests). */
  reset(): void {
    this.flaggedTxHashes.clear();
    this.flaggedAddresses.clear();
  }

  async assessTransaction(txContext: TransactionContext): Promise<KytAssessment> {
    const isFlaggedByHash = this.flaggedTxHashes.has(txContext.onchainTxHash.toLowerCase());
    const isFlaggedByAddr =
      this.flaggedAddresses.has(txContext.fromAddress.toLowerCase()) ||
      this.flaggedAddresses.has(txContext.toAddress.toLowerCase());

    const flagged = isFlaggedByHash || isFlaggedByAddr;

    if (flagged) {
      return {
        riskScore: 85,
        flagged: true,
        reasons: [
          {
            code: 'MOCK_FORCED_FLAG',
            description:
              'MockTransactionMonitoringProvider: forced high-risk result via armFlag() ' +
              'or armFlagAddress() — manual review required before proceeding.',
          },
        ],
        assessedAt: new Date(),
        referenceId: crypto.randomUUID(),
      };
    }

    return {
      riskScore: 0,
      flagged: false,
      reasons: [],
      assessedAt: new Date(),
      referenceId: crypto.randomUUID(),
    };
  }
}
