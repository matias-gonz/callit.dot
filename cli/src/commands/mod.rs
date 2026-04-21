pub mod chain;
pub mod contract;
pub mod deployments;
pub mod market;
pub mod prove;
pub mod signer;

use alloy::sol;
use blake2::{
	digest::{consts::U32, Digest},
	Blake2b,
};

sol! {
	#[sol(rpc)]
	contract ProofOfExistence {
		function createClaim(bytes32 documentHash) external;
		function revokeClaim(bytes32 documentHash) external;
		function getClaim(bytes32 documentHash) external view returns (address owner, uint256 blockNumber);
		function getClaimCount() external view returns (uint256);
		function getClaimHashAtIndex(uint256 index) external view returns (bytes32);
	}
}

sol! {
	#[sol(rpc)]
	contract PredictionMarket {
		function resolutionBond() external view returns (uint256);
		function disputeWindow() external view returns (uint256);
		function owner() external view returns (address);

		function createMarket(string calldata question, uint256 resolutionTimestamp) external returns (uint256 marketId);
		function buyShares(uint256 marketId, bool outcome) external payable;
		function resolveMarket(uint256 marketId, bool outcome) external payable;
		function disputeResolution(uint256 marketId) external payable;
		function godResolve(uint256 marketId, bool outcome) external;
		function claimWinnings(uint256 marketId) external;

		function getMarket(uint256 marketId) external view returns (
			address creator,
			string memory question,
			uint256 resolutionTimestamp,
			uint8 state,
			bool proposedOutcome,
			uint256 yesPool,
			uint256 noPool
		);
		function getUserPosition(uint256 marketId, address user) external view returns (uint256 yesDeposit, uint256 noDeposit);
		function getMarketCount() external view returns (uint256);

		function setResolutionBond(uint256 amount) external;
		function setDisputeWindow(uint256 duration) external;

		event MarketCreated(uint256 indexed marketId, address indexed creator, string question, uint256 resolutionTimestamp);
		event SharesBought(uint256 indexed marketId, address indexed buyer, bool outcome, uint256 amount);
		event MarketResolved(uint256 indexed marketId, address indexed resolver, bool outcome);
		event DisputeRaised(uint256 indexed marketId, address indexed disputer);
		event MarketFinalized(uint256 indexed marketId, bool outcome);
		event WinningsClaimed(uint256 indexed marketId, address indexed claimant, uint256 amount);
	}
}

use std::fs;

type Blake2b256 = Blake2b<U32>;
type HashResult = Result<(String, Option<Vec<u8>>), Box<dyn std::error::Error>>;

/// Resolve a hash from either a direct hex string or a file path.
/// Returns (hex_hash, Option<file_bytes>).
pub fn hash_input(hash: Option<String>, file: Option<&str>) -> HashResult {
	match (hash, file) {
		(Some(h), _) => Ok((h, None)),
		(None, Some(path)) => {
			let bytes = fs::read(path)?;
			let mut hasher = Blake2b256::new();
			hasher.update(&bytes);
			let result = hasher.finalize();
			let hex = format!("0x{}", hex::encode(result));
			println!("File: {path}");
			println!("Blake2b-256: {hex}");
			Ok((hex, Some(bytes)))
		},
		(None, None) => Err("Provide either a hash or --file <path>".into()),
	}
}
