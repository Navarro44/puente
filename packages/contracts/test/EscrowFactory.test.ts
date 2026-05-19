import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import type { Escrow, EscrowFactory, MockERC20 } from "../typechain-types";

const FEE_BPS = 50n;
const ONE_USDC = 10n ** 6n;
const AMOUNT = 100_000n * ONE_USDC;

const DEFAULT_MILESTONES = [
  { milestoneType: ethers.id("BL_VERIFIED"), pct: 30n },
  { milestoneType: ethers.id("RECEIPT_CONFIRMED"), pct: 70n },
];

async function deployFactoryFixture() {
  const [owner, buyer, supplier, oracle, arbitrator, feeRecipient, stranger, newOracle] =
    await ethers.getSigners();

  const MockERC20F = await ethers.getContractFactory("MockERC20");
  const usdc = (await MockERC20F.deploy("Mock USDC", "USDC", 6)) as unknown as MockERC20;

  // Break the circular dependency (factory needs escrow address; escrow needs factory address):
  // 1. Deploy factory proxy with owner as a non-zero placeholder for escrowContract.
  // 2. Deploy Escrow with the real factory proxy address.
  // 3. Call setEscrowContract to point the factory at the real Escrow.
  const EscrowFactoryF = await ethers.getContractFactory("EscrowFactory");
  const factory = (await upgrades.deployProxy(
    EscrowFactoryF,
    [
      owner.address,
      feeRecipient.address,
      oracle.address,
      arbitrator.address,
      await usdc.getAddress(),
      FEE_BPS,
      owner.address, // placeholder — replaced below
    ],
    { kind: "uups" }
  )) as unknown as EscrowFactory;

  const EscrowF = await ethers.getContractFactory("Escrow");
  const escrow = (await EscrowF.deploy(await factory.getAddress())) as unknown as Escrow;

  await factory.connect(owner).setEscrowContract(await escrow.getAddress());

  return { factory, escrow, usdc, owner, buyer, supplier, oracle, arbitrator, feeRecipient, stranger, newOracle };
}

