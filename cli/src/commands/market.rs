use super::{
	deployments::{load, prediction_market_address, resolve_market_address, ContractKind},
	signer::{dev_signers, resolve_signer},
	PredictionMarket,
};
use alloy::{
	primitives::{
		utils::{format_ether, parse_ether},
		Address, U256,
	},
	providers::{DynProvider, Provider, ProviderBuilder},
	rpc::types::TransactionReceipt,
	signers::local::PrivateKeySigner,
};
use clap::{Args, Subcommand};
use serde::Serialize;

const MARKET_STATE_LABELS: [&str; 5] = ["Open", "Resolving", "Proposed", "Disputed", "Finalized"];

#[derive(Args, Clone)]
pub struct MarketSelector {
	/// PredictionMarket contract address. Falls back to deployments.json.
	#[arg(long, short = 'c', env = "CALLIT_MARKET_CONTRACT")]
	pub contract: Option<String>,
	/// Contract flavor to pick from deployments.json (evm or pvm). Ignored if --contract is set.
	#[arg(long, value_parser = ["evm", "pvm"], default_value = "pvm")]
	pub kind: String,
}

impl MarketSelector {
	pub fn address(&self, eth_rpc_url: &str) -> Result<Address, Box<dyn std::error::Error>> {
		let kind = ContractKind::parse(&self.kind)?;
		resolve_market_address(self.contract.as_deref(), eth_rpc_url, kind)
	}
}

#[derive(Args, Clone)]
pub struct SignerOpts {
	/// Signer: dev name (alice/bob/charlie), 0x private key, or BIP-39 mnemonic phrase
	#[arg(long, short = 's', default_value = "alice", env = "CALLIT_SIGNER")]
	pub signer: String,
	/// Derivation index when `--signer` is a mnemonic
	#[arg(long, default_value_t = 0)]
	pub account_index: u32,
}

impl SignerOpts {
	pub fn resolve(&self) -> Result<PrivateKeySigner, Box<dyn std::error::Error>> {
		resolve_signer(&self.signer, Some(self.account_index))
	}
}

#[derive(Args, Clone)]
pub struct OutputOpts {
	/// Emit machine-readable JSON on stdout (useful for scripting & MCP integration)
	#[arg(long, global = true)]
	pub json: bool,
}

#[derive(Subcommand)]
pub enum MarketAction {
	/// Show the deployed PredictionMarket address, owner, bond, and dispute window
	Info {
		#[command(flatten)]
		market: MarketSelector,
		#[command(flatten)]
		output: OutputOpts,
	},
	/// List all markets on the contract
	List {
		#[command(flatten)]
		market: MarketSelector,
		#[command(flatten)]
		output: OutputOpts,
	},
	/// Fetch a single market by id
	GetMarket {
		market_id: u64,
		#[command(flatten)]
		market: MarketSelector,
		#[command(flatten)]
		output: OutputOpts,
	},
	/// Fetch a user's YES/NO deposits on a market
	GetPosition {
		market_id: u64,
		/// Address to query. Defaults to the resolved signer's address.
		#[arg(long)]
		user: Option<String>,
		#[command(flatten)]
		market: MarketSelector,
		#[command(flatten)]
		signer: SignerOpts,
		#[command(flatten)]
		output: OutputOpts,
	},
	/// Create a new market
	Create {
		/// Market question
		#[arg(long, short = 'q')]
		question: String,
		/// Resolution deadline: unix seconds, or `+Nh` / `+Nd` relative offset
		#[arg(long, short = 'd')]
		deadline: String,
		#[command(flatten)]
		market: MarketSelector,
		#[command(flatten)]
		signer: SignerOpts,
		#[command(flatten)]
		output: OutputOpts,
	},
	/// Buy YES or NO shares on a market
	Buy {
		market_id: u64,
		/// yes or no
		#[arg(value_parser = ["yes", "no"])]
		outcome: String,
		/// Stake amount in ETH units (e.g. 0.1)
		#[arg(long, short = 'a')]
		amount: String,
		#[command(flatten)]
		market: MarketSelector,
		#[command(flatten)]
		signer: SignerOpts,
		#[command(flatten)]
		output: OutputOpts,
	},
	/// Propose the outcome of a market (posts resolution bond)
	Resolve {
		market_id: u64,
		#[arg(value_parser = ["yes", "no"])]
		outcome: String,
		#[command(flatten)]
		market: MarketSelector,
		#[command(flatten)]
		signer: SignerOpts,
		#[command(flatten)]
		output: OutputOpts,
	},
	/// Dispute a proposed resolution (matches the posted bond)
	Dispute {
		market_id: u64,
		#[command(flatten)]
		market: MarketSelector,
		#[command(flatten)]
		signer: SignerOpts,
		#[command(flatten)]
		output: OutputOpts,
	},
	/// Owner-only: force-resolve a disputed market
	GodResolve {
		market_id: u64,
		#[arg(value_parser = ["yes", "no"])]
		outcome: String,
		#[command(flatten)]
		market: MarketSelector,
		#[command(flatten)]
		signer: SignerOpts,
		#[command(flatten)]
		output: OutputOpts,
	},
	/// Claim winnings (also auto-finalizes after the dispute window closes)
	Claim {
		market_id: u64,
		#[command(flatten)]
		market: MarketSelector,
		#[command(flatten)]
		signer: SignerOpts,
		#[command(flatten)]
		output: OutputOpts,
	},
	/// Owner-only: update the resolution bond (in ETH units)
	SetBond {
		amount: String,
		#[command(flatten)]
		market: MarketSelector,
		#[command(flatten)]
		signer: SignerOpts,
		#[command(flatten)]
		output: OutputOpts,
	},
	/// Owner-only: update the dispute window (in seconds)
	SetWindow {
		seconds: u64,
		#[command(flatten)]
		market: MarketSelector,
		#[command(flatten)]
		signer: SignerOpts,
		#[command(flatten)]
		output: OutputOpts,
	},
}

