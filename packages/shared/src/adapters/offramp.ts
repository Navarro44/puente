/**
 * OffRampAdapter — USDC → SGD/USD fiat off-ramp.
 *
 * Phase 1: mock implementation simulates payout and marks complete.
 * Phase 2+: StraitsX / Triple-A / Aspire (MAS-licensed Singapore partners).
 *
 * The interface is corridor-agnostic: targetCurrency is a parameter, not
 * hardcoded to SGD, so the same interface covers future corridors.
 */

/** Bank account details for a supplier's fiat receiving account. */
export interface SupplierBankAccount {
  /** Full legal name of the account holder. */
  accountHolderName: string;
  /** Account number (format varies by country/bank). */
  accountNumber: string;
  /** BIC/SWIFT code for international transfers; local routing code for domestic. */
  bankCode: string;
  /** ISO 4217 target currency, e.g., "SGD", "USD", "HKD". */
  currency: string;
  /** ISO 3166-1 alpha-2 country code where the bank account is held. */
  country: string;
  /** Optional bank name for display / audit. */
  bankName?: string;
}

export interface OffRampQuote {
  quoteId: string;
  /** USDC atomic units being converted (6 decimals). */
  usdcAmount: bigint;
  /** Fiat amount the supplier will receive, in the smallest unit of targetCurrency. */
  targetAmount: bigint;
  /** ISO 4217 code, e.g., "SGD". */
  targetCurrency: string;
  /** Exchange rate as a decimal string, e.g., "1.345" (SGD per USDC). */
  fxRate: string;
  /** Fee charged by the off-ramp partner, in USDC atomic units. */
  feeUsdc: bigint;
  expiresAt: Date;
}

export type OffRampStatusState = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface OffRampStatus {
  referenceId: string;
  state: OffRampStatusState;
  /** Fiat amount actually paid, in smallest unit of targetCurrency. */
  paidAmount?: bigint;
  paidAt?: string;
  failureReason?: string;
}

export interface OffRampAdapter {
  /**
   * Request a quote for converting usdcAmount to the given targetCurrency.
   * Quote is valid until quote.expiresAt.
   */
  quote(usdcAmount: bigint, targetCurrency: string): Promise<OffRampQuote>;

  /**
   * Initiate a fiat payout to the supplier's bank account using a valid quote.
   * The caller is responsible for ensuring the USDC has already been released
   * from the escrow before calling this method.
   *
   * @returns referenceId — opaque ID used to poll status().
   */
  executePayout(
    supplierBank: SupplierBankAccount,
    quote: OffRampQuote
  ): Promise<{ referenceId: string }>;

  /**
   * Poll the status of a previously initiated payout.
   */
  status(referenceId: string): Promise<OffRampStatus>;
}
