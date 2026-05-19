// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @dev Milestone descriptor. All milestones for an escrow must sum to 100 (percent).
struct Milestone {
    bytes32 milestoneType; // caller-defined identifier; use the MILESTONE_* constants
    uint256 pct;           // percentage of escrow amount released at this milestone (0–100)
}

/// @title Escrow
/// @notice Single shared contract that holds all per-escrow state in mappings keyed by escrow
///         ID. One deployed contract handles every trade, avoiding per-transaction bytecode
///         overhead and keeping storage access O(1) — the primary gas rationale for this design.
///
///         Fee-at-funding: the buyer bears the protocol fee so the supplier always receives the
///         clean agreed amount. Fee is forwarded immediately to feeRecipient at funding time;
///         only `amount` is held by this contract thereafter.
///
///         Only EscrowFactory may call `create`; all other functions are called directly by the
///         relevant party (buyer, supplier, oracle, arbitrator, or public for timeoutRelease).
contract Escrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Constants ────────────────────────────────────────────────────────────

    uint256 public constant TIMEOUT_PERIOD = 14 days;

    /// Well-known milestone types; callers may use any bytes32 that fits their workflow.
    bytes32 public constant MILESTONE_BL_VERIFIED       = keccak256("BL_VERIFIED");
    bytes32 public constant MILESTONE_RECEIPT_CONFIRMED = keccak256("RECEIPT_CONFIRMED");

    // ─── State enum ───────────────────────────────────────────────────────────

    enum EscrowState {
        Created,          // 0: registered, awaiting funding
        Funded,           // 1: buyer funded; terms now immutable
        Shipped,          // 2: supplier confirmed shipment + B/L reference
        PartialReleased,  // 3: oracle verified B/L; tranche 1 released to supplier
        Completed,        // 4: all funds released (tranche 2 paid)
        Disputed,         // 5: buyer raised dispute; remaining funds frozen
        Resolved          // 6: arbitrator split remaining funds
    }

    // ─── Per-escrow record ────────────────────────────────────────────────────

    struct EscrowRecord {
        address buyer;
        address supplier;
        uint256 amount;           // clean amount (fee excluded); total received by supplier
        uint256 fee;              // protocol fee forwarded at funding
        address feeRecipient;
        EscrowState state;
        bytes32 blReference;      // bill-of-lading reference supplied by carrier / confirmed by oracle
        address oracle;           // snapshotted at creation; immutable per escrow
        address arbitrator;       // snapshotted at creation; immutable per escrow
        IERC20 token;             // USDC address snapshotted at creation
        uint256 createdAt;
        uint256 fundedAt;
        uint256 shippedAt;
        uint256 completedAt;
        uint256 arrivalTimestamp; // carrier-confirmed arrival recorded by oracle; 0 = not yet set
        uint256 releasedAmount;   // amount already paid (tranche 1); used to compute remainder
        Milestone[] milestones;   // exactly 2 for Phase 1; pct values must sum to 100
    }

    // ─── Storage ──────────────────────────────────────────────────────────────

    address public immutable factory;
    mapping(uint256 => EscrowRecord) private _escrows;

    // ─── Events ───────────────────────────────────────────────────────────────

    event EscrowFunded(uint256 indexed escrowId, address indexed buyer, uint256 amount, uint256 fee);
    event ShipmentConfirmed(uint256 indexed escrowId, address indexed supplier, bytes32 blReference);
    event Tranche1Released(uint256 indexed escrowId, address indexed supplier, uint256 amount);
    event FundsReleased(uint256 indexed escrowId, address indexed supplier, uint256 amount);
    event ArrivalRecorded(uint256 indexed escrowId, uint256 arrivalTimestamp);
    event DisputeRaised(uint256 indexed escrowId, address indexed buyer);
    event DisputeResolved(
        uint256 indexed escrowId,
        address indexed arbitrator,
        uint256 buyerAmount,
        uint256 supplierAmount
    );

    // ─── Custom errors ────────────────────────────────────────────────────────

    error OnlyFactory();
    error EscrowNotFound(uint256 escrowId);
    error WrongState(uint256 escrowId, EscrowState current, EscrowState required);
    error OnlyBuyer(uint256 escrowId);
    error OnlySupplier(uint256 escrowId);
    error OnlyOracle(uint256 escrowId);
    error OnlyArbitrator(uint256 escrowId);
    error InvalidSplitSum(uint256 buyerSplit, uint256 supplierSplit, uint256 balance);
    error ZeroAmount();
    error InvalidMilestones();        // wrong count or pct does not sum to 100
    error NoArrivalTimestamp(uint256 escrowId);
    error TimeoutNotElapsed(uint256 escrowId);

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(address factory_) {
        require(factory_ != address(0), "zero factory");
        factory = factory_;
    }

    // ─── Factory-only registration ────────────────────────────────────────────

    /// @notice Called exclusively by EscrowFactory.createEscrow. Snapshots all immutable
    ///         protocol parameters so that subsequent factory config changes do not affect
    ///         live escrows.
    /// @param milestones_ Exactly 2 milestones for Phase 1. pct values must sum to 100.
    ///        Phase 2: relax the length == 2 constraint to support N tranches without
    ///        altering this function's signature.
    function create(
        uint256 escrowId,
        address buyer,
        address supplier,
        uint256 amount,
        uint256 fee,
        address feeRecipient,
        address oracle,
        address arbitrator,
        address token,
        Milestone[] calldata milestones_
    ) external {
        if (msg.sender != factory) revert OnlyFactory();
        if (amount == 0) revert ZeroAmount();
        if (milestones_.length != 2) revert InvalidMilestones();
        if (milestones_[0].pct + milestones_[1].pct != 100) revert InvalidMilestones();

        EscrowRecord storage r = _escrows[escrowId];
        require(r.buyer == address(0), "escrow exists");

        r.buyer = buyer;
        r.supplier = supplier;
        r.amount = amount;
        r.fee = fee;
        r.feeRecipient = feeRecipient;
        r.oracle = oracle;
        r.arbitrator = arbitrator;
        r.token = IERC20(token);
        r.state = EscrowState.Created;
        r.createdAt = block.timestamp;
        r.milestones.push(milestones_[0]);
        r.milestones.push(milestones_[1]);
    }

    // ─── State transitions ────────────────────────────────────────────────────

    /// @notice Buyer funds the escrow by transferring `amount + fee` USDC.
    function fund(uint256 escrowId) external nonReentrant {
        EscrowRecord storage r = _escrowOrRevert(escrowId);
        if (r.state != EscrowState.Created) revert WrongState(escrowId, r.state, EscrowState.Created);
        if (msg.sender != r.buyer) revert OnlyBuyer(escrowId);

        r.state = EscrowState.Funded;
        r.fundedAt = block.timestamp;

        uint256 total = r.amount + r.fee;
        r.token.safeTransferFrom(msg.sender, address(this), total);
        if (r.fee > 0) {
            r.token.safeTransfer(r.feeRecipient, r.fee);
        }

        emit EscrowFunded(escrowId, msg.sender, r.amount, r.fee);
    }

    /// @notice Supplier records a shipment and attaches a bill-of-lading reference.
    ///         This is a claim, not a verification — the oracle verifies separately.
    function confirmShipment(uint256 escrowId, bytes32 blReference) external nonReentrant {
        EscrowRecord storage r = _escrowOrRevert(escrowId);
        if (r.state != EscrowState.Funded) revert WrongState(escrowId, r.state, EscrowState.Funded);
        if (msg.sender != r.supplier) revert OnlySupplier(escrowId);

        r.state = EscrowState.Shipped;
        r.blReference = blReference;
        r.shippedAt = block.timestamp;

        emit ShipmentConfirmed(escrowId, msg.sender, blReference);
    }

    /// @notice Oracle verifies the bill of lading and releases tranche 1 to the supplier,
    ///         moving the escrow to PartialReleased.
    /// @dev Authorization is delegated to _isAuthorizedOracle so that the check can be
    ///      upgraded in Phase 2 to a threshold-attester model (e.g. IAttesterSet.isMember +
    ///      quorum check) WITHOUT changing this function's signature or its events.
    function verifyBL(uint256 escrowId, bytes32 blRef) external nonReentrant {
        EscrowRecord storage r = _escrowOrRevert(escrowId);
        if (r.state != EscrowState.Shipped) revert WrongState(escrowId, r.state, EscrowState.Shipped);
        if (!_isAuthorizedOracle(msg.sender, escrowId)) revert OnlyOracle(escrowId);

        uint256 tranche1 = r.amount * r.milestones[0].pct / 100;
        r.state = EscrowState.PartialReleased;
        r.blReference = blRef;
        r.releasedAmount = tranche1;

        if (tranche1 > 0) {
            r.token.safeTransfer(r.supplier, tranche1);
        }

        emit Tranche1Released(escrowId, r.supplier, tranche1);
    }

    /// @notice Oracle records the carrier-confirmed arrival timestamp, starting the 14-day
    ///         buyer-confirmation window. Must be called from PartialReleased state.
    ///         Authorization uses the same _isAuthorizedOracle seam as verifyBL.
    function recordArrival(uint256 escrowId) external {
        EscrowRecord storage r = _escrowOrRevert(escrowId);
        if (r.state != EscrowState.PartialReleased) {
            revert WrongState(escrowId, r.state, EscrowState.PartialReleased);
        }
        if (!_isAuthorizedOracle(msg.sender, escrowId)) revert OnlyOracle(escrowId);

        r.arrivalTimestamp = block.timestamp;

        emit ArrivalRecorded(escrowId, block.timestamp);
    }

    /// @notice Buyer confirms receipt of goods, releasing the remaining tranche 2 to supplier.
    function confirmReceipt(uint256 escrowId) external nonReentrant {
        EscrowRecord storage r = _escrowOrRevert(escrowId);
        if (r.state != EscrowState.PartialReleased) {
            revert WrongState(escrowId, r.state, EscrowState.PartialReleased);
        }
        if (msg.sender != r.buyer) revert OnlyBuyer(escrowId);

        uint256 payout = r.amount - r.releasedAmount;
        r.state = EscrowState.Completed;
        r.completedAt = block.timestamp;

        if (payout > 0) {
            r.token.safeTransfer(r.supplier, payout);
        }

        emit FundsReleased(escrowId, r.supplier, payout);
    }

    /// @notice Permissionless fallback: releases tranche 2 to the supplier once 14 days have
    ///         elapsed since the carrier-confirmed arrival. Anyone may call this to unstick
    ///         an escrow where the buyer is unresponsive. Funds still go to the supplier.
    function timeoutRelease(uint256 escrowId) external nonReentrant {
        EscrowRecord storage r = _escrowOrRevert(escrowId);
        if (r.state != EscrowState.PartialReleased) {
            revert WrongState(escrowId, r.state, EscrowState.PartialReleased);
        }
        if (r.arrivalTimestamp == 0) revert NoArrivalTimestamp(escrowId);
        if (block.timestamp < r.arrivalTimestamp + TIMEOUT_PERIOD) revert TimeoutNotElapsed(escrowId);

        uint256 payout = r.amount - r.releasedAmount;
        r.state = EscrowState.Completed;
        r.completedAt = block.timestamp;

        if (payout > 0) {
            r.token.safeTransfer(r.supplier, payout);
        }

        emit FundsReleased(escrowId, r.supplier, payout);
    }

    /// @notice Buyer freezes the escrow. Allowed from Funded, Shipped, or PartialReleased.
    ///         When called from PartialReleased, only the remaining (unreleased) balance is
    ///         frozen — tranche 1 is already with the supplier.
    function raiseDispute(uint256 escrowId) external nonReentrant {
        EscrowRecord storage r = _escrowOrRevert(escrowId);
        EscrowState s = r.state;
        if (s != EscrowState.Funded && s != EscrowState.Shipped && s != EscrowState.PartialReleased) {
            revert WrongState(escrowId, s, EscrowState.Funded);
        }
        if (msg.sender != r.buyer) revert OnlyBuyer(escrowId);

        r.state = EscrowState.Disputed;

        emit DisputeRaised(escrowId, msg.sender);
    }

    /// @notice Arbitrator resolves a dispute by splitting the REMAINING balance (after any
    ///         tranche 1 release) between buyer and supplier. buyerSplit + supplierSplit must
    ///         equal r.amount - r.releasedAmount exactly. No other destination is permitted.
    function resolveDispute(
        uint256 escrowId,
        uint256 buyerSplit,
        uint256 supplierSplit
    ) external nonReentrant {
        EscrowRecord storage r = _escrowOrRevert(escrowId);
        if (r.state != EscrowState.Disputed) revert WrongState(escrowId, r.state, EscrowState.Disputed);
        if (msg.sender != r.arbitrator) revert OnlyArbitrator(escrowId);

        uint256 balance = r.amount - r.releasedAmount;
        if (buyerSplit + supplierSplit != balance) {
            revert InvalidSplitSum(buyerSplit, supplierSplit, balance);
        }

        r.state = EscrowState.Resolved;
        r.completedAt = block.timestamp;

        if (buyerSplit > 0) r.token.safeTransfer(r.buyer, buyerSplit);
        if (supplierSplit > 0) r.token.safeTransfer(r.supplier, supplierSplit);

        emit DisputeResolved(escrowId, msg.sender, buyerSplit, supplierSplit);
    }

    // ─── View helpers ─────────────────────────────────────────────────────────

    function getEscrow(uint256 escrowId) external view returns (EscrowRecord memory) {
        return _escrowOrRevert(escrowId);
    }

    function getState(uint256 escrowId) external view returns (EscrowState) {
        return _escrowOrRevert(escrowId).state;
    }

    // ─── Oracle authorization seam ────────────────────────────────────────────

    /// @dev Phase 1: single oracle address per escrow, snapshotted at creation.
    ///      Phase 2: replace the body with a threshold-attester check, e.g.:
    ///        IAttesterSet(escrow.oracle).isMember(caller) && meetsThreshold()
    ///      The function signature, its callers (verifyBL, recordArrival), and their
    ///      events remain unchanged across the upgrade.
    function _isAuthorizedOracle(address caller, uint256 escrowId) internal view returns (bool) {
        return caller == _escrows[escrowId].oracle;
    }

    // ─── Internal helpers ─────────────────────────────────────────────────────

    function _escrowOrRevert(uint256 escrowId) internal view returns (EscrowRecord storage) {
        EscrowRecord storage r = _escrows[escrowId];
        if (r.buyer == address(0)) revert EscrowNotFound(escrowId);
        return r;
    }
}
