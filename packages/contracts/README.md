# contracts

Hardhat (TypeScript) project containing the Puente smart contracts deployed on Base.

## Planned contracts

- **`EscrowFactory`** — deploys and tracks escrow instances; holds protocol-level config (fee bps, fee recipient, oracle address, arbitrator address, USDC token address). UUPS upgradeable.
- **`Escrow`** — single shared contract holding all per-escrow state in mappings keyed by escrow ID. Terms are immutable once funded. Implements the full milestone state machine.
- **`SupplierRegistry`** — anchors KYB credential hashes on-chain with a status flag and expiry timestamp. UUPS upgradeable.

## Tooling

- **Hardhat** with `hardhat-toolbox` (ethers v6, chai, typechain, hardhat-gas-reporter, solidity-coverage)
- **OpenZeppelin v5** for access control, UUPS upgradeability, `ReentrancyGuard`, and `SafeERC20`
- **Solidity 0.8.28** with optimizer enabled (200 runs)

## Networks

| Name | Chain ID | Variable |
|------|----------|----------|
| Base Sepolia | 84532 | `BASE_SEPOLIA_RPC_URL` |
| Base mainnet | 8453 | `BASE_MAINNET_RPC_URL` |

## Commands

```bash
pnpm build            # hardhat compile
pnpm test             # hardhat test
pnpm coverage         # solidity-coverage report
pnpm clean            # remove artifacts and cache
```

Required env vars: `BASE_SEPOLIA_RPC_URL`, `BASE_MAINNET_RPC_URL`, `DEPLOYER_PRIVATE_KEY`, `BASESCAN_API_KEY`. See root `.env.example`.
