import * as dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { HardhatUserConfig, task } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";

task("export-abis", "Copy compiled ABIs to abis/ for off-chain consumers").setAction(
  async (_, hre) => {
    const contracts = ["Escrow", "EscrowFactory", "SupplierRegistry"];
    const abisDir = path.join(__dirname, "abis");
    fs.mkdirSync(abisDir, { recursive: true });
    for (const name of contracts) {
      const artifact = await hre.artifacts.readArtifact(name);
      const dest = path.join(abisDir, `${name}.json`);
      fs.writeFileSync(dest, JSON.stringify(artifact.abi, null, 2));
      console.log(`  exported ${name}.json`);
    }
  }
);

// Load root .env so RPC URLs and keys are available when running from the
// packages/contracts directory (two levels up from repo root).
dotenv.config({ path: path.join(__dirname, "../../.env") });

const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
const accounts = deployerKey ? [deployerKey] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {},
    baseSepolia: {
      url: process.env.BASE_SEPOLIA_RPC_URL ?? "",
      accounts,
      chainId: 84532,
    },
    base: {
      url: process.env.BASE_MAINNET_RPC_URL ?? "",
      accounts,
      chainId: 8453,
    },
  },
  // hardhat-verify v2: single API key works for all Etherscan-compatible chains
  // (Etherscan v2 API). Base and Base Sepolia are built-in — no customChains needed.
  etherscan: {
    apiKey: process.env.BASESCAN_API_KEY ?? "",
  },
  sourcify: {
    enabled: false,
  },
};

export default config;
