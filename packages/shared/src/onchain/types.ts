/**
 * On-chain type definitions for Puente contracts.
 * Values here must stay in sync with the Solidity source; the enum integer
 * values are verified against the contract by the oracle's indexer.
 */

// ─── EscrowState ──────────────────────────────────────────────────────────────
// Must match Escrow.sol EscrowState enum exactly, value-for-value.

export enum EscrowState {
  Created         = 0, // registered, awaiting funding
  Funded          = 1, // buyer funded; terms now immutable
  Shipped         = 2, // supplier confirmed shipment + B/L reference
  PartialReleased = 3, // oracle verified B/L; tranche 1 released to supplier
  Completed       = 4, // all funds released (tranche 2 paid)
  Disputed        = 5, // buyer raised dispute; remaining funds frozen
  Resolved        = 6, // arbitrator split remaining funds
}

// ─── SupplierStatus ───────────────────────────────────────────────────────────
// Must match SupplierRegistry.sol SupplierStatus enum exactly.

export enum SupplierStatus {
  None     = 0,
  Verified = 1,
  Revoked  = 2,
}

// ─── Milestone ────────────────────────────────────────────────────────────────

/** Structural mirror of the Solidity Milestone struct. */
export interface OnchainMilestone {
  /** keccak256 identifier for the milestone type.
   *  Use MILESTONE_BL_VERIFIED or MILESTONE_RECEIPT_CONFIRMED (Escrow constants). */
  milestoneType: string; // bytes32 hex string
  /** Percentage of escrow amount released at this milestone (0–100). */
  pct: bigint;
}

// Well-known milestone type keccak256 identifiers.
// These match Escrow.sol's MILESTONE_BL_VERIFIED and MILESTONE_RECEIPT_CONFIRMED constants.
// Compute at call time via ethers.id("BL_VERIFIED") or viem's keccak256(toBytes("BL_VERIFIED"))
// rather than hardcoding the hash here, so any toolchain version change is caught early.

// ─── EscrowRecord ─────────────────────────────────────────────────────────────

/**
 * Structural mirror of Escrow.sol EscrowRecord.
 * All uint256 fields are bigint; addresses are hex strings.
 * This is the decoded shape returned by `escrow.getEscrow(id)`.
 */
export interface OnchainEscrowRecord {
  buyer: string;
  supplier: string;
  amount: bigint;
  fee: bigint;
  feeRecipient: string;
  state: EscrowState;
  blReference: string; // bytes32 hex string
  oracle: string;
  arbitrator: string;
  token: string;
  createdAt: bigint;
  fundedAt: bigint;
  shippedAt: bigint;
  completedAt: bigint;
  arrivalTimestamp: bigint; // 0 = not yet set
  releasedAmount: bigint;
  milestones: OnchainMilestone[];
}

// ─── SupplierCredential ───────────────────────────────────────────────────────

/** Structural mirror of SupplierRegistry.sol Credential struct. */
export interface OnchainCredential {
  credentialHash: string; // bytes32 hex string — keccak256 of the off-chain KYB bundle
  status: SupplierStatus;
  expiry: bigint; // unix timestamp; 0 = no expiry
}
