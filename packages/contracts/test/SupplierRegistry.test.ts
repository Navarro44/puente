import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import type { SupplierRegistry } from "../typechain-types";

const CRED_HASH = ethers.id("kyb-credential-bundle-v1");
const ZERO_HASH = ethers.ZeroHash;

async function deployRegistryFixture() {
  const [owner, operator, supplier, stranger] = await ethers.getSigners();

  const RegistryF = await ethers.getContractFactory("SupplierRegistry");
  const registry = (await upgrades.deployProxy(
    RegistryF,
    [owner.address],
    { kind: "uups" }
  )) as unknown as SupplierRegistry;

  return { registry, owner, operator, supplier, stranger };
}

describe("SupplierRegistry", function () {

  // ── Initialization ──────────────────────────────────────────────────────────

  describe("initialization", function () {
    it("sets owner correctly", async function () {
      const { registry, owner } = await loadFixture(deployRegistryFixture);
      expect(await registry.owner()).to.equal(owner.address);
    });

    it("cannot be re-initialized", async function () {
      const { registry, owner } = await loadFixture(deployRegistryFixture);
      await expect(registry.initialize(owner.address)).to.be.reverted;
    });

    it("reverts for zero owner address", async function () {
      const RegistryF = await ethers.getContractFactory("SupplierRegistry");
      await expect(
        upgrades.deployProxy(RegistryF, [ethers.ZeroAddress], { kind: "uups" })
      ).to.be.revertedWithCustomError(
        await ethers.getContractFactory("SupplierRegistry"),
        "ZeroAddress"
      );
    });
  });

  // ── Operator management ─────────────────────────────────────────────────────

  describe("setOperator()", function () {
    it("owner can add an operator and emits event", async function () {
      const { registry, owner, operator } = await loadFixture(deployRegistryFixture);
      await expect(registry.connect(owner).setOperator(operator.address, true))
        .to.emit(registry, "OperatorUpdated")
        .withArgs(operator.address, true);
      expect(await registry.operators(operator.address)).to.be.true;
    });

    it("owner can remove an operator", async function () {
      const { registry, owner, operator } = await loadFixture(deployRegistryFixture);
      await registry.connect(owner).setOperator(operator.address, true);
      await registry.connect(owner).setOperator(operator.address, false);
      expect(await registry.operators(operator.address)).to.be.false;
    });

    it("non-owner cannot set operator", async function () {
      const { registry, stranger, operator } = await loadFixture(deployRegistryFixture);
      await expect(registry.connect(stranger).setOperator(operator.address, true))
        .to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
    });

    it("reverts for zero operator address", async function () {
      const { registry, owner } = await loadFixture(deployRegistryFixture);
      await expect(registry.connect(owner).setOperator(ethers.ZeroAddress, true))
        .to.be.revertedWithCustomError(registry, "ZeroAddress");
    });
  });

  // ── setCredential() ─────────────────────────────────────────────────────────

  describe("setCredential()", function () {
    it("operator can set a credential and emits event", async function () {
      const { registry, owner, operator, supplier } = await loadFixture(deployRegistryFixture);
      await registry.connect(owner).setOperator(operator.address, true);

      await expect(registry.connect(operator).setCredential(supplier.address, CRED_HASH, 0))
        .to.emit(registry, "CredentialSet")
        .withArgs(supplier.address, CRED_HASH, 0);

      const cred = await registry.getCredential(supplier.address);
      expect(cred.credentialHash).to.equal(CRED_HASH);
      expect(cred.status).to.equal(1n); // Verified
      expect(cred.expiry).to.equal(0n);
    });

    it("owner (implicitly an operator) can set a credential", async function () {
      const { registry, owner, supplier } = await loadFixture(deployRegistryFixture);
      await expect(registry.connect(owner).setCredential(supplier.address, CRED_HASH, 0))
        .to.emit(registry, "CredentialSet");
    });

    it("stranger cannot set a credential", async function () {
      const { registry, stranger, supplier } = await loadFixture(deployRegistryFixture);
      await expect(registry.connect(stranger).setCredential(supplier.address, CRED_HASH, 0))
        .to.be.revertedWithCustomError(registry, "NotOperator");
    });

    it("reverts for zero supplier address", async function () {
      const { registry, owner } = await loadFixture(deployRegistryFixture);
      await expect(registry.connect(owner).setCredential(ethers.ZeroAddress, CRED_HASH, 0))
        .to.be.revertedWithCustomError(registry, "ZeroAddress");
    });

    it("operator can update an existing credential (re-verify)", async function () {
      const { registry, owner, operator, supplier } = await loadFixture(deployRegistryFixture);
      await registry.connect(owner).setOperator(operator.address, true);

      await registry.connect(operator).setCredential(supplier.address, CRED_HASH, 0);
      const newHash = ethers.id("updated-kyb-bundle");
      const futureExpiry = (await time.latest()) + 365 * 24 * 3600;

      await registry.connect(operator).setCredential(supplier.address, newHash, futureExpiry);
      const cred = await registry.getCredential(supplier.address);
      expect(cred.credentialHash).to.equal(newHash);
      expect(cred.expiry).to.equal(BigInt(futureExpiry));
      expect(cred.status).to.equal(1n); // Verified
    });
  });

  // ── revokeCredential() ──────────────────────────────────────────────────────

  describe("revokeCredential()", function () {
    it("operator can revoke and emits event", async function () {
      const { registry, owner, operator, supplier } = await loadFixture(deployRegistryFixture);
      await registry.connect(owner).setOperator(operator.address, true);
      await registry.connect(operator).setCredential(supplier.address, CRED_HASH, 0);

      await expect(registry.connect(operator).revokeCredential(supplier.address))
        .to.emit(registry, "CredentialRevoked")
        .withArgs(supplier.address);

      const cred = await registry.getCredential(supplier.address);
      expect(cred.status).to.equal(2n); // Revoked
    });

    it("hash and expiry are preserved after revocation (audit trail)", async function () {
      const { registry, owner, supplier } = await loadFixture(deployRegistryFixture);
      const expiry = (await time.latest()) + 1000;
      await registry.connect(owner).setCredential(supplier.address, CRED_HASH, expiry);
      await registry.connect(owner).revokeCredential(supplier.address);

      const cred = await registry.getCredential(supplier.address);
      expect(cred.credentialHash).to.equal(CRED_HASH);
      expect(cred.expiry).to.equal(BigInt(expiry));
      expect(cred.status).to.equal(2n); // Revoked
    });

    it("stranger cannot revoke", async function () {
      const { registry, owner, stranger, supplier } = await loadFixture(deployRegistryFixture);
      await registry.connect(owner).setCredential(supplier.address, CRED_HASH, 0);
      await expect(registry.connect(stranger).revokeCredential(supplier.address))
        .to.be.revertedWithCustomError(registry, "NotOperator");
    });
  });

  // ── isVerified() ────────────────────────────────────────────────────────────

  describe("isVerified()", function () {
    it("returns false for unknown supplier", async function () {
      const { registry, supplier } = await loadFixture(deployRegistryFixture);
      expect(await registry.isVerified(supplier.address)).to.be.false;
    });

    it("returns true for verified supplier with no expiry", async function () {
      const { registry, owner, supplier } = await loadFixture(deployRegistryFixture);
      await registry.connect(owner).setCredential(supplier.address, CRED_HASH, 0);
      expect(await registry.isVerified(supplier.address)).to.be.true;
    });

    it("returns false for revoked supplier", async function () {
      const { registry, owner, supplier } = await loadFixture(deployRegistryFixture);
      await registry.connect(owner).setCredential(supplier.address, CRED_HASH, 0);
      await registry.connect(owner).revokeCredential(supplier.address);
      expect(await registry.isVerified(supplier.address)).to.be.false;
    });

    it("returns true for verified supplier before expiry", async function () {
      const { registry, owner, supplier } = await loadFixture(deployRegistryFixture);
      const expiry = (await time.latest()) + 3600; // 1 hour from now
      await registry.connect(owner).setCredential(supplier.address, CRED_HASH, expiry);
      expect(await registry.isVerified(supplier.address)).to.be.true;
    });

    it("returns false for verified supplier after expiry", async function () {
      const { registry, owner, supplier } = await loadFixture(deployRegistryFixture);
      const expiry = (await time.latest()) + 60; // 60 seconds
      await registry.connect(owner).setCredential(supplier.address, CRED_HASH, expiry);

      await time.increase(61);

      expect(await registry.isVerified(supplier.address)).to.be.false;
    });

    it("expiry boundary: not expired at exactly expiry + 1 second", async function () {
      // expiry > block.timestamp is the contract condition; at exactly expiry it flips false.
      // Each time.increase() mines a block (+1 auto), and the tx also mines (+1).
      // So: setCredential mines at T+1; time.increase(98) mines at T+99; view sees T+99.
      const { registry, owner, supplier } = await loadFixture(deployRegistryFixture);
      const expiry = (await time.latest()) + 100;
      await registry.connect(owner).setCredential(supplier.address, CRED_HASH, expiry);

      await time.increase(98); // latest → T+1+98 = T+99; expiry T+100 > T+99 → valid
      expect(await registry.isVerified(supplier.address)).to.be.true;

      await time.increase(1); // latest → T+99+1 = T+100; expiry T+100 > T+100 → false
      expect(await registry.isVerified(supplier.address)).to.be.false;
    });

    it("expiry == 0 is treated as no-expiry (always valid)", async function () {
      const { registry, owner, supplier } = await loadFixture(deployRegistryFixture);
      await registry.connect(owner).setCredential(supplier.address, CRED_HASH, 0);

      await time.increase(365 * 24 * 3600); // advance 1 year
      expect(await registry.isVerified(supplier.address)).to.be.true;
    });

    it("re-verifying after revocation restores isVerified", async function () {
      const { registry, owner, supplier } = await loadFixture(deployRegistryFixture);
      await registry.connect(owner).setCredential(supplier.address, CRED_HASH, 0);
      await registry.connect(owner).revokeCredential(supplier.address);
      expect(await registry.isVerified(supplier.address)).to.be.false;

      // Re-issue credential
      await registry.connect(owner).setCredential(supplier.address, CRED_HASH, 0);
      expect(await registry.isVerified(supplier.address)).to.be.true;
    });
  });

  // ── getCredential() ─────────────────────────────────────────────────────────

  describe("getCredential()", function () {
    it("returns zero-value struct for unknown supplier", async function () {
      const { registry, supplier } = await loadFixture(deployRegistryFixture);
      const cred = await registry.getCredential(supplier.address);
      expect(cred.credentialHash).to.equal(ZERO_HASH);
      expect(cred.status).to.equal(0n); // None
      expect(cred.expiry).to.equal(0n);
    });
  });

  // ── Operator access control edge cases ─────────────────────────────────────

  describe("operator access control", function () {
    it("removed operator cannot set credentials", async function () {
      const { registry, owner, operator, supplier } = await loadFixture(deployRegistryFixture);
      await registry.connect(owner).setOperator(operator.address, true);
      await registry.connect(owner).setOperator(operator.address, false);

      await expect(registry.connect(operator).setCredential(supplier.address, CRED_HASH, 0))
        .to.be.revertedWithCustomError(registry, "NotOperator");
    });

    it("multiple operators can independently manage credentials", async function () {
      const { registry, owner, operator, stranger, supplier } = await loadFixture(deployRegistryFixture);
      await registry.connect(owner).setOperator(operator.address, true);
      await registry.connect(owner).setOperator(stranger.address, true);

      await registry.connect(operator).setCredential(supplier.address, CRED_HASH, 0);
      expect(await registry.isVerified(supplier.address)).to.be.true;

      await registry.connect(stranger).revokeCredential(supplier.address);
      expect(await registry.isVerified(supplier.address)).to.be.false;
    });
  });

  // ── UUPS upgrade guard ──────────────────────────────────────────────────────

  describe("UUPS upgrade", function () {
    it("non-owner cannot upgrade", async function () {
      const { registry, stranger } = await loadFixture(deployRegistryFixture);
      const RegistryV2 = await ethers.getContractFactory("SupplierRegistry", stranger);
      await expect(upgrades.upgradeProxy(await registry.getAddress(), RegistryV2))
        .to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
    });

    it("owner can upgrade and state is preserved", async function () {
      const { registry, owner, supplier } = await loadFixture(deployRegistryFixture);

      // Set state before upgrade
      await registry.connect(owner).setCredential(supplier.address, CRED_HASH, 0);
      expect(await registry.isVerified(supplier.address)).to.be.true;

      // Upgrade to same implementation (simulates upgrade process)
      const RegistryV2 = await ethers.getContractFactory("SupplierRegistry", owner);
      const upgraded = await upgrades.upgradeProxy(await registry.getAddress(), RegistryV2);

      // State persists across upgrade
      expect(await (upgraded as unknown as SupplierRegistry).isVerified(supplier.address)).to.be.true;
    });
  });
});
