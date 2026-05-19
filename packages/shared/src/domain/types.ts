/**
 * Domain model types shared between apps/web and apps/oracle.
 * These mirror the Supabase database tables described in CLAUDE.md §6.
 *
 * Design rules:
 *   - All amounts are `string` (numeric string) in the DB tier to avoid
 *     JavaScript integer overflow on large USDC values.
 *   - Currency is always an ISO 4217 code (e.g., "MXN", "USDC", "SGD").
 *     Nothing is hardcoded to a specific corridor currency.
 *   - `id` fields are UUIDs (string).
 *   - Timestamps are ISO 8601 strings from the DB; the oracle may use
 *     `Date` objects internally but serialises to strings before writing.
 *   - On-chain state (escrow ID, tx hash, block number) is preserved
 *     alongside the off-chain mirror so the indexer can reconcile.
 */

// ─── Organisation / User ──────────────────────────────────────────────────────

export type OrganizationRole = 'buyer' | 'supplier' | 'platform';

export interface Organization {
  id: string;
  name: string;
  role: OrganizationRole;
  /** ISO 3166-1 alpha-2 country code of legal registration. */
  country: string;
  /** Wallet address controlled by this org (for on-chain interactions). */
  walletAddress: string;
  createdAt: string;
}

export type UserRole = 'cfo' | 'procurement' | 'supplier_contact' | 'admin';

export interface User {
  id: string;
  organizationId: string;
  email: string;
  role: UserRole;
  /** Optional wallet address for this individual user (may differ from org wallet). */
  walletAddress?: string;
  createdAt: string;
}

// ─── Supplier ─────────────────────────────────────────────────────────────────

export type KybStatus = 'pending' | 'verified' | 'revoked' | 'expired';

