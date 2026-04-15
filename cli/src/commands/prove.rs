use super::ProofOfExistence;
use crate::commands::{
	hash_input, parse_h256, resolve_statement_signer, resolve_substrate_signer,
	submit_to_statement_store, upload_to_bulletin,
};
use alloy::providers::ProviderBuilder;
use clap::Args;
use subxt::{OnlineClient, PolkadotConfig};

use super::contract::{get_contract_address, load_deployments, resolve_signer};

#[derive(Args)]
pub struct ProveArgs {
	/// Path to the file to prove
	#[arg(long)]
	pub file: String,
	/// Create claim via pallet (default if --contract is not set)
	#[arg(long, conflicts_with = "contract")]
	pub pallet: bool,
	/// Create claim via contract (evm or pvm)
	#[arg(long, value_parser = ["evm", "pvm"], conflicts_with = "pallet")]
	pub contract: Option<String>,
	/// Also upload the file to the Bulletin Chain (IPFS)
	#[arg(long)]
	pub bulletin: bool,
	/// Also submit the file to the Statement Store
	#[arg(long)]
	pub statement_store: bool,
	/// Signer: dev name (alice/bob/charlie), mnemonic, or 0x secret seed
	#[arg(long, short, default_value = "alice")]
	pub signer: String,
}

#[derive(Debug, PartialEq, Eq)]
enum ClaimTarget {
	Pallet,
	Contract(String),
}

pub async fn run(
	args: ProveArgs,
	ws_url: &str,
	eth_rpc_url: &str,
) -> Result<(), Box<dyn std::error::Error>> {
	let (hash_hex, file_bytes) = hash_input(None, Some(&args.file))?;
	let file_bytes = file_bytes.unwrap();
	let claim_target = claim_target(&args)?;

	// Optional: upload to Bulletin Chain
	if args.bulletin {
		let keypair = resolve_substrate_signer(&args.signer)?;
		upload_to_bulletin(&file_bytes, &keypair).await?;
	}

	// Optional: submit to Statement Store
	if args.statement_store {
		let statement_signer = resolve_statement_signer(&args.signer)?;
		submit_to_statement_store(ws_url, &file_bytes, &statement_signer).await?;
	}

	// Create on-chain claim
	match claim_target {
		ClaimTarget::Contract(contract_type) => {
			let deployments = load_deployments()?;
			let contract_addr = get_contract_address(&deployments, &contract_type)?;
			let document_hash: alloy::primitives::FixedBytes<32> = hash_hex.parse()?;
			let wallet = alloy::network::EthereumWallet::from(resolve_signer(&args.signer)?);

			let provider = ProviderBuilder::new().wallet(wallet).connect_http(eth_rpc_url.parse()?);
			let contract = ProofOfExistence::new(contract_addr, &provider);

			println!("Submitting createClaim to {} contract...", contract_type.to_uppercase());
			let pending = contract.createClaim(document_hash).send().await?;
			let receipt = pending.get_receipt().await?;
			println!(
				"Confirmed in block {}: tx {}",
				receipt.block_number.unwrap_or_default(),
				receipt.transaction_hash
			);
		},
		ClaimTarget::Pallet => {
			let api = OnlineClient::<PolkadotConfig>::from_url(ws_url).await?;
			let keypair = resolve_substrate_signer(&args.signer)?;
			let hash_bytes = parse_h256(&hash_hex)?;

			let tx = subxt::dynamic::tx(
				"TemplatePallet",
				"create_claim",
				vec![("hash", subxt::dynamic::Value::from_bytes(hash_bytes))],
			);
			let result = api
				.tx()
				.sign_and_submit_then_watch_default(&tx, &keypair)
				.await?
				.wait_for_finalized_success()
				.await?;
			println!("create_claim finalized in block: {}", result.extrinsic_hash());
		},
	}

	Ok(())
}

fn claim_target(args: &ProveArgs) -> Result<ClaimTarget, Box<dyn std::error::Error>> {
	match (args.pallet, args.contract.as_deref()) {
		(true, Some(_)) => Err("Choose either --pallet or --contract <evm|pvm>, not both.".into()),
		(_, Some(contract)) => Ok(ClaimTarget::Contract(contract.to_string())),
		_ => Ok(ClaimTarget::Pallet),
	}
}

#[cfg(test)]
mod tests {
	use super::{claim_target, ClaimTarget, ProveArgs};

	fn args() -> ProveArgs {
		ProveArgs {
			file: "README.md".to_string(),
			pallet: false,
			contract: None,
			bulletin: false,
			statement_store: false,
			signer: "alice".to_string(),
		}
	}

	#[test]
	fn defaults_to_pallet_when_no_explicit_target_is_given() {
		assert_eq!(claim_target(&args()).unwrap(), ClaimTarget::Pallet);
	}

	#[test]
	fn explicit_pallet_selection_uses_pallet_path() {
		let mut args = args();
		args.pallet = true;

		assert_eq!(claim_target(&args).unwrap(), ClaimTarget::Pallet);
	}

	#[test]
	fn contract_selection_uses_contract_path() {
		let mut args = args();
		args.contract = Some("evm".to_string());

		assert_eq!(claim_target(&args).unwrap(), ClaimTarget::Contract("evm".to_string()));
	}

	#[test]
	fn conflicting_targets_are_rejected() {
		let mut args = args();
		args.pallet = true;
		args.contract = Some("pvm".to_string());

		let error = claim_target(&args).unwrap_err();
		assert!(error.to_string().contains("Choose either --pallet or --contract"));
	}
}
