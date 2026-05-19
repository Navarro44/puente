export const EscrowAbi = [
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "factory_",
        "type": "address"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "escrowId",
        "type": "uint256"
      }
    ],
    "name": "EscrowNotFound",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidMilestones",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "buyerSplit",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "supplierSplit",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "balance",
        "type": "uint256"
      }
    ],
    "name": "InvalidSplitSum",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "escrowId",
        "type": "uint256"
      }
    ],
    "name": "NoArrivalTimestamp",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "escrowId",
        "type": "uint256"
      }
    ],
    "name": "OnlyArbitrator",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "escrowId",
        "type": "uint256"
      }
    ],
    "name": "OnlyBuyer",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "OnlyFactory",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "escrowId",
        "type": "uint256"
      }
    ],
    "name": "OnlyOracle",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "escrowId",
        "type": "uint256"
      }
    ],
    "name": "OnlySupplier",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ReentrancyGuardReentrantCall",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "token",
        "type": "address"
      }
    ],
    "name": "SafeERC20FailedOperation",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "escrowId",
        "type": "uint256"
      }
    ],
    "name": "TimeoutNotElapsed",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "escrowId",
        "type": "uint256"
      },
      {
        "internalType": "enum Escrow.EscrowState",
        "name": "current",
        "type": "uint8"
      },
      {
        "internalType": "enum Escrow.EscrowState",
        "name": "required",
        "type": "uint8"
      }
    ],
    "name": "WrongState",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ZeroAmount",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "escrowId",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "arrivalTimestamp",
        "type": "uint256"
      }
    ],
    "name": "ArrivalRecorded",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "escrowId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "buyer",
        "type": "address"
      }
    ],
    "name": "DisputeRaised",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "escrowId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "arbitrator",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "buyerAmount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "supplierAmount",
        "type": "uint256"
      }
    ],
    "name": "DisputeResolved",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "escrowId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "buyer",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "fee",
        "type": "uint256"
      }
    ],
    "name": "EscrowFunded",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "escrowId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "supplier",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "FundsReleased",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "escrowId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "supplier",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "blReference",
        "type": "bytes32"
      }
    ],
    "name": "ShipmentConfirmed",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "escrowId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "supplier",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "Tranche1Released",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "MILESTONE_BL_VERIFIED",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "MILESTONE_RECEIPT_CONFIRMED",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "TIMEOUT_PERIOD",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "escrowId",
        "type": "uint256"
      }
    ],
    "name": "confirmReceipt",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "escrowId",
        "type": "uint256"
      },
      {
        "internalType": "bytes32",
        "name": "blReference",
        "type": "bytes32"
      }
    ],
    "name": "confirmShipment",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "escrowId",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "buyer",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "supplier",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "fee",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "feeRecipient",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "oracle",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "arbitrator",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "token",
        "type": "address"
      },
      {
        "components": [
          {
            "internalType": "bytes32",
            "name": "milestoneType",
            "type": "bytes32"
          },
          {
            "internalType": "uint256",
            "name": "pct",
            "type": "uint256"
          }
        ],
        "internalType": "struct Milestone[]",
        "name": "milestones_",
        "type": "tuple[]"
      }
    ],
    "name": "create",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "factory",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "escrowId",
        "type": "uint256"
      }
    ],
    "name": "fund",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "escrowId",
        "type": "uint256"
      }
    ],
    "name": "getEscrow",
    "outputs": [
      {
        "components": [
          {
            "internalType": "address",
            "name": "buyer",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "supplier",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "amount",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "fee",
            "type": "uint256"
          },
          {
            "internalType": "address",
            "name": "feeRecipient",
            "type": "address"
          },
          {
            "internalType": "enum Escrow.EscrowState",
            "name": "state",
            "type": "uint8"
          },
          {
            "internalType": "bytes32",
            "name": "blReference",
            "type": "bytes32"
          },
          {
            "internalType": "address",
            "name": "oracle",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "arbitrator",
            "type": "address"
          },
          {
            "internalType": "contract IERC20",
            "name": "token",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "createdAt",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "fundedAt",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "shippedAt",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "completedAt",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "arrivalTimestamp",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "releasedAmount",
            "type": "uint256"
          },
          {
            "components": [
              {
                "internalType": "bytes32",
                "name": "milestoneType",
                "type": "bytes32"
              },
              {
                "internalType": "uint256",
                "name": "pct",
                "type": "uint256"
              }
            ],
            "internalType": "struct Milestone[]",
            "name": "milestones",
            "type": "tuple[]"
          }
        ],
        "internalType": "struct Escrow.EscrowRecord",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "escrowId",
        "type": "uint256"
      }
    ],
    "name": "getState",
    "outputs": [
      {
        "internalType": "enum Escrow.EscrowState",
        "name": "",
        "type": "uint8"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "escrowId",
        "type": "uint256"
      }
    ],
    "name": "raiseDispute",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "escrowId",
        "type": "uint256"
      }
    ],
    "name": "recordArrival",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "escrowId",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "buyerSplit",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "supplierSplit",
        "type": "uint256"
      }
    ],
    "name": "resolveDispute",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "escrowId",
        "type": "uint256"
      }
    ],
    "name": "timeoutRelease",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "escrowId",
        "type": "uint256"
      },
      {
        "internalType": "bytes32",
        "name": "blRef",
        "type": "bytes32"
      }
    ],
    "name": "verifyBL",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const;
