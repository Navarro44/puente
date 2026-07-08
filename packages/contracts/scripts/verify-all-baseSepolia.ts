/**
 * scripts/verify-all-baseSepolia.ts
 *
 * Verifies the three deployed Puente contract implementations on Base Sepolia
 * using the Basescan source API.  Idempotent: contracts that are already
 * verified are skipped rather than causing a failure.
 *
 * Addresses are read from deployments/baseSepolia.json — never from .env.
 *
 * Run:
 *   pnpm --filter contracts run verify:all:baseSepolia
 *
 * The three targets:
 *   1. EscrowFactory implementation  — no constructor args (UUPS: _disableInitializers)
 *   2. Escrow                        — constructor arg: EscrowFactory proxy address
 *   3. SupplierRegistry implementation — no constructor args (UUPS: _disableInitializers)
 */

import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { run } from "hardhat";

// Load root .env (three directories up: scripts/ → contracts/ → packages/ → repo root)
dotenv.config({ path: path.join(__dirname, "../../../.env") });

// ── Deployment record ─────────────────────────────────────────────────────────

interface DeploymentRecord {
  network: string;
  EscrowFactory: { proxy: string; implementation: string };
  Escrow:        { address: string };
  SupplierRegistry: { proxy: string; implementation: string };
}

function loadDeployment(): DeploymentRecord {
  const deployFile = path.join(__dirname, "../deployments/baseSepolia.json");
  if (!fs.existsSync(deployFile)) {
    console.error(
      `\n[verify-all] Deployment file not found: ${deployFile}\n` +
      `             Run "pnpm deploy:baseSepolia" first.\n`,
    );
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(deployFile, "utf-8")) as DeploymentRecord;
}

// ── Verification helper ───────────────────────────────────────────────────────

async function verifyOne(
  label: string,
  address: string,
  constructorArguments: unknown[],
): Promise<void> {
  console.log(`\n[verify-all] ${label}`);
  console.log(`             address: ${address}`);
  if (constructorArguments.length) {
    console.log(`             constructor args: ${constructorArguments.join(", ")}`);
  }

  try {
    await run("verify:verify", { address, constructorArguments });
    console.log(`             ✓ verified`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.toLowerCase().includes("already verified") ||
      msg.toLowerCase().includes("contract source code already verified")
    ) {
      console.log(`             ✓ already verified (skipping)`);
    } else {
      console.error(`             ✗ FAILED: ${msg}`);
      throw err;
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const deployment = loadDeployment();

  console.log(`\n[verify-all] Verifying Puente contracts on ${deployment.network}`);
  console.log(`             EscrowFactory impl:   ${deployment.EscrowFactory.implementation}`);
  console.log(`             Escrow:               ${deployment.Escrow.address}`);
  console.log(`             SupplierRegistry impl: ${deployment.SupplierRegistry.implementation}`);

  // 1. EscrowFactory implementation — UUPS pattern, no constructor args
  await verifyOne(
    "EscrowFactory implementation",
    deployment.EscrowFactory.implementation,
    [],
  );

  // 2. Escrow — regular contract; constructor takes the factory proxy address
  await verifyOne(
    "Escrow",
    deployment.Escrow.address,
    [deployment.EscrowFactory.proxy],
  );

  // 3. SupplierRegistry implementation — UUPS pattern, no constructor args
  await verifyOne(
    "SupplierRegistry implementation",
    deployment.SupplierRegistry.implementation,
    [],
  );

  console.log("\n[verify-all] All contracts verified.\n");
}

main().catch((err: unknown) => {
  console.error("\n[verify-all] Fatal error:", err);
  process.exit(1);
});
