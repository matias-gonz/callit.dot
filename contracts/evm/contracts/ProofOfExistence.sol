// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title ProofOfExistence
/// @notice A proof of existence contract demonstrating the same concept as the
///         pallet-template — create and revoke claims for document hashes.
///         This same Solidity source compiles to both EVM (via solc) and
///         PVM (via resolc) bytecode.
contract ProofOfExistence {
	struct Claim {
		address owner;
		uint256 blockNumber;
	}

	mapping(bytes32 => Claim) private claims;
	bytes32[] private claimHashes;
	mapping(bytes32 => uint256) private claimIndex;

	event ClaimCreated(address indexed who, bytes32 indexed hash);
	event ClaimRevoked(address indexed who, bytes32 indexed hash);

	/// @notice Create a new proof-of-existence claim for a document hash.
	/// @param documentHash The blake2b-256 hash of the document.
	function createClaim(bytes32 documentHash) external {
		require(claims[documentHash].owner == address(0), "Already claimed");
		claims[documentHash] = Claim(msg.sender, block.number);
		claimIndex[documentHash] = claimHashes.length;
		claimHashes.push(documentHash);
		emit ClaimCreated(msg.sender, documentHash);
	}

	/// @notice Revoke an existing proof-of-existence claim.
	/// @param documentHash The hash of the claim to revoke.
	function revokeClaim(bytes32 documentHash) external {
		require(claims[documentHash].owner != address(0), "Claim not found");
		require(claims[documentHash].owner == msg.sender, "Not claim owner");

		// Swap-and-pop to remove from the array
		uint256 idx = claimIndex[documentHash];
		uint256 lastIdx = claimHashes.length - 1;
		if (idx != lastIdx) {
			bytes32 lastHash = claimHashes[lastIdx];
			claimHashes[idx] = lastHash;
			claimIndex[lastHash] = idx;
		}
		claimHashes.pop();
		delete claimIndex[documentHash];
		delete claims[documentHash];

		emit ClaimRevoked(msg.sender, documentHash);
	}

	/// @notice Get the claim details for a document hash.
	/// @param documentHash The hash to look up.
	/// @return owner The address that created the claim (address(0) if unclaimed).
	/// @return blockNumber The block number when the claim was created.
	function getClaim(
		bytes32 documentHash
	) external view returns (address owner, uint256 blockNumber) {
		Claim memory c = claims[documentHash];
		return (c.owner, c.blockNumber);
	}

	/// @notice Get the total number of active claims.
	function getClaimCount() external view returns (uint256) {
		return claimHashes.length;
	}

	/// @notice Get a claim hash by its index in the array.
	/// @param index The index to look up.
	function getClaimHashAtIndex(uint256 index) external view returns (bytes32) {
		return claimHashes[index];
	}
}
