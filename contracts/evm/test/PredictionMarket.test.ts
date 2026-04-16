import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import { getAddress, parseEventLogs } from "viem";

type MarketTuple = readonly [string, string, bigint, number];

type MarketCreatedArgs = {
	marketId: bigint;
	creator: string;
	question: string;
	resolutionTimestamp: bigint;
};

describe("PredictionMarket (EVM)", function () {
	async function deployFixture() {
		const [owner, otherAccount] = await hre.viem.getWalletClients();
		const market = await hre.viem.deployContract("PredictionMarket");
		const publicClient = await hre.viem.getPublicClient();
		return { market, owner, otherAccount, publicClient };
	}

	async function futureTimestamp(secondsFromNow = 3600): Promise<bigint> {
		const now = await time.latest();
		return BigInt(now + secondsFromNow);
	}

	it("Should start with zero markets", async function () {
		const { market } = await loadFixture(deployFixture);
		expect(await market.read.getMarketCount()).to.equal(0n);
	});

	it("Should create a market", async function () {
		const { market, owner } = await loadFixture(deployFixture);
		const deadline = await futureTimestamp();
		const question = "Will DOT reach $20 by July 1?";

		await market.write.createMarket([question, deadline]);

		expect(await market.read.getMarketCount()).to.equal(1n);
		const [creator, storedQuestion, storedDeadline, state] = (await market.read.getMarket([
			0n,
		])) as MarketTuple;
		expect(getAddress(creator)).to.equal(getAddress(owner.account.address));
		expect(storedQuestion).to.equal(question);
		expect(storedDeadline).to.equal(deadline);
		expect(state).to.equal(0);
	});

	it("Should increment market ids", async function () {
		const { market } = await loadFixture(deployFixture);
		const deadline = await futureTimestamp();

		await market.write.createMarket(["first", deadline]);
		await market.write.createMarket(["second", deadline + 1n]);

		expect(await market.read.getMarketCount()).to.equal(2n);
		const [, q0] = (await market.read.getMarket([0n])) as MarketTuple;
		const [, q1] = (await market.read.getMarket([1n])) as MarketTuple;
		expect(q0).to.equal("first");
		expect(q1).to.equal("second");
	});

	it("Should track the original creator, not msg.sender on subsequent calls", async function () {
		const { market, otherAccount } = await loadFixture(deployFixture);
		const deadline = await futureTimestamp();

		await market.write.createMarket(["from other", deadline], {
			account: otherAccount.account,
		});

		const [creator] = (await market.read.getMarket([0n])) as MarketTuple;
		expect(getAddress(creator)).to.equal(getAddress(otherAccount.account.address));
	});

	it("Should reject empty questions", async function () {
		const { market } = await loadFixture(deployFixture);
		const deadline = await futureTimestamp();
		try {
			await market.write.createMarket(["", deadline]);
			expect.fail("Should have reverted");
		} catch (e: unknown) {
			expect((e as Error).message).to.include("Question required");
		}
	});

	it("Should reject past or current resolution timestamps", async function () {
		const { market } = await loadFixture(deployFixture);
		const now = BigInt(await time.latest());
		try {
			await market.write.createMarket(["past", now]);
			expect.fail("Should have reverted");
		} catch (e: unknown) {
			expect((e as Error).message).to.include("Resolution must be in the future");
		}
	});

	it("Should emit MarketCreated event", async function () {
		const { market, owner, publicClient } = await loadFixture(deployFixture);
		const deadline = await futureTimestamp();
		const question = "event test";

		const hash = await market.write.createMarket([question, deadline]);
		const receipt = await publicClient.waitForTransactionReceipt({ hash });
		const logs = parseEventLogs({
			abi: market.abi,
			logs: receipt.logs,
			eventName: "MarketCreated",
		});
		expect(logs).to.have.lengthOf(1);
		const args = logs[0].args as unknown as MarketCreatedArgs;
		expect(args.marketId).to.equal(0n);
		expect(getAddress(args.creator)).to.equal(getAddress(owner.account.address));
		expect(args.question).to.equal(question);
		expect(args.resolutionTimestamp).to.equal(deadline);
	});
});