#[derive(Debug, Serialize)]
pub struct MarketView {
	pub id: u64,
	pub creator: String,
	pub question: String,
	pub resolution_timestamp: u64,
	pub state: u8,
	pub state_label: &'static str,
	pub proposed_outcome: bool,
	pub yes_pool_wei: String,
	pub no_pool_wei: String,
	pub yes_pool: String,
	pub no_pool: String,
}

#[derive(Debug, Serialize)]
pub struct PositionView {
	pub market_id: u64,
	pub user: String,
	pub yes_deposit_wei: String,
	pub no_deposit_wei: String,
	pub yes_deposit: String,
	pub no_deposit: String,
}

#[derive(Debug, Serialize)]
pub struct ContractInfoView {
	pub address: String,
	pub owner: String,
	pub resolution_bond_wei: String,
	pub resolution_bond: String,
	pub dispute_window_seconds: u64,
	pub market_count: u64,
}

#[derive(Debug, Serialize)]
pub struct TxOutcome {
	pub tx_hash: String,
	pub block_number: Option<u64>,
	pub status: bool,
	pub gas_used: u64,
}

impl From<TransactionReceipt> for TxOutcome {
	fn from(r: TransactionReceipt) -> Self {
		Self {
			tx_hash: format!("{:?}", r.transaction_hash),
			block_number: r.block_number,
			status: r.status(),
			gas_used: r.gas_used,
		}
	}
}

fn build_read_provider(eth_rpc_url: &str) -> Result<DynProvider, Box<dyn std::error::Error>> {
	Ok(ProviderBuilder::new().connect_http(eth_rpc_url.parse()?).erased())
}

fn build_write_provider(
	eth_rpc_url: &str,
	signer: PrivateKeySigner,
) -> Result<DynProvider, Box<dyn std::error::Error>> {
	let wallet = alloy::network::EthereumWallet::from(signer);
	Ok(ProviderBuilder::new()
		.wallet(wallet)
		.connect_http(eth_rpc_url.parse()?)
		.erased())
}

fn parse_outcome(s: &str) -> bool {
	matches!(s.to_lowercase().as_str(), "yes" | "true" | "1")
}

