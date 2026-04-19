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
	}

	uint256 private marketCount;
	mapping(uint256 => Market) private markets;

	event MarketCreated(
		uint256 indexed marketId,
		address indexed creator,
		string question,
		uint256 resolutionTimestamp
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
			state: State.Open
		});
		marketCount = marketId + 1;

		emit MarketCreated(marketId, msg.sender, question, resolutionTimestamp);
	}

	function getMarket(
		uint256 marketId
	)
		external
		view
		returns (address creator, string memory question, uint256 resolutionTimestamp, State state)
	{
		Market memory m = markets[marketId];
		return (m.creator, m.question, m.resolutionTimestamp, m.state);
	}

	function getMarketCount() external view returns (uint256) {
		return marketCount;
	}
}
