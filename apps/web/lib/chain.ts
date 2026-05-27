import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';

const RPC_URL = process.env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org';

export const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL),
});

function makeWalletClient(envKey: string, label: string) {
  const key = process.env[envKey];
  if (!key) throw new Error(`${envKey} is not set — required for ${label}`);
  return createWalletClient({
    account: privateKeyToAccount(key as `0x${string}`),
    chain: baseSepolia,
    transport: http(RPC_URL),
  });
}

export const getBuyerWalletClient = () =>
  makeWalletClient('BUYER_PRIVATE_KEY', 'buyer on-chain actions');

export const getSupplierWalletClient = () =>
  makeWalletClient('SUPPLIER_PRIVATE_KEY', 'supplier on-chain actions');

export const getArbitratorWalletClient = () =>
  makeWalletClient('ARBITRATOR_PRIVATE_KEY', 'arbitrator dispute resolution');