fn parse_deadline(input: &str) -> Result<U256, Box<dyn std::error::Error>> {
	let trimmed = input.trim();
	if let Some(rest) = trimmed.strip_prefix('+') {
		let (num_part, unit) =
			rest.split_at(rest.find(|c: char| !c.is_ascii_digit()).unwrap_or(rest.len()));
		let n: u64 = num_part.parse().map_err(|_| -> Box<dyn std::error::Error> {
			"invalid number in relative deadline".into()
		})?;
		let seconds = match unit.trim() {
			"s" | "" => n,
			"m" => n * 60,
			"h" => n * 3600,
			"d" => n * 86_400,
			other => return Err(format!("unknown unit '{other}' (use s, m, h, or d)").into()),
		};
		let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_secs();
		Ok(U256::from(now + seconds))
	} else {
		let ts: u64 = trimmed.parse().map_err(|_| -> Box<dyn std::error::Error> {
			"deadline must be a unix timestamp or +Nh/+Nd form".into()
		})?;
		Ok(U256::from(ts))
	}
}

fn parse_amount_wei(amount: &str) -> Result<U256, Box<dyn std::error::Error>> {
	Ok(parse_ether(amount)?)
}

fn print_json<T: Serialize>(value: &T) -> Result<(), Box<dyn std::error::Error>> {
	println!("{}", serde_json::to_string_pretty(value)?);
	Ok(())
}

async fn fetch_market(
	contract: &PredictionMarket::PredictionMarketInstance<&DynProvider>,
	id: u64,
) -> Result<MarketView, Box<dyn std::error::Error>> {
	let m = contract.getMarket(U256::from(id)).call().await?;
	let state_u8: u8 = m.state;
	let state_label = MARKET_STATE_LABELS.get(state_u8 as usize).copied().unwrap_or("Unknown");
	Ok(MarketView {
		id,
		creator: format!("{:?}", m.creator),
		question: m.question,
		resolution_timestamp: m.resolutionTimestamp.try_into().unwrap_or(u64::MAX),
		state: state_u8,
		state_label,
		proposed_outcome: m.proposedOutcome,
		yes_pool_wei: m.yesPool.to_string(),
		no_pool_wei: m.noPool.to_string(),
		yes_pool: format_ether(m.yesPool),
		no_pool: format_ether(m.noPool),
	})
}

