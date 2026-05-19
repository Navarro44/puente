/**
 * OnRampAdapter — MXN → USDC on-ramp.
 *
 * Phase 1: mock implementation deposits test USDC from a funded test wallet
 * on Base Sepolia directly to the escrow contract address.
 * Phase 2+: Bitso Business API or equivalent MAS/CNBV-licensed partner.
 *
 * The interface is intentionally currency-agnostic in the fiat leg
 * (sourceCurrency field) so a second corridor (e.g., BRL) can reuse it.
 */

export interface OnRampQuote {
  /** Opaque reference used to execute this specific quote. */
  quoteId: string;
  /** Fiat amount being converted, in the smallest unit of sourceCurrency. */
  sourceAmount: bigint;
  /** ISO 4217 code of the fiat leg, e.g., "MXN". */
  sourceCurrency: string;
  /** USDC amount that will be deposited (6 decimals, atomic units). */
  usdcAmount: bigint;
  /** Exchange rate expressed as a decimal string, e.g., "0.053" (USDC per 1 MXN). */
  fxRate: string;
  /** Fee charged by the on-ramp partner, in sourceCurrency smallest unit. */
  feeSource: bigint;
  /** UTC timestamp after which this quote is no longer valid. */
  expiresAt: Date;
}

export type OnRampStatusState = 'pending' | 'completed' | 'failed' | 'cancelled';

export interface OnRampStatus {
  referenceId: string;
  state: OnRampStatusState;
  /** USDC atomic units actually deposited; populated when state == 'completed'. */
  usdcAmountDeposited?: bigint;
  /** ISO 8601 timestamp of completion or failure. */
  settledAt?: string;
  failureReason?: string;
}

export interface OnRampAdapter {
  /**
   * Request a quote for converting fiatAmount of fiatCurrency into USDC.
   * The returned quote is valid until quote.expiresAt.
   */
  quote(fiatAmount: bigint, fiatCurrency: string): Promise<OnRampQuote>;

  /**
   * Execute a previously obtained quote, depositing USDC into the escrow
   * contract for the given escrowId. The escrow contract address is resolved
   * by the caller from on-chain state.
   *
   * @returns referenceId — opaque ID used to poll status().
   */
  execute(
    escrowId: bigint,
    escrowContractAddress: string,
    quote: OnRampQuote
  ): Promise<{ referenceId: string }>;

  /**
   * Poll the status of a previously executed on-ramp operation.
   */
  status(referenceId: string): Promise<OnRampStatus>;
}
