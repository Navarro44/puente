// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "./Escrow.sol";

/// @title EscrowFactory
/// @notice UUPS-upgradeable registry and configuration hub for the Puente
///         escrow system. Holds protocol-wide parameters (fee, oracle, arbitrator)
///         and creates new escrow records in the shared Escrow contract.
///
///         Pause semantics: pausing halts NEW escrow creation only. It never
///         freezes, redirects, or blocks settlement of already-funded escrows.
///         The owner has no path to touch funds held inside any escrow record.
contract EscrowFactory is Initializable, OwnableUpgradeable, PausableUpgradeable, UUPSUpgradeable {

    // ─── Protocol configuration ───────────────────────────────────────────────

    uint256 public feeBps;         // protocol fee in basis points (target: 50 = 0.5 %)
    address public feeRecipient;
    address public oracle;
    address public arbitrator;
    address public token;          // USDC on Base

    // ─── Escrow contract reference ────────────────────────────────────────────

    Escrow public escrowContract;

    // ─── Escrow ID counter ────────────────────────────────────────────────────

    uint256 private _escrowCounter;

    // ─── Events ───────────────────────────────────────────────────────────────

    /// @dev Carries all terms so an off-chain indexer can reconstruct escrow state
    ///      without reading contract storage.
    event EscrowCreated(
        uint256 indexed escrowId,
        address indexed buyer,
        address indexed supplier,
        uint256 amount,
        uint256 fee,
        address oracle,
        address arbitrator,
        address token
    );

    event EscrowContractUpdated(address oldEscrow, address newEscrow);
    event FeeBpsUpdated(uint256 oldFeeBps, uint256 newFeeBps);
    event FeeRecipientUpdated(address oldRecipient, address newRecipient);
    event OracleUpdated(address oldOracle, address newOracle);
    event ArbitratorUpdated(address oldArbitrator, address newArbitrator);

    // ─── Custom errors ────────────────────────────────────────────────────────

    error ZeroAddress();
    error InvalidFeeBps(uint256 feeBps);

    // ─── Initializer (replaces constructor for UUPS proxies) ─────────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address owner_,
        address feeRecipient_,
        address oracle_,
        address arbitrator_,
        address token_,
        uint256 feeBps_,
        address escrowContract_
    ) external initializer {
        if (feeRecipient_ == address(0)) revert ZeroAddress();
        if (oracle_ == address(0)) revert ZeroAddress();
        if (arbitrator_ == address(0)) revert ZeroAddress();
        if (token_ == address(0)) revert ZeroAddress();
        if (escrowContract_ == address(0)) revert ZeroAddress();
        if (feeBps_ > 10_000) revert InvalidFeeBps(feeBps_);

        __Ownable_init(owner_);
        __Pausable_init();

        feeRecipient = feeRecipient_;
        oracle = oracle_;
        arbitrator = arbitrator_;
        token = token_;
        feeBps = feeBps_;
        escrowContract = Escrow(escrowContract_);
    }

    // ─── Core action ──────────────────────────────────────────────────────────

    /// @notice Create a new escrow. msg.sender is recorded as the buyer.
    ///         Protocol config (oracle, arbitrator, fee) is snapshotted so
    ///         subsequent owner config changes do not affect live escrows.
    /// @param supplier   Counterparty who will receive funds upon successful delivery.
    /// @param amount     Clean amount (in USDC atomic units) the supplier will receive.
    /// @param milestones Exactly 2 milestones for Phase 1; pct values must sum to 100.
    ///                   Use Escrow.MILESTONE_BL_VERIFIED / MILESTONE_RECEIPT_CONFIRMED as types.
    /// @return escrowId  Sequential ID for the new escrow.
    function createEscrow(
        address supplier,
        uint256 amount,
        Milestone[] calldata milestones
    ) external whenNotPaused returns (uint256 escrowId) {
        if (supplier == address(0)) revert ZeroAddress();

        escrowId = _escrowCounter++;

        uint256 fee = (amount * feeBps) / 10_000;

        escrowContract.create(
            escrowId,
            msg.sender,  // buyer
            supplier,
            amount,
            fee,
            feeRecipient,
            oracle,
            arbitrator,
            token,
            milestones
        );

        emit EscrowCreated(escrowId, msg.sender, supplier, amount, fee, oracle, arbitrator, token);
    }

    // ─── Owner-only configuration setters ────────────────────────────────────

    /// @notice Point the factory at a different Escrow contract. Owner-only.
    ///         Needed to break the circular deployment dependency (factory address
    ///         must be known before Escrow is deployed; Escrow address must be known
    ///         before factory is initialized). Only affects NEW escrow creations;
    ///         records already held in the previous Escrow contract are unaffected.
    function setEscrowContract(address newEscrow) external onlyOwner {
        if (newEscrow == address(0)) revert ZeroAddress();
        emit EscrowContractUpdated(address(escrowContract), newEscrow);
        escrowContract = Escrow(newEscrow);
    }

    function setFeeBps(uint256 newFeeBps) external onlyOwner {
        if (newFeeBps > 10_000) revert InvalidFeeBps(newFeeBps);
        emit FeeBpsUpdated(feeBps, newFeeBps);
        feeBps = newFeeBps;
    }

    function setFeeRecipient(address newRecipient) external onlyOwner {
        if (newRecipient == address(0)) revert ZeroAddress();
        emit FeeRecipientUpdated(feeRecipient, newRecipient);
        feeRecipient = newRecipient;
    }

    function setOracle(address newOracle) external onlyOwner {
        if (newOracle == address(0)) revert ZeroAddress();
        emit OracleUpdated(oracle, newOracle);
        oracle = newOracle;
    }

    function setArbitrator(address newArbitrator) external onlyOwner {
        if (newArbitrator == address(0)) revert ZeroAddress();
        emit ArbitratorUpdated(arbitrator, newArbitrator);
        arbitrator = newArbitrator;
    }

    /// @notice Pause halts new escrow creation only.
    ///         Already-funded escrows are unaffected and can settle normally.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ─── UUPS upgrade guard ───────────────────────────────────────────────────

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