pub async fn run(
	action: MarketAction,
	eth_rpc_url: &str,
	_ws_url: &str,
) -> Result<(), Box<dyn std::error::Error>> {
	match action {
		MarketAction::Info { market, output } => {
			let kind = ContractKind::parse(&market.kind)?;
			let address = match &market.contract {
				Some(explicit) => explicit.parse()?,
				None => prediction_market_address(&load(eth_rpc_url)?, kind)?,
			};
			let provider = build_read_provider(eth_rpc_url)?;
			let contract = PredictionMarket::new(address, &provider);
			let (owner, bond, window, count) = tokio::try_join!(
				async { contract.owner().call().await.map_err(Box::<dyn std::error::Error>::from) },
				async {
					contract
						.resolutionBond()
						.call()
						.await
						.map_err(Box::<dyn std::error::Error>::from)
				},
				async {
					contract
						.disputeWindow()
						.call()
						.await
						.map_err(Box::<dyn std::error::Error>::from)
				},
				async {
					contract
						.getMarketCount()
						.call()
						.await
						.map_err(Box::<dyn std::error::Error>::from)
				},
			)?;

			let info = ContractInfoView {
				address: format!("{address:?}"),
				owner: format!("{owner:?}"),
				resolution_bond_wei: bond.to_string(),
				resolution_bond: format_ether(bond),
				dispute_window_seconds: window.try_into().unwrap_or(u64::MAX),
				market_count: count.try_into().unwrap_or(u64::MAX),
			};

			if output.json {
				print_json(&info)?;
			} else {
				println!("PredictionMarket @ {}", info.address);
				println!("  Owner:                {}", info.owner);
				println!(
					"  Resolution bond:      {} ETH ({} wei)",
					info.resolution_bond, info.resolution_bond_wei
				);
				println!("  Dispute window:       {} s", info.dispute_window_seconds);
				println!("  Markets:              {}", info.market_count);
				println!();
				println!("Dev Accounts");
				for (name, s) in dev_signers() {
					println!("  {:<8} {}", format!("{}:", name), s.address());
				}
			}
		},
		MarketAction::List { market, output } => {
			let address = market.address(eth_rpc_url)?;
			let provider = build_read_provider(eth_rpc_url)?;
			let contract = PredictionMarket::new(address, &provider);
			let count_u256 = contract.getMarketCount().call().await?;
			let count: u64 = count_u256.try_into().unwrap_or(u64::MAX);
			let mut views = Vec::with_capacity(count as usize);
			for id in 0..count {
				views.push(fetch_market(&contract, id).await?);
			}
			if output.json {
				print_json(&views)?;
			} else if views.is_empty() {
				println!("No markets on {address:?}");
			} else {
				for m in &views {
					println!(
						"#{:<4} [{}] {} — YES {} / NO {} — deadline {}",
						m.id,
						m.state_label,
						m.question,
						m.yes_pool,
						m.no_pool,
						m.resolution_timestamp,
					);
				}
			}
		},
		MarketAction::GetMarket { market_id, market, output } => {
			let address = market.address(eth_rpc_url)?;
			let provider = build_read_provider(eth_rpc_url)?;
			let contract = PredictionMarket::new(address, &provider);
			let view = fetch_market(&contract, market_id).await?;
			if output.json {
				print_json(&view)?;
			} else {
				println!("Market #{}", view.id);
				println!("  Question:      {}", view.question);
				println!("  Creator:       {}", view.creator);
				println!("  Deadline:      {}", view.resolution_timestamp);
				println!("  State:         {} ({})", view.state_label, view.state);
				println!("  Proposed:      {}", if view.proposed_outcome { "YES" } else { "NO" });
				println!("  YES pool:      {} ({} wei)", view.yes_pool, view.yes_pool_wei);
				println!("  NO pool:       {} ({} wei)", view.no_pool, view.no_pool_wei);
			}
		},
		MarketAction::GetPosition { market_id, user, market, signer, output } => {
			let address = market.address(eth_rpc_url)?;
			let user_addr: Address = match user {
				Some(raw) => raw.parse()?,
				None => signer.resolve()?.address(),
			};
			let provider = build_read_provider(eth_rpc_url)?;
			let contract = PredictionMarket::new(address, &provider);
			let pos = contract.getUserPosition(U256::from(market_id), user_addr).call().await?;
			let view = PositionView {
				market_id,
				user: format!("{user_addr:?}"),
				yes_deposit_wei: pos.yesDeposit.to_string(),
				no_deposit_wei: pos.noDeposit.to_string(),
				yes_deposit: format_ether(pos.yesDeposit),
				no_deposit: format_ether(pos.noDeposit),
			};
			if output.json {
				print_json(&view)?;
			} else {
				println!("Position of {} on market #{}", view.user, view.market_id);
				println!("  YES deposit:   {} ({} wei)", view.yes_deposit, view.yes_deposit_wei);
				println!("  NO deposit:    {} ({} wei)", view.no_deposit, view.no_deposit_wei);
			}
		},
		MarketAction::Create { question, deadline, market, signer, output } => {
			let address = market.address(eth_rpc_url)?;
			let resolved = signer.resolve()?;
			let sender = resolved.address();
			let deadline_ts = parse_deadline(&deadline)?;
			let provider = build_write_provider(eth_rpc_url, resolved)?;
			let contract = PredictionMarket::new(address, &provider);
			if !output.json {
				println!("Creating market from {sender:?} on {address:?}…");
			}
			let pending = contract.createMarket(question, deadline_ts).send().await?;
			let receipt = pending.get_receipt().await?;
			emit_tx(output.json, "createMarket", receipt)?;
		},
		MarketAction::Buy { market_id, outcome, amount, market, signer, output } => {
			let address = market.address(eth_rpc_url)?;
			let resolved = signer.resolve()?;
			let value = parse_amount_wei(&amount)?;
			let outcome_bool = parse_outcome(&outcome);
			let provider = build_write_provider(eth_rpc_url, resolved)?;
			let contract = PredictionMarket::new(address, &provider);
			if !output.json {
				println!(
					"Buying {} shares on market #{} ({} ETH)…",
					if outcome_bool { "YES" } else { "NO" },
					market_id,
					amount
				);
			}
			let pending = contract
				.buyShares(U256::from(market_id), outcome_bool)
				.value(value)
				.send()
				.await?;
			let receipt = pending.get_receipt().await?;
			emit_tx(output.json, "buyShares", receipt)?;
		},
		MarketAction::Resolve { market_id, outcome, market, signer, output } => {
			let address = market.address(eth_rpc_url)?;
			let resolved = signer.resolve()?;
			let outcome_bool = parse_outcome(&outcome);
			let read_provider = build_read_provider(eth_rpc_url)?;
			let bond =
				PredictionMarket::new(address, &read_provider).resolutionBond().call().await?;
			let provider = build_write_provider(eth_rpc_url, resolved)?;
			let contract = PredictionMarket::new(address, &provider);
			if !output.json {
				println!(
					"Proposing {} on market #{} (bond {} wei)…",
					if outcome_bool { "YES" } else { "NO" },
					market_id,
					bond
				);
			}
			let pending = contract
				.resolveMarket(U256::from(market_id), outcome_bool)
				.value(bond)
				.send()
				.await?;
			let receipt = pending.get_receipt().await?;
			emit_tx(output.json, "resolveMarket", receipt)?;
		},
		MarketAction::Dispute { market_id, market, signer, output } => {
			let address = market.address(eth_rpc_url)?;
			let resolved = signer.resolve()?;
			let read_provider = build_read_provider(eth_rpc_url)?;
			let bond =
				PredictionMarket::new(address, &read_provider).resolutionBond().call().await?;
			let provider = build_write_provider(eth_rpc_url, resolved)?;
			let contract = PredictionMarket::new(address, &provider);
			if !output.json {
				println!("Disputing market #{} (matching bond {} wei)…", market_id, bond);
			}
			let pending =
				contract.disputeResolution(U256::from(market_id)).value(bond).send().await?;
			let receipt = pending.get_receipt().await?;
			emit_tx(output.json, "disputeResolution", receipt)?;
		},
		MarketAction::GodResolve { market_id, outcome, market, signer, output } => {
			let address = market.address(eth_rpc_url)?;
			let resolved = signer.resolve()?;
			let outcome_bool = parse_outcome(&outcome);
			let provider = build_write_provider(eth_rpc_url, resolved)?;
			let contract = PredictionMarket::new(address, &provider);
			if !output.json {
				println!(
					"God-resolving market #{} as {}…",
					market_id,
					if outcome_bool { "YES" } else { "NO" }
				);
			}
			let pending = contract.godResolve(U256::from(market_id), outcome_bool).send().await?;
			let receipt = pending.get_receipt().await?;
			emit_tx(output.json, "godResolve", receipt)?;
		},
		MarketAction::Claim { market_id, market, signer, output } => {
			let address = market.address(eth_rpc_url)?;
			let resolved = signer.resolve()?;
			let provider = build_write_provider(eth_rpc_url, resolved)?;
			let contract = PredictionMarket::new(address, &provider);
			if !output.json {
				println!("Claiming on market #{}…", market_id);
			}
			let pending = contract.claimWinnings(U256::from(market_id)).send().await?;
			let receipt = pending.get_receipt().await?;
			emit_tx(output.json, "claimWinnings", receipt)?;
		},
		MarketAction::SetBond { amount, market, signer, output } => {
			let address = market.address(eth_rpc_url)?;
			let resolved = signer.resolve()?;
			let value = parse_amount_wei(&amount)?;
			let provider = build_write_provider(eth_rpc_url, resolved)?;
			let contract = PredictionMarket::new(address, &provider);
			if !output.json {
				println!("Setting resolution bond to {} wei…", value);
			}
			let pending = contract.setResolutionBond(value).send().await?;
			let receipt = pending.get_receipt().await?;
			emit_tx(output.json, "setResolutionBond", receipt)?;
		},
		MarketAction::SetWindow { seconds, market, signer, output } => {
			let address = market.address(eth_rpc_url)?;
			let resolved = signer.resolve()?;
			let provider = build_write_provider(eth_rpc_url, resolved)?;
			let contract = PredictionMarket::new(address, &provider);
			if !output.json {
				println!("Setting dispute window to {} s…", seconds);
			}
			let pending = contract.setDisputeWindow(U256::from(seconds)).send().await?;
			let receipt = pending.get_receipt().await?;
			emit_tx(output.json, "setDisputeWindow", receipt)?;
		},
	}
	Ok(())
}

