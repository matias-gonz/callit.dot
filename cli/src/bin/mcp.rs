//! `callit-mcp` — Model Context Protocol server exposing the Callit
//! `PredictionMarket` contract as MCP tools over stdio.
//!
//! The server is fully stateless: **no environment variables are read**. Every
//! call must supply the Ethereum JSON-RPC URL, and every write call must supply
//! the signer. A single running server can therefore talk to any chain and act
//! as any identity — the agent decides per call.
//!
//! Required fields on every tool that touches the chain:
//!
//! - `eth_rpc_url` — e.g. `http://127.0.0.1:8545` (local dev) or
//!                   `https://eth-rpc-testnet.polkadot.io/` (Paseo Hub TestNet).
//!
//! Required on every **write** tool:
//!
//! - `signer` — `alice|bob|charlie` (well-known Substrate dev keys in
//!              Ethereum form), a `0x`-prefixed 32-byte private key, or a
//!              BIP-39 mnemonic phrase.
//!
//! Optional on every tool, with built-in defaults:
//!
//! - `kind`          — `evm` or `pvm` (default: `pvm`).
//! - `account_index` — derivation index for mnemonic signers (default: `0`).
//! - `network`       — `local` or `paseoHub` slot in `deployments.json`.
//!                     When omitted, derived from the URL.
//! - `contract`      — explicit PredictionMarket address; bypasses
//!                     `deployments.json`.

use alloy::{
	primitives::{Address, U256},
	providers::DynProvider,
};
use callit_cli::commands::{deployments::ContractKind, market::api};
use rmcp::{
	handler::server::{router::tool::ToolRouter, wrapper::Parameters},
	model::{CallToolResult, Content, Implementation, ServerCapabilities, ServerInfo},
	schemars::{self, JsonSchema},
	tool, tool_handler, tool_router,
	transport::stdio,
	ErrorData as McpError, ServerHandler, ServiceExt,
};
use serde::{Deserialize, Serialize};

const DEFAULT_KIND: &str = "pvm";
const DEFAULT_ACCOUNT_INDEX: u32 = 0;

const INSTRUCTIONS: &str = "MCP server for the Callit PredictionMarket smart contract. \
Tools cover both reads (info, list, get_market, get_position) and writes \
(create, buy, resolve, dispute, god_resolve, claim, set_bond, set_window). \
The server is stateless: every tool call must pass `eth_rpc_url`, and every \
write call must pass `signer`. No defaults are read from environment variables. \
`kind` defaults to \"pvm\", `account_index` to 0, `network` is auto-derived \
from the URL, and `contract` is loaded from deployments.json when omitted. \
Outcomes accept 'yes'/'no' (also true/false/1/0). Deadlines accept either a \
unix timestamp or a relative form like '+7d' / '+12h' / '+30m'. Amounts are in \
ETH units (e.g. '0.05'). Paseo Hub TestNet URL: \
https://eth-rpc-testnet.polkadot.io/";

#[derive(Clone)]
pub struct CallitServer {
	#[allow(dead_code)] // consumed by the rmcp `#[tool_handler]` macro
	tool_router: ToolRouter<Self>,
}

