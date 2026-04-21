# CLI

`callit-cli` is the Rust command-line tool for interacting with the Callit chain through:

- [subxt](https://github.com/parity-tech/subxt) for Substrate RPC
- [alloy](https://alloy.rs) for Ethereum-compatible contract calls through `pallet-revive` / `eth-rpc`

It can drive **all PredictionMarket contract functions** (create, buy, resolve, dispute, god-resolve, claim, owner setters) and the legacy ProofOfExistence contract, on either the local dev stack or the Paseo Asset Hub TestNet.

## Run It

From the repo root:

```bash
cargo run -p callit-cli -- --help
```

Or use the library directly from another crate (the CLI exposes everything via
`callit_cli::commands::market::api` so you can build an MCP server on top
without shelling out).

## Command Groups

- `chain`: `info`, `blocks`
- `contract`: `info`, `create-claim <evm|pvm>`, `revoke-claim`, `get-claim` (ProofOfExistence)
- `market`: `info`, `list`, `get-market`, `get-position`, `create`, `buy`, `resolve`, `dispute`, `god-resolve`, `claim`, `set-bond`, `set-window` (PredictionMarket)
- `prove`: hash a file and call `createClaim` in one step

## Global options

| Flag | Env var | Default |
| --- | --- | --- |
| `--url <ws>` | `SUBSTRATE_RPC_WS` | `ws://127.0.0.1:9944` |
| `--eth-rpc-url <http>` | `ETH_RPC_HTTP` | `http://127.0.0.1:8545` |

When `ETH_RPC_HTTP` points at `localhost`/`127.0.0.1`, the CLI automatically picks `deployments.local` from `deployments.json`; otherwise it uses `deployments.paseoHub`. Override with `CALLIT_NETWORK=local|paseoHub`.

## Signers

All write commands (`contract create-claim`, `contract revoke-claim`, `market *`, `prove`) accept `--signer / -s` (or the `CALLIT_SIGNER` env var). Three input forms are supported:

1. **Dev names** — `alice`, `bob`, `charlie` (well-known Substrate dev keys in Ethereum form; public test keys, never use for real funds).
2. **Raw private key** — `0x` + 64 hex characters.
3. **BIP-39 mnemonic** — 12/15/18/21/24-word English phrase. Use `--account-index N` to select a derivation index on the standard `m/44'/60'/0'/0/N` path (defaults to `0`).

Examples:

```bash
# dev shortcut
callit-cli market buy 0 yes --amount 0.01 -s alice

# raw private key
callit-cli market create -q "Will ETH hit 5k?" -d +7d \
  -s 0x5fb92d6e98884f76de468fa3f6278f8807c48bebc13595d45af5bdc4da702133

# mnemonic + custom derivation index
callit-cli market resolve 0 yes \
  -s "test test test test test test test test test test test junk" \
  --account-index 2

# via env vars (nice for scripting)
export CALLIT_SIGNER="your twelve word phrase here … last"
export CALLIT_MARKET_CONTRACT=0xb3d565cc1b459295971d32d7643d555b908183f0
callit-cli market list
```

## Contract address resolution (market commands)

Every `market` subcommand takes `--contract / -c <address>` (or the `CALLIT_MARKET_CONTRACT` env var). If omitted, the CLI reads from the repo-root `deployments.json` using the current network slot and `--kind evm|pvm` (default: `pvm`).

## Examples

```bash
# Chain info
callit-cli chain info

# Contract info (both PoE and PredictionMarket addresses, all dev accounts)
callit-cli contract info

# PoE contract
callit-cli contract create-claim evm --file ./README.md
callit-cli contract get-claim evm 0x…

# PredictionMarket — reads
callit-cli market info
callit-cli market list
callit-cli market list --json
callit-cli market get-market 0
callit-cli market get-position 0 --user 0xabc…

# PredictionMarket — writes
callit-cli market create -q "Will DOT reach $20 by July 1?" -d +14d
callit-cli market buy 0 yes --amount 0.05
callit-cli market buy 0 no  --amount 0.1
callit-cli market resolve 0 yes            # posts the resolution bond automatically
callit-cli market dispute 0                # matches the posted bond automatically
callit-cli market god-resolve 0 yes        # owner-only
callit-cli market claim 0

# Owner setters
callit-cli market set-bond 0.25
callit-cli market set-window 86400

# Targeting Paseo Asset Hub explicitly
callit-cli --eth-rpc-url https://eth-rpc-testnet.polkadot.io/ market info
```

## JSON output

Every `market` subcommand accepts `--json` and emits structured output with both wei and ether-formatted amounts. This is what makes the CLI MCP-friendly — an agent can parse the output reliably instead of scraping stdout.

```bash
callit-cli market get-market 0 --json
# {
#   "id": 0,
#   "creator": "0x7bff…cebe",
#   "question": "Will Boca win the match?",
#   "resolution_timestamp": 1776693600,
#   "state": 3,
#   "state_label": "Disputed",
#   …
# }
```

For transaction-submitting commands, JSON mode emits a `TxOutcome` with `tx_hash`, `block_number`, `status`, and `gas_used`.

## Using `callit-cli` as a library

`callit-cli` is published as both a binary and a library. The bundled MCP server (see below) and any other Rust tool can depend on it directly and call typed async functions:

```rust
use alloy::primitives::{utils::parse_ether, Address};
use callit_cli::commands::market::api;
use callit_cli::commands::deployments::ContractKind;

let provider = api::write_provider(
    "http://127.0.0.1:8545",
    "alice",              // or a 0x private key, or a mnemonic
    None,                 // derivation index (mnemonic only)
)?;
let addr = api::address_from(None, "http://127.0.0.1:8545", ContractKind::Pvm)?;

let info = api::info(&provider, addr).await?;
let id = 0u64;
let outcome = api::buy_shares(&provider, addr, id, true, parse_ether("0.05")?).await?;
println!("{}", serde_json::to_string_pretty(&outcome)?);
```

See [`src/commands/market.rs`](src/commands/market.rs) for the full `api` surface.

## MCP server (`callit-mcp`)

The `cli` crate also ships a second binary, `callit-mcp`, that exposes the
PredictionMarket contract as an [MCP](https://modelcontextprotocol.io) server
over stdio. Point any MCP-aware client (Cursor, Claude Desktop, Claude Code,
the `mcp` CLI, etc.) at the compiled binary and an agent can drive markets
end-to-end without shelling out.

### Build

```bash
cargo build --release -p callit-cli --bin callit-mcp
# binary: ./target/release/callit-mcp
```

### Configuration

**The server is stateless and reads no environment variables.** Every piece of
configuration is passed per tool call. A single running server can therefore
target any chain and act as any identity — the agent decides per call.

#### Required on every chain-touching tool

| Field | Purpose |
| --- | --- |
| `eth_rpc_url` | Full JSON-RPC URL, e.g. `http://127.0.0.1:8545` (local) or `https://eth-rpc-testnet.polkadot.io/` (Paseo Hub TestNet). |

#### Required on every write tool

| Field | Purpose |
| --- | --- |
| `signer` | Dev name (`alice`/`bob`/`charlie`), 0x-prefixed 32-byte private key, or BIP-39 mnemonic phrase. |

#### Optional (with built-in defaults)

| Field | Default | Purpose |
| --- | --- | --- |
| `kind` | `pvm` | Contract flavor: `evm` or `pvm`. |
| `account_index` | `0` | Derivation index for mnemonic signers. |
| `network` | auto-derived from `eth_rpc_url` | `local` or `paseoHub` — which slot of `deployments.json` to read the address from. Only relevant when `contract` is omitted. |
| `contract` | looked up in `deployments.json` | Explicit `0x…` PredictionMarket address. Skips `deployments.json` entirely. |

### Tools exposed

Reads:

- `config` — describe the server's stateless contract: which fields are required, which have defaults, and example values. Takes no arguments.
- `market_info` — contract owner, current bond, dispute window, market count.
- `market_list` — every market with id, question, state, pools, deadline.
- `market_get` — single market by id.
- `market_get_position` — a user's YES/NO deposits. Pass `user` directly, or `signer` to derive the user address from it.

Writes:

- `market_create` — create a market. `deadline` accepts a unix timestamp or `+30m` / `+12h` / `+7d`.
- `market_buy` — buy YES/NO shares, `amount` in ETH units.
- `market_resolve` — propose an outcome (auto-posts the current bond).
- `market_dispute` — dispute a proposal (auto-matches the bond).
- `market_god_resolve` — owner-only force resolution.
- `market_claim` — claim winnings (auto-finalizes after the dispute window).
- `market_set_bond`, `market_set_window` — owner setters.

### Example calls

Read a market on Paseo Hub PVM:

```json
{
  "name": "market_info",
  "arguments": {
    "eth_rpc_url": "https://eth-rpc-testnet.polkadot.io/"
  }
}
```

Create a market on local dev as Alice:

```json
{
  "name": "market_create",
  "arguments": {
    "eth_rpc_url": "http://127.0.0.1:8545",
    "signer": "alice",
    "question": "Will it rain tomorrow?",
    "deadline": "+12h"
  }
}
```

Every tool returns pretty-printed JSON matching the same `MarketView` /
`PositionView` / `ContractInfoView` / `TxOutcome` types the CLI emits with
`--json`.

### Wiring it into a client

Cursor / Claude Desktop config (`mcp.json` or equivalent):

```json
{
  "mcpServers": {
    "callit": {
      "command": "/absolute/path/to/target/release/callit-mcp"
    }
  }
}
```

No `env` block is needed — the server takes all configuration per call.

Quick smoke test from the shell (initialize + list tools):

```bash
printf '%s\n%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"smoke","version":"0.0.0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | ./target/release/callit-mcp
```

## See also

- [`../contracts/README.md`](../contracts/README.md) — deployment flow
- [`../docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md) — end-to-end deployment guide
- [`../docs/PALLET_REVIVE_NOTES.md`](../docs/PALLET_REVIVE_NOTES.md) — `pallet-revive` integration gotchas
