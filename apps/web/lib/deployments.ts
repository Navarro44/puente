import path from 'path';
import { readFileSync } from 'fs';

const deploymentPath = path.join(
  process.cwd(),
  '..',
  '..',
  'packages',
  'contracts',
  'deployments',
  'baseSepolia.json',
);

export const deployment = JSON.parse(readFileSync(deploymentPath, 'utf8')) as {
  network: string;
  chainId: number;
  deploymentBlock: number;
  usdcAddress: string;
  protocolConfig: {
    feeBps: number;
    oracle: string;
    arbitrator: string;
    feeRecipient: string;
  };
  EscrowFactory: { proxy: string; implementation: string };
  Escrow: { address: string };
  SupplierRegistry: { proxy: string; implementation: string };
};
