# Callit

Decentralized binary prediction markets on Polkadot. One Solidity contract deployed to both **EVM** and **PolkaVM** (`pallet-revive`), with a web app, Rust CLI, and MCP server.

Anyone can create a market, buy YES/NO shares with native tokens, and propose a resolution by posting a bond. A 24h dispute window with bond slashing keeps resolvers honest.

## Components

| Component | Path | Stack |
|---|---|---|
| `PredictionMarket` contract | [`contracts/`](contracts/) | Solidity 0.8.28, Hardhat |
| Web frontend | [`web/`](web/) | React, Vite, viem, PAPI |
| `callit-cli` | [`cli/`](cli/) | Rust, alloy, clap, subxt |
| `callit-mcp` | [`cli/src/bin/mcp.rs`](cli/src/bin/mcp.rs) | Rust, rmcp, stdio |
| Parachain runtime | [`blockchain/`](blockchain/) | Polkadot SDK, FRAME, Cumulus |

All surfaces share the same deployed contract — addresses in [`deployments.json`](deployments.json) are the single source of truth.

## Deployed — Paseo Hub TestNet (chain ID `420420417`)

| Target | Address |
|---|---|
| PVM | `0xb3d565cc1b459295971d32d7643d555b908183f0` |
| EVM | `0x2e23ad027063f59ed31daf2a10984eb9171a56b9` |

Frontend: [callit00.paseo.li](https://callit00.paseo.li) · RPC: `https://eth-rpc-testnet.polkadot.io/` · Explorer: [blockscout-testnet.polkadot.io](https://blockscout-testnet.polkadot.io/) · Faucet: [faucet.polkadot.io](https://faucet.polkadot.io/)

## Quick start

```bash
# Against Paseo TestNet (no local node needed)
cargo run -p callit-cli -- --eth-rpc-url https://eth-rpc-testnet.polkadot.io/ market list

# Full local stack
./scripts/start-all.sh
# Substrate: ws://127.0.0.1:9944 · Ethereum RPC: http://127.0.0.1:8545 · Frontend: http://127.0.0.1:5173

# Docker (no Rust required on host)
docker compose up -d
```

Prerequisites: Rust (stable), Node 22.x LTS, `protoc`. Run `./scripts/download-sdk-binaries.sh` to fetch Polkadot SDK binaries.

## Deploy your own contract

```bash
cd contracts/evm && npx hardhat vars set PRIVATE_KEY
cd contracts/pvm && npx hardhat vars set PRIVATE_KEY
./scripts/deploy-paseo.sh
```

## Technical design

**Two-layer resolution with skin in the game.** Anyone proposes a resolution by posting a bond, opening a 24h dispute window. Anyone can dispute by matching that bond. Wrong resolution → lose bond to the disputer. Frivolous dispute → lose bond to the resolver. Honest behavior is the only rational strategy. The god oracle only activates after a dispute — the happy path never needs it.

**Pool-based pricing, no AMM.** Share prices emerge from the YES/NO pool ratio. Simple and understandable; an AMM (LMSR, constant-product) is a future upgrade.

**Native tokens throughout.** All value flows via `msg.value` and `payable(…).transfer()` — no ERC-20, no approve/transferFrom. On Paseo Hub that means PAS.

**Internal share accounting.** Shares are deposit amounts in contract storage, not tokens. Payout = `userDeposit * totalPool / winningSidePool` (multiply-before-divide). Residual dust stays in the contract. Avoids minting logic and keeps the contract ~200 lines. ERC-1155 tradeable positions are a clean future drop-in.

**Same contract on EVM and PVM.** Identical Solidity source compiled by `solc` (EVM) and `resolc` (PolkaVM). Validates "write once, run on both VMs" and lets the frontend/CLI toggle `kind: "evm" | "pvm"` without any contract changes.

**Stateless MCP server.** `callit-mcp` reads zero environment variables — every call carries its own `eth_rpc_url` and `signer`. One running server can target local dev and Paseo Hub interleaved, with different identities, within one agent conversation.

## Useful commands

```bash
cargo build --release
cargo test -p pallet-template
cd web && npm ci && npm run dev
cargo run -p callit-cli -- market list --json
cargo build --release -p callit-cli --bin callit-mcp
```

## References

- [PROJECT.md](PROJECT.md) — market design and spec
- [cli/README.md](cli/README.md) — full CLI + MCP reference
- [contracts/README.md](contracts/README.md) — Hardhat flows for EVM + PVM
- [web/README.md](web/README.md) — frontend dev notes
- [PALLET_REVIVE_NOTES.md](PALLET_REVIVE_NOTES.md) — `pallet-revive` integration gotchas

## License

[MIT](LICENSE)
