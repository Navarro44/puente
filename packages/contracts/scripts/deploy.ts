/**
 * Deploy Puente contracts to Base Sepolia (or any configured network).
 *
 * Deployment order (resolves the circular factory↔escrow dependency):
 *   1. EscrowFactory UUPS proxy — owner address used as temporary escrowContract placeholder
 *   2. Escrow — non-proxy, constructor takes factory proxy address
 *   3. EscrowFactory.setEscrowContract() — replaces the placeholder with the real Escrow
 *   4. SupplierRegistry UUPS proxy
 *
 * Usage:
 *   pnpm deploy:baseSepolia
 *
 * To force redeploy when a deployment file already exists:
 *   FORCE_REDEPLOY=true pnpm deploy:baseSepolia
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { ethers, upgrades, run, network } from "hardhat";
import type { EscrowFactory, SupplierRegistry } from "../typechain-types";

// ── Required environment variables ──────────────────────────────────────────

const REQUIRED_ENV: Array<[string, string]> = [
  ["BASE_SEPOLIA_RPC_URL",   "RPC URL for Base Sepolia (Alchemy / Infura / public)"],
  ["DEPLOYER_PRIVATE_KEY",   "deployer wallet private key (testnet only — use KMS for mainnet)"],
  ["ORACLE_ADDRESS",         "oracle wallet address that submits B/L verifications on-chain"],
  ["ARBITRATOR_ADDRESS",     "arbitrator wallet address that resolves escrow disputes"],
  ["FEE_RECIPIENT_ADDRESS",  "address that receives the 0.5% protocol fee"],
  ["USDC_BASE_SEPOLIA",      "Circle-issued USDC contract address on Base Sepolia"],
  ["BASESCAN_API_KEY",       "Basescan API key for source verification"],
];

function checkEnv(): void {
  const missing: string[] = [];
  for (const [key, desc] of REQUIRED_ENV) {
    if (!process.env[key]) {
      missing.push(`  ${key.padEnd(26)} — ${desc}`);
    }
  }
  if (missing.length === 0) return;

  console.error("\n[deploy] Missing required environment variables:\n");
  console.error(missing.join("\n"));
  console.error("\nCopy .env.example to .env and fill in the values.\n");
  process.exit(1);
}

// ── Deployment file helpers ──────────────────────────────────────────────────

const DEPLOYMENTS_DIR = path.join(__dirname, "../deployments");

function deploymentPath(networkName: string): string {
  return path.join(DEPLOYMENTS_DIR, `${networkName}.json`);
}

// ── Git commit hash (best-effort) ────────────────────────────────────────────

function gitCommit(): string | null {
  try {
    return execSync("git rev-parse HEAD", {
      cwd: __dirname,
      stdio: ["pipe", "pipe", "pipe"],
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

// ── Basescan verification (non-fatal) ────────────────────────────────────────

async function verifyContract(
  label: string,
  address: string,
  constructorArguments: unknown[]
): Promise<void> {
  try {
    await run("verify:verify", { address, constructorArguments });
    console.log(`  [verify] ${label}: verified (${address})`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes("already verified")) {
      console.log(`  [verify] ${label}: already verified (${address})`);
    } else {
      console.warn(`  [verify] ${label}: FAILED — ${msg}`);
      console.warn(
        `           Re-run later: hardhat verify --network ${network.name} ${address}${
          constructorArguments.length ? " " + constructorArguments.join(" ") : ""
        }`
      );
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  checkEnv();

  const force =
    process.argv.includes("--force") || process.env.FORCE_REDEPLOY === "true";
  const networkName = network.name;
  const chainId = network.config.chainId;
  const deployFile = deploymentPath(networkName);

  // Idempotency guard
  if (fs.existsSync(deployFile) && !force) {
    const existing = JSON.parse(fs.readFileSync(deployFile, "utf-8")) as {
      EscrowFactory: { proxy: string };
      Escrow: { address: string };
      SupplierRegistry: { proxy: string };
    };
    console.log(`\n[deploy] Existing deployment found for ${networkName}:`);
    console.log(`  EscrowFactory proxy: ${existing.EscrowFactory.proxy}`);
    console.log(`  Escrow:              ${existing.Escrow.address}`);
    console.log(`  SupplierRegistry:    ${existing.SupplierRegistry.proxy}`);
    console.log(
      "\nSet FORCE_REDEPLOY=true to redeploy (addresses will change — update downstream packages).\n"
    );
    return;
  }

  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();

  const oracleAddress      = process.env.ORACLE_ADDRESS!;
  const arbitratorAddress  = process.env.ARBITRATOR_ADDRESS!;
  const feeRecipient       = process.env.FEE_RECIPIENT_ADDRESS!;
  const usdcAddress        = process.env.USDC_BASE_SEPOLIA!;
  const feeBps             = 50n; // 0.5%

  console.log(`\n[deploy] Deploying Puente contracts to ${networkName} (chainId: ${chainId})`);
  console.log(`  Deployer:   ${deployerAddress}`);
  console.log(`  Oracle:     ${oracleAddress}`);
  console.log(`  Arbitrator: ${arbitratorAddress}`);
  console.log(`  Fee recip:  ${feeRecipient}`);
  console.log(`  USDC:       ${usdcAddress}`);
  console.log(`  Fee bps:    ${feeBps} (${Number(feeBps) / 100}%)\n`);

  // ── Step 1: EscrowFactory UUPS proxy ────────────────────────────────────
  // Deployer address used as a non-zero placeholder for escrowContract_.
  // Replaced in step 3 once the Escrow is deployed.
  console.log("[deploy] 1/4  Deploying EscrowFactory proxy...");
  const EscrowFactoryF = await ethers.getContractFactory("EscrowFactory");
  const factory = (await upgrades.deployProxy(
    EscrowFactoryF,
    [
      deployerAddress,   // owner_
      feeRecipient,      // feeRecipient_
      oracleAddress,     // oracle_
      arbitratorAddress, // arbitrator_
      usdcAddress,       // token_
      feeBps,            // feeBps_
      deployerAddress,   // escrowContract_ — placeholder, replaced in step 3
    ],
    { kind: "uups" }
  )) as unknown as EscrowFactory;
  await factory.waitForDeployment();

  const factoryProxyAddress = await factory.getAddress();
  const factoryImplAddress  = await upgrades.erc1967.getImplementationAddress(factoryProxyAddress);
  console.log(`         proxy:          ${factoryProxyAddress}`);
  console.log(`         implementation: ${factoryImplAddress}`);

  // ── Step 2: Escrow (non-proxy, constructor takes factory address) ────────
  console.log("\n[deploy] 2/4  Deploying Escrow...");
  const EscrowF = await ethers.getContractFactory("Escrow");
  const escrow  = await EscrowF.deploy(factoryProxyAddress);
  await escrow.waitForDeployment();

  const escrowAddress = await escrow.getAddress();
  console.log(`         address: ${escrowAddress}`);

  // ── Step 3: Wire EscrowFactory → Escrow ─────────────────────────────────
  console.log("\n[deploy] 3/4  Linking EscrowFactory → Escrow...");
  const setTx = await factory.setEscrowContract(escrowAddress);
  await setTx.wait();
  console.log(`         setEscrowContract() confirmed (tx: ${setTx.hash})`);

  // ── Step 4: SupplierRegistry UUPS proxy ─────────────────────────────────
  console.log("\n[deploy] 4/4  Deploying SupplierRegistry proxy...");
  const SupplierRegistryF = await ethers.getContractFactory("SupplierRegistry");
  const registry = (await upgrades.deployProxy(
    SupplierRegistryF,
    [deployerAddress], // owner_
    { kind: "uups" }
  )) as unknown as SupplierRegistry;
  await registry.waitForDeployment();

  const registryProxyAddress = await registry.getAddress();
  const registryImplAddress  = await upgrades.erc1967.getImplementationAddress(registryProxyAddress);
  console.log(`         proxy:          ${registryProxyAddress}`);
  console.log(`         implementation: ${registryImplAddress}`);

  // ── Persist deployment record ────────────────────────────────────────────
  const deploymentBlock = await ethers.provider.getBlockNumber();

  const deployment = {
    network:              networkName,
    chainId,
    deployer:             deployerAddress,
    deploymentBlock,
    deploymentTimestamp:  new Date().toISOString(),
    gitCommit:            gitCommit(),
    usdcAddress,
    protocolConfig: {
      feeBps:      Number(feeBps),
      oracle:      oracleAddress,
      arbitrator:  arbitratorAddress,
      feeRecipient,
    },
    EscrowFactory: {
      proxy:          factoryProxyAddress,
      implementation: factoryImplAddress,
    },
    Escrow: {
      address: escrowAddress,
    },
    SupplierRegistry: {
      proxy:          registryProxyAddress,
      implementation: registryImplAddress,
    },
  };

  fs.mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  fs.writeFileSync(deployFile, JSON.stringify(deployment, null, 2));
  console.log(`\n[deploy] Addresses persisted to ${path.relative(process.cwd(), deployFile)}`);

  // ── Source verification ──────────────────────────────────────────────────
  console.log("\n[deploy] Attempting Basescan source verification...");
  // Implementations have no constructor args (UUPS pattern: constructor calls _disableInitializers())
  await verifyContract("EscrowFactory implementation", factoryImplAddress, []);
  await verifyContract("SupplierRegistry implementation", registryImplAddress, []);
  // Escrow is a regular contract whose constructor takes the factory proxy address
  await verifyContract("Escrow", escrowAddress, [factoryProxyAddress]);

  console.log("\n[deploy] Done.\n");
  console.log("Next steps:");
  console.log("  1. Transfer EscrowFactory ownership to a multisig (factory.transferOwnership)");
  console.log("  2. Transfer SupplierRegistry ownership to the same multisig");
  console.log("  3. Update ESCROW_CONTRACT_ADDRESS, ESCROW_FACTORY_ADDRESS,");
  console.log("     SUPPLIER_REGISTRY_ADDRESS in .env (and apps/oracle env)");
  console.log("  4. Fund the oracle wallet so it can submit transactions\n");
}

main().catch((err) => {
  console.error("[deploy] Fatal error:", err);
  process.exit(1);
});
