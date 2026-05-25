/**
 * packages/contracts/scripts/seed-test-transaction.ts
 *
 * Creates a complete on-chain test transaction against the deployed Puente
 * contracts on Base Sepolia so the indexer and oracle can be exercised
 * end-to-end without a frontend.
 *
 * Transaction sequence:
 *   1. Buyer  → EscrowFactory.createEscrow(supplier, 2 USDC, [30/70 milestones])
 *   2. Buyer  → USDC.approve(Escrow, amount + fee)      ← Escrow pulls, not Factory
 *   3. Buyer  → Escrow.fund(escrowId)
 *   4. Supplier → Escrow.confirmShipment(escrowId, blRef)
 *
 * Contract addresses come from deployments/baseSepolia.json — never from .env.
 *
 * Run:  pnpm seed:test-tx
 */

import * as fs   from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { ethers, network } from "hardhat";
import type { EscrowFactory, Escrow } from "../typechain-types";

// Load root .env (three directories up: scripts/ → contracts/ → packages/ → repo root)
dotenv.config({ path: path.join(__dirname, "../../../.env") });

// ── Deployment file ──────────────────────────────────────────────────────────

interface DeploymentRecord {
  network:     string;
  chainId:     number;
  deploymentBlock: number;
  usdcAddress: string;
  protocolConfig: { feeBps: number };
  EscrowFactory:  { proxy: string };
  Escrow:         { address: string };
}

function loadDeployment(): DeploymentRecord {
  const deployFile = path.join(__dirname, "../deployments/baseSepolia.json");
  if (!fs.existsSync(deployFile)) {
    console.error(
      `\n[seed] Deployment file not found: ${deployFile}\n` +
      `       Run "pnpm deploy:baseSepolia" in packages/contracts first.\n`,
    );
    process.exit(1);
  }

  const rec = JSON.parse(fs.readFileSync(deployFile, "utf-8")) as DeploymentRecord;

  // Guard against a partially-written or stale deployment file.
  const required: Array<[string, unknown]> = [
    ["chainId",                 rec.chainId],
    ["usdcAddress",             rec.usdcAddress],
    ["EscrowFactory.proxy",     rec.EscrowFactory?.proxy],
    ["Escrow.address",          rec.Escrow?.address],
    ["protocolConfig.feeBps",   rec.protocolConfig?.feeBps],
  ];
  const missing = required.filter(([, v]) => v === undefined || v === null || v === "").map(([k]) => k);
  if (missing.length > 0) {
    console.error(`\n[seed] Deployment file is missing required fields: ${missing.join(", ")}\n`);
    process.exit(1);
  }

  return rec;
}

// ── Required env vars ────────────────────────────────────────────────────────

const REQUIRED_ENV: Array<[string, string]> = [
  ["BASE_SEPOLIA_RPC_URL",   "RPC URL for Base Sepolia (Alchemy / Infura / public)"],
  ["BUYER_PRIVATE_KEY",      "private key of the buyer test wallet (0x…)"],
  ["BUYER_ADDRESS",          "public address of the buyer test wallet"],
  ["SUPPLIER_PRIVATE_KEY",   "private key of the supplier test wallet (0x…)"],
  ["SUPPLIER_ADDRESS",       "public address of the supplier test wallet"],
  ["USDC_BASE_SEPOLIA",      "Circle-issued USDC address on Base Sepolia"],
];

function checkEnv(): void {
  const missing: string[] = [];
  for (const [key, desc] of REQUIRED_ENV) {
    if (!process.env[key]) missing.push(`  ${key.padEnd(24)} — ${desc}`);
  }
  if (missing.length === 0) return;

  console.error("\n[seed] Missing required environment variables:\n");
  console.error(missing.join("\n"));
  console.error("\nCopy .env.example to .env and fill in the values.\n");
  process.exit(1);
}

// ── USDC minimal ABI ─────────────────────────────────────────────────────────

// We interact with the external USDC contract directly; no TypeChain type exists for it.
const USDC_ABI = [
  "function balanceOf(address account) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
];

// ── Formatting helpers ────────────────────────────────────────────────────────

