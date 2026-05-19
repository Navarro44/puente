/**
 * MockOffRampAdapter — Phase 1 stub for the USDC → SGD/USD off-ramp.
 *
 * All operations are simulated in-memory. executePayout() immediately marks
 * the payout as completed so the oracle can proceed without waiting on a
 * real banking partner. No network calls are made.
 */

import type {
  OffRampAdapter,
  OffRampQuote,
  OffRampStatus,
  SupplierBankAccount,
} from '../adapters/offramp';

// Simulated USD→SGD rate
const MOCK_RATES: Record<string, string> = {
  SGD: '1.345',
  USD: '1.000',
  HKD: '7.820',
};

const RAMP_FEE_BPS = 50n; // 0.5% off-ramp fee in USDC
const QUOTE_TTL_MS = 3 * 60 * 1000;

interface PayoutRecord {
  state: 'pending' | 'completed' | 'failed';
  paidAmount?: bigint;
  paidAt?: string;
  failureReason?: string;
}

export class MockOffRampAdapter implements OffRampAdapter {
  private readonly payouts = new Map<string, PayoutRecord>();

  async quote(usdcAmount: bigint, targetCurrency: string): Promise<OffRampQuote> {
    const fxRate = MOCK_RATES[targetCurrency] ?? '1.000';
    const feeUsdc = (usdcAmount * RAMP_FEE_BPS) / 10_000n;
    const netUsdc = usdcAmount - feeUsdc;
    // targetAmount in smallest unit of targetCurrency (2 decimals for SGD/USD)
    const rateNum = Math.round(parseFloat(fxRate) * 100);
    const targetAmount = (netUsdc * BigInt(rateNum)) / 100n;

    return {
      quoteId: crypto.randomUUID(),
      usdcAmount,
      targetAmount,
      targetCurrency,
      fxRate,
      feeUsdc,
      expiresAt: new Date(Date.now() + QUOTE_TTL_MS),
    };
  }

  async executePayout(
    supplierBank: SupplierBankAccount,
    quote: OffRampQuote
  ): Promise<{ referenceId: string }> {
    void supplierBank; // not used in mock
    const referenceId = crypto.randomUUID();
    // Immediately mark complete — no real banking call in Phase 1
    this.payouts.set(referenceId, {
      state: 'completed',
      paidAmount: quote.targetAmount,
      paidAt: new Date().toISOString(),
    });
    return { referenceId };
  }

  async status(referenceId: string): Promise<OffRampStatus> {
    const record = this.payouts.get(referenceId) ?? { state: 'pending' as const };
    return { referenceId, ...record };
  }
}
