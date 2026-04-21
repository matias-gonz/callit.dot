use super::{
	deployments::{load, poe_address, ContractKind},
	hash_input,
	signer::resolve_signer,
	ProofOfExistence,
};
use alloy::providers::ProviderBuilder;
use clap::Args;

#[derive(Args)]
pub struct ProveArgs {
	/// Path to the file to prove
	#[arg(long)]
	pub file: String,
	/// Contract backend to use (evm or pvm)
	#[arg(long, value_parser = ["evm", "pvm"], default_value = "evm")]
	pub contract: String,
	/// Signer: dev name (alice/bob/charlie), 0x private key, or BIP-39 mnemonic
	#[arg(long, short, default_value = "alice", env = "CALLIT_SIGNER")]
	pub signer: String,
	/// Derivation index when `--signer` is a mnemonic
	#[arg(long, default_value_t = 0)]
	pub account_index: u32,
}

pub async fn run(
	args: ProveArgs,
	_ws_url: &str,
	eth_rpc_url: &str,
) -> Result<(), Box<dyn std::error::Error>> {
	let (hash_hex, _file_bytes) = hash_input(None, Some(&args.file))?;

	let kind = ContractKind::parse(&args.contract)?;
	let deployments = load(eth_rpc_url)?;
	let contract_addr = poe_address(&deployments, kind)?;
	let document_hash: alloy::primitives::FixedBytes<32> = hash_hex.parse()?;
	let wallet = alloy::network::EthereumWallet::from(resolve_signer(
		&args.signer,
		Some(args.account_index),
	)?);

	let provider = ProviderBuilder::new().wallet(wallet).connect_http(eth_rpc_url.parse()?);
	let contract = ProofOfExistence::new(contract_addr, &provider);

	println!("Submitting createClaim to {} contract…", kind.as_str().to_uppercase());
	let pending = contract.createClaim(document_hash).send().await?;
	let receipt = pending.get_receipt().await?;
	println!(
		"Confirmed in block {}: tx {}",
		receipt.block_number.unwrap_or_default(),
		receipt.transaction_hash
	);

	Ok(())
}

#[cfg(test)]
mod tests {
	use super::ProveArgs;

	fn args() -> ProveArgs {
		ProveArgs {
			file: "README.md".to_string(),
			contract: "evm".to_string(),
			signer: "alice".to_string(),
			account_index: 0,
		}
	}

	#[test]
	fn default_args_are_valid() {
		let a = args();
		assert_eq!(a.contract, "evm");
		assert_eq!(a.signer, "alice");
	}
}
