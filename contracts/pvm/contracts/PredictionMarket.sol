// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract PredictionMarket {
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
		uint256 yesPool;
		uint256 noPool;
	}

	uint256 private marketCount;
	mapping(uint256 => Market) private markets;
	mapping(uint256 => mapping(address => uint256)) private yesDeposits;
	mapping(uint256 => mapping(address => uint256)) private noDeposits;

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
			uint256 yesPool,
			uint256 noPool
		)
	{
		Market memory m = markets[marketId];
		return (m.creator, m.question, m.resolutionTimestamp, m.state, m.yesPool, m.noPool);
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
