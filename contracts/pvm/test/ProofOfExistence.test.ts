import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import { getAddress, keccak256, toBytes } from "viem";

describe("ProofOfExistence (PVM)", function () {
	async function deployFixture() {
		const [owner, otherAccount] = await hre.viem.getWalletClients();
		const poe = await hre.viem.deployContract("ProofOfExistence");
		return { poe, owner, otherAccount };
	}

	// The contract accepts any bytes32 hash. These tests use viem's built-in
	// keccak256 helper for convenience, while the app/CLI use blake2b-256 so the
	// same file hash can be shared across the pallet, contracts, and Bulletin flow.
	const testHash = keccak256(toBytes("test document"));
	const testHash2 = keccak256(toBytes("another document"));

	it("Should return zero for unclaimed hash", async function () {
		const { poe } = await loadFixture(deployFixture);
		const [owner, blockNumber] = await poe.read.getClaim([testHash]);
		expect(owner).to.equal("0x0000000000000000000000000000000000000000");
		expect(blockNumber).to.equal(0n);
	});

	it("Should create a claim", async function () {
		const { poe, owner } = await loadFixture(deployFixture);
		await poe.write.createClaim([testHash]);
		const [claimOwner, blockNumber] = await poe.read.getClaim([testHash]);
		expect(getAddress(claimOwner)).to.equal(getAddress(owner.account.address));
		expect(blockNumber).to.not.equal(0n);
	});

	it("Should track claim count", async function () {
		const { poe } = await loadFixture(deployFixture);
		expect(await poe.read.getClaimCount()).to.equal(0n);
		await poe.write.createClaim([testHash]);
		expect(await poe.read.getClaimCount()).to.equal(1n);
		await poe.write.createClaim([testHash2]);
		expect(await poe.read.getClaimCount()).to.equal(2n);
	});

	it("Should fail on duplicate claim", async function () {
		const { poe } = await loadFixture(deployFixture);
		await poe.write.createClaim([testHash]);
		try {
			await poe.write.createClaim([testHash]);
			expect.fail("Should have reverted");
		} catch (e: unknown) {
			expect((e as Error).message).to.include("Already claimed");
		}
	});

	it("Should revoke a claim", async function () {
		const { poe } = await loadFixture(deployFixture);
		await poe.write.createClaim([testHash]);
		await poe.write.revokeClaim([testHash]);
		const [owner] = await poe.read.getClaim([testHash]);
		expect(owner).to.equal("0x0000000000000000000000000000000000000000");
		expect(await poe.read.getClaimCount()).to.equal(0n);
	});

	it("Should fail to revoke if not owner", async function () {
		const { poe, otherAccount } = await loadFixture(deployFixture);
		await poe.write.createClaim([testHash]);
		try {
			await poe.write.revokeClaim([testHash], {
				account: otherAccount.account,
			});
			expect.fail("Should have reverted");
		} catch (e: unknown) {
			expect((e as Error).message).to.include("Not claim owner");
		}
	});

	it("Should fail to revoke non-existent claim", async function () {
		const { poe } = await loadFixture(deployFixture);
		try {
			await poe.write.revokeClaim([testHash]);
			expect.fail("Should have reverted");
		} catch (e: unknown) {
			expect((e as Error).message).to.include("Claim not found");
		}
	});
});
