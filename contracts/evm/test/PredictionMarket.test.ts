import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import { getAddress, parseEther, parseEventLogs } from "viem";

type MarketTuple = readonly [string, string, bigint, number, boolean, bigint, bigint];
type PositionTuple = readonly [bigint, bigint];

const RESOLUTION_BOND = parseEther("0.1");
const DISPUTE_WINDOW = 86400n;

type MarketCreatedArgs = {
	marketId: bigint;
	creator: string;
	question: string;
	resolutionTimestamp: bigint;
};

describe("PredictionMarket (EVM)", function () {
	async function deployFixture() {
		const [owner, otherAccount] = await hre.viem.getWalletClients();
		const market = await hre.viem.deployContract("PredictionMarket", [
			RESOLUTION_BOND,
			DISPUTE_WINDOW,
		]);
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

	describe("buyShares", function () {
		async function marketFixture() {
			const base = await loadFixture(deployFixture);
			const deadline = await futureTimestamp();
			await base.market.write.createMarket(["Will DOT hit $20?", deadline]);
			return { ...base, deadline };
		}

		it("Should record a YES deposit", async function () {
			const { market, owner } = await loadFixture(marketFixture);
			const amount = parseEther("1");

			await market.write.buyShares([0n, true], { value: amount });

			const [yesDeposit, noDeposit] = (await market.read.getUserPosition([
				0n,
				owner.account.address,
			])) as PositionTuple;
			expect(yesDeposit).to.equal(amount);
			expect(noDeposit).to.equal(0n);
		});

		it("Should record a NO deposit", async function () {
			const { market, owner } = await loadFixture(marketFixture);
			const amount = parseEther("0.5");

			await market.write.buyShares([0n, false], { value: amount });

			const [yesDeposit, noDeposit] = (await market.read.getUserPosition([
				0n,
				owner.account.address,
			])) as PositionTuple;
			expect(yesDeposit).to.equal(0n);
			expect(noDeposit).to.equal(amount);
		});

		it("Should update yesPool and noPool in getMarket", async function () {
			const { market, owner, otherAccount } = await loadFixture(marketFixture);

			await market.write.buyShares([0n, true], {
				account: owner.account,
				value: parseEther("2"),
			});
			await market.write.buyShares([0n, false], {
				account: otherAccount.account,
				value: parseEther("1"),
			});

			const [, , , , , yesPool, noPool] = (await market.read.getMarket([0n])) as MarketTuple;
			expect(yesPool).to.equal(parseEther("2"));
			expect(noPool).to.equal(parseEther("1"));
		});

		it("Should accumulate multiple buys from the same user", async function () {
			const { market, owner } = await loadFixture(marketFixture);

			await market.write.buyShares([0n, true], { value: parseEther("1") });
			await market.write.buyShares([0n, true], { value: parseEther("0.5") });

			const [yesDeposit] = (await market.read.getUserPosition([0n, owner.account.address])) as PositionTuple;
			expect(yesDeposit).to.equal(parseEther("1.5"));
		});

		it("Should revert with zero value", async function () {
			const { market } = await loadFixture(marketFixture);
			try {
				await market.write.buyShares([0n, true], { value: 0n });
				expect.fail("Should have reverted");
			} catch (e: unknown) {
				expect((e as Error).message).to.include("Must send tokens to buy shares");
			}
		});

		it("Should revert after the resolution timestamp", async function () {
			const { market } = await loadFixture(marketFixture);
			await time.increase(3601);
			try {
				await market.write.buyShares([0n, true], { value: parseEther("1") });
				expect.fail("Should have reverted");
			} catch (e: unknown) {
				expect((e as Error).message).to.include("Market closed for trading");
			}
		});

		it("Should emit SharesBought event", async function () {
			const { market, owner, publicClient } = await loadFixture(marketFixture);
			const amount = parseEther("1");

			const hash = await market.write.buyShares([0n, true], { value: amount });
			const receipt = await publicClient.waitForTransactionReceipt({ hash });
			const logs = parseEventLogs({
				abi: market.abi,
				logs: receipt.logs,
				eventName: "SharesBought",
			});
			expect(logs).to.have.lengthOf(1);
			const args = logs[0].args as {
				marketId: bigint;
				buyer: string;
				outcome: boolean;
				amount: bigint;
			};
			expect(args.marketId).to.equal(0n);
			expect(getAddress(args.buyer)).to.equal(getAddress(owner.account.address));
			expect(args.outcome).to.equal(true);
			expect(args.amount).to.equal(amount);
		});
	});

	describe("resolveMarket", function () {
		async function resolveFixture() {
			const base = await loadFixture(deployFixture);
			const deadline = await futureTimestamp(3600);
			await base.market.write.createMarket(["Will DOT hit $20?", deadline]);
			await time.increaseTo(deadline);
			return { ...base, deadline };
		}

		it("Should transition state to Proposed", async function () {
			const { market } = await loadFixture(resolveFixture);

			await market.write.resolveMarket([0n, true], { value: RESOLUTION_BOND });

			const [, , , state] = (await market.read.getMarket([0n])) as MarketTuple;
			expect(state).to.equal(2);
		});

		it("Should record the proposed outcome", async function () {
			const { market } = await loadFixture(resolveFixture);

			await market.write.resolveMarket([0n, false], { value: RESOLUTION_BOND });

			const [, , , , proposedOutcome] = (await market.read.getMarket([0n])) as MarketTuple;
			expect(proposedOutcome).to.equal(false);
		});

		it("Should revert before the resolution timestamp", async function () {
			const { market } = await loadFixture(deployFixture);
			const deadline = await futureTimestamp(3600);
			await market.write.createMarket(["too early", deadline]);

			try {
				await market.write.resolveMarket([0n, true], { value: RESOLUTION_BOND });
				expect.fail("Should have reverted");
			} catch (e: unknown) {
				expect((e as Error).message).to.include("Too early to resolve");
			}
		});

		it("Should revert with wrong bond amount", async function () {
			const { market } = await loadFixture(resolveFixture);

			try {
				await market.write.resolveMarket([0n, true], { value: parseEther("0.05") });
				expect.fail("Should have reverted");
			} catch (e: unknown) {
				expect((e as Error).message).to.include("Wrong bond amount");
			}
		});

		it("Should revert if market is not Open", async function () {
			const { market } = await loadFixture(resolveFixture);
			await market.write.resolveMarket([0n, true], { value: RESOLUTION_BOND });

			try {
				await market.write.resolveMarket([0n, false], { value: RESOLUTION_BOND });
				expect.fail("Should have reverted");
			} catch (e: unknown) {
				expect((e as Error).message).to.include("Market not open");
			}
		});

		it("Should emit MarketResolved event", async function () {
			const { market, owner, publicClient } = await loadFixture(resolveFixture);

			const hash = await market.write.resolveMarket([0n, true], { value: RESOLUTION_BOND });
			const receipt = await publicClient.waitForTransactionReceipt({ hash });
			const logs = parseEventLogs({
				abi: market.abi,
				logs: receipt.logs,
				eventName: "MarketResolved",
			});
			expect(logs).to.have.lengthOf(1);
			const args = logs[0].args as {
				marketId: bigint;
				resolver: string;
				outcome: boolean;
			};
			expect(args.marketId).to.equal(0n);
			expect(getAddress(args.resolver)).to.equal(getAddress(owner.account.address));
			expect(args.outcome).to.equal(true);
		});
	});

	describe("disputeResolution", function () {
		async function disputeFixture() {
			const base = await loadFixture(deployFixture);
			const deadline = await futureTimestamp(3600);
			await base.market.write.createMarket(["Will DOT hit $20?", deadline]);
			await time.increaseTo(deadline);
			await base.market.write.resolveMarket([0n, true], { value: RESOLUTION_BOND });
			return { ...base, deadline };
		}

		it("Should transition state to Disputed", async function () {
			const { market, otherAccount } = await loadFixture(disputeFixture);

			await market.write.disputeResolution([0n], {
				account: otherAccount.account,
				value: RESOLUTION_BOND,
			});

			const [, , , state] = (await market.read.getMarket([0n])) as MarketTuple;
			expect(state).to.equal(3);
		});

		it("Should revert if market is not Proposed", async function () {
			const { market, otherAccount } = await loadFixture(deployFixture);
			const deadline = await futureTimestamp(3600);
			await market.write.createMarket(["open market", deadline]);

			try {
				await market.write.disputeResolution([0n], {
					account: otherAccount.account,
					value: RESOLUTION_BOND,
				});
				expect.fail("Should have reverted");
			} catch (e: unknown) {
				expect((e as Error).message).to.include("Market not in Proposed state");
			}
		});

		it("Should revert after the dispute window closes", async function () {
			const { market, otherAccount } = await loadFixture(disputeFixture);
			await time.increase(DISPUTE_WINDOW + 1n);

			try {
				await market.write.disputeResolution([0n], {
					account: otherAccount.account,
					value: RESOLUTION_BOND,
				});
				expect.fail("Should have reverted");
			} catch (e: unknown) {
				expect((e as Error).message).to.include("Dispute window closed");
			}
		});

		it("Should revert with wrong bond amount", async function () {
			const { market, otherAccount } = await loadFixture(disputeFixture);

			try {
				await market.write.disputeResolution([0n], {
					account: otherAccount.account,
					value: parseEther("0.05"),
				});
				expect.fail("Should have reverted");
			} catch (e: unknown) {
				expect((e as Error).message).to.include("Wrong bond amount");
			}
		});

		it("Should emit DisputeRaised event", async function () {
			const { market, otherAccount, publicClient } = await loadFixture(disputeFixture);

			const hash = await market.write.disputeResolution([0n], {
				account: otherAccount.account,
				value: RESOLUTION_BOND,
			});
			const receipt = await publicClient.waitForTransactionReceipt({ hash });
			const logs = parseEventLogs({
				abi: market.abi,
				logs: receipt.logs,
				eventName: "DisputeRaised",
			});
			expect(logs).to.have.lengthOf(1);
			const args = logs[0].args as { marketId: bigint; disputer: string };
			expect(args.marketId).to.equal(0n);
			expect(getAddress(args.disputer)).to.equal(getAddress(otherAccount.account.address));
		});
	});

	describe("godResolve", function () {
		async function godResolveFixture() {
			const base = await loadFixture(deployFixture);
			const deadline = await futureTimestamp(3600);
			await base.market.write.createMarket(["Will DOT hit $20?", deadline]);
			await time.increaseTo(deadline);
			await base.market.write.resolveMarket([0n, true], {
				account: base.owner.account,
				value: RESOLUTION_BOND,
			});
			await base.market.write.disputeResolution([0n], {
				account: base.otherAccount.account,
				value: RESOLUTION_BOND,
			});
			return base;
		}

		it("Should finalize with owner's chosen outcome", async function () {
			const { market } = await loadFixture(godResolveFixture);

			await market.write.godResolve([0n, false]);

			const [, , , state] = (await market.read.getMarket([0n])) as MarketTuple;
			expect(state).to.equal(4);
		});

		it("Should pay 2x bond to resolver when resolver wins", async function () {
			const { market, owner, publicClient } = await loadFixture(godResolveFixture);

			const balanceBefore = await publicClient.getBalance({ address: owner.account.address });
			const hash = await market.write.godResolve([0n, true]);
			const receipt = await publicClient.waitForTransactionReceipt({ hash });
			const gasUsed = receipt.gasUsed * receipt.effectiveGasPrice;
			const balanceAfter = await publicClient.getBalance({ address: owner.account.address });

			expect(balanceAfter - balanceBefore + gasUsed).to.equal(2n * RESOLUTION_BOND);
		});

		it("Should pay 2x bond to disputer when disputer wins", async function () {
			const { market, otherAccount, publicClient } = await loadFixture(godResolveFixture);

			const balanceBefore = await publicClient.getBalance({
				address: otherAccount.account.address,
			});
			await market.write.godResolve([0n, false]);
			const balanceAfter = await publicClient.getBalance({
				address: otherAccount.account.address,
			});

			expect(balanceAfter - balanceBefore).to.equal(2n * RESOLUTION_BOND);
		});

		it("Should revert if caller is not owner", async function () {
			const { market, otherAccount } = await loadFixture(godResolveFixture);

			try {
				await market.write.godResolve([0n, true], { account: otherAccount.account });
				expect.fail("Should have reverted");
			} catch (e: unknown) {
				expect((e as Error).message).to.include("OwnableUnauthorizedAccount");
			}
		});

		it("Should revert if market is not Disputed", async function () {
			const { market } = await loadFixture(deployFixture);
			const deadline = await futureTimestamp(3600);
			await market.write.createMarket(["open market", deadline]);

			try {
				await market.write.godResolve([0n, true]);
				expect.fail("Should have reverted");
			} catch (e: unknown) {
				expect((e as Error).message).to.include("Market not disputed");
			}
		});

		it("Should emit MarketFinalized event", async function () {
			const { market, publicClient } = await loadFixture(godResolveFixture);

			const hash = await market.write.godResolve([0n, true]);
			const receipt = await publicClient.waitForTransactionReceipt({ hash });
			const logs = parseEventLogs({
				abi: market.abi,
				logs: receipt.logs,
				eventName: "MarketFinalized",
			});
			expect(logs).to.have.lengthOf(1);
			const args = logs[0].args as { marketId: bigint; outcome: boolean };
			expect(args.marketId).to.equal(0n);
			expect(args.outcome).to.equal(true);
		});
	});

	describe("claimWinnings", function () {
		async function poolFixture() {
			const base = await loadFixture(deployFixture);
			const deadline = await futureTimestamp(3600);
			await base.market.write.createMarket(["Will DOT hit $20?", deadline]);
			await base.market.write.buyShares([0n, true], {
				account: base.owner.account,
				value: parseEther("3"),
			});
			await base.market.write.buyShares([0n, false], {
				account: base.otherAccount.account,
				value: parseEther("1"),
			});
			await time.increaseTo(deadline);
			return { ...base, deadline };
		}

		it("Should pay out winner proportionally after godResolve", async function () {
			const { market, owner, otherAccount, publicClient } = await loadFixture(poolFixture);

			await market.write.resolveMarket([0n, true], {
				account: owner.account,
				value: RESOLUTION_BOND,
			});
			await market.write.disputeResolution([0n], {
				account: otherAccount.account,
				value: RESOLUTION_BOND,
			});
			await market.write.godResolve([0n, true]);

			const balanceBefore = await publicClient.getBalance({ address: owner.account.address });
			const hash = await market.write.claimWinnings([0n], { account: owner.account });
			const receipt = await publicClient.waitForTransactionReceipt({ hash });
			const gasUsed = receipt.gasUsed * receipt.effectiveGasPrice;
			const balanceAfter = await publicClient.getBalance({ address: owner.account.address });

			expect(balanceAfter - balanceBefore + gasUsed).to.equal(parseEther("4"));
		});

		it("Should auto-finalize and pay winner after dispute window expires", async function () {
			const { market, owner, publicClient } = await loadFixture(poolFixture);

			await market.write.resolveMarket([0n, true], {
				account: owner.account,
				value: RESOLUTION_BOND,
			});
			await time.increase(DISPUTE_WINDOW + 1n);

			const balanceBefore = await publicClient.getBalance({ address: owner.account.address });
			const hash = await market.write.claimWinnings([0n], { account: owner.account });
			const receipt = await publicClient.waitForTransactionReceipt({ hash });
			const gasUsed = receipt.gasUsed * receipt.effectiveGasPrice;
			const balanceAfter = await publicClient.getBalance({ address: owner.account.address });

			expect(balanceAfter - balanceBefore + gasUsed).to.equal(
				parseEther("4") + RESOLUTION_BOND,
			);
		});

		it("Should revert for losers", async function () {
			const { market, owner, otherAccount } = await loadFixture(poolFixture);

			await market.write.resolveMarket([0n, true], {
				account: owner.account,
				value: RESOLUTION_BOND,
			});
			await market.write.disputeResolution([0n], {
				account: otherAccount.account,
				value: RESOLUTION_BOND,
			});
			await market.write.godResolve([0n, true]);

			try {
				await market.write.claimWinnings([0n], { account: otherAccount.account });
				expect.fail("Should have reverted");
			} catch (e: unknown) {
				expect((e as Error).message).to.include("No winning position");
			}
		});

		it("Should revert on double-claim", async function () {
			const { market, owner, otherAccount } = await loadFixture(poolFixture);

			await market.write.resolveMarket([0n, true], {
				account: owner.account,
				value: RESOLUTION_BOND,
			});
			await market.write.disputeResolution([0n], {
				account: otherAccount.account,
				value: RESOLUTION_BOND,
			});
			await market.write.godResolve([0n, true]);
			await market.write.claimWinnings([0n], { account: owner.account });

			try {
				await market.write.claimWinnings([0n], { account: owner.account });
				expect.fail("Should have reverted");
			} catch (e: unknown) {
				expect((e as Error).message).to.include("No winning position");
			}
		});

		it("Should revert if market is not finalized", async function () {
			const { market, owner } = await loadFixture(poolFixture);

			try {
				await market.write.claimWinnings([0n], { account: owner.account });
				expect.fail("Should have reverted");
			} catch (e: unknown) {
				expect((e as Error).message).to.include("Market not finalized");
			}
		});

		it("Should revert if no pool to claim from (empty market)", async function () {
			const { market, owner } = await loadFixture(deployFixture);
			const deadline = await futureTimestamp(3600);
			await market.write.createMarket(["empty", deadline]);
			await time.increaseTo(deadline);
			await market.write.resolveMarket([0n, true], { value: RESOLUTION_BOND });
			await time.increase(DISPUTE_WINDOW + 1n);

			try {
				await market.write.claimWinnings([0n], { account: owner.account });
				expect.fail("Should have reverted");
			} catch (e: unknown) {
				expect((e as Error).message).to.include("No pool to claim from");
			}
		});

		it("Should emit WinningsClaimed event", async function () {
			const { market, owner, otherAccount, publicClient } = await loadFixture(poolFixture);

			await market.write.resolveMarket([0n, true], {
				account: owner.account,
				value: RESOLUTION_BOND,
			});
			await market.write.disputeResolution([0n], {
				account: otherAccount.account,
				value: RESOLUTION_BOND,
			});
			await market.write.godResolve([0n, true]);

			const hash = await market.write.claimWinnings([0n], { account: owner.account });
			const receipt = await publicClient.waitForTransactionReceipt({ hash });
			const logs = parseEventLogs({
				abi: market.abi,
				logs: receipt.logs,
				eventName: "WinningsClaimed",
			});
			expect(logs).to.have.lengthOf(1);
			const args = logs[0].args as {
				marketId: bigint;
				claimant: string;
				amount: bigint;
			};
			expect(args.marketId).to.equal(0n);
			expect(getAddress(args.claimant)).to.equal(getAddress(owner.account.address));
			expect(args.amount).to.equal(parseEther("4"));
		});
	});

	describe("setResolutionBond", function () {
		it("Should update the bond amount", async function () {
			const { market } = await loadFixture(deployFixture);
			await market.write.setResolutionBond([parseEther("0.5")]);
			expect(await market.read.resolutionBond()).to.equal(parseEther("0.5"));
		});

		it("Should revert if caller is not owner", async function () {
			const { market, otherAccount } = await loadFixture(deployFixture);
			try {
				await market.write.setResolutionBond([parseEther("0.5")], {
					account: otherAccount.account,
				});
				expect.fail("Should have reverted");
			} catch (e: unknown) {
				expect((e as Error).message).to.include("OwnableUnauthorizedAccount");
			}
		});

		it("Should not affect the bond of a market already in Proposed state", async function () {
			const { market } = await loadFixture(deployFixture);
			const deadline = await futureTimestamp(3600);
			await market.write.createMarket(["bond isolation", deadline]);
			await time.increaseTo(deadline);
			await market.write.resolveMarket([0n, true], { value: RESOLUTION_BOND });

			await market.write.setResolutionBond([parseEther("9")]);

			await market.write.disputeResolution([0n], {
				value: RESOLUTION_BOND,
			});

			const [, , , state] = (await market.read.getMarket([0n])) as MarketTuple;
			expect(state).to.equal(3);
		});
	});

	describe("setDisputeWindow", function () {
		it("Should update the dispute window", async function () {
			const { market } = await loadFixture(deployFixture);
			await market.write.setDisputeWindow([3600n]);
			expect(await market.read.disputeWindow()).to.equal(3600n);
		});

		it("Should revert if caller is not owner", async function () {
			const { market, otherAccount } = await loadFixture(deployFixture);
			try {
				await market.write.setDisputeWindow([3600n], { account: otherAccount.account });
				expect.fail("Should have reverted");
			} catch (e: unknown) {
				expect((e as Error).message).to.include("OwnableUnauthorizedAccount");
			}
		});
	});
});
