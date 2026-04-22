# Callit

Decentralized binary prediction markets on Polkadot. A single smart contract deployed to both **EVM** and **PolkaVM** (via `pallet-revive`), plus a **web app**, a **Rust CLI**, and an **MCP server** so humans, scripts, and LLM agents can all drive the same markets.

Anyone can create a market, buy YES/NO shares with native tokens (PAS/DOT), and anyone can propose a resolution by posting a bond. A 24h dispute window with matching-bond slashing keeps resolvers honest, with a god-oracle fallback for disputed outcomes.

Details of the market design live in [`PROJECT.md`](PROJECT.md).

## What's Built

| Component | Path | Stack | Status |
|---|---|---|---|
| `PredictionMarket` smart contract | [`contracts/`](contracts/) | Solidity 0.8.28, Hardhat | Deployed to EVM + PVM on Paseo Hub TestNet |
| Web frontend | [`web/`](web/) | React 18, Vite, TypeScript, Tailwind, viem, PAPI | Live markets page with buy/resolve/dispute/claim flows |
| Rust CLI (`callit-cli`) | [`cli/`](cli/) | Rust, alloy, clap, subxt | Full coverage of every contract function, JSON output |
| MCP server (`callit-mcp`) | [`cli/src/bin/mcp.rs`](cli/src/bin/mcp.rs) | Rust, `rmcp`, stdio transport | Exposes the contract as MCP tools for Cursor / Claude |
| Parachain runtime + pallet | [`blockchain/`](blockchain/) | Polkadot SDK, FRAME, Cumulus, `pallet-revive` | Inherited from the PBA template, drives the local dev chain |

All four user-facing surfaces (contract, web, CLI, MCP) hit the **same deployed contract** — the addresses in [`deployments.json`](deployments.json) are the single source of truth and are auto-synced to [`web/src/config/deployments.ts`](web/src/config/deployments.ts) and consumed by the CLI / MCP at runtime.

## Deployed Addresses (Paseo Hub TestNet, chain ID `420420417`)

| Target | Address |
|---|---|
| PVM `PredictionMarket` | `0xb3d565cc1b459295971d32d7643d555b908183f0` |
| EVM `PredictionMarket` | `0x2e23ad027063f59ed31daf2a10984eb9171a56b9` |

