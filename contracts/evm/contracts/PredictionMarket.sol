// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";

contract PredictionMarket is Ownable {
	enum State {
		Open,
		Resolving,
		Proposed,
		Disputed,
		Finalized
	}

	struct Market {
		address creator;
		string question;
		uint256 resolutionTimestamp;
		State state;
		bool proposedOutcome;
		address resolver;
		address disputer;
		uint256 disputeDeadline;
		uint256 yesPool;
		uint256 noPool;
	}

	uint256 public resolutionBond;
	uint256 public disputeWindow;

	uint256 private marketCount;
	mapping(uint256 => Market) private markets;
	mapping(uint256 => mapping(address => uint256)) private yesDeposits;
	mapping(uint256 => mapping(address => uint256)) private noDeposits;

	constructor(uint256 initialResolutionBond, uint256 initialDisputeWindow) Ownable(msg.sender) {
		resolutionBond = initialResolutionBond;
		disputeWindow = initialDisputeWindow;
	}

	event MarketCreated(
		uint256 indexed marketId,
		address indexed creator,
		string question,
		uint256 resolutionTimestamp
	);

	event SharesBought(
		uint256 indexed marketId,
		address indexed buyer,
		bool outcome,
		uint256 amount
	);

	event MarketResolved(
		uint256 indexed marketId,
		address indexed resolver,
		bool outcome
	);

	event DisputeRaised(uint256 indexed marketId, address indexed disputer);

	function createMarket(
		string calldata question,
		uint256 resolutionTimestamp
	) external returns (uint256 marketId) {
		require(bytes(question).length > 0, "Question required");
		require(resolutionTimestamp > block.timestamp, "Resolution must be in the future");

		marketId = marketCount;
		markets[marketId] = Market({
			creator: msg.sender,
			question: question,
			resolutionTimestamp: resolutionTimestamp,
			state: State.Open,
			proposedOutcome: false,
			resolver: address(0),
			disputer: address(0),
			disputeDeadline: 0,
			yesPool: 0,
			noPool: 0
		});
		marketCount = marketId + 1;

		emit MarketCreated(marketId, msg.sender, question, resolutionTimestamp);
	}

	function buyShares(uint256 marketId, bool outcome) external payable {
		Market storage m = markets[marketId];
		require(m.state == State.Open, "Market not open");
		require(block.timestamp < m.resolutionTimestamp, "Market closed for trading");
		require(msg.value > 0, "Must send tokens to buy shares");

		if (outcome) {
			m.yesPool += msg.value;
			yesDeposits[marketId][msg.sender] += msg.value;
		} else {
			m.noPool += msg.value;
			noDeposits[marketId][msg.sender] += msg.value;
		}

		emit SharesBought(marketId, msg.sender, outcome, msg.value);
	}

	function resolveMarket(uint256 marketId, bool outcome) external payable {
		Market storage m = markets[marketId];
		require(m.state == State.Open, "Market not open");
		require(block.timestamp >= m.resolutionTimestamp, "Too early to resolve");
		require(msg.value == resolutionBond, "Wrong bond amount");

		m.state = State.Proposed;
		m.proposedOutcome = outcome;
		m.resolver = msg.sender;
		m.disputeDeadline = block.timestamp + disputeWindow;

		emit MarketResolved(marketId, msg.sender, outcome);
	}

	function disputeResolution(uint256 marketId) external payable {
		Market storage m = markets[marketId];
		require(m.state == State.Proposed, "Market not in Proposed state");
		require(block.timestamp <= m.disputeDeadline, "Dispute window closed");
		require(msg.value == resolutionBond, "Wrong bond amount");

		m.state = State.Disputed;
		m.disputer = msg.sender;

		emit DisputeRaised(marketId, msg.sender);
	}

	function getMarket(
		uint256 marketId
	)
		external
		view
		returns (
			address creator,
			string memory question,
			uint256 resolutionTimestamp,
			State state,
			bool proposedOutcome,
			uint256 yesPool,
			uint256 noPool
		)
	{
		Market memory m = markets[marketId];
		return (
			m.creator,
			m.question,
			m.resolutionTimestamp,
			m.state,
			m.proposedOutcome,
			m.yesPool,
			m.noPool
		);
	}

	function getUserPosition(
		uint256 marketId,
		address user
	) external view returns (uint256 yesDeposit, uint256 noDeposit) {
		return (yesDeposits[marketId][user], noDeposits[marketId][user]);
	}

	function getMarketCount() external view returns (uint256) {
		return marketCount;
	}
}
