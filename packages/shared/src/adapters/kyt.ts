/**
 * TransactionMonitoringProvider — Know Your Transaction (KYT) / on-chain surveillance.
 *
 * KYT answers: "Is this specific on-chain money movement suspicious?"
 * It performs continuous monitoring of on-chain activity: wallet risk scoring,
 * exposure to sanctioned or high-risk addresses, and suspicious-pattern detection.
 * This is DISTINCT from sanctions screening:
 *   - Sanctions screening checks whether a named party is on a watchlist (done once, before funding).
 *   - KYT checks whether the on-chain transaction itself is high-risk (done on every transfer).
 *
 * Phase 1: mock returns a clean (riskScore=0, flagged=false) assessment.
 *          A test-only helper allows forcing a flagged result for integration testing.
 * Phase 2+: Chainalysis / TRM Labs / Elliptic.
 *
 * See CLAUDE.md §8 for the full KYB vs. sanctions vs. KYT distinction.
 */

/**
 * Context describing the on-chain transaction to be assessed.
 * Corresponds to one ERC-20 transfer or native transfer observed by the indexer.
 */
export interface TransactionContext {
  /** Ethereum tx hash of the transfer. */
  onchainTxHash: string;
  /** Sending address (e.g., buyer's wallet for a fund() call). */
  fromAddress: string;
  /** Receiving address (e.g., escrow contract, supplier wallet). */
  toAddress: string;
  /** ERC-20 token contract address (USDC on Base). */
  tokenAddress: string;
  /** Amount transferred in atomic units (USDC: 6 decimals). */
  amount: bigint;
  /** EIP-155 chain ID, e.g., 8453 (Base mainnet) or 84532 (Base Sepolia). */
  chainId: number;
  /** Block number of the transfer. */
  blockNumber?: bigint;
}

/** A single reason code explaining why a transaction was flagged. */
export interface KytFlagReason {
  /**
   * Machine-readable reason code.
   * Examples: "EXPOSURE_SANCTIONED_ENTITY", "HIGH_RISK_JURISDICTION",
   *           "MIXER_EXPOSURE", "DARKNET_MARKET_EXPOSURE",
   *           "SUSPICIOUS_VOLUME_PATTERN".
   */
  code: string;
  /** Human-readable explanation for the audit log. */
  description: string;
}

export interface KytAssessment {
  /**
   * Risk score from 0 (clean) to 100 (high risk).
   * Consumers should treat any score above a configurable threshold as flagged.
   */
  riskScore: number;
  /**
   * True iff the provider recommends blocking or escalating this transaction.
   * A flagged assessment must trigger a manual review workflow before any
   * further escrow action is taken.
   */
  flagged: boolean;
  /** Non-empty when flagged == true. */
  reasons: KytFlagReason[];
  assessedAt: Date;
  /** Opaque provider reference for audit trail linkage. */
  referenceId: string;
}

export interface TransactionMonitoringProvider {
  /**
   * Assess the risk profile of a single on-chain transaction.
   * Called by the indexer for every fund-moving event it observes
   * (EscrowFunded, Tranche1Released, FundsReleased, DisputeResolved).
   *
   * The result is stored in the audit_events table for compliance reporting.
   * If assessment.flagged == true, the oracle must pause further automation
   * and alert the operations team.
   */
  assessTransaction(txContext: TransactionContext): Promise<KytAssessment>;
}
