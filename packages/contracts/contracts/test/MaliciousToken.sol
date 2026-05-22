// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IReentrantTarget {
    function verifyBL(uint256 escrowId, bytes32 blRef) external;
}

/// @dev ERC20 that calls back into the Escrow on transfer, testing ReentrancyGuard.
contract MaliciousToken is ERC20 {
    address public callTarget;
    uint256 public escrowId;
    bytes32 public blRef;
    bool public armed;

    constructor() ERC20("Evil", "EVIL") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// Arm the reentrant callback. Once armed, the next call to transfer()
    /// will call verifyBL on `callTarget` before the transfer completes,
    /// regardless of who the recipient is. The payout in verifyBL goes
    /// to the supplier, not back to the escrow, so a `to == callTarget` check would
    /// never fire — the callback must trigger on any outbound transfer.
    function arm(address callTarget_, uint256 escrowId_, bytes32 blRef_) external {
        callTarget = callTarget_;
        escrowId = escrowId_;
        blRef = blRef_;
        armed = true;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (armed) {
            armed = false; // prevent infinite loop
            IReentrantTarget(callTarget).verifyBL(escrowId, blRef);
        }
        return super.transfer(to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (armed) {
            armed = false;
            IReentrantTarget(callTarget).verifyBL(escrowId, blRef);
        }
        return super.transferFrom(from, to, amount);
    }
}