describe("EscrowFactory", function () {

  // ── Initialization ──────────────────────────────────────────────────────────

  describe("initialization", function () {
    it("stores config correctly", async function () {
      const { factory, escrow, usdc, owner, oracle, arbitrator, feeRecipient } =
        await loadFixture(deployFactoryFixture);
      expect(await factory.feeBps()).to.equal(FEE_BPS);
      expect(await factory.feeRecipient()).to.equal(feeRecipient.address);
      expect(await factory.oracle()).to.equal(oracle.address);
      expect(await factory.arbitrator()).to.equal(arbitrator.address);
      expect(await factory.token()).to.equal(await usdc.getAddress());
      expect(await factory.escrowContract()).to.equal(await escrow.getAddress());
      expect(await factory.owner()).to.equal(owner.address);
    });

    it("cannot be re-initialized", async function () {
      const { factory, escrow, usdc, owner, oracle, arbitrator, feeRecipient } =
        await loadFixture(deployFactoryFixture);
      await expect(
        factory.initialize(
          owner.address, feeRecipient.address, oracle.address, arbitrator.address,
          await usdc.getAddress(), FEE_BPS, await escrow.getAddress()
        )
      ).to.be.reverted; // InvalidInitialization
    });
  });

  // ── createEscrow() ──────────────────────────────────────────────────────────

  describe("createEscrow()", function () {
    it("emits EscrowCreated with all terms", async function () {
      const { factory, usdc, buyer, supplier, oracle, arbitrator } =
        await loadFixture(deployFactoryFixture);

      const fee = (AMOUNT * FEE_BPS) / 10_000n;

      await expect(factory.connect(buyer).createEscrow(supplier.address, AMOUNT, DEFAULT_MILESTONES))
        .to.emit(factory, "EscrowCreated")
        .withArgs(0n, buyer.address, supplier.address, AMOUNT, fee,
          oracle.address, arbitrator.address, await usdc.getAddress());
    });

    it("assigns sequential IDs", async function () {
      const { factory, buyer, supplier } = await loadFixture(deployFactoryFixture);
      const tx1 = await factory.connect(buyer).createEscrow(supplier.address, AMOUNT, DEFAULT_MILESTONES);
      const r1 = await tx1.wait();
      const tx2 = await factory.connect(buyer).createEscrow(supplier.address, AMOUNT, DEFAULT_MILESTONES);
      const r2 = await tx2.wait();

      const log1 = r1!.logs.find((l: any) => l.fragment?.name === "EscrowCreated");
      const log2 = r2!.logs.find((l: any) => l.fragment?.name === "EscrowCreated");
      expect((log1 as any).args[0]).to.equal(0n);
      expect((log2 as any).args[0]).to.equal(1n);
    });

    it("reverts for zero supplier address", async function () {
      const { factory, buyer } = await loadFixture(deployFactoryFixture);
      await expect(factory.connect(buyer).createEscrow(ethers.ZeroAddress, AMOUNT, DEFAULT_MILESTONES))
        .to.be.revertedWithCustomError(factory, "ZeroAddress");
    });

    it("reverts when paused", async function () {
      const { factory, owner, buyer, supplier } = await loadFixture(deployFactoryFixture);
      await factory.connect(owner).pause();
      await expect(factory.connect(buyer).createEscrow(supplier.address, AMOUNT, DEFAULT_MILESTONES))
        .to.be.revertedWithCustomError(factory, "EnforcedPause");
    });

    it("succeeds after unpause", async function () {
      const { factory, owner, buyer, supplier } = await loadFixture(deployFactoryFixture);
      await factory.connect(owner).pause();
      await factory.connect(owner).unpause();
      await expect(factory.connect(buyer).createEscrow(supplier.address, AMOUNT, DEFAULT_MILESTONES))
        .to.emit(factory, "EscrowCreated");
    });
  });

  // ── Pause behavior ──────────────────────────────────────────────────────────

  describe("pause()", function () {
    it("non-owner cannot pause", async function () {
      const { factory, stranger } = await loadFixture(deployFactoryFixture);
      await expect(factory.connect(stranger).pause())
        .to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
    });

    it("pausing does not affect the Escrow contract directly", async function () {
      // Escrow state transitions are not gated by factory pause — only createEscrow is.
      const { factory, escrow, usdc, owner, buyer, supplier, oracle } =
        await loadFixture(deployFactoryFixture);

      // Create and fund an escrow via the factory (ID 0).
      const fee = (AMOUNT * FEE_BPS) / 10_000n;
      await usdc.mint(buyer.address, AMOUNT + fee);
      await usdc.connect(buyer).approve(await escrow.getAddress(), AMOUNT + fee);
      await factory.connect(buyer).createEscrow(supplier.address, AMOUNT, DEFAULT_MILESTONES);
      const escrowId = 0n;

      await escrow.connect(buyer).fund(escrowId);

      // Pause the factory — only new escrow creation is blocked.
      await factory.connect(owner).pause();

      // Existing escrow settlement continues unaffected through the full lifecycle.
      const bl = ethers.encodeBytes32String("MSKU1234567");
      await escrow.connect(supplier).confirmShipment(escrowId, bl);

      // verifyBL releases tranche 1; confirmReceipt releases tranche 2 — factory pause irrelevant.
      await expect(escrow.connect(oracle).verifyBL(escrowId, bl))
        .to.emit(escrow, "Tranche1Released");
      await expect(escrow.connect(buyer).confirmReceipt(escrowId))
        .to.emit(escrow, "FundsReleased");
    });
  });

  // ── Config setters ──────────────────────────────────────────────────────────

  describe("setFeeBps()", function () {
    it("owner can update feeBps and emits event", async function () {
      const { factory, owner } = await loadFixture(deployFactoryFixture);
      await expect(factory.connect(owner).setFeeBps(100n))
        .to.emit(factory, "FeeBpsUpdated")
        .withArgs(FEE_BPS, 100n);
      expect(await factory.feeBps()).to.equal(100n);
    });

    it("non-owner cannot update feeBps", async function () {
      const { factory, stranger } = await loadFixture(deployFactoryFixture);
      await expect(factory.connect(stranger).setFeeBps(100n))
        .to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
    });

    it("reverts for feeBps > 10000", async function () {
      const { factory, owner } = await loadFixture(deployFactoryFixture);
      await expect(factory.connect(owner).setFeeBps(10_001n))
        .to.be.revertedWithCustomError(factory, "InvalidFeeBps");
    });

    it("allows feeBps == 0", async function () {
      const { factory, owner } = await loadFixture(deployFactoryFixture);
      await factory.connect(owner).setFeeBps(0n);
      expect(await factory.feeBps()).to.equal(0n);
    });

    it("allows feeBps == 10000", async function () {
      const { factory, owner } = await loadFixture(deployFactoryFixture);
      await factory.connect(owner).setFeeBps(10_000n);
      expect(await factory.feeBps()).to.equal(10_000n);
    });
  });

  describe("setFeeRecipient()", function () {
    it("owner can update and emits event", async function () {
      const { factory, owner, newOracle } = await loadFixture(deployFactoryFixture);
      await expect(factory.connect(owner).setFeeRecipient(newOracle.address))
        .to.emit(factory, "FeeRecipientUpdated");
      expect(await factory.feeRecipient()).to.equal(newOracle.address);
    });

    it("reverts for zero address", async function () {
      const { factory, owner } = await loadFixture(deployFactoryFixture);
      await expect(factory.connect(owner).setFeeRecipient(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(factory, "ZeroAddress");
    });

    it("non-owner cannot update", async function () {
      const { factory, stranger, newOracle } = await loadFixture(deployFactoryFixture);
      await expect(factory.connect(stranger).setFeeRecipient(newOracle.address))
        .to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
    });
  });

  describe("setOracle()", function () {
    it("owner can update oracle and emits event", async function () {
      const { factory, owner, newOracle } = await loadFixture(deployFactoryFixture);
      await expect(factory.connect(owner).setOracle(newOracle.address))
        .to.emit(factory, "OracleUpdated");
      expect(await factory.oracle()).to.equal(newOracle.address);
    });

    it("reverts for zero address", async function () {
      const { factory, owner } = await loadFixture(deployFactoryFixture);
      await expect(factory.connect(owner).setOracle(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(factory, "ZeroAddress");
    });

    it("non-owner cannot update oracle", async function () {
      const { factory, stranger, newOracle } = await loadFixture(deployFactoryFixture);
      await expect(factory.connect(stranger).setOracle(newOracle.address))
        .to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
    });
  });

  describe("setArbitrator()", function () {
    it("owner can update arbitrator and emits event", async function () {
      const { factory, owner, newOracle } = await loadFixture(deployFactoryFixture);
      await expect(factory.connect(owner).setArbitrator(newOracle.address))
        .to.emit(factory, "ArbitratorUpdated");
      expect(await factory.arbitrator()).to.equal(newOracle.address);
    });

    it("reverts for zero address", async function () {
      const { factory, owner } = await loadFixture(deployFactoryFixture);
      await expect(factory.connect(owner).setArbitrator(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(factory, "ZeroAddress");
    });
  });

  // ── UUPS upgrade guard ──────────────────────────────────────────────────────

  describe("UUPS upgrade", function () {
    it("non-owner cannot upgrade", async function () {
      const { factory, stranger } = await loadFixture(deployFactoryFixture);
      const EscrowFactoryV2 = await ethers.getContractFactory("EscrowFactory", stranger);
      await expect(upgrades.upgradeProxy(await factory.getAddress(), EscrowFactoryV2))
        .to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");
    });

    it("owner can upgrade to a new implementation", async function () {
      const { factory, owner } = await loadFixture(deployFactoryFixture);
      const EscrowFactoryV2 = await ethers.getContractFactory("EscrowFactory", owner);
      const upgraded = await upgrades.upgradeProxy(await factory.getAddress(), EscrowFactoryV2);
      expect(await upgraded.getAddress()).to.equal(await factory.getAddress());
      // Config survives upgrade
      expect(await (upgraded as unknown as EscrowFactory).feeBps()).to.equal(FEE_BPS);
    });
  });

  // ── Owner cannot access escrow funds ────────────────────────────────────────

  describe("owner fund access", function () {
    it("factory owner has no path to move escrow funds", async function () {
      const { factory } = await loadFixture(deployFactoryFixture);
      const iface = factory.interface;
      const dangerousFns = ["withdraw", "sweep", "adminTransfer", "rescueFunds", "drain"];
      for (const fn of dangerousFns) {
        expect((iface as any).getFunction(fn)).to.be.null;
      }
    });
  });
});