fn emit_tx(
	json: bool,
	label: &str,
	receipt: TransactionReceipt,
) -> Result<(), Box<dyn std::error::Error>> {
	let out: TxOutcome = receipt.into();
	if json {
		print_json(&out)
	} else {
		println!(
			"{}: {} — block {} — status {}",
			label,
			out.tx_hash,
			out.block_number.map(|b| b.to_string()).unwrap_or_else(|| "pending".into()),
			if out.status { "ok" } else { "FAILED" }
		);
		Ok(())
	}
}

// Re-exports so the (future) MCP server can drive the same logic programmatically.
pub mod api {
	use super::*;

	pub use super::{ContractInfoView, MarketView, PositionView, TxOutcome};

	pub fn parse_contract_kind(s: &str) -> Result<ContractKind, Box<dyn std::error::Error>> {
		ContractKind::parse(s)
	}

	/// Build a read-only alloy provider (no signer).
	pub fn read_provider(eth_rpc_url: &str) -> Result<DynProvider, Box<dyn std::error::Error>> {
		build_read_provider(eth_rpc_url)
	}

	/// Build a signing provider from a raw signer input (dev name, 0x key, mnemonic).
	pub fn write_provider(
		eth_rpc_url: &str,
		signer_input: &str,
		account_index: Option<u32>,
	) -> Result<DynProvider, Box<dyn std::error::Error>> {
		let signer = resolve_signer(signer_input, account_index)?;
		build_write_provider(eth_rpc_url, signer)
	}

