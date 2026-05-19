/**
 * MockOnRampAdapter — Phase 1 stub for the MXN → USDC on-ramp.
 *
 * execute() uses viem to:
 *   1. Approve `amount + fee` USDC from the mock buyer wallet to the Escrow contract.
 *   2. Call Escrow.fund(escrowId) from the mock buyer wallet.
 *
 * This requires the mock wallet to be the same address registered as the buyer
 * in the on-chain escrow record. Set MOCK_ONRAMP_WALLET_KEY to the buyer's
 * private key in the test environment.
 *
 * Required env vars:
 *   MOCK_ONRAMP_WALLET_KEY   — 0x-prefixed private key of the buyer's test wallet
 *   MOCK_USDC_ADDRESS        — USDC contract address on the target network
 *   BASE_SEPOLIA_RPC_URL     — RPC endpoint (or BASE_MAINNET_RPC_URL for mainnet)
 *   ORACLE_NETWORK           — "baseSepolia" | "base" (default: baseSepolia)
 */

import { createPublicClient, createWalletClient, http, type Chain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia, base } from 'viem/chains';
import type { OnRampAdapter, OnRampQuote, OnRampStatus } from '../adapters/onramp';

// Minimal ABIs — only the functions this mock needs.
const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
] as const;

const ESCROW_ABI = [
  {
    name: 'getEscrow',
    type: 'function',
    inputs: [{ name: 'escrowId', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'buyer', type: 'address' },
          { name: 'supplier', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'fee', type: 'uint256' },
          { name: 'feeRecipient', type: 'address' },
          { name: 'state', type: 'uint8' },
          { name: 'blReference', type: 'bytes32' },
          { name: 'oracle', type: 'address' },
          { name: 'arbitrator', type: 'address' },
          { name: 'token', type: 'address' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'fundedAt', type: 'uint256' },
          { name: 'shippedAt', type: 'uint256' },
          { name: 'completedAt', type: 'uint256' },
          { name: 'arrivalTimestamp', type: 'uint256' },
          { name: 'releasedAmount', type: 'uint256' },
          // milestones array is omitted — we only need amount+fee
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    name: 'fund',
    type: 'function',
    inputs: [{ name: 'escrowId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

// Simulated MXN → USDC rate: 1 MXN ≈ 0.053 USDC (6 decimal USDC, centavo MXN)
const DEFAULT_FX_RATE = '0.053';
// 0.5% on-ramp fee charged in MXN
const RAMP_FEE_BPS = 50n;
// Quote valid for 3 minutes
const QUOTE_TTL_MS = 3 * 60 * 1000;

interface StatusRecord {
  state: 'pending' | 'completed' | 'failed';
  usdcAmountDeposited?: bigint;
  settledAt?: string;
  failureReason?: string;
}

function getChain(): Chain {
  return (process.env.ORACLE_NETWORK ?? 'baseSepolia') === 'base' ? base : baseSepolia;
}

function getRpcUrl(): string {
  const net = process.env.ORACLE_NETWORK ?? 'baseSepolia';
  return net === 'base'
    ? (process.env.BASE_MAINNET_RPC_URL ?? 'https://mainnet.base.org')
    : (process.env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org');
}

export class MockOnRampAdapter implements OnRampAdapter {
  private readonly statuses = new Map<string, StatusRecord>();

  async quote(fiatAmount: bigint, fiatCurrency: string): Promise<OnRampQuote> {
    // Compute fee in fiat then net amount, then convert to USDC
    const feeFiat = (fiatAmount * RAMP_FEE_BPS) / 10_000n;
    const netFiat = fiatAmount - feeFiat;
    // usdcAmount = netFiat * rate (rate expressed as USDC per 1 fiat unit, 6 decimals)
    // e.g., 100_000 MXN centavos * 0.053 = 5300 USDC atomic units (6dp)
    const rateNum = Math.round(parseFloat(DEFAULT_FX_RATE) * 1_000_000);
    const usdcAmount = (netFiat * BigInt(rateNum)) / 1_000_000n;

    return {
      quoteId: crypto.randomUUID(),
      sourceAmount: fiatAmount,
      sourceCurrency: fiatCurrency,
      usdcAmount,
      fxRate: DEFAULT_FX_RATE,
      feeSource: feeFiat,
      expiresAt: new Date(Date.now() + QUOTE_TTL_MS),
    };
  }

  async execute(
    escrowId: bigint,
    escrowContractAddress: string,
    quote: OnRampQuote
  ): Promise<{ referenceId: string }> {
    const walletKey = process.env.MOCK_ONRAMP_WALLET_KEY;
    const usdcAddress = process.env.MOCK_USDC_ADDRESS;
    if (!walletKey) throw new Error('MOCK_ONRAMP_WALLET_KEY is not set');
    if (!usdcAddress) throw new Error('MOCK_USDC_ADDRESS is not set');

    const chain = getChain();
    const transport = http(getRpcUrl());
    const account = privateKeyToAccount(walletKey as `0x${string}`);

    const publicClient = createPublicClient({ chain, transport });
    const walletClient = createWalletClient({ account, chain, transport });

    const escrowAddr = escrowContractAddress as `0x${string}`;
    const usdcAddr = usdcAddress as `0x${string}`;

    // Read escrow to get the exact amount + fee to approve
    const record = await publicClient.readContract({
      address: escrowAddr,
      abi: ESCROW_ABI,
      functionName: 'getEscrow',
      args: [escrowId],
    }) as { amount: bigint; fee: bigint };

    const totalToApprove = record.amount + record.fee;

    // 1. Approve USDC
    const approveTx = await walletClient.writeContract({
      address: usdcAddr,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [escrowAddr, totalToApprove],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveTx });

    // 2. Call fund(escrowId)
    const fundTx = await walletClient.writeContract({
      address: escrowAddr,
      abi: ESCROW_ABI,
      functionName: 'fund',
      args: [escrowId],
    });
    await publicClient.waitForTransactionReceipt({ hash: fundTx });

    const referenceId = crypto.randomUUID();
    this.statuses.set(referenceId, {
      state: 'completed',
      usdcAmountDeposited: record.amount,
      settledAt: new Date().toISOString(),
    });

    return { referenceId };
  }

  async status(referenceId: string): Promise<OnRampStatus> {
    const record = this.statuses.get(referenceId) ?? { state: 'pending' as const };
    return { referenceId, ...record };
  }
}