export interface Supplier {
  id: string;
  /** Buyer organisation that onboarded this supplier (per-org relationship). */
  buyerOrganizationId: string;
  legalName: string;
  /** Business registration number in the supplier's jurisdiction. */
  registrationNumber: string;
  /** ISO 3166-1 alpha-2 country code of the supplier's legal registration. */
  registrationCountry: string;
  /** Ethereum address of the supplier's receiving wallet. */
  walletAddress: string;
  kybStatus: KybStatus;
  /** bytes32 hex credential hash stored in SupplierRegistry on-chain. Null until KYB passes. */
  onchainCredentialHash?: string;
  /** Unix timestamp of on-chain credential expiry; 0 = no expiry; null = not yet set. */
  onchainCredentialExpiry?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Transaction (escrow mirror) ──────────────────────────────────────────────

export type TransactionState =
  | 'Created'
  | 'Funded'
  | 'Shipped'
  | 'PartialReleased'
  | 'Completed'
  | 'Disputed'
  | 'Resolved';

export interface Transaction {
  id: string;
  /** Matches the uint256 escrow ID emitted by EscrowFactory.EscrowCreated. */
  escrowId: string;
  buyerOrganizationId: string;
  supplierId: string;
  /** Clean USDC amount the supplier receives (fee excluded), in atomic units (6 decimals). */
  amount: string;
  /** Protocol fee in atomic USDC units charged at funding. */
  fee: string;
  /** ISO 4217 code; "USDC" for all on-chain amounts. */
  currency: string;
  state: TransactionState;
  /** Address of the USDC token contract snapshotted at creation. */
  tokenAddress: string;
  /** Escrow contract address handling this trade. */
  escrowAddress: string;
  /** Oracle address snapshotted at escrow creation. */
  oracleAddress: string;
  /** Arbitrator address snapshotted at escrow creation. */
  arbitratorAddress: string;
  /** On-chain tx hash of EscrowCreated event. */
  creationTxHash: string;
  /** On-chain tx hash of EscrowFunded event. Null until funded. */
  fundingTxHash?: string;
  createdAt: string;
  fundedAt?: string;
  shippedAt?: string;
  completedAt?: string;
  updatedAt: string;
}

// ─── Milestone (DB mirror) ────────────────────────────────────────────────────

export type MilestoneState = 'pending' | 'released';

export interface DbMilestone {
  id: string;
  transactionId: string;
  /** Ordinal position within the escrow (0-based). */
  index: number;
  /** bytes32 hex milestone type identifier (matches on-chain). */
  milestoneType: string;
  /** Percentage of total amount released at this milestone. */
  pct: number;
  state: MilestoneState;
  /** USDC atomic amount released. Null until milestone fires. */
  releasedAmount?: string;
  /** On-chain tx hash of the release event. */
  releaseTxHash?: string;
  releasedAt?: string;
}

// ─── Bill of Lading ───────────────────────────────────────────────────────────

export type BillOfLadingVerificationState =
  | 'pending'   // uploaded by supplier, awaiting oracle check
  | 'verified'  // oracle confirmed valid
  | 'rejected'; // oracle found mismatch or invalid

export interface BillOfLading {
  id: string;
  transactionId: string;
  /** The bytes32 hex reference submitted on-chain via confirmShipment / verifyBL. */
  blReference: string;
  /** Supabase storage path of the uploaded PDF/image. */
  documentStoragePath?: string;
  verificationState: BillOfLadingVerificationState;
  /** Unix timestamp of carrier-confirmed arrival; null until oracle records it. */
  arrivalTimestamp?: string;
  /** On-chain tx hash of verifyBL call. */
  verificationTxHash?: string;
  uploadedAt: string;
  verifiedAt?: string;
}

// ─── Document (generic file attachments) ─────────────────────────────────────

export type DocumentType = 'bill_of_lading' | 'kyb_document' | 'invoice' | 'other';

export interface Document {
  id: string;
  transactionId?: string;
  supplierId?: string;
  type: DocumentType;
  name: string;
  /** Supabase storage path. */
  storagePath: string;
  uploadedByUserId: string;
  uploadedAt: string;
}

// ─── Message ──────────────────────────────────────────────────────────────────

export interface Message {
  id: string;
  transactionId: string;
  senderId: string; // User.id
  body: string;
  sentAt: string;
}

// ─── Dispute ──────────────────────────────────────────────────────────────────

export type DisputeState = 'open' | 'resolved';

export interface Dispute {
  id: string;
  transactionId: string;
  raisedByUserId: string;
  raisedAt: string;
  state: DisputeState;
  reason?: string;
  /** USDC atomic amount returned to buyer on resolution. */
  buyerSplit?: string;
  /** USDC atomic amount paid to supplier on resolution. */
  supplierSplit?: string;
  /** On-chain tx hash of resolveDispute call. */
  resolutionTxHash?: string;
  resolvedAt?: string;
}

// ─── Audit event ─────────────────────────────────────────────────────────────

/**
 * Append-only log of every meaningful system event. Written by the indexer
 * for on-chain transitions and by the web app for off-chain actions.
 */
export type AuditEventType =
  | 'escrow_created'
  | 'escrow_funded'
  | 'shipment_confirmed'
  | 'bl_verified'
  | 'tranche1_released'
  | 'arrival_recorded'
  | 'receipt_confirmed'
  | 'funds_released'
  | 'timeout_release'
  | 'dispute_raised'
  | 'dispute_resolved'
  | 'kyb_credential_set'
  | 'kyb_credential_revoked'
  | 'sanctions_screen_cleared'
  | 'sanctions_screen_flagged'
  | 'document_uploaded'
  | 'message_sent';

export interface AuditEvent {
  id: string;
  transactionId?: string;
  supplierId?: string;
  eventType: AuditEventType;
  /** Ethereum address of the signing account (on-chain events) or user wallet. */
  actorAddress?: string;
  /** User.id for off-chain actions; null for pure on-chain events. */
  actorUserId?: string;
  /** On-chain tx hash, if this event originates from a contract event. */
  onchainTxHash?: string;
  blockNumber?: string;
  /** Additional structured payload; schema depends on eventType. */
  data: Record<string, unknown>;
  occurredAt: string;
}

// ─── Ledger entry (double-entry accounting) ───────────────────────────────────

/**
 * One row in the double-entry ledger. Every fund-affecting event produces a
 * balanced set of entries (total debits == total credits for the group).
 * The chain is the source of truth for funds; this table is the accounting
 * interpretation written by the indexer.
 *
 * Account naming convention:
 *   "escrow:<escrowId>"     — funds held by the escrow contract
 *   "buyer:<address>"       — buyer's economic position
 *   "supplier:<address>"    — supplier's economic position
 *   "fee_recipient:<addr>"  — protocol fee recipient
 */
export interface LedgerEntry {
  id: string;
  transactionId: string;
  /** The account being debited or credited. */
  account: string;
  /** Amount debited (positive). Exactly one of debit/credit is non-zero per row. */
  debit: string;   // numeric string, USDC atomic units
  credit: string;  // numeric string, USDC atomic units
  /** ISO 4217 currency code; "USDC" for all on-chain entries. */
  currency: string;
  /** Reference to the originating on-chain event (tx hash). */
  onchainEventRef?: string;
  occurredAt: string;
}
