/**
 * @puente/shared — single import point for the Puente platform.
 *
 * Exports (in order):
 *   1. Contract ABIs  — typed `as const` arrays for viem / wagmi
 *   2. On-chain types — EscrowState enum, struct mirrors, typed event shapes
 *   3. Domain types   — database-aligned entities (Organization, Transaction, …)
 *   4. Adapter interfaces — the "interfaces over integrations" seam
 *
 * This package has ZERO runtime dependencies. It must never import any
 * concrete partner SDK or any code from apps/web or apps/oracle.
 */

// ── 1. Contract ABIs ──────────────────────────────────────────────────────────
export { EscrowAbi, EscrowFactoryAbi, SupplierRegistryAbi } from './abis';

// ── 2. On-chain types ─────────────────────────────────────────────────────────
export {
  EscrowState,
  SupplierStatus,
  type OnchainMilestone,
  type OnchainEscrowRecord,
  type OnchainCredential,
} from './onchain';

export type {
  // Escrow events
  EscrowFundedEvent,
  ShipmentConfirmedEvent,
  Tranche1ReleasedEvent,
  FundsReleasedEvent,
  ArrivalRecordedEvent,
  DisputeRaisedEvent,
  DisputeResolvedEvent,
  // EscrowFactory events
  EscrowCreatedEvent,
  EscrowContractUpdatedEvent,
  FeeBpsUpdatedEvent,
  FeeRecipientUpdatedEvent,
  OracleUpdatedEvent,
  ArbitratorUpdatedEvent,
  // SupplierRegistry events
  CredentialSetEvent,
  CredentialRevokedEvent,
  OperatorUpdatedEvent,
  // Union
  PuenteContractEvent,
} from './onchain';

// ── 3. Domain types ───────────────────────────────────────────────────────────
export type {
  OrganizationRole,
  Organization,
  UserRole,
  User,
  KybStatus,
  Supplier,
  TransactionState,
  Transaction,
  MilestoneState,
  DbMilestone,
  BillOfLadingVerificationState,
  BillOfLading,
  DocumentType,
  Document,
  Message,
  DisputeState,
  Dispute,
  AuditEventType,
  AuditEvent,
  LedgerEntry,
} from './domain';

// ── 4. Adapter interfaces ─────────────────────────────────────────────────────
export type {
  // On-ramp
  OnRampQuote,
  OnRampStatus,
  OnRampStatusState,
  OnRampAdapter,
  // Off-ramp
  SupplierBankAccount,
  OffRampQuote,
  OffRampStatus,
  OffRampStatusState,
  OffRampAdapter,
  // Carrier API
  BillOfLadingVerification,
  ArrivalInfo,
  CarrierApiAdapter,
  // KYB
  KybSubject,
  KybCredential,
  KybProvider,
  // Sanctions screening
  ScreeningSubject,
  SanctionsMatch,
  SanctionsScreeningResult,
  SanctionsScreeningProvider,
  // KYT / transaction monitoring
  TransactionContext,
  KytFlagReason,
  KytAssessment,
  TransactionMonitoringProvider,
} from './adapters';
