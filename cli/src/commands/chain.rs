use crate::commands::{resolve_statement_signer, rpc_call, submit_to_statement_store};
use clap::Subcommand;
use codec::Decode;
use sp_core::Pair;
use sp_statement_store::Statement;
use subxt::{OnlineClient, PolkadotConfig};

#[derive(Subcommand)]
pub enum ChainAction {
	/// Display chain information
	Info,
	/// Subscribe to new finalized blocks
	Blocks,
	/// Submit a test statement to the Statement Store RPC
	StatementSubmit {
		/// File whose bytes will be stored as statement data
		#[arg(long)]
		file: String,
		/// Signer for the statement proof
		#[arg(long, default_value = "alice")]
		signer: String,
		/// Submit without a signature proof to test runtime rejection
		#[arg(long)]
		unsigned: bool,
	},
	/// Dump known statements from the Statement Store RPC
	StatementDump,
}

pub async fn run(action: ChainAction, url: &str) -> Result<(), Box<dyn std::error::Error>> {
	match action {
		ChainAction::Info => {
			let api = OnlineClient::<PolkadotConfig>::from_url(url).await?;
			let genesis = api.genesis_hash();
			let runtime_version = api.runtime_version();
			println!("Chain Information");
			println!("=================");
			println!("Genesis Hash:    {genesis}");
			println!("Spec Version:    {}", runtime_version.spec_version);
			println!("TX Version:      {}", runtime_version.transaction_version);
		},
		ChainAction::Blocks => {
			let api = OnlineClient::<PolkadotConfig>::from_url(url).await?;
			println!("Subscribing to finalized blocks (Ctrl+C to stop)...");
			let mut blocks = api.blocks().subscribe_finalized().await?;
			while let Some(block) = blocks.next().await {
				let block = block?;
				println!("Block #{} - Hash: {}", block.number(), block.hash());
			}
		},
		ChainAction::StatementSubmit { file, signer, unsigned } => {
			let bytes = std::fs::read(&file)?;

			if unsigned {
				use codec::Encode;
				println!("Submitting an unsigned statement to test runtime rejection...");
				let mut statement = Statement::new();
				statement.set_plain_data(bytes);
				let encoded = format!("0x{}", hex::encode(statement.encode()));
				let statement_hash = format!("0x{}", hex::encode(statement.hash()));
				rpc_call::<_, ()>(url, "statement_submit", vec![encoded]).await?;
				println!("Statement submitted successfully.");
				println!("Hash: {statement_hash}");
			} else {
				let signer = resolve_statement_signer(&signer)?;
				println!("Using signer: 0x{}", hex::encode(signer.public()));
				submit_to_statement_store(url, &bytes, &signer).await?;
			}
		},
		ChainAction::StatementDump => {
			let encoded_statements: Vec<String> =
				rpc_call(url, "statement_dump", Vec::<String>::new()).await?;

			if encoded_statements.is_empty() {
				println!("No statements in the store.");
				return Ok(());
			}

			println!("Statements in store: {}", encoded_statements.len());
			for (index, encoded) in encoded_statements.iter().enumerate() {
				let raw = hex::decode(encoded.trim_start_matches("0x"))?;
				let statement = Statement::decode(&mut raw.as_slice())?;
				let account =
					statement.account_id().map(hex::encode).unwrap_or_else(|| "none".to_string());

				println!(
					"[{}] hash=0x{} account=0x{} bytes={} topics={} proof={}",
					index,
					hex::encode(statement.hash()),
					account,
					statement.data_len(),
					topic_count(&statement),
					statement.proof().is_some()
				);
			}
		},
	}

	Ok(())
}

fn topic_count(statement: &Statement) -> usize {
	(0..sp_statement_store::MAX_TOPICS)
		.take_while(|index| statement.topic(*index).is_some())
		.count()
}
