use alloy::primitives::Address;
use serde::Deserialize;
use std::{fs, path::PathBuf};

#[derive(Debug, Deserialize, Default, Clone)]
pub struct Deployments {
	#[serde(default)]
	pub evm: Option<String>,
	#[serde(default)]
	pub pvm: Option<String>,
	#[serde(rename = "evmPredictionMarket", default)]
	pub evm_prediction_market: Option<String>,
	#[serde(rename = "pvmPredictionMarket", default)]
	pub pvm_prediction_market: Option<String>,
}

#[derive(Debug, Deserialize, Default, Clone)]
pub struct DeploymentsFile {
	#[serde(default)]
	pub local: Option<Deployments>,
	#[serde(default, rename = "paseoHub", alias = "testnet")]
	pub paseo_hub: Option<Deployments>,
}

pub fn load_file() -> Result<DeploymentsFile, Box<dyn std::error::Error>> {
	let paths = [
		PathBuf::from("deployments.json"),
		PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../deployments.json"),
	];
	for path in &paths {
		if path.exists() {
			let content = fs::read_to_string(path)?;
			return serde_json::from_str::<DeploymentsFile>(&content).map_err(Into::into);
		}
	}
	Err("deployments.json not found. Deploy contracts first.".into())
}

/// Pick which network slot to use. Honors `CALLIT_NETWORK=local|paseoHub` when set,
/// otherwise falls back to the shape of `eth_rpc_url` (localhost → local, else paseoHub).
pub fn resolve_network(eth_rpc_url: &str) -> String {
	resolve_network_with(eth_rpc_url, None)
}

/// Same as [`resolve_network`] but with an explicit per-call override that
/// takes precedence over both `CALLIT_NETWORK` and URL sniffing.
pub fn resolve_network_with(eth_rpc_url: &str, override_network: Option<&str>) -> String {
	if let Some(explicit) = override_network {
		return explicit.to_string();
	}
	if let Ok(explicit) = std::env::var("CALLIT_NETWORK") {
		return explicit;
	}
	let rpc = eth_rpc_url.to_lowercase();
	if rpc.contains("127.0.0.1") || rpc.contains("localhost") || rpc.is_empty() {
		"local".to_string()
	} else {
		"paseoHub".to_string()
	}
}

pub fn load(eth_rpc_url: &str) -> Result<Deployments, Box<dyn std::error::Error>> {
	load_with(eth_rpc_url, None)
}

/// Like [`load`] but lets callers override the network slot explicitly. Useful
/// for MCP tools that let an agent switch chains per call.
pub fn load_with(
	eth_rpc_url: &str,
	override_network: Option<&str>,
) -> Result<Deployments, Box<dyn std::error::Error>> {
	let file = load_file()?;
	let slot = match resolve_network_with(eth_rpc_url, override_network).as_str() {
		"local" => file.local,
		_ => file.paseo_hub,
	};
	Ok(slot.unwrap_or_default())
}

#[derive(Clone, Copy)]
pub enum ContractKind {
	Evm,
	Pvm,
}

impl ContractKind {
	pub fn parse(s: &str) -> Result<Self, Box<dyn std::error::Error>> {
		match s.to_lowercase().as_str() {
			"evm" => Ok(Self::Evm),
			"pvm" => Ok(Self::Pvm),
			other => Err(format!("Unknown contract kind: {other}. Use evm or pvm.").into()),
		}
	}

	pub fn as_str(self) -> &'static str {
		match self {
			Self::Evm => "evm",
			Self::Pvm => "pvm",
		}
	}
}

pub fn poe_address(
	deployments: &Deployments,
	kind: ContractKind,
) -> Result<Address, Box<dyn std::error::Error>> {
	let addr = match kind {
		ContractKind::Evm => deployments.evm.as_deref(),
		ContractKind::Pvm => deployments.pvm.as_deref(),
	};
	let s = addr.ok_or_else(|| -> Box<dyn std::error::Error> {
        format!(
            "{} proof-of-existence contract not deployed. Run: cd contracts/{} && npm run deploy:local (local) or npm run deploy:paseo-hub (Paseo Asset Hub).",
            kind.as_str().to_uppercase(),
            kind.as_str()
        )
        .into()
    })?;
	Ok(s.parse()?)
}

pub fn prediction_market_address(
	deployments: &Deployments,
	kind: ContractKind,
) -> Result<Address, Box<dyn std::error::Error>> {
	let addr = match kind {
		ContractKind::Evm => deployments.evm_prediction_market.as_deref(),
		ContractKind::Pvm => deployments.pvm_prediction_market.as_deref(),
	};
	let s = addr.ok_or_else(|| -> Box<dyn std::error::Error> {
		format!(
			"{} PredictionMarket contract not deployed. Pass --contract <address> or run the deploy script.",
			kind.as_str().to_uppercase()
		)
		.into()
	})?;
	Ok(s.parse()?)
}

/// Resolve a market contract address, preferring an explicit `--contract` override
/// and falling back to `deployments.json`.
pub fn resolve_market_address(
	explicit: Option<&str>,
	eth_rpc_url: &str,
	kind: ContractKind,
) -> Result<Address, Box<dyn std::error::Error>> {
	resolve_market_address_with(explicit, eth_rpc_url, None, kind)
}

/// Like [`resolve_market_address`] but with an explicit network override that
/// short-circuits URL sniffing and `CALLIT_NETWORK`.
pub fn resolve_market_address_with(
	explicit: Option<&str>,
	eth_rpc_url: &str,
	override_network: Option<&str>,
	kind: ContractKind,
) -> Result<Address, Box<dyn std::error::Error>> {
	if let Some(raw) = explicit {
		return Ok(raw.parse()?);
	}
	let deployments = load_with(eth_rpc_url, override_network)?;
	prediction_market_address(&deployments, kind)
}
