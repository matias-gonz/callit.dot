pub mod chain;
pub mod contract;
pub mod prove;

use alloy::sol;
use blake2::{
	digest::{consts::U32, Digest},
	Blake2b,
};

// Shared contract ABI for the ProofOfExistence Solidity contract.
// Used by both the `contract` and `prove` command modules.
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