function formatUsdc(units: bigint): string {
  return (Number(units) / 1_000_000).toFixed(6) + " USDC";
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  checkEnv();

  const deployment = loadDeployment();

  const BUYER_PRIVATE_KEY    = process.env.BUYER_PRIVATE_KEY!;
  const BUYER_ADDRESS        = process.env.BUYER_ADDRESS!;
  const SUPPLIER_PRIVATE_KEY = process.env.SUPPLIER_PRIVATE_KEY!;
  const SUPPLIER_ADDRESS     = process.env.SUPPLIER_ADDRESS!;

  // ── Derive wallets ────────────────────────────────────────────────────────
  const buyerWallet    = new ethers.Wallet(BUYER_PRIVATE_KEY,    ethers.provider);
  const supplierWallet = new ethers.Wallet(SUPPLIER_PRIVATE_KEY, ethers.provider);

  // Cross-check: derived address must match provided address. Prevents silent
  // mismatches where a typo in one var sends funds to the wrong address.
  if (buyerWallet.address.toLowerCase() !== BUYER_ADDRESS.toLowerCase()) {
    console.error(
      `\n[seed] BUYER_PRIVATE_KEY derives ${buyerWallet.address} ` +
      `but BUYER_ADDRESS is ${BUYER_ADDRESS}. Fix your .env.\n`,
    );
    process.exit(1);
  }
  if (supplierWallet.address.toLowerCase() !== SUPPLIER_ADDRESS.toLowerCase()) {
    console.error(
      `\n[seed] SUPPLIER_PRIVATE_KEY derives ${supplierWallet.address} ` +
      `but SUPPLIER_ADDRESS is ${SUPPLIER_ADDRESS}. Fix your .env.\n`,
    );
    process.exit(1);
  }

  // ── Pre-flight: chain ID ──────────────────────────────────────────────────
  const { chainId } = await ethers.provider.getNetwork();
  const chainIdNum  = Number(chainId);

  if (chainIdNum !== deployment.chainId) {
    console.error(
      `\n[seed] Chain ID mismatch.\n` +
      `       Connected to: ${chainIdNum}\n` +
      `       Deployment:   ${deployment.chainId}\n` +
      `       Check BASE_SEPOLIA_RPC_URL and --network flag.\n`,
    );
    process.exit(1);
  }

  console.log(`\n[seed] Connected to ${deployment.network} (chainId: ${chainIdNum})`);
  console.log(`  EscrowFactory: ${deployment.EscrowFactory.proxy}`);
  console.log(`  Escrow:        ${deployment.Escrow.address}`);
  console.log(`  USDC:          ${deployment.usdcAddress}`);
  console.log(`  Fee:           ${deployment.protocolConfig.feeBps} bps`);

  // ── Pre-flight: ETH balances ──────────────────────────────────────────────
  const BUYER_MIN_ETH    = ethers.parseEther("0.01");
  const SUPPLIER_MIN_ETH = ethers.parseEther("0.005");

  const [buyerEth, supplierEth] = await Promise.all([
    ethers.provider.getBalance(BUYER_ADDRESS),
    ethers.provider.getBalance(SUPPLIER_ADDRESS),
  ]);

  if (buyerEth < BUYER_MIN_ETH) {
    console.error(
      `\n[seed] Buyer ${BUYER_ADDRESS} has insufficient ETH for gas.\n` +
      `       Balance: ${ethers.formatEther(buyerEth)} ETH\n` +
      `       Required: ≥ ${ethers.formatEther(BUYER_MIN_ETH)} ETH\n` +
      `       Hint: https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet\n`,
    );
    process.exit(1);
  }
  if (supplierEth < SUPPLIER_MIN_ETH) {
    console.error(
      `\n[seed] Supplier ${SUPPLIER_ADDRESS} has insufficient ETH for gas.\n` +
      `       Balance: ${ethers.formatEther(supplierEth)} ETH\n` +
      `       Required: ≥ ${ethers.formatEther(SUPPLIER_MIN_ETH)} ETH\n` +
      `       Hint: https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet\n`,
    );
    process.exit(1);
  }

  console.log(`\n[seed] ETH balances OK`);
  console.log(`  Buyer:    ${ethers.formatEther(buyerEth)} ETH`);
  console.log(`  Supplier: ${ethers.formatEther(supplierEth)} ETH`);

  // ── Pre-flight: USDC balance ──────────────────────────────────────────────
  const usdc = new ethers.Contract(deployment.usdcAddress, USDC_ABI, ethers.provider);
  const BUYER_MIN_USDC = 5_000_000n; // 5 USDC in 6-decimal units

  const buyerUsdc = (await usdc.balanceOf(BUYER_ADDRESS)) as bigint;
  if (buyerUsdc < BUYER_MIN_USDC) {
    console.error(
      `\n[seed] Buyer ${BUYER_ADDRESS} has insufficient USDC.\n` +
      `       Balance: ${formatUsdc(buyerUsdc)}\n` +
      `       Required: ≥ ${formatUsdc(BUYER_MIN_USDC)}\n` +
      `       Hint: https://faucet.circle.com (select "Base Sepolia")\n`,
    );
    process.exit(1);
  }

  console.log(`\n[seed] USDC balance OK`);
  console.log(`  Buyer: ${formatUsdc(buyerUsdc)}`);

  // ── Contract handles ──────────────────────────────────────────────────────
  // factory signer = buyer (msg.sender becomes the buyer for createEscrow).
  const factory = (await ethers.getContractAt(
    "EscrowFactory",
    deployment.EscrowFactory.proxy,
    buyerWallet,
  )) as unknown as EscrowFactory;

  // Attach the Escrow contract with each signer separately; fund needs the buyer
  // and confirmShipment needs the supplier.
  const escrowAsBuyer = (await ethers.getContractAt(
    "Escrow",
    deployment.Escrow.address,
    buyerWallet,
  )) as unknown as Escrow;

  const escrowAsSupplier = (await ethers.getContractAt(
    "Escrow",
    deployment.Escrow.address,
    supplierWallet,
  )) as unknown as Escrow;

  // ── Parameters ────────────────────────────────────────────────────────────
  const AMOUNT  = 2_000_000n; // 2 USDC (6 decimals)
  const feeBps  = BigInt(deployment.protocolConfig.feeBps);
  const FEE     = (AMOUNT * feeBps) / 10_000n; // 10_000 at 50 bps = 0.01 USDC
  const TOTAL   = AMOUNT + FEE;

  // Milestone types match the constants in Escrow.sol:
  //   MILESTONE_BL_VERIFIED       = keccak256("BL_VERIFIED")
  //   MILESTONE_RECEIPT_CONFIRMED = keccak256("RECEIPT_CONFIRMED")
  const milestones = [
    {
      milestoneType: ethers.keccak256(ethers.toUtf8Bytes("BL_VERIFIED")),
      pct: 30n,
    },
    {
      milestoneType: ethers.keccak256(ethers.toUtf8Bytes("RECEIPT_CONFIRMED")),
      pct: 70n,
    },
  ];

  // B/L reference: right-padded bytes32 from a human-readable test label.
  // encodeBytes32String requires ≤ 31 chars; "TEST-BL-<13-digit ms>" = 21 chars. ✓
  const blString = `TEST-BL-${Date.now()}`;
  const blRef    = ethers.encodeBytes32String(blString);

  console.log(`\n[seed] Transaction parameters`);
  console.log(`  Buyer:         ${BUYER_ADDRESS}`);
  console.log(`  Supplier:      ${SUPPLIER_ADDRESS}`);
  console.log(`  Amount:        ${formatUsdc(AMOUNT)}`);
  console.log(`  Fee:           ${formatUsdc(FEE)} (${feeBps} bps)`);
  console.log(`  Total (buyer): ${formatUsdc(TOTAL)}`);
  console.log(`  B/L string:    ${blString}`);
  console.log(`  B/L ref (hex): ${blRef}`);

  // ── Step 1: createEscrow ──────────────────────────────────────────────────
  console.log("\n[seed] Step 1/4  Creating escrow…");

  const createTx      = await factory.createEscrow(SUPPLIER_ADDRESS, AMOUNT, milestones);
  const createReceipt = await createTx.wait();
  if (!createReceipt) throw new Error("createEscrow: no transaction receipt");

  // The escrow ID is sequential and emitted in EscrowCreated. Parse from logs
  // rather than assuming a value, so concurrent scripts don't collide.
  let escrowId: bigint | undefined;
  for (const log of createReceipt.logs) {
    try {
      const parsed = factory.interface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed?.name === "EscrowCreated") {
        escrowId = parsed.args.escrowId as bigint;
        break;
      }
    } catch {
      // Logs from other contracts in the same block — ignore.
    }
  }
  if (escrowId === undefined) {
    throw new Error(
      "EscrowCreated event not found in receipt. " +
      "Verify the EscrowFactory address in deployments/baseSepolia.json.",
    );
  }

  console.log(`  tx:    ${createTx.hash}`);
  console.log(`  block: ${createReceipt.blockNumber}`);
  console.log(`  Escrow ID: ${escrowId}`);

  // ── Step 2: USDC approve ──────────────────────────────────────────────────
  // Escrow.fund() calls token.safeTransferFrom(msg.sender, address(this), total).
  // The spender must be the Escrow contract, NOT the EscrowFactory proxy.
  console.log(`\n[seed] Step 2/4  Approving ${formatUsdc(TOTAL)} to Escrow…`);

  const usdcAsBuyer  = usdc.connect(buyerWallet) as typeof usdc;
  const approveTx    = await usdcAsBuyer.approve(deployment.Escrow.address, TOTAL);
  const approveReceipt = await approveTx.wait();
  if (!approveReceipt) throw new Error("approve: no transaction receipt");

  console.log(`  tx:      ${approveTx.hash}`);
  console.log(`  block:   ${approveReceipt.blockNumber}`);
  console.log(`  Spender: ${deployment.Escrow.address}`);
  console.log(`  Amount:  ${formatUsdc(TOTAL)}`);

  // ── Step 3: fund ─────────────────────────────────────────────────────────
  console.log(`\n[seed] Step 3/4  Funding escrow ${escrowId}…`);

  const fundTx      = await escrowAsBuyer.fund(escrowId);
  const fundReceipt = await fundTx.wait();
  if (!fundReceipt) throw new Error("fund: no transaction receipt");

  console.log(`  tx:    ${fundTx.hash}`);
  console.log(`  block: ${fundReceipt.blockNumber}`);
  console.log(`  State → Funded`);

  // ── Step 4: confirmShipment ───────────────────────────────────────────────
  console.log(`\n[seed] Step 4/4  Confirming shipment (${blString})…`);

  const shipTx      = await escrowAsSupplier.confirmShipment(escrowId, blRef as `0x${string}`);
  const shipReceipt = await shipTx.wait();
  if (!shipReceipt) throw new Error("confirmShipment: no transaction receipt");

  console.log(`  tx:    ${shipTx.hash}`);
  console.log(`  block: ${shipReceipt.blockNumber}`);
  console.log(`  State → Shipped`);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("");
  console.log("=============================================");
  console.log("Test transaction created successfully.");
  console.log(`Escrow ID:     ${escrowId}`);
  console.log(`Buyer:         ${BUYER_ADDRESS}`);
  console.log(`Supplier:      ${SUPPLIER_ADDRESS}`);
  console.log(`Amount:        ${formatUsdc(AMOUNT)}`);
  console.log(`Fee:           ${formatUsdc(FEE)} (${feeBps} bps)`);
  console.log(`B/L reference: ${blRef}`);
  console.log(`Final state:   Shipped`);
  console.log("");
  console.log("Next: the oracle worker (apps/oracle, dev:oracle) should pick this up");
  console.log("within ~15s, verify the B/L via the mock carrier adapter, and submit");
  console.log("verifyBL(...) on-chain. The indexer should reflect PartialReleased in");
  console.log("Supabase shortly after.");
  console.log("=============================================");
  console.log("");
  console.log("To arm the mock carrier adapter, run this in the oracle process REPL:");
  console.log(`  const { getAdapters } = require('@puente/shared/mocks');`);
  console.log(`  const carrier = getAdapters().carrier;`);
  console.log(`  carrier.armVerification('${blRef}', {`);
  console.log(`    valid: true,`);
  console.log(`    shipper: 'Test Shipper SA de CV',`);
  console.log(`    consignee: 'Test Consignee Pte Ltd',`);
  console.log(`    inTransit: true,`);
  console.log(`  });`);
}

main().catch((err: unknown) => {
  console.error("\n[seed] Fatal error:", err);
  process.exit(1);
});
