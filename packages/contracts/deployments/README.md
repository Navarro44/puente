# Contract deployment records

Each file in this directory is the authoritative address book for one network:

| File | Network |
|---|---|
| `baseSepolia.json` | Base Sepolia testnet (chainId 84532) |
| `base.json` | Base mainnet (chainId 8453) |

These files are **committed to git**. Contract addresses are public information, not secrets.

## File structure

```json
{
  "network": "baseSepolia",
  "chainId": 84532,
  "deployer": "0x...",
  "deploymentBlock": 12345678,
  "deploymentTimestamp": "2025-01-01T00:00:00.000Z",
  "gitCommit": "abc123...",
  "usdcAddress": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "protocolConfig": {
    "feeBps": 50,
    "oracle": "0x...",
    "arbitrator": "0x...",
    "feeRecipient": "0x..."
  },
  "EscrowFactory": {
    "proxy": "0x...",
    "implementation": "0x..."
  },
  "Escrow": {
    "address": "0x..."
  },
  "SupplierRegistry": {
    "proxy": "0x...",
    "implementation": "0x..."
  }
}
```

Downstream packages (`apps/oracle`, `apps/web`) read proxy addresses from this file
to know where to send transactions.

## How to deploy

Ensure `.env` is populated (see `.env.example`), then:

```sh
pnpm deploy:baseSepolia
```

The script deploys four steps in order and writes the resulting addresses here.

## How to redeploy

If `baseSepolia.json` already exists, the script exits cleanly and prints the current
addresses. To force a fresh deployment:

```sh
FORCE_REDEPLOY=true pnpm deploy:baseSepolia
```

> **Warning — addresses change on redeploy.** Every downstream consumer hard-references
> the proxy addresses in this file. After a redeploy:
> - Update `ESCROW_CONTRACT_ADDRESS`, `ESCROW_FACTORY_ADDRESS`, and
>   `SUPPLIER_REGISTRY_ADDRESS` in `.env` and in the oracle's environment.
> - The old proxy contracts remain on-chain; any funds inside them remain accessible
>   to the original parties via direct contract calls.

## Upgrade vs. redeploy

The contracts use UUPS proxies (`EscrowFactory`, `SupplierRegistry`). To upgrade an
implementation without changing the proxy address, use the OpenZeppelin upgrades plugin
directly — do not redeploy the proxy. Only the `Escrow` contract (non-proxy) requires
a full redeploy for contract changes.

## Mainnet deployment checklist

Mainnet deployments **must not** use a private key stored in `.env`. Use a hardware
wallet (Ledger / Trezor via `hardhat-ledger`) or a dedicated KMS-protected signing key
(AWS KMS, GCP Cloud HSM, HashiCorp Vault). The `.env` approach is for testnets only.

Before deploying to mainnet:

- [ ] Smart contract audit completed and all findings addressed
- [ ] Deployer key sourced from hardware wallet or KMS (never `.env`)
- [ ] `FORCE_REDEPLOY` not set (idempotency guard must be active)
- [ ] `USDC_BASE_MAINNET` verified as the canonical Circle USDC on Base mainnet
      (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`)
- [ ] Basescan source verification confirmed before transferring ownership
- [ ] Ownership transferred to a multisig immediately after deployment
