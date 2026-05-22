import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import type { Escrow, MockERC20, MaliciousToken } from "../typechain-types";

// ─── Constants ────────────────────────────────────────────────────────────────

const FEE_BPS    = 50n;
const ONE_USDC   = 10n ** 6n;
const AMOUNT     = 100_000n * ONE_USDC;
const TIMEOUT    = 14 * 24 * 3600; // 14 days in seconds

const BL_REF     = ethers.encodeBytes32String("MAEU123456789");
const BL_TYPE    = ethers.id("BL_VERIFIED");
const RCPT_TYPE  = ethers.id("RECEIPT_CONFIRMED");

const DEFAULT_MILESTONES = [
  { milestoneType: BL_TYPE, pct: 30n },
  { milestoneType: RCPT_TYPE, pct: 70n },
];

// ─── Shared fixture ───────────────────────────────────────────────────────────

async function deployFixture() {
  const [owner, buyer, supplier, oracle, arbitrator, feeRecipient, stranger] =
    await ethers.getSigners();

  const MockERC20F = await ethers.getContractFactory("MockERC20");
  const usdc = (await MockERC20F.deploy("Mock USDC", "USDC", 6)) as unknown as MockERC20;

  const EscrowF = await ethers.getContractFactory("Escrow");
  const escrow  = (await EscrowF.deploy(owner.address)) as unknown as Escrow;

  const totalNeeded = AMOUNT + (AMOUNT * FEE_BPS) / 10_000n;
  await usdc.mint(buyer.address, totalNeeded * 20n);
  await usdc.connect(buyer).approve(await escrow.getAddress(), ethers.MaxUint256);

  return { escrow, usdc, owner, buyer, supplier, oracle, arbitrator, feeRecipient, stranger };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function createEscrow(
  escrow: Escrow,
  caller: any,
  escrowId: bigint,
  buyer: any,
  supplier: any,
  usdc: MockERC20,
  amount      = AMOUNT,
  feeBps      = FEE_BPS,
  oracle: any,
  arbitrator: any,
  feeRecipient: any,
  milestones  = DEFAULT_MILESTONES,
) {
  const fee = (amount * feeBps) / 10_000n;
  await escrow.connect(caller).create(
    escrowId,
    buyer.address,
    supplier.address,
    amount,
    fee,
    feeRecipient.address,
    oracle.address,
    arbitrator.address,
    await usdc.getAddress(),
    milestones,
  );
  return fee;
}

/** Advance clock to PartialReleased: create → fund → ship → verifyBL. */
async function setupPartialReleased(f: any, escrowId = 0n, amount = AMOUNT) {
  const fee = await createEscrow(
    f.escrow, f.owner, escrowId, f.buyer, f.supplier, f.usdc,
    amount, FEE_BPS, f.oracle, f.arbitrator, f.feeRecipient,
  );
  await f.escrow.connect(f.buyer).fund(escrowId);
  await f.escrow.connect(f.supplier).confirmShipment(escrowId, BL_REF);
  await f.escrow.connect(f.oracle).verifyBL(escrowId, BL_REF);
  return fee;
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("Escrow", function () {

  // ── Deployment ──────────────────────────────────────────────────────────────

  describe("deployment", function () {
    it("stores the factory address", async function () {
      const { escrow, owner } = await loadFixture(deployFixture);
      expect(await escrow.factory()).to.equal(owner.address);
    });
  });

  // ── create() ────────────────────────────────────────────────────────────────

  describe("create()", function () {
    it("records a Created escrow with correct milestone config", async function () {
      const { escrow, owner, buyer, supplier, usdc, oracle, arbitrator, feeRecipient } =
        await loadFixture(deployFixture);
      await createEscrow(escrow, owner, 0n, buyer, supplier, usdc, AMOUNT, FEE_BPS, oracle, arbitrator, feeRecipient);
      const r = await escrow.getEscrow(0n);
      expect(r.buyer).to.equal(buyer.address);
      expect(r.state).to.equal(0); // Created
      expect(r.milestones[0].pct).to.equal(30n);
      expect(r.milestones[1].pct).to.equal(70n);
    });

    it("reverts for non-factory caller", async function () {
      const { escrow, buyer, supplier, usdc, oracle, arbitrator, feeRecipient } =
        await loadFixture(deployFixture);
      await expect(
        escrow.connect(buyer).create(
          0n, buyer.address, supplier.address, AMOUNT, 0n,
          feeRecipient.address, oracle.address, arbitrator.address,
          await usdc.getAddress(), DEFAULT_MILESTONES,
        ),
      ).to.be.revertedWithCustomError(escrow, "OnlyFactory");
    });

    it("reverts for zero amount", async function () {
      const { escrow, owner, buyer, supplier, usdc, oracle, arbitrator, feeRecipient } =
        await loadFixture(deployFixture);
      await expect(
        escrow.connect(owner).create(
          0n, buyer.address, supplier.address, 0n, 0n,
          feeRecipient.address, oracle.address, arbitrator.address,
          await usdc.getAddress(), DEFAULT_MILESTONES,
        ),
      ).to.be.revertedWithCustomError(escrow, "ZeroAmount");
    });

    it("reverts if escrow ID already exists", async function () {
      const { escrow, owner, buyer, supplier, usdc, oracle, arbitrator, feeRecipient } =
        await loadFixture(deployFixture);
      await createEscrow(escrow, owner, 0n, buyer, supplier, usdc, AMOUNT, FEE_BPS, oracle, arbitrator, feeRecipient);
      await expect(
        createEscrow(escrow, owner, 0n, buyer, supplier, usdc, AMOUNT, FEE_BPS, oracle, arbitrator, feeRecipient),
      ).to.be.revertedWith("escrow exists");
    });

    it("reverts when milestones do not sum to 100 (must revert at creation)", async function () {
      const { escrow, owner, buyer, supplier, usdc, oracle, arbitrator, feeRecipient } =
        await loadFixture(deployFixture);
      const badMilestones = [
        { milestoneType: BL_TYPE, pct: 30n },
        { milestoneType: RCPT_TYPE, pct: 30n }, // 60 ≠ 100
      ];
      await expect(
        createEscrow(escrow, owner, 0n, buyer, supplier, usdc, AMOUNT, FEE_BPS, oracle, arbitrator, feeRecipient, badMilestones),
      ).to.be.revertedWithCustomError(escrow, "InvalidMilestones");
    });

    it("reverts for wrong milestone count (not 2)", async function () {
      const { escrow, owner, buyer, supplier, usdc, oracle, arbitrator, feeRecipient } =
        await loadFixture(deployFixture);
      await expect(
        createEscrow(escrow, owner, 0n, buyer, supplier, usdc, AMOUNT, FEE_BPS, oracle, arbitrator, feeRecipient, []),
      ).to.be.revertedWithCustomError(escrow, "InvalidMilestones");
    });

    it("accepts custom milestone percentages that sum to 100", async function () {
      const { escrow, owner, buyer, supplier, usdc, oracle, arbitrator, feeRecipient } =
        await loadFixture(deployFixture);
      const custom = [
        { milestoneType: BL_TYPE, pct: 25n },
        { milestoneType: RCPT_TYPE, pct: 75n },
      ];
      await createEscrow(escrow, owner, 0n, buyer, supplier, usdc, AMOUNT, FEE_BPS, oracle, arbitrator, feeRecipient, custom);
      const r = await escrow.getEscrow(0n);
      expect(r.milestones[0].pct).to.equal(25n);
      expect(r.milestones[1].pct).to.equal(75n);
    });
  });

  // ── fund() ───────────────────────────────────────────────────────────────────

  describe("fund()", function () {
    it("transitions Created → Funded, sends fee to feeRecipient, holds amount", async function () {
      const { escrow, owner, buyer, supplier, usdc, oracle, arbitrator, feeRecipient } =
        await loadFixture(deployFixture);
      const fee = await createEscrow(escrow, owner, 0n, buyer, supplier, usdc, AMOUNT, FEE_BPS, oracle, arbitrator, feeRecipient);
      const recipientBefore = await usdc.balanceOf(feeRecipient.address);

      await expect(escrow.connect(buyer).fund(0n))
        .to.emit(escrow, "EscrowFunded")
        .withArgs(0n, buyer.address, AMOUNT, fee);

      expect(await escrow.getState(0n)).to.equal(1); // Funded
      expect(await usdc.balanceOf(await escrow.getAddress())).to.equal(AMOUNT);
      expect(await usdc.balanceOf(feeRecipient.address)).to.equal(recipientBefore + fee);
    });

    it("reverts when not buyer", async function () {
      const { escrow, owner, buyer, supplier, usdc, oracle, arbitrator, feeRecipient, stranger } =
        await loadFixture(deployFixture);
      await createEscrow(escrow, owner, 0n, buyer, supplier, usdc, AMOUNT, FEE_BPS, oracle, arbitrator, feeRecipient);
      await expect(escrow.connect(stranger).fund(0n)).to.be.revertedWithCustomError(escrow, "OnlyBuyer");
    });

    it("reverts double-fund (state not Created)", async function () {
      const { escrow, owner, buyer, supplier, usdc, oracle, arbitrator, feeRecipient } =
        await loadFixture(deployFixture);
      await createEscrow(escrow, owner, 0n, buyer, supplier, usdc, AMOUNT, FEE_BPS, oracle, arbitrator, feeRecipient);
      await escrow.connect(buyer).fund(0n);
      await expect(escrow.connect(buyer).fund(0n)).to.be.revertedWithCustomError(escrow, "WrongState");
    });

    it("reverts for unknown escrow ID", async function () {
      const { escrow, buyer } = await loadFixture(deployFixture);
      await expect(escrow.connect(buyer).fund(999n)).to.be.revertedWithCustomError(escrow, "EscrowNotFound");
    });
  });

  // ── confirmShipment() ───────────────────────────────────────────────────────

  describe("confirmShipment()", function () {
    async function fundedFixture() {
      const f = await loadFixture(deployFixture);
      await createEscrow(f.escrow, f.owner, 0n, f.buyer, f.supplier, f.usdc, AMOUNT, FEE_BPS, f.oracle, f.arbitrator, f.feeRecipient);
      await f.escrow.connect(f.buyer).fund(0n);
      return f;
    }

    it("transitions Funded → Shipped and stores B/L reference", async function () {
      const { escrow, supplier } = await fundedFixture();
      await expect(escrow.connect(supplier).confirmShipment(0n, BL_REF))
        .to.emit(escrow, "ShipmentConfirmed").withArgs(0n, supplier.address, BL_REF);
      expect(await escrow.getState(0n)).to.equal(2); // Shipped
    });

    it("reverts when not supplier", async function () {
      const { escrow, buyer } = await fundedFixture();
      await expect(escrow.connect(buyer).confirmShipment(0n, BL_REF))
        .to.be.revertedWithCustomError(escrow, "OnlySupplier");
    });

    it("reverts before funding (state is Created)", async function () {
      const { escrow, owner, buyer, supplier, usdc, oracle, arbitrator, feeRecipient } =
        await loadFixture(deployFixture);
      await createEscrow(escrow, owner, 0n, buyer, supplier, usdc, AMOUNT, FEE_BPS, oracle, arbitrator, feeRecipient);
      await expect(escrow.connect(supplier).confirmShipment(0n, BL_REF))
        .to.be.revertedWithCustomError(escrow, "WrongState");
    });

    it("reverts double confirmShipment", async function () {
      const { escrow, supplier } = await fundedFixture();
      await escrow.connect(supplier).confirmShipment(0n, BL_REF);
      await expect(escrow.connect(supplier).confirmShipment(0n, BL_REF))
        .to.be.revertedWithCustomError(escrow, "WrongState");
    });
  });

  // ── verifyBL() ──────────────────────────────────────────────────────────────

  describe("verifyBL()", function () {
    async function shippedFixture() {
      const f = await loadFixture(deployFixture);
      await createEscrow(f.escrow, f.owner, 0n, f.buyer, f.supplier, f.usdc, AMOUNT, FEE_BPS, f.oracle, f.arbitrator, f.feeRecipient);
      await f.escrow.connect(f.buyer).fund(0n);
      await f.escrow.connect(f.supplier).confirmShipment(0n, BL_REF);
      return f;
    }

    it("transitions Shipped → PartialReleased and releases tranche 1 (30%)", async function () {
      const { escrow, oracle, supplier, usdc } = await shippedFixture();
      const tranche1 = AMOUNT * 30n / 100n;
      const supplierBefore = await usdc.balanceOf(supplier.address);

      await expect(escrow.connect(oracle).verifyBL(0n, BL_REF))
        .to.emit(escrow, "Tranche1Released").withArgs(0n, supplier.address, tranche1);

      expect(await escrow.getState(0n)).to.equal(3); // PartialReleased
      expect(await usdc.balanceOf(supplier.address)).to.equal(supplierBefore + tranche1);
      expect(await usdc.balanceOf(await escrow.getAddress())).to.equal(AMOUNT - tranche1);
    });

    it("reverts for non-oracle caller", async function () {
      const { escrow, buyer } = await shippedFixture();
      await expect(escrow.connect(buyer).verifyBL(0n, BL_REF))
        .to.be.revertedWithCustomError(escrow, "OnlyOracle");
    });

    it("reverts when state is Funded (not Shipped)", async function () {
      const { escrow, owner, buyer, supplier, usdc, oracle, arbitrator, feeRecipient } =
        await loadFixture(deployFixture);
      await createEscrow(escrow, owner, 0n, buyer, supplier, usdc, AMOUNT, FEE_BPS, oracle, arbitrator, feeRecipient);
      await escrow.connect(buyer).fund(0n);
      await expect(escrow.connect(oracle).verifyBL(0n, BL_REF))
        .to.be.revertedWithCustomError(escrow, "WrongState");
    });

    it("reverts when state is Created (oracle tries to release unfunded escrow)", async function () {
      const { escrow, owner, buyer, supplier, usdc, oracle, arbitrator, feeRecipient } =
        await loadFixture(deployFixture);
      await createEscrow(escrow, owner, 0n, buyer, supplier, usdc, AMOUNT, FEE_BPS, oracle, arbitrator, feeRecipient);
      await expect(escrow.connect(oracle).verifyBL(0n, BL_REF))
        .to.be.revertedWithCustomError(escrow, "WrongState");
    });

    it("tranche amounts reconcile: tranche1 + remaining == amount", async function () {
      const { escrow, oracle, usdc } = await shippedFixture();
      await escrow.connect(oracle).verifyBL(0n, BL_REF);
      const r = await escrow.getEscrow(0n);
      const tranche1 = r.releasedAmount;
      const remaining = await usdc.balanceOf(await escrow.getAddress());
      expect(tranche1 + remaining).to.equal(AMOUNT);
    });
  });

  // ── recordArrival() ─────────────────────────────────────────────────────────

  describe("recordArrival()", function () {
    it("oracle records arrival timestamp from PartialReleased", async function () {
      const f = await loadFixture(deployFixture);
      await setupPartialReleased(f);

      const before = await time.latest();
      await expect(f.escrow.connect(f.oracle).recordArrival(0n))
        .to.emit(f.escrow, "ArrivalRecorded");

      const r = await f.escrow.getEscrow(0n);
      expect(r.arrivalTimestamp).to.be.gte(before);
    });

    it("reverts when state is not PartialReleased (e.g. Shipped)", async function () {
      const { escrow, owner, buyer, supplier, usdc, oracle, arbitrator, feeRecipient } =
        await loadFixture(deployFixture);
      await createEscrow(escrow, owner, 0n, buyer, supplier, usdc, AMOUNT, FEE_BPS, oracle, arbitrator, feeRecipient);
      await escrow.connect(buyer).fund(0n);
      await escrow.connect(supplier).confirmShipment(0n, BL_REF);
      await expect(escrow.connect(oracle).recordArrival(0n))
        .to.be.revertedWithCustomError(escrow, "WrongState");
    });

    it("reverts for non-oracle caller", async function () {
      const f = await loadFixture(deployFixture);
      await setupPartialReleased(f);
      await expect(f.escrow.connect(f.buyer).recordArrival(0n))
        .to.be.revertedWithCustomError(f.escrow, "OnlyOracle");
    });
  });

  // ── confirmReceipt() ────────────────────────────────────────────────────────

  describe("confirmReceipt()", function () {
    it("transitions PartialReleased → Completed and releases tranche 2 (70%)", async function () {
      const f = await loadFixture(deployFixture);
      await setupPartialReleased(f);

      const tranche1   = AMOUNT * 30n / 100n;
      const tranche2   = AMOUNT - tranche1;
      const supplierBefore = await f.usdc.balanceOf(f.supplier.address);

      await expect(f.escrow.connect(f.buyer).confirmReceipt(0n))
        .to.emit(f.escrow, "FundsReleased").withArgs(0n, f.supplier.address, tranche2);

      expect(await f.escrow.getState(0n)).to.equal(4); // Completed
      expect(await f.usdc.balanceOf(f.supplier.address)).to.equal(supplierBefore + tranche2);
      expect(await f.usdc.balanceOf(await f.escrow.getAddress())).to.equal(0n);
    });

    it("reverts when not buyer", async function () {
      const f = await loadFixture(deployFixture);
      await setupPartialReleased(f);
      await expect(f.escrow.connect(f.stranger).confirmReceipt(0n))
        .to.be.revertedWithCustomError(f.escrow, "OnlyBuyer");
    });

    it("reverts when state is not PartialReleased (e.g. Shipped)", async function () {
      const { escrow, owner, buyer, supplier, usdc, oracle, arbitrator, feeRecipient } =
        await loadFixture(deployFixture);
      await createEscrow(escrow, owner, 0n, buyer, supplier, usdc, AMOUNT, FEE_BPS, oracle, arbitrator, feeRecipient);
      await escrow.connect(buyer).fund(0n);
      await escrow.connect(supplier).confirmShipment(0n, BL_REF);
      await expect(escrow.connect(buyer).confirmReceipt(0n))
        .to.be.revertedWithCustomError(escrow, "WrongState");
    });
  });

  // ── timeoutRelease() ────────────────────────────────────────────────────────

  describe("timeoutRelease()", function () {
    async function partialReleasedWithArrival() {
      const f = await loadFixture(deployFixture);
      await setupPartialReleased(f);
      await f.escrow.connect(f.oracle).recordArrival(0n);
      return f;
    }

    it("releases tranche 2 after 14 days from arrival (callable by anyone)", async function () {
      const { escrow, supplier, stranger, usdc } = await partialReleasedWithArrival();
      const tranche2 = AMOUNT * 70n / 100n;

      await time.increase(TIMEOUT);

      const supplierBefore = await usdc.balanceOf(supplier.address);
      await expect(escrow.connect(stranger).timeoutRelease(0n))   // stranger calls, not buyer
        .to.emit(escrow, "FundsReleased").withArgs(0n, supplier.address, tranche2);

      expect(await escrow.getState(0n)).to.equal(4); // Completed
      expect(await usdc.balanceOf(supplier.address)).to.equal(supplierBefore + tranche2);
      expect(await usdc.balanceOf(await escrow.getAddress())).to.equal(0n);
    });

    it("reverts before 14 days have elapsed", async function () {
      const { escrow, stranger } = await partialReleasedWithArrival();
      // time.increase mines a block; timeoutRelease mines another (+1 more).
      // Use TIMEOUT - 2 so the tx block lands at arrivalTimestamp + TIMEOUT - 1, still < TIMEOUT.
      await time.increase(TIMEOUT - 2);
      await expect(escrow.connect(stranger).timeoutRelease(0n))
        .to.be.revertedWithCustomError(escrow, "TimeoutNotElapsed");
    });

    it("succeeds exactly at 14-day boundary (timestamp == arrivalTimestamp + TIMEOUT)", async function () {
      const { escrow, stranger } = await partialReleasedWithArrival();
      await time.increase(TIMEOUT); // block.timestamp >= arrivalTimestamp + TIMEOUT_PERIOD
      await expect(escrow.connect(stranger).timeoutRelease(0n)).to.not.be.reverted;
    });

    it("reverts when no arrival timestamp has been set", async function () {
      const f = await loadFixture(deployFixture);
      await setupPartialReleased(f); // no recordArrival call
      await time.increase(TIMEOUT + 1);
      await expect(f.escrow.connect(f.stranger).timeoutRelease(0n))
        .to.be.revertedWithCustomError(f.escrow, "NoArrivalTimestamp");
    });

    it("reverts when state is not PartialReleased", async function () {
      const { escrow, owner, buyer, supplier, usdc, oracle, arbitrator, feeRecipient, stranger } =
        await loadFixture(deployFixture);
      await createEscrow(escrow, owner, 0n, buyer, supplier, usdc, AMOUNT, FEE_BPS, oracle, arbitrator, feeRecipient);
      await escrow.connect(buyer).fund(0n);
      await time.increase(TIMEOUT + 1);
      await expect(escrow.connect(stranger).timeoutRelease(0n))
        .to.be.revertedWithCustomError(escrow, "WrongState");
    });
  });

  // ── raiseDispute() ───────────────────────────────────────────────────────────

  describe("raiseDispute()", function () {
    it("transitions Funded → Disputed", async function () {
      const { escrow, owner, buyer, supplier, usdc, oracle, arbitrator, feeRecipient } =
        await loadFixture(deployFixture);
      await createEscrow(escrow, owner, 0n, buyer, supplier, usdc, AMOUNT, FEE_BPS, oracle, arbitrator, feeRecipient);
      await escrow.connect(buyer).fund(0n);
      await expect(escrow.connect(buyer).raiseDispute(0n))
        .to.emit(escrow, "DisputeRaised").withArgs(0n, buyer.address);
      expect(await escrow.getState(0n)).to.equal(5);
    });

    it("transitions Shipped → Disputed", async function () {
      const { escrow, owner, buyer, supplier, usdc, oracle, arbitrator, feeRecipient } =
        await loadFixture(deployFixture);
      await createEscrow(escrow, owner, 0n, buyer, supplier, usdc, AMOUNT, FEE_BPS, oracle, arbitrator, feeRecipient);
      await escrow.connect(buyer).fund(0n);
      await escrow.connect(supplier).confirmShipment(0n, BL_REF);
      await expect(escrow.connect(buyer).raiseDispute(0n))
        .to.emit(escrow, "DisputeRaised").withArgs(0n, buyer.address);
    });

    it("transitions PartialReleased → Disputed, freezing only the remaining balance", async function () {
      const f = await loadFixture(deployFixture);
      await setupPartialReleased(f);

      const tranche1 = AMOUNT * 30n / 100n;
      const remaining = AMOUNT - tranche1;

      await expect(f.escrow.connect(f.buyer).raiseDispute(0n))
        .to.emit(f.escrow, "DisputeRaised").withArgs(0n, f.buyer.address);

      // Contract only holds the remaining balance
      expect(await f.usdc.balanceOf(await f.escrow.getAddress())).to.equal(remaining);
      expect(await f.escrow.getState(0n)).to.equal(5); // Disputed
    });

    it("reverts from Created state", async function () {
      const { escrow, owner, buyer, supplier, usdc, oracle, arbitrator, feeRecipient } =
        await loadFixture(deployFixture);
      await createEscrow(escrow, owner, 0n, buyer, supplier, usdc, AMOUNT, FEE_BPS, oracle, arbitrator, feeRecipient);
      await expect(escrow.connect(buyer).raiseDispute(0n)).to.be.revertedWithCustomError(escrow, "WrongState");
    });

    it("reverts from Completed state", async function () {
      const f = await loadFixture(deployFixture);
      await setupPartialReleased(f);
      await f.escrow.connect(f.buyer).confirmReceipt(0n);
      await expect(f.escrow.connect(f.buyer).raiseDispute(0n))
        .to.be.revertedWithCustomError(f.escrow, "WrongState");
    });

    it("reverts for non-buyer", async function () {
      const { escrow, owner, buyer, supplier, usdc, oracle, arbitrator, feeRecipient, stranger } =
        await loadFixture(deployFixture);
      await createEscrow(escrow, owner, 0n, buyer, supplier, usdc, AMOUNT, FEE_BPS, oracle, arbitrator, feeRecipient);
      await escrow.connect(buyer).fund(0n);
      await expect(escrow.connect(stranger).raiseDispute(0n)).to.be.revertedWithCustomError(escrow, "OnlyBuyer");
    });

    it("buyer cannot raise dispute twice", async function () {
      const { escrow, owner, buyer, supplier, usdc, oracle, arbitrator, feeRecipient } =
        await loadFixture(deployFixture);
      await createEscrow(escrow, owner, 0n, buyer, supplier, usdc, AMOUNT, FEE_BPS, oracle, arbitrator, feeRecipient);
      await escrow.connect(buyer).fund(0n);
      await escrow.connect(buyer).raiseDispute(0n);
      await expect(escrow.connect(buyer).raiseDispute(0n)).to.be.revertedWithCustomError(escrow, "WrongState");
    });
  });

  // ── resolveDispute() ─────────────────────────────────────────────────────────

  describe("resolveDispute()", function () {
    async function disputedFixture() {
      const f = await loadFixture(deployFixture);
      await createEscrow(f.escrow, f.owner, 0n, f.buyer, f.supplier, f.usdc, AMOUNT, FEE_BPS, f.oracle, f.arbitrator, f.feeRecipient);
      await f.escrow.connect(f.buyer).fund(0n);
      await f.escrow.connect(f.buyer).raiseDispute(0n);
      return f;
    }

    it("resolves 50/50 split correctly", async function () {
      const { escrow, arbitrator, buyer, supplier, usdc } = await disputedFixture();
      const half = AMOUNT / 2n;
      await expect(escrow.connect(arbitrator).resolveDispute(0n, half, half))
        .to.emit(escrow, "DisputeResolved").withArgs(0n, arbitrator.address, half, half);
      expect(await escrow.getState(0n)).to.equal(6);
      expect(await usdc.balanceOf(await escrow.getAddress())).to.equal(0n);
    });

    it("resolves 100% to buyer (0 to supplier)", async function () {
      const { escrow, arbitrator, buyer, usdc } = await disputedFixture();
      const before = await usdc.balanceOf(buyer.address);
      await escrow.connect(arbitrator).resolveDispute(0n, AMOUNT, 0n);
      expect(await usdc.balanceOf(buyer.address)).to.equal(before + AMOUNT);
    });

    it("resolves 100% to supplier (0 to buyer)", async function () {
      const { escrow, arbitrator, supplier, usdc } = await disputedFixture();
      const before = await usdc.balanceOf(supplier.address);
      await escrow.connect(arbitrator).resolveDispute(0n, 0n, AMOUNT);
      expect(await usdc.balanceOf(supplier.address)).to.equal(before + AMOUNT);
    });

    it("resolves from PartialReleased dispute — splits must equal remaining balance only", async function () {
      const f = await loadFixture(deployFixture);
      await setupPartialReleased(f);
      await f.escrow.connect(f.buyer).raiseDispute(0n);

      const tranche1  = AMOUNT * 30n / 100n;
      const remaining = AMOUNT - tranche1;

      // Full AMOUNT split fails — tranche 1 is already with supplier
      await expect(f.escrow.connect(f.arbitrator).resolveDispute(0n, AMOUNT, 0n))
        .to.be.revertedWithCustomError(f.escrow, "InvalidSplitSum");

      // Correct remaining split succeeds
      const buyerBefore    = await f.usdc.balanceOf(f.buyer.address);
      const supplierBefore = await f.usdc.balanceOf(f.supplier.address);
      await f.escrow.connect(f.arbitrator).resolveDispute(0n, remaining / 2n, remaining - remaining / 2n);
      expect(await f.usdc.balanceOf(f.buyer.address)).to.equal(buyerBefore + remaining / 2n);
      expect(await f.usdc.balanceOf(f.supplier.address)).to.equal(supplierBefore + (remaining - remaining / 2n));
    });

    it("reverts when splits do not sum to balance", async function () {
      const { escrow, arbitrator } = await disputedFixture();
      await expect(escrow.connect(arbitrator).resolveDispute(0n, AMOUNT / 2n, AMOUNT / 4n))
        .to.be.revertedWithCustomError(escrow, "InvalidSplitSum");
    });

    it("reverts when splits exceed balance", async function () {
      const { escrow, arbitrator } = await disputedFixture();
      await expect(escrow.connect(arbitrator).resolveDispute(0n, AMOUNT, AMOUNT))
        .to.be.revertedWithCustomError(escrow, "InvalidSplitSum");
    });

    it("reverts for non-arbitrator caller", async function () {
      const { escrow, buyer } = await disputedFixture();
      await expect(escrow.connect(buyer).resolveDispute(0n, AMOUNT, 0n))
        .to.be.revertedWithCustomError(escrow, "OnlyArbitrator");
    });

    it("reverts when state is not Disputed", async function () {
      const { escrow, owner, buyer, supplier, usdc, oracle, arbitrator, feeRecipient } =
        await loadFixture(deployFixture);
      await createEscrow(escrow, owner, 0n, buyer, supplier, usdc, AMOUNT, FEE_BPS, oracle, arbitrator, feeRecipient);
      await escrow.connect(buyer).fund(0n);
      await expect(escrow.connect(arbitrator).resolveDispute(0n, AMOUNT, 0n))
        .to.be.revertedWithCustomError(escrow, "WrongState");
    });
  });

  // ── Property / parameterized fee + tranche math ──────────────────────────────

  describe("fee and tranche math properties", function () {
    const testCases = [
      { amount: 1n,                        feeBps: 0n,      ms: [30n, 70n] },
      { amount: 1n,                        feeBps: 50n,     ms: [30n, 70n] },
      { amount: ONE_USDC,                  feeBps: 50n,     ms: [30n, 70n] },
      { amount: ONE_USDC,                  feeBps: 0n,      ms: [30n, 70n] },
      { amount: 100_000n * ONE_USDC,       feeBps: 50n,     ms: [30n, 70n] },
      { amount: 500_000n * ONE_USDC,       feeBps: 50n,     ms: [30n, 70n] },
      { amount: 1_000_000n * ONE_USDC,     feeBps: 100n,    ms: [30n, 70n] },
      { amount: 999_999n,                  feeBps: 33n,     ms: [30n, 70n] },
      { amount: 7_777n * ONE_USDC,         feeBps: 9_999n,  ms: [30n, 70n] },
      { amount: 2n ** 64n,                 feeBps: 50n,     ms: [30n, 70n] },
      { amount: 2n ** 96n,                 feeBps: 1n,      ms: [30n, 70n] },
      // custom milestone splits
      { amount: 100_000n * ONE_USDC,       feeBps: 50n,     ms: [25n, 75n] },
      { amount: 100_000n * ONE_USDC,       feeBps: 50n,     ms: [50n, 50n] },
      { amount: 100_000n * ONE_USDC,       feeBps: 50n,     ms: [0n, 100n] },
      { amount: 100_000n * ONE_USDC,       feeBps: 50n,     ms: [100n, 0n] },
      { amount: 100_000n * ONE_USDC,       feeBps: 50n,     ms: [1n, 99n] },
    ];

    testCases.forEach(({ amount, feeBps: bps, ms }, idx) => {
      it(`[${idx}] amount=${amount} feeBps=${bps} milestones=[${ms}]: no USDC leak`, async function () {
        const { escrow, owner, buyer, supplier, usdc, oracle, arbitrator, feeRecipient } =
          await loadFixture(deployFixture);

        const milestones = [
          { milestoneType: BL_TYPE, pct: ms[0] },
          { milestoneType: RCPT_TYPE, pct: ms[1] },
        ];
        const fee     = (amount * bps) / 10_000n;
        const total   = amount + fee;
        const tranche1 = amount * ms[0] / 100n;
        const tranche2 = amount - tranche1;

        // Fee must not exceed amount
        expect(fee).to.be.lte(amount);
        // Tranche split must reconcile
        expect(tranche1 + tranche2).to.equal(amount);

        await usdc.mint(buyer.address, total);
        await usdc.connect(buyer).approve(await escrow.getAddress(), total);

        const eid = BigInt(idx + 5000);
        await escrow.connect(owner).create(
          eid, buyer.address, supplier.address, amount, fee,
          feeRecipient.address, oracle.address, arbitrator.address,
          await usdc.getAddress(), milestones,
        );

        const recipientBefore = await usdc.balanceOf(feeRecipient.address);
        const supplierBefore  = await usdc.balanceOf(supplier.address);

        await escrow.connect(buyer).fund(eid);
        expect(await usdc.balanceOf(feeRecipient.address)).to.equal(recipientBefore + fee);
        expect(await usdc.balanceOf(await escrow.getAddress())).to.equal(amount);

        await escrow.connect(supplier).confirmShipment(eid, BL_REF);
        await escrow.connect(oracle).verifyBL(eid, BL_REF);
        // tranche 1 released
        expect(await usdc.balanceOf(supplier.address)).to.equal(supplierBefore + tranche1);
        expect(await usdc.balanceOf(await escrow.getAddress())).to.equal(tranche2);

        await escrow.connect(buyer).confirmReceipt(eid);
        // tranche 2 released
        expect(await usdc.balanceOf(supplier.address)).to.equal(supplierBefore + amount);
        expect(await usdc.balanceOf(await escrow.getAddress())).to.equal(0n);
      });
    });
  });

  // ── Reentrancy guard ─────────────────────────────────────────────────────────

  describe("reentrancy guard", function () {
    it("blocks a reentrant verifyBL via malicious token", async function () {
      const { owner, buyer, supplier, oracle, arbitrator, feeRecipient } =
        await loadFixture(deployFixture);

      const MaliciousTokenF = await ethers.getContractFactory("MaliciousToken");
      const evil = (await MaliciousTokenF.deploy()) as unknown as MaliciousToken;

      const EscrowF = await ethers.getContractFactory("Escrow");
      const escrow2 = (await EscrowF.deploy(owner.address)) as unknown as Escrow;

      const fee   = (AMOUNT * FEE_BPS) / 10_000n;
      const total = AMOUNT + fee;

      await evil.mint(buyer.address, total);
      await evil.connect(buyer).approve(await escrow2.getAddress(), total);

      await escrow2.connect(owner).create(
        0n, buyer.address, supplier.address, AMOUNT, fee,
        feeRecipient.address, oracle.address, arbitrator.address,
        await evil.getAddress(), DEFAULT_MILESTONES,
      );
      await escrow2.connect(buyer).fund(0n);
      await escrow2.connect(supplier).confirmShipment(0n, BL_REF);

      await evil.arm(await escrow2.getAddress(), 0n, BL_REF);

      await expect(escrow2.connect(oracle).verifyBL(0n, BL_REF))
        .to.be.revertedWithCustomError(escrow2, "ReentrancyGuardReentrantCall");
    });
  });

  // ── Owner fund access ────────────────────────────────────────────────────────

  describe("owner fund access", function () {
    it("owner has no function to withdraw escrow funds", async function () {
      const { escrow } = await loadFixture(deployFixture);
      const iface = escrow.interface;
      const dangerousFns = ["withdraw", "sweep", "adminTransfer", "rescueFunds", "drain"];
      for (const fn of dangerousFns) {
        expect((iface as any).getFunction(fn)).to.be.null;
      }
    });
  });

  // ── Full happy-path integration ───────────────────────────────────────────────

  describe("happy path: create → fund → ship → verifyBL → confirmReceipt → completed", function () {
    it("runs the full two-milestone lifecycle", async function () {
      const { escrow, owner, buyer, supplier, oracle, usdc, arbitrator, feeRecipient } =
        await loadFixture(deployFixture);

      const escrowId = 99n;
      const amount   = 50_000n * ONE_USDC;
      const fee      = (amount * FEE_BPS) / 10_000n;
      const tranche1 = amount * 30n / 100n;
      const tranche2 = amount - tranche1;
      const bl       = ethers.encodeBytes32String("COSCO987654321");

      // 1. Create
      await escrow.connect(owner).create(
        escrowId, buyer.address, supplier.address, amount, fee,
        feeRecipient.address, oracle.address, arbitrator.address,
        await usdc.getAddress(), DEFAULT_MILESTONES,
      );
      expect(await escrow.getState(escrowId)).to.equal(0);

      // 2. Fund
      await usdc.mint(buyer.address, amount + fee);
      await usdc.connect(buyer).approve(await escrow.getAddress(), amount + fee);
      await escrow.connect(buyer).fund(escrowId);
      expect(await escrow.getState(escrowId)).to.equal(1);

      // 3. Confirm shipment
      await escrow.connect(supplier).confirmShipment(escrowId, bl);
      expect(await escrow.getState(escrowId)).to.equal(2);

      // 4. Oracle verifies BL → tranche 1 released
      const supplierAfterT1 = (await usdc.balanceOf(supplier.address)) + tranche1;
      await escrow.connect(oracle).verifyBL(escrowId, bl);
      expect(await escrow.getState(escrowId)).to.equal(3); // PartialReleased
      expect(await usdc.balanceOf(supplier.address)).to.equal(supplierAfterT1);

      // 5. Buyer confirms receipt → tranche 2 released
      await escrow.connect(buyer).confirmReceipt(escrowId);
      expect(await escrow.getState(escrowId)).to.equal(4); // Completed
      expect(await usdc.balanceOf(supplier.address)).to.equal(supplierAfterT1 + tranche2);
      expect(await usdc.balanceOf(await escrow.getAddress())).to.equal(0n);
    });
  });
});