RPC: `https://eth-rpc-testnet.polkadot.io/` · Explorer: [blockscout-testnet.polkadot.io](https://blockscout-testnet.polkadot.io/) · Faucet: [faucet.polkadot.io](https://faucet.polkadot.io/)

## Smart Contract

`PredictionMarket.sol` (same source for EVM and PVM; compiled with `solc` for EVM and `resolc` for PolkaVM) inherits OpenZeppelin `Ownable`. All value flows use native tokens via `msg.value` / `transfer()` — no ERC-20s, no `approve`.

### External interface

```solidity
// anyone
function createMarket(string question, uint256 resolutionTimestamp) returns (uint256 marketId);
function buyShares(uint256 marketId, bool outcome) payable;        // YES = true
function resolveMarket(uint256 marketId, bool outcome) payable;    // posts resolutionBond
function disputeResolution(uint256 marketId) payable;              // matches the posted bond
function claimWinnings(uint256 marketId);                          // auto-finalizes after the dispute window

// owner only (god oracle)
function godResolve(uint256 marketId, bool outcome);
function setResolutionBond(uint256 amount);
function setDisputeWindow(uint256 duration);

// reads
function getMarket(uint256 marketId) view returns (address creator, string question, uint256 resolutionTimestamp, State state, bool proposedOutcome, uint256 yesPool, uint256 noPool);
function getUserPosition(uint256 marketId, address user) view returns (uint256 yesDeposit, uint256 noDeposit);
function getMarketCount() view returns (uint256);
function resolutionBond() view returns (uint256);
function disputeWindow() view returns (uint256);
```

### State machine

```
Open → Resolving → Proposed → Finalized
                       ↓
                   Disputed → Finalized
```

| State | Trigger | Allowed actions |
|---|---|---|
| **Open** | `createMarket()` | `buyShares()` |
| **Resolving** | Resolution timestamp passes | `resolveMarket(outcome)` + bond |
| **Proposed** | `resolveMarket()` was called | `disputeResolution()` + matching bond, or wait for window to expire |
| **Disputed** | `disputeResolution()` was called | `godResolve()` (owner only) |
| **Finalized** | Window expired undisputed, or `godResolve()` | `claimWinnings()` |

## Web frontend

Single-page React app at [`web/src/pages/MarketsPage.tsx`](web/src/pages/MarketsPage.tsx).

- **Market list** — all markets with YES/NO probability bars and state badges
- **Market detail** — buy YES / buy NO, countdown, pool sizes, your open position
- **Create market** — question + resolution deadline
- **Resolve / dispute / claim** flows wired straight to the contract
- **Network switcher** — Local Dev or Paseo Hub, uses PAPI for chain metadata and viem for contract calls via `eth-rpc`
- **Dev signers** — Alice / Bob / Charlie shortcuts for fast local iteration; browser wallet flow for Paseo

## CLI

[`callit-cli`](cli/) is a Rust binary with full coverage of every contract function and structured JSON output (so scripts and agents can parse reliably).

```bash
# reads
callit-cli market info
callit-cli market list
callit-cli market get-market 0 --json
callit-cli market get-position 0 --user 0xabc…

# writes
callit-cli market create -q "Will DOT reach $20 by July 1?" -d +14d
callit-cli market buy 0 yes --amount 0.05
callit-cli market resolve 0 yes                   # auto-posts the current bond
callit-cli market dispute 0                       # auto-matches the posted bond
callit-cli market god-resolve 0 yes               # owner only
callit-cli market claim 0

# owner setters
callit-cli market set-bond 0.25
callit-cli market set-window 86400

# target testnet explicitly
callit-cli --eth-rpc-url https://eth-rpc-testnet.polkadot.io/ market list --json
```

Signers accept dev names (`alice`/`bob`/`charlie`), raw `0x`-prefixed private keys, or BIP-39 mnemonics (with `--account-index`). Defaults to `alice` on local, uses `CALLIT_SIGNER` env var on testnet. The CLI auto-picks `deployments.local` vs `deployments.paseoHub` based on the RPC URL; override with `CALLIT_NETWORK`.

Full reference: [`cli/README.md`](cli/README.md).

## MCP server

[`callit-mcp`](cli/src/bin/mcp.rs) is a second binary from the same crate that exposes the contract as [Model Context Protocol](https://modelcontextprotocol.io) tools over stdio — so Cursor, Claude Desktop, Claude Code, or any other MCP client can drive markets end-to-end through natural language.

```bash
cargo build --release -p callit-cli --bin callit-mcp
# binary: ./target/release/callit-mcp
```

Wire it into a client:

```json
{
  "mcpServers": {
    "callit": {
      "command": "/absolute/path/to/target/release/callit-mcp"
    }
  }
}
```

The server is **fully stateless** and reads no environment variables — every tool call supplies the RPC URL, and every write supplies the signer. One running server can therefore target any chain and act as any identity, the agent decides per call.

Tools exposed:

- **Reads**: `config`, `market_info`, `market_list`, `market_get`, `market_get_position`
- **Writes**: `market_create`, `market_buy`, `market_resolve`, `market_dispute`, `market_god_resolve`, `market_claim`, `market_set_bond`, `market_set_window`

All tools return the same `MarketView` / `PositionView` / `TxOutcome` JSON types the CLI emits with `--json`, because they share the same `callit_cli::commands::market::api` module under the hood — one set of contract-interaction code, three front doors (CLI, MCP, web via viem).

Full reference: [`cli/README.md#mcp-server-callit-mcp`](cli/README.md#mcp-server-callit-mcp).

## How to run

### Against Paseo Hub TestNet (quickest)

The contract is already deployed. No local node needed.

```bash
# 1. Grab testnet tokens from https://faucet.polkadot.io/ for your Ethereum address

# 2. Use the CLI
cargo run -p callit-cli -- \
  --eth-rpc-url https://eth-rpc-testnet.polkadot.io/ \
  market list

cargo run -p callit-cli -- \
  --eth-rpc-url https://eth-rpc-testnet.polkadot.io/ \
  market buy 0 yes --amount 0.01 -s 0xYOUR_PRIVATE_KEY

# 3. Use the web app (deployed version, or local dev)
cd web && npm install && npm run dev
# open http://127.0.0.1:5173 → switch to "Paseo Asset Hub"
```

### Full local stack

One command brings up the parachain, `eth-rpc`, deploys both flavors of the contract, and starts the frontend:

```bash
./scripts/start-all.sh
# Substrate RPC: ws://127.0.0.1:9944
# Ethereum RPC:  http://127.0.0.1:8545
# Frontend:      http://127.0.0.1:5173
```

Prerequisites for native builds: Rust (stable via [rustup](https://rustup.rs/)), Node 22.x LTS, OpenSSL / `protoc`, and the Polkadot SDK binaries (`./scripts/download-sdk-binaries.sh` will fetch them into `./bin/`). Details in [`docs/INSTALL.md`](docs/INSTALL.md).

Docker alternative (no Rust required on host):

```bash
docker compose up -d    # first build compiles runtime in Docker ~10-20 min
(cd contracts/pvm && npm install && npm run deploy:local)
(cd web && npm install && npm run dev)
```

Other flows — solo-node dev loop, frontend-only, port overrides, second parallel stack — are in [`scripts/README.md`](scripts/README.md).

### Deploy your own contract

```bash
cd contracts/evm && npx hardhat vars set PRIVATE_KEY
cd contracts/pvm && npx hardhat vars set PRIVATE_KEY
./scripts/deploy-paseo.sh   # updates deployments.json + web/src/config/deployments.ts
```

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the full deployment guide (contracts, frontend via GitHub Pages / DotNS / IPFS, and the runtime).

## Technical design decisions

### Market mechanics

- **Two-layer resolution with skin in the game**. Anyone can propose a resolution by posting a bond, opening a 24h dispute window. Anyone can dispute by matching that bond. If undisputed, the resolver gets their bond back. If disputed, the god oracle (contract owner) makes the final call and the loser's bond goes to the winner. No protocol fee — the economics are self-funding through bonds, and both resolvers and disputers are financially motivated to be truthful.
- **Pool-based pricing, no AMM curve**. Share prices emerge from the ratio of YES vs NO pools. Simple, understandable, and good enough for binary outcomes at hackathon scale. An AMM (LMSR, constant-product) is a future improvement.
- **Native tokens throughout**. Everything flows via `msg.value` and `payable(…).transfer()` — no ERC-20 deployment, no approve/transferFrom dance, no separate "stable" token to worry about. On Paseo Hub that means PAS; on a Polkadot asset hub it would be DOT.
- **Internal accounting instead of ERC-1155 shares**. Shares aren't tokens — they're stored as deposit amounts in a `mapping(marketId => mapping(user => uint256))`. At payout, `userDeposit * totalPool / winningSidePool` (multiply-before-divide) computes the share; residual dust from rounding stays in the contract. Keeps the contract ~200 lines and avoids minting logic. ERC-1155 (tradeable secondary market for positions) is a clean future drop-in.
- **Configurable bond and window**. `setResolutionBond` and `setDisputeWindow` let the owner tune the economics as the chain or user base evolves without redeploying.
- **No operator, no custody**. The contract holds funds and distributes them deterministically. The only trust assumption is the god oracle fallback, which only activates *after* a dispute — the happy path never needs it.

### Same contract on EVM and PVM

The **identical Solidity source** is compiled by `solc` for standard EVM and by `@parity/resolc` for PolkaVM (RISC-V on `pallet-revive`). Both get deployed alongside each other. This:

- validates the "write once, run on both VMs" pitch of `pallet-revive`
- lets us A/B gas costs and behavior between the two targets during development
- gives the frontend / CLI / MCP a toggleable `kind: "evm" | "pvm"` without any contract changes

### One interaction library, three front doors

The CLI, MCP server, and (in spirit) the web frontend all call the **same typed Rust API** in `callit_cli::commands::market::api` — `buy_shares(provider, address, id, outcome, amount_wei)`, `resolve_market(...)`, etc. The CLI is a thin `clap` wrapper, the MCP server is a thin `rmcp` wrapper, both return the same `MarketView` / `TxOutcome` JSON. The web frontend uses viem directly but against the same ABI and the same deployed address. This means:

- a bug fix lands in one place and is picked up everywhere
- new contract functions expose through all surfaces with one diff each
- agents and humans see consistent data shapes

### Stateless MCP server

`callit-mcp` deliberately reads **zero environment variables**. Every tool call carries its own `eth_rpc_url`, every write its own `signer`, and `contract` / `network` are resolved per call (from `deployments.json` when omitted). Consequences:

- one long-running server process can target local dev *and* Paseo Hub *and* a fork node interleaved, with different identities, all within one agent conversation
- configuration lives in the agent transcript rather than in shell state, which is also what makes multi-turn workflows ("buy as Alice, resolve as Bob, claim as Alice") reliable
- a `config` tool self-describes the required / optional fields so the agent can discover the contract without documentation

### Flexible signers

Both CLI and MCP accept three signer forms, auto-detected:

1. **Dev names** — `alice` / `bob` / `charlie` (well-known Substrate dev keys in Ethereum form, public test keys, never for real funds)
2. **Raw private key** — `0x` + 64 hex chars
3. **BIP-39 mnemonic** — with `--account-index` / `account_index` for derivation on `m/44'/60'/0'/0/N`

Dev names make local demos fast; mnemonics + indices make it trivial to script multi-party flows (one signer, many accounts); raw keys cover the "I have this one testnet key exported" case.

### Pool payout rounding

`payout = userDeposit * totalPool / winningSidePool` — multiply before divide to keep integer truncation minimal. Tiny dust (< `winningSidePool` wei) accrues in the contract and is effectively burned. At native-token precision this is negligible; keeping it simple beats FixedPoint math for a hackathon.

### Known simplifications / future work

- **No AMM curve** — pool-ratio pricing is simple but suboptimal for price discovery; LMSR or a constant-product variant is a natural upgrade.
- **ERC-1155 positions** — tokenize shares so they're tradeable on secondary markets before resolution.
- **Oracle plurality** — right now a single god-oracle address is the dispute backstop. A committee with threshold resolution (e.g. 2-of-3 signers) would further reduce the trust assumption.
- **Bond scaling** — the bond is a fixed amount, not a function of pool size. A percentage-of-pool bond would scale security with stake.

## Repository layout

```
.
├── PROJECT.md                        # market design + spec
├── contracts/
│   ├── evm/ ├── contracts/PredictionMarket.sol   # solc build
│   └── pvm/ └── contracts/PredictionMarket.sol   # resolc build
├── web/                              # React frontend
│   └── src/pages/MarketsPage.tsx     # main markets UI
├── cli/
│   ├── src/main.rs                   # callit-cli entry
│   ├── src/bin/mcp.rs                # callit-mcp entry (MCP server)
│   └── src/commands/market.rs        # shared contract API (used by both binaries)
├── blockchain/                       # parachain runtime + pallet (template base)
├── deployments.json                  # single source of truth for contract addresses
├── scripts/                          # one-command dev / deploy scripts
└── docs/                             # INSTALL, DEPLOYMENT, TOOLS, PALLET_REVIVE_NOTES
```

## Commands cheat sheet

```bash
# Rust — build, test, lint
cargo build --release
cargo test -p pallet-template
cargo +nightly fmt
cargo clippy --workspace

# Contracts (from repo root)
cd contracts/evm && npm ci && npx hardhat compile && npx hardhat test
cd contracts/pvm && npm ci && npx hardhat compile && npx hardhat test

# Frontend
cd web && npm ci && npm run dev       # dev server
cd web && npm run build               # production bundle
cd web && npm run lint && npm run fmt

# CLI
cargo run -p callit-cli -- --help
cargo run -p callit-cli -- market list --json

# MCP server
cargo build --release -p callit-cli --bin callit-mcp
./target/release/callit-mcp           # stdio MCP server
```

## Versions

| Component | Version |
|---|---|
| polkadot-sdk | stable2512-3 |
| polkadot-omni-node | v1.21.3 |
| eth-rpc | v0.12.0 |
| pallet-revive | v0.12.2 |
| Solidity | 0.8.28 |
| resolc | 1.0.0 |
| Node.js | 22.x LTS |
| React | 18.3 |
| viem | 2.x |
| alloy | 1.8 |
| rmcp (MCP SDK) | latest |

## Resources

- [PROJECT.md](PROJECT.md) — market design deep dive
- [cli/README.md](cli/README.md) — full CLI + MCP reference
- [contracts/README.md](contracts/README.md) — Hardhat flows for EVM + PVM
- [web/README.md](web/README.md) — frontend dev notes
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — hosted deployment (GitHub Pages, DotNS, contracts)
- [docs/PALLET_REVIVE_NOTES.md](docs/PALLET_REVIVE_NOTES.md) — `pallet-revive` integration gotchas
- [Polkadot Smart Contract Docs](https://docs.polkadot.com/smart-contracts/overview/)
- [Model Context Protocol](https://modelcontextprotocol.io)

## License

[MIT](LICENSE)
