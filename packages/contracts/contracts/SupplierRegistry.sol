// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @title SupplierRegistry
/// @notice UUPS-upgradeable registry that anchors on-chain the KYB status of each supplier.
///         Stores only a bytes32 hash of the off-chain credential — never KYB detail itself.
///         A supplier is "verified" when its status flag is Verified AND the expiry has not
///         passed (expiry == 0 is treated as no-expiry / always valid).
///
///         The owner manages operators; operators may set or revoke credentials. The owner
///         is also implicitly an operator.
contract SupplierRegistry is Initializable, OwnableUpgradeable, UUPSUpgradeable {

    // ─── Types ────────────────────────────────────────────────────────────────

    enum SupplierStatus { None, Verified, Revoked }

    struct Credential {
        bytes32 credentialHash; // keccak256 anchor of the off-chain KYB document bundle
        SupplierStatus status;
        uint256 expiry;         // unix timestamp; 0 = no expiry
    }

    // ─── Storage ──────────────────────────────────────────────────────────────

    mapping(address => Credential) private _credentials;
    mapping(address => bool) public operators;

    // ─── Events ───────────────────────────────────────────────────────────────

    event CredentialSet(address indexed supplier, bytes32 credentialHash, uint256 expiry);
    event CredentialRevoked(address indexed supplier);
    event OperatorUpdated(address indexed operator, bool enabled);

    // ─── Custom errors ────────────────────────────────────────────────────────

    error NotOperator();
    error ZeroAddress();

    // ─── Constructor ──────────────────────────────────────────────────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_) external initializer {
        if (owner_ == address(0)) revert ZeroAddress();
        __Ownable_init(owner_);
    }

    // ─── Operator management ──────────────────────────────────────────────────

    function setOperator(address operator, bool enabled) external onlyOwner {
        if (operator == address(0)) revert ZeroAddress();
        operators[operator] = enabled;
        emit OperatorUpdated(operator, enabled);
    }

    // ─── Credential management ────────────────────────────────────────────────

    /// @notice Record or update a supplier's KYB credential anchor.
    ///         status is set to Verified. Pass expiry = 0 for no expiry.
    function setCredential(
        address supplier,
        bytes32 credentialHash,
        uint256 expiry
    ) external onlyOperator {
        if (supplier == address(0)) revert ZeroAddress();
        _credentials[supplier] = Credential({
            credentialHash: credentialHash,
            status: SupplierStatus.Verified,
            expiry: expiry
        });
        emit CredentialSet(supplier, credentialHash, expiry);
    }

    /// @notice Revoke a supplier's credential. Status becomes Revoked; hash and expiry are
    ///         preserved for audit purposes.
    function revokeCredential(address supplier) external onlyOperator {
        _credentials[supplier].status = SupplierStatus.Revoked;
        emit CredentialRevoked(supplier);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    /// @notice Returns true iff the supplier is currently KYB-verified:
    ///         status == Verified AND (expiry == 0 OR expiry > block.timestamp).
    function isVerified(address supplier) external view returns (bool) {
        Credential storage c = _credentials[supplier];
        return c.status == SupplierStatus.Verified &&
               (c.expiry == 0 || c.expiry > block.timestamp);
    }

    function getCredential(address supplier) external view returns (Credential memory) {
        return _credentials[supplier];
    }

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyOperator() {
        if (!operators[msg.sender] && msg.sender != owner()) revert NotOperator();
        _;
    }

    // ─── UUPS upgrade guard ───────────────────────────────────────────────────

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