	pub fn address_from(
		explicit: Option<&str>,
		eth_rpc_url: &str,
		kind: ContractKind,
	) -> Result<Address, Box<dyn std::error::Error>> {
		resolve_market_address(explicit, eth_rpc_url, kind)
	}

	pub async fn info(
		provider: &DynProvider,
		contract_addr: Address,
	) -> Result<ContractInfoView, Box<dyn std::error::Error>> {
		let c = PredictionMarket::new(contract_addr, provider);
		let owner = c.owner().call().await?;
		let bond = c.resolutionBond().call().await?;
		let window = c.disputeWindow().call().await?;
		let count = c.getMarketCount().call().await?;
		Ok(ContractInfoView {
			address: format!("{contract_addr:?}"),
			owner: format!("{owner:?}"),
			resolution_bond_wei: bond.to_string(),
			resolution_bond: format_ether(bond),
			dispute_window_seconds: window.try_into().unwrap_or(u64::MAX),
			market_count: count.try_into().unwrap_or(u64::MAX),
		})
	}

	pub async fn list(
		provider: &DynProvider,
		contract_addr: Address,
	) -> Result<Vec<MarketView>, Box<dyn std::error::Error>> {
		let c = PredictionMarket::new(contract_addr, provider);
		let count: u64 = c.getMarketCount().call().await?.try_into().unwrap_or(u64::MAX);
		let mut out = Vec::with_capacity(count as usize);
		for id in 0..count {
			out.push(fetch_market(&c, id).await?);
		}
		Ok(out)
	}

	pub async fn get_market(
		provider: &DynProvider,
		contract_addr: Address,
		market_id: u64,
	) -> Result<MarketView, Box<dyn std::error::Error>> {
		let c = PredictionMarket::new(contract_addr, provider);
		fetch_market(&c, market_id).await
	}

	pub async fn get_position(
		provider: &DynProvider,
		contract_addr: Address,
		market_id: u64,
		user: Address,
	) -> Result<PositionView, Box<dyn std::error::Error>> {
		let c = PredictionMarket::new(contract_addr, provider);
		let pos = c.getUserPosition(U256::from(market_id), user).call().await?;
		Ok(PositionView {
			market_id,
			user: format!("{user:?}"),
			yes_deposit_wei: pos.yesDeposit.to_string(),
			no_deposit_wei: pos.noDeposit.to_string(),
			yes_deposit: format_ether(pos.yesDeposit),
			no_deposit: format_ether(pos.noDeposit),
		})
	}

	pub async fn create_market(
		provider: &DynProvider,
		contract_addr: Address,
		question: &str,
		deadline_ts: u64,
	) -> Result<TxOutcome, Box<dyn std::error::Error>> {
		let c = PredictionMarket::new(contract_addr, provider);
		let pending = c.createMarket(question.to_string(), U256::from(deadline_ts)).send().await?;
		Ok(pending.get_receipt().await?.into())
	}

