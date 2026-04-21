use super::{
	deployments::{load, poe_address, ContractKind},
	hash_input,
	signer::{dev_signers, resolve_signer},
	ProofOfExistence,
};
use alloy::{
	primitives::{Address, FixedBytes},
	providers::ProviderBuilder,
};
use clap::Subcommand;

#[derive(Subcommand)]
pub enum ContractAction {
	/// Show deployed contract addresses and dev accounts
	Info,
	/// Create a proof-of-existence claim
	CreateClaim {
		/// Contract type: evm or pvm
		#[arg(value_parser = ["evm", "pvm"])]
		contract_type: String,
		/// The 0x-prefixed blake2b-256 hash to claim
		#[arg(group = "input")]
		hash: Option<String>,
		/// Path to a file (will be hashed with blake2b-256)
		#[arg(long, group = "input")]
		file: Option<String>,
		/// Signer: dev name (alice/bob/charlie), 0x private key, or mnemonic phrase
		#[arg(long, short, default_value = "alice", env = "CALLIT_SIGNER")]
		signer: String,
		/// Derivation index when `--signer` is a mnemonic
		#[arg(long, default_value_t = 0)]
		account_index: u32,
	},
	/// Revoke a proof-of-existence claim
	RevokeClaim {
		/// Contract type: evm or pvm
		#[arg(value_parser = ["evm", "pvm"])]
		contract_type: String,
		/// The 0x-prefixed hash to revoke
		hash: String,
		/// Signer: dev name, 0x private key, or mnemonic phrase
		#[arg(long, short, default_value = "alice", env = "CALLIT_SIGNER")]
		signer: String,
		#[arg(long, default_value_t = 0)]
		account_index: u32,
	},
	/// Get the claim details for a hash
	GetClaim {
		/// Contract type: evm or pvm
		#[arg(value_parser = ["evm", "pvm"])]
		contract_type: String,
		/// The 0x-prefixed hash to look up
		hash: String,
	},
}

fn parse_hash(hex_str: &str) -> Result<FixedBytes<32>, Box<dyn std::error::Error>> {
	Ok(hex_str.parse()?)
}

pub async fn run(
	action: ContractAction,
	eth_rpc_url: &str,
	_ws_url: &str,
) -> Result<(), Box<dyn std::error::Error>> {
	match action {
		ContractAction::Info => {
			let deployments = load(eth_rpc_url)?;
			println!("Deployed Contracts");
			println!("==================");
			println!(
				"EVM PoE (solc):               {}",
				deployments.evm.as_deref().unwrap_or("not deployed")
			);
			println!(
				"PVM PoE (resolc):             {}",
				deployments.pvm.as_deref().unwrap_or("not deployed")
			);
			println!(
				"EVM PredictionMarket (solc):  {}",
				deployments.evm_prediction_market.as_deref().unwrap_or("not deployed")
			);
			println!(
				"PVM PredictionMarket (resolc):{}",
				deployments.pvm_prediction_market.as_deref().unwrap_or("not deployed")
			);
			println!();
			println!("Dev Accounts (Ethereum)");
			println!("=======================");
			for (name, signer) in dev_signers() {
				println!("{:<10} {}", format!("{}:", name), signer.address());
			}
		},
		ContractAction::CreateClaim { contract_type, hash, file, signer, account_index } => {
			let (hash_hex, _file_bytes) = hash_input(hash, file.as_deref())?;
			let kind = ContractKind::parse(&contract_type)?;
			let deployments = load(eth_rpc_url)?;
			let contract_addr = poe_address(&deployments, kind)?;
			let document_hash = parse_hash(&hash_hex)?;
			let wallet =
				alloy::network::EthereumWallet::from(resolve_signer(&signer, Some(account_index))?);

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
		},
		ContractAction::RevokeClaim { contract_type, hash, signer, account_index } => {
			let kind = ContractKind::parse(&contract_type)?;
			let deployments = load(eth_rpc_url)?;
			let contract_addr = poe_address(&deployments, kind)?;
			let document_hash = parse_hash(&hash)?;
			let wallet =
				alloy::network::EthereumWallet::from(resolve_signer(&signer, Some(account_index))?);

			let provider = ProviderBuilder::new().wallet(wallet).connect_http(eth_rpc_url.parse()?);
			let contract = ProofOfExistence::new(contract_addr, &provider);

			println!("Submitting revokeClaim to {} contract…", kind.as_str().to_uppercase());
			let pending = contract.revokeClaim(document_hash).send().await?;
			let receipt = pending.get_receipt().await?;
			println!(
				"Confirmed in block {}: tx {}",
				receipt.block_number.unwrap_or_default(),
				receipt.transaction_hash
			);
		},
		ContractAction::GetClaim { contract_type, hash } => {
			let kind = ContractKind::parse(&contract_type)?;
			let deployments = load(eth_rpc_url)?;
			let contract_addr = poe_address(&deployments, kind)?;
			let document_hash = parse_hash(&hash)?;

			let provider = ProviderBuilder::new().connect_http(eth_rpc_url.parse()?);
			let contract = ProofOfExistence::new(contract_addr, &provider);

			let result = contract.getClaim(document_hash).call().await?;
			if result.owner == Address::ZERO {
				println!("No claim found for this hash");
			} else {
				println!("Owner: {}", result.owner);
				println!("Block: {}", result.blockNumber);
			}
		},
	}

	Ok(())
}
