/**
 * Typed event parameter shapes for all events emitted by the Puente contracts.
 * Each interface corresponds to one Solidity event's decoded arguments.
 * The oracle's indexer uses these to type-check its event handlers.
 *
 * Indexed fields are included here as decoded values (strings / bigints),
 * NOT as raw topic hashes.
 */

// ─── Escrow events ────────────────────────────────────────────────────────────

export interface EscrowFundedEvent {
  escrowId: bigint;  // indexed
  buyer: string;     // indexed
  amount: bigint;
  fee: bigint;
}

export interface ShipmentConfirmedEvent {
  escrowId: bigint;  // indexed
  supplier: string;  // indexed
  blReference: string; // bytes32 hex
}

export interface Tranche1ReleasedEvent {
  escrowId: bigint;  // indexed
  supplier: string;  // indexed
  amount: bigint;
}

export interface FundsReleasedEvent {
  escrowId: bigint;  // indexed
  supplier: string;  // indexed
  amount: bigint;
}

export interface ArrivalRecordedEvent {
  escrowId: bigint;        // indexed
  arrivalTimestamp: bigint;
}

export interface DisputeRaisedEvent {
  escrowId: bigint; // indexed
  buyer: string;    // indexed
}

export interface DisputeResolvedEvent {
  escrowId: bigint;    // indexed
  arbitrator: string;  // indexed
  buyerAmount: bigint;
  supplierAmount: bigint;
}

// ─── EscrowFactory events ─────────────────────────────────────────────────────

export interface EscrowCreatedEvent {
  escrowId: bigint;  // indexed
  buyer: string;     // indexed
  supplier: string;  // indexed
  amount: bigint;
  fee: bigint;
  oracle: string;
  arbitrator: string;
  token: string;
}

export interface EscrowContractUpdatedEvent {
  oldEscrow: string;
  newEscrow: string;
}

export interface FeeBpsUpdatedEvent {
  oldFeeBps: bigint;
  newFeeBps: bigint;
}

export interface FeeRecipientUpdatedEvent {
  oldRecipient: string;
  newRecipient: string;
}

export interface OracleUpdatedEvent {
  oldOracle: string;
  newOracle: string;
}

export interface ArbitratorUpdatedEvent {
  oldArbitrator: string;
  newArbitrator: string;
}

// ─── SupplierRegistry events ──────────────────────────────────────────────────

export interface CredentialSetEvent {
  supplier: string;        // indexed
  credentialHash: string;  // bytes32 hex
  expiry: bigint;
}

export interface CredentialRevokedEvent {
  supplier: string; // indexed
}

export interface OperatorUpdatedEvent {
  operator: string; // indexed
  enabled: boolean;
}

// ─── Union type for all indexable events ─────────────────────────────────────

/** All events the Puente indexer must handle. */
export type PuenteContractEvent =
  | EscrowFundedEvent
  | ShipmentConfirmedEvent
  | Tranche1ReleasedEvent
  | FundsReleasedEvent
  | ArrivalRecordedEvent
  | DisputeRaisedEvent
  | DisputeResolvedEvent
  | EscrowCreatedEvent
  | CredentialSetEvent
  | CredentialRevokedEvent;
