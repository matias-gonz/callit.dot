use callit_cli::commands;
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "callit-cli")]
#[command(about = "CLI for interacting with the Callit chain and PredictionMarket contract")]
struct Cli {
	/// WebSocket RPC endpoint URL
	#[arg(long, env = "SUBSTRATE_RPC_WS", default_value = "ws://127.0.0.1:9944")]
	url: String,

	/// Ethereum JSON-RPC endpoint URL (for contract interaction via eth-rpc)
	#[arg(long, env = "ETH_RPC_HTTP", default_value = "http://127.0.0.1:8545")]
	eth_rpc_url: String,

	#[command(subcommand)]
	command: Commands,
}

#[derive(Subcommand)]
enum Commands {
	/// Chain information commands
	Chain {
		#[command(subcommand)]
		action: commands::chain::ChainAction,
	},
	/// Proof-of-existence contract commands (via eth-rpc)
	Contract {
		#[command(subcommand)]
		action: commands::contract::ContractAction,
	},
	/// PredictionMarket contract commands (via eth-rpc)
	Market {
		#[command(subcommand)]
		action: commands::market::MarketAction,
	},
	/// All-in-one: hash a file and create an on-chain claim via contract
	Prove(commands::prove::ProveArgs),
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
	let cli = Cli::parse();

	match cli.command {
		Commands::Chain { action } => commands::chain::run(action, &cli.url).await?,
		Commands::Contract { action } => {
			commands::contract::run(action, &cli.eth_rpc_url, &cli.url).await?
		},
		Commands::Market { action } => {
			commands::market::run(action, &cli.eth_rpc_url, &cli.url).await?
		},
		Commands::Prove(args) => commands::prove::run(args, &cli.url, &cli.eth_rpc_url).await?,
	}

	Ok(())
}