#[derive(Debug, Serialize)]
struct ServerConfigView {
	stateless: bool,
	required_per_call: &'static [&'static str],
	required_on_writes: &'static [&'static str],
	optional_with_default: &'static [(&'static str, &'static str)],
	optional_with_auto_resolution: &'static [(&'static str, &'static str)],
	example_eth_rpc_urls: &'static [(&'static str, &'static str)],
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ContractArgs {
	/// Optional PredictionMarket address (0x…). When omitted, the address is
	/// looked up in `deployments.json` using the `network` slot.
	#[serde(default)]
	pub contract: Option<String>,
	/// Contract flavor: "evm" or "pvm". Defaults to "pvm".
	#[serde(default)]
	pub kind: Option<String>,
	/// Required Ethereum JSON-RPC URL for this call. Examples:
	/// `http://127.0.0.1:8545` (local dev), `https://eth-rpc-testnet.polkadot.io/` (Paseo Hub TestNet).
	pub eth_rpc_url: String,
	/// Optional `deployments.json` slot: "local" or "paseoHub". When set,
	/// bypasses URL sniffing. Only relevant when `contract` is not supplied
	/// (i.e. the address is loaded from `deployments.json`).
	#[serde(default)]
	pub network: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct GetMarketArgs {
	/// Market id (u64).
	pub market_id: u64,
	#[serde(default)]
	pub contract: Option<String>,
	#[serde(default)]
	pub kind: Option<String>,
	/// Required Ethereum JSON-RPC URL for this call. Examples:
	/// `http://127.0.0.1:8545` (local dev), `https://eth-rpc-testnet.polkadot.io/` (Paseo Hub TestNet).
	pub eth_rpc_url: String,
	/// Optional `deployments.json` slot: "local" or "paseoHub". When set,
	/// bypasses URL sniffing. Only relevant when `contract` is not supplied
	/// (i.e. the address is loaded from `deployments.json`).
	#[serde(default)]
	pub network: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct GetPositionArgs {
	pub market_id: u64,
	/// Address to query. Either `user` or `signer` must be provided. If only
	/// `signer` is given, the signer's derived Ethereum address is used.
	#[serde(default)]
	pub user: Option<String>,
	/// Optional signer (dev name / 0x private key / mnemonic). Only consulted
	/// when `user` is omitted, purely to derive an address to query.
	#[serde(default)]
	pub signer: Option<String>,
	#[serde(default)]
	pub account_index: Option<u32>,
	#[serde(default)]
	pub contract: Option<String>,
	#[serde(default)]
	pub kind: Option<String>,
	/// Required Ethereum JSON-RPC URL for this call. Examples:
	/// `http://127.0.0.1:8545` (local dev), `https://eth-rpc-testnet.polkadot.io/` (Paseo Hub TestNet).
	pub eth_rpc_url: String,
	/// Optional `deployments.json` slot: "local" or "paseoHub". When set,
	/// bypasses URL sniffing. Only relevant when `contract` is not supplied
	/// (i.e. the address is loaded from `deployments.json`).
	#[serde(default)]
	pub network: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct CreateMarketArgs {
	/// Market question shown to participants.
	pub question: String,
	/// Resolution deadline. Either a unix timestamp (seconds) or a relative
	/// form: "+30m", "+12h", "+7d".
	pub deadline: String,
	/// Signer: dev name (alice/bob/charlie), 0x private key, or BIP-39 mnemonic. Required.
	pub signer: String,
	#[serde(default)]
	pub account_index: Option<u32>,
	#[serde(default)]
	pub contract: Option<String>,
	#[serde(default)]
	pub kind: Option<String>,
	/// Required Ethereum JSON-RPC URL for this call. Examples:
	/// `http://127.0.0.1:8545` (local dev), `https://eth-rpc-testnet.polkadot.io/` (Paseo Hub TestNet).
	pub eth_rpc_url: String,
	/// Optional `deployments.json` slot: "local" or "paseoHub". When set,
	/// bypasses URL sniffing. Only relevant when `contract` is not supplied
	/// (i.e. the address is loaded from `deployments.json`).
	#[serde(default)]
	pub network: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct BuyArgs {
	pub market_id: u64,
	/// "yes" or "no" (also accepts "true"/"false"/"1"/"0").
	pub outcome: String,
	/// Stake amount in ETH units, e.g. "0.05".
	pub amount: String,
	/// Signer: dev name (alice/bob/charlie), 0x private key, or BIP-39 mnemonic. Required.
	pub signer: String,
	#[serde(default)]
	pub account_index: Option<u32>,
	#[serde(default)]
	pub contract: Option<String>,
	#[serde(default)]
	pub kind: Option<String>,
	/// Required Ethereum JSON-RPC URL for this call. Examples:
	/// `http://127.0.0.1:8545` (local dev), `https://eth-rpc-testnet.polkadot.io/` (Paseo Hub TestNet).
	pub eth_rpc_url: String,
	/// Optional `deployments.json` slot: "local" or "paseoHub". When set,
	/// bypasses URL sniffing. Only relevant when `contract` is not supplied
	/// (i.e. the address is loaded from `deployments.json`).
	#[serde(default)]
	pub network: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct OutcomeArgs {
	pub market_id: u64,
	/// "yes" or "no".
	pub outcome: String,
	/// Signer: dev name (alice/bob/charlie), 0x private key, or BIP-39 mnemonic. Required.
	pub signer: String,
	#[serde(default)]
	pub account_index: Option<u32>,
	#[serde(default)]
	pub contract: Option<String>,
	#[serde(default)]
	pub kind: Option<String>,
	/// Required Ethereum JSON-RPC URL for this call. Examples:
	/// `http://127.0.0.1:8545` (local dev), `https://eth-rpc-testnet.polkadot.io/` (Paseo Hub TestNet).
	pub eth_rpc_url: String,
	/// Optional `deployments.json` slot: "local" or "paseoHub". When set,
	/// bypasses URL sniffing. Only relevant when `contract` is not supplied
	/// (i.e. the address is loaded from `deployments.json`).
	#[serde(default)]
	pub network: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct MarketWriteArgs {
	pub market_id: u64,
	/// Signer: dev name (alice/bob/charlie), 0x private key, or BIP-39 mnemonic. Required.
	pub signer: String,
	#[serde(default)]
	pub account_index: Option<u32>,
	#[serde(default)]
	pub contract: Option<String>,
	#[serde(default)]
	pub kind: Option<String>,
	/// Required Ethereum JSON-RPC URL for this call. Examples:
	/// `http://127.0.0.1:8545` (local dev), `https://eth-rpc-testnet.polkadot.io/` (Paseo Hub TestNet).
	pub eth_rpc_url: String,
	/// Optional `deployments.json` slot: "local" or "paseoHub". When set,
	/// bypasses URL sniffing. Only relevant when `contract` is not supplied
	/// (i.e. the address is loaded from `deployments.json`).
	#[serde(default)]
	pub network: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SetBondArgs {
	/// New resolution bond in ETH units (e.g. "0.25").
	pub amount: String,
	/// Signer: dev name (alice/bob/charlie), 0x private key, or BIP-39 mnemonic. Required.
	pub signer: String,
	#[serde(default)]
	pub account_index: Option<u32>,
	#[serde(default)]
	pub contract: Option<String>,
	#[serde(default)]
	pub kind: Option<String>,
	/// Required Ethereum JSON-RPC URL for this call. Examples:
	/// `http://127.0.0.1:8545` (local dev), `https://eth-rpc-testnet.polkadot.io/` (Paseo Hub TestNet).
	pub eth_rpc_url: String,
	/// Optional `deployments.json` slot: "local" or "paseoHub". When set,
	/// bypasses URL sniffing. Only relevant when `contract` is not supplied
	/// (i.e. the address is loaded from `deployments.json`).
	#[serde(default)]
	pub network: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct SetWindowArgs {
	/// New dispute window in seconds.
	pub seconds: u64,
	/// Signer: dev name (alice/bob/charlie), 0x private key, or BIP-39 mnemonic. Required.
	pub signer: String,
	#[serde(default)]
	pub account_index: Option<u32>,
	#[serde(default)]
	pub contract: Option<String>,
	#[serde(default)]
	pub kind: Option<String>,
	/// Required Ethereum JSON-RPC URL for this call. Examples:
	/// `http://127.0.0.1:8545` (local dev), `https://eth-rpc-testnet.polkadot.io/` (Paseo Hub TestNet).
	pub eth_rpc_url: String,
	/// Optional `deployments.json` slot: "local" or "paseoHub". When set,
	/// bypasses URL sniffing. Only relevant when `contract` is not supplied
	/// (i.e. the address is loaded from `deployments.json`).
	#[serde(default)]
	pub network: Option<String>,
}

fn invalid_params<E: std::fmt::Display>(e: E) -> McpError {
	McpError::invalid_params(e.to_string(), None)
}

fn internal<E: std::fmt::Display>(e: E) -> McpError {
	McpError::internal_error(e.to_string(), None)
}

fn ok_json<T: Serialize>(value: &T) -> Result<CallToolResult, McpError> {
	let body = serde_json::to_string_pretty(value).map_err(internal)?;
	Ok(CallToolResult::success(vec![Content::text(body)]))
}

#[tool_router]
impl CallitServer {
	pub fn new() -> Self {
		Self { tool_router: Self::tool_router() }
	}

	#[tool(description = "Describe how this MCP server is configured. The server is stateless \
		and reads no environment variables: the agent decides every value per call. Use this \
		tool to discover which fields are required, which have defaults, and example values.")]
	async fn config(&self) -> Result<CallToolResult, McpError> {
		let view = ServerConfigView {
			stateless: true,
			required_per_call: &["eth_rpc_url"],
			required_on_writes: &["signer"],
			optional_with_default: &[
				("kind", "\"pvm\" (also accepts \"evm\")"),
				("account_index", "0 (only used for mnemonic signers)"),
			],
			optional_with_auto_resolution: &[
				(
					"network",
					"auto-derived from eth_rpc_url (localhost → \"local\", else \"paseoHub\")",
				),
				("contract", "looked up in deployments.json using the resolved network"),
			],
			example_eth_rpc_urls: &[
				("local", "http://127.0.0.1:8545"),
				("paseoHub", "https://eth-rpc-testnet.polkadot.io/"),
			],
		};
		ok_json(&view)
	}

	#[tool(description = "Read PredictionMarket contract metadata: address, owner, current \
		resolution bond (wei + ETH), dispute window (seconds), and total market count.")]
	async fn market_info(
		&self,
		Parameters(args): Parameters<ContractArgs>,
	) -> Result<CallToolResult, McpError> {
		let kind = self.kind(args.kind)?;
		let rpc = args.eth_rpc_url.as_str();
		let net = args.network.as_deref();
		let address = self.address(args.contract, rpc, net, kind)?;
		let provider = self.read_provider(rpc)?;
		let info = api::info(&provider, address).await.map_err(internal)?;
		ok_json(&info)
	}

	#[tool(description = "List every market on the contract. Each entry includes id, question, \
		creator, resolution timestamp, state (Open/Resolving/Proposed/Disputed/Finalized), \
		proposed outcome, and current YES/NO pool sizes.")]
	async fn market_list(
		&self,
		Parameters(args): Parameters<ContractArgs>,
	) -> Result<CallToolResult, McpError> {
		let kind = self.kind(args.kind)?;
		let rpc = args.eth_rpc_url.as_str();
		let net = args.network.as_deref();
		let address = self.address(args.contract, rpc, net, kind)?;
		let provider = self.read_provider(rpc)?;
		let markets = api::list(&provider, address).await.map_err(internal)?;
		ok_json(&markets)
	}

	#[tool(description = "Fetch a single market by id.")]
	async fn market_get(
		&self,
		Parameters(args): Parameters<GetMarketArgs>,
	) -> Result<CallToolResult, McpError> {
		let kind = self.kind(args.kind)?;
		let rpc = args.eth_rpc_url.as_str();
		let net = args.network.as_deref();
		let address = self.address(args.contract, rpc, net, kind)?;
		let provider = self.read_provider(rpc)?;
		let view = api::get_market(&provider, address, args.market_id).await.map_err(internal)?;
		ok_json(&view)
	}

	#[tool(description = "Read a user's YES/NO deposits on a market. If `user` is omitted, the \
		resolved signer's own address is used.")]
	async fn market_get_position(
		&self,
		Parameters(args): Parameters<GetPositionArgs>,
	) -> Result<CallToolResult, McpError> {
		let kind = self.kind(args.kind)?;
		let rpc = args.eth_rpc_url.as_str();
		let net = args.network.as_deref();
		let address = self.address(args.contract, rpc, net, kind)?;
		let user_addr: Address = match (args.user.as_deref(), args.signer.as_deref()) {
			(Some(raw), _) => raw.parse().map_err(invalid_params)?,
			(None, Some(s)) => api::resolve_signer_for(s, args.account_index)
				.map_err(invalid_params)?,
			(None, None) =>
				return Err(invalid_params("either `user` or `signer` must be provided")),
		};
		let provider = self.read_provider(rpc)?;
		let view = api::get_position(&provider, address, args.market_id, user_addr)
			.await
			.map_err(internal)?;
		ok_json(&view)
	}

	#[tool(description = "Create a new market. `deadline` accepts either a unix timestamp \
		(seconds) or a relative form like '+30m' / '+12h' / '+7d'. Returns the transaction \
		receipt; the new market id is the previous `market_count`.")]
	async fn market_create(
		&self,
		Parameters(args): Parameters<CreateMarketArgs>,
	) -> Result<CallToolResult, McpError> {
		let kind = self.kind(args.kind)?;
		let rpc = args.eth_rpc_url.as_str();
		let net = args.network.as_deref();
		let address = self.address(args.contract, rpc, net, kind)?;
		let deadline_u256 = api::parse_deadline(&args.deadline).map_err(invalid_params)?;
		let deadline_ts: u64 = deadline_u256.try_into().unwrap_or(u64::MAX);
		let provider = self.write_provider(&args.signer, args.account_index, rpc)?;
		let outcome = api::create_market(&provider, address, &args.question, deadline_ts)
			.await
			.map_err(internal)?;
		ok_json(&outcome)
	}

	#[tool(description = "Buy YES or NO shares on a market. `amount` is the stake in ETH units \
		(e.g. '0.05'); it is sent as msg.value.")]
	async fn market_buy(
		&self,
		Parameters(args): Parameters<BuyArgs>,
	) -> Result<CallToolResult, McpError> {
		let kind = self.kind(args.kind)?;
		let rpc = args.eth_rpc_url.as_str();
		let net = args.network.as_deref();
		let address = self.address(args.contract, rpc, net, kind)?;
		let amount_wei: U256 = api::parse_amount_wei(&args.amount).map_err(invalid_params)?;
		let outcome_yes = api::parse_outcome(&args.outcome);
		let provider = self.write_provider(&args.signer, args.account_index, rpc)?;
		let outcome = api::buy_shares(&provider, address, args.market_id, outcome_yes, amount_wei)
			.await
			.map_err(internal)?;
		ok_json(&outcome)
	}

	#[tool(description = "Propose the outcome of a market. Posts the current resolution bond \
		automatically (read from the contract).")]
	async fn market_resolve(
		&self,
		Parameters(args): Parameters<OutcomeArgs>,
	) -> Result<CallToolResult, McpError> {
		let kind = self.kind(args.kind)?;
		let rpc = args.eth_rpc_url.as_str();
		let net = args.network.as_deref();
		let address = self.address(args.contract, rpc, net, kind)?;
		let outcome_yes = api::parse_outcome(&args.outcome);
		let provider = self.write_provider(&args.signer, args.account_index, rpc)?;
		let outcome = api::resolve_market(&provider, address, args.market_id, outcome_yes)
			.await
			.map_err(internal)?;
		ok_json(&outcome)
	}

	#[tool(description = "Dispute a proposed resolution within the dispute window. Matches the \
		posted bond automatically.")]
	async fn market_dispute(
		&self,
		Parameters(args): Parameters<MarketWriteArgs>,
	) -> Result<CallToolResult, McpError> {
		let kind = self.kind(args.kind)?;
		let rpc = args.eth_rpc_url.as_str();
		let net = args.network.as_deref();
		let address = self.address(args.contract, rpc, net, kind)?;
		let provider = self.write_provider(&args.signer, args.account_index, rpc)?;
		let outcome = api::dispute(&provider, address, args.market_id).await.map_err(internal)?;
		ok_json(&outcome)
	}

	#[tool(description = "Owner-only: force-resolve a disputed market.")]
	async fn market_god_resolve(
		&self,
		Parameters(args): Parameters<OutcomeArgs>,
	) -> Result<CallToolResult, McpError> {
		let kind = self.kind(args.kind)?;
		let rpc = args.eth_rpc_url.as_str();
		let net = args.network.as_deref();
		let address = self.address(args.contract, rpc, net, kind)?;
		let outcome_yes = api::parse_outcome(&args.outcome);
		let provider = self.write_provider(&args.signer, args.account_index, rpc)?;
		let outcome = api::god_resolve(&provider, address, args.market_id, outcome_yes)
			.await
			.map_err(internal)?;
		ok_json(&outcome)
	}

	#[tool(description = "Claim winnings on a finalized market (also auto-finalizes after the \
		dispute window closes).")]
	async fn market_claim(
		&self,
		Parameters(args): Parameters<MarketWriteArgs>,
	) -> Result<CallToolResult, McpError> {
		let kind = self.kind(args.kind)?;
		let rpc = args.eth_rpc_url.as_str();
		let net = args.network.as_deref();
		let address = self.address(args.contract, rpc, net, kind)?;
		let provider = self.write_provider(&args.signer, args.account_index, rpc)?;
		let outcome = api::claim(&provider, address, args.market_id).await.map_err(internal)?;
		ok_json(&outcome)
	}

	#[tool(description = "Owner-only: update the resolution bond (in ETH units).")]
	async fn market_set_bond(
		&self,
		Parameters(args): Parameters<SetBondArgs>,
	) -> Result<CallToolResult, McpError> {
		let kind = self.kind(args.kind)?;
		let rpc = args.eth_rpc_url.as_str();
		let net = args.network.as_deref();
		let address = self.address(args.contract, rpc, net, kind)?;
		let amount_wei: U256 = api::parse_amount_wei(&args.amount).map_err(invalid_params)?;
		let provider = self.write_provider(&args.signer, args.account_index, rpc)?;
		let outcome = api::set_bond(&provider, address, amount_wei).await.map_err(internal)?;
		ok_json(&outcome)
	}

	#[tool(description = "Owner-only: update the dispute window (in seconds).")]
	async fn market_set_window(
		&self,
		Parameters(args): Parameters<SetWindowArgs>,
	) -> Result<CallToolResult, McpError> {
		let kind = self.kind(args.kind)?;
		let rpc = args.eth_rpc_url.as_str();
		let net = args.network.as_deref();
		let address = self.address(args.contract, rpc, net, kind)?;
		let provider = self.write_provider(&args.signer, args.account_index, rpc)?;
		let outcome =
			api::set_window(&provider, address, args.seconds).await.map_err(internal)?;
		ok_json(&outcome)
	}
}

impl CallitServer {
	fn kind(&self, override_kind: Option<String>) -> Result<ContractKind, McpError> {
		let s = override_kind.unwrap_or_else(|| DEFAULT_KIND.to_string());
		ContractKind::parse(&s).map_err(invalid_params)
	}

	fn address(
		&self,
		explicit: Option<String>,
		rpc: &str,
		network: Option<&str>,
		kind: ContractKind,
	) -> Result<Address, McpError> {
		api::address_from_with(explicit.as_deref(), rpc, network, kind).map_err(internal)
	}

	fn read_provider(&self, rpc: &str) -> Result<DynProvider, McpError> {
		api::read_provider(rpc).map_err(internal)
	}

	fn write_provider(
		&self,
		signer: &str,
		account_index: Option<u32>,
		rpc: &str,
	) -> Result<DynProvider, McpError> {
		let idx = account_index.unwrap_or(DEFAULT_ACCOUNT_INDEX);
		api::write_provider(rpc, signer, Some(idx)).map_err(internal)
	}
}

#[tool_handler]
impl ServerHandler for CallitServer {
	fn get_info(&self) -> ServerInfo {
		ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
			.with_server_info(Implementation::new(
				"callit-mcp",
				env!("CARGO_PKG_VERSION"),
			))
			.with_instructions(INSTRUCTIONS)
	}
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
	let server = CallitServer::new();
	let service = server.serve(stdio()).await?;
	service.waiting().await?;
	Ok(())
}