	pub async fn buy_shares(
		provider: &DynProvider,
		contract_addr: Address,
		market_id: u64,
		outcome_yes: bool,
		amount_wei: U256,
	) -> Result<TxOutcome, Box<dyn std::error::Error>> {
		let c = PredictionMarket::new(contract_addr, provider);
		let pending =
			c.buyShares(U256::from(market_id), outcome_yes).value(amount_wei).send().await?;
		Ok(pending.get_receipt().await?.into())
	}

	pub async fn resolve_market(
		provider: &DynProvider,
		contract_addr: Address,
		market_id: u64,
		outcome_yes: bool,
	) -> Result<TxOutcome, Box<dyn std::error::Error>> {
		let c = PredictionMarket::new(contract_addr, provider);
		let bond = c.resolutionBond().call().await?;
		let pending =
			c.resolveMarket(U256::from(market_id), outcome_yes).value(bond).send().await?;
		Ok(pending.get_receipt().await?.into())
	}

	pub async fn dispute(
		provider: &DynProvider,
		contract_addr: Address,
		market_id: u64,
	) -> Result<TxOutcome, Box<dyn std::error::Error>> {
		let c = PredictionMarket::new(contract_addr, provider);
		let bond = c.resolutionBond().call().await?;
		let pending = c.disputeResolution(U256::from(market_id)).value(bond).send().await?;
		Ok(pending.get_receipt().await?.into())
	}

	pub async fn god_resolve(
		provider: &DynProvider,
		contract_addr: Address,
		market_id: u64,
		outcome_yes: bool,
	) -> Result<TxOutcome, Box<dyn std::error::Error>> {
		let c = PredictionMarket::new(contract_addr, provider);
		let pending = c.godResolve(U256::from(market_id), outcome_yes).send().await?;
		Ok(pending.get_receipt().await?.into())
	}

	pub async fn claim(
		provider: &DynProvider,
		contract_addr: Address,
		market_id: u64,
	) -> Result<TxOutcome, Box<dyn std::error::Error>> {
		let c = PredictionMarket::new(contract_addr, provider);
		let pending = c.claimWinnings(U256::from(market_id)).send().await?;
		Ok(pending.get_receipt().await?.into())
	}

	pub async fn set_bond(
		provider: &DynProvider,
		contract_addr: Address,
		amount_wei: U256,
	) -> Result<TxOutcome, Box<dyn std::error::Error>> {
		let c = PredictionMarket::new(contract_addr, provider);
		let pending = c.setResolutionBond(amount_wei).send().await?;
		Ok(pending.get_receipt().await?.into())
	}

	pub async fn set_window(
		provider: &DynProvider,
		contract_addr: Address,
		seconds: u64,
	) -> Result<TxOutcome, Box<dyn std::error::Error>> {
		let c = PredictionMarket::new(contract_addr, provider);
		let pending = c.setDisputeWindow(U256::from(seconds)).send().await?;
		Ok(pending.get_receipt().await?.into())
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn parse_deadline_accepts_unix_seconds() {
		let ts = parse_deadline("1800000000").unwrap();
		assert_eq!(ts, U256::from(1_800_000_000u64));
	}

	#[test]
	fn parse_deadline_accepts_relative_hours() {
		let before = std::time::SystemTime::now()
			.duration_since(std::time::UNIX_EPOCH)
			.unwrap()
			.as_secs();
		let ts = parse_deadline("+2h").unwrap();
		let ts_u64: u64 = ts.try_into().unwrap();
		assert!(ts_u64 >= before + 7200 - 2 && ts_u64 <= before + 7200 + 2);
	}

	#[test]
	fn parse_outcome_is_lenient() {
		assert!(parse_outcome("yes"));
		assert!(parse_outcome("YES"));
		assert!(parse_outcome("true"));
		assert!(parse_outcome("1"));
		assert!(!parse_outcome("no"));
		assert!(!parse_outcome("false"));
	}

	#[test]
	fn parse_amount_in_ether() {
		let w = parse_amount_wei("1").unwrap();
		assert_eq!(w, U256::from(1_000_000_000_000_000_000u128));
	}
}
