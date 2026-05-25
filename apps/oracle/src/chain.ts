/**
 * viem clients for the oracle service.
 *
 * publicClient  — read-only chain access (getLogs, readContract, getBlockNumber)
 * walletClient  — signs and submits oracle transactions
 * oracleAddress — the Ethereum address of the oracle signing wallet (safe to log)
 *
 * The private key is consumed here to derive an Account object.
 * The raw hex string is not stored beyond this module.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
  type Transport,
  type Chain,
  type Account,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia, base } from 'viem/chains';
import { NETWORK, RPC_URL, ORACLE_PRIVATE_KEY } from './config';

const chain = NETWORK === 'base' ? base : baseSepolia;

// Explicit generic parameters prevent TS7056 ("inferred type exceeds maximum
// length") caused by viem's deeply nested chain-specific transaction type unions.
// `as unknown as` is required because the concrete chain type (baseSepolia | base)
// includes "deposit" transaction variants that don't unify with the generic Chain.
export const publicClient: PublicClient<Transport, Chain> = createPublicClient({
  chain,
  transport: http(RPC_URL),
}) as unknown as PublicClient<Transport, Chain>;

// Derive the signing account from the key. The raw key string is not retained
// after this call — only the Account object (which contains the address and a
// sign function, not the raw private key bytes) is exported.
const account = privateKeyToAccount(ORACLE_PRIVATE_KEY);

// WalletClient<Transport, Chain, Account> carries `chain` and `account`, which
// allows writeContract calls without repeating those fields on every call.
export const walletClient: WalletClient<Transport, Chain, Account> = createWalletClient({
  chain,
  transport: http(RPC_URL),
  account,
}) as unknown as WalletClient<Transport, Chain, Account>;

/** Ethereum address of the oracle signing wallet. Safe to log and inspect. */
export const oracleAddress: `0x${string}` = account.address;
