# Callit — Slide Script & Content Guide

5-minute presentation. 2 minutes are demo. That leaves ~3 minutes for slides — roughly 5 slides at 30-40 seconds each. Every slide needs to earn its place. Scripts are short on purpose.

---

## Slide 1 — Title (~15 seconds)

**Title:** Callit — Decentralized Prediction Markets on Polkadot

**Content:**
- Subtitle: "Permissionless binary markets — create, bet, resolve, claim. No operator."
- Deployed on Paseo Hub TestNet (EVM + PVM)

**Script:**
Callit is a decentralized binary prediction market. Anyone can create a question, bet YES or NO with native tokens, and anyone can resolve the outcome. No company, no custodian, no off-chain orderbook. A single smart contract handles the full lifecycle. It's live on Paseo Hub TestNet right now.

---

## Slide 2 — The Problem (~30 seconds)

**Title:** Polymarket Is Not Permissionless

**Content:** Two columns:

Left — Centralized platforms (Polymarket):
- Operator controls which markets exist
- Can freeze funds, delay payouts
- Resolution is centralized and opaque
- Trust the company

Right — Callit:
- Anyone creates any market
- Funds locked in the contract, not a company wallet
- Resolution is open, incentivized, and slashable
- Trust the code

**Script:**
Polymarket is the biggest prediction market and it's fundamentally centralized. They decide what questions get listed, they run resolution, they hold your funds. If they get a subpoena or decide your market is inconvenient, it disappears. Callit makes every one of those operator roles into a smart contract function. There is no compliance team.

---

## Slide 3 — Architecture (~45 seconds)

**Title:** One Contract, Four Surfaces

**Content:**

System diagram:
```
  [ Web App ]          [ callit-cli ]        [ callit-mcp / AI agent ]
       │                    │                          │
       │  Triangle Host API  │  alloy                   │  rmcp (stdio)
       │  (Product SDK)      │  (Ethereum RPC)          │
       ▼                    │                          │
    PWallet                  │                          │
  (Polkadot app —            │                          │
   accounts + signing)       │                          │
       │                    │                          │
       └────────── eth-rpc proxy (port 8545) ──────────┘
              Ethereum JSON-RPC → Substrate extrinsics
                             │
                    pallet-revive on Polkadot Hub
                             │
                ┌────────────┴────────────┐
                │                         │
          EVM PredictionMarket     PVM PredictionMarket
          (compiled by solc)       (compiled by resolc / RISC-V)
```

Key pieces:
- **Web app** uses the **Polkadot Triangle Host API** (`@novasamatech/product-sdk`) to connect to **PWallet**. PWallet holds the accounts and signs transactions.
- **CLI** (`callit-cli`) uses alloy + raw Ethereum RPC with dev-name / mnemonic / hex-key signers.
- **MCP server** (`callit-mcp`) exposes every contract function as a typed MCP tool over stdio — stateless, reads no env vars, agent supplies RPC + signer per call.
- All three hit the same deployed addresses via `eth-rpc`. Single source of truth: `deployments.json` → synced to web, CLI, MCP.

Two `pallet-revive` gotchas worth knowing:
1. **Account mapping** — Substrate accounts are 32 bytes, `pallet-revive` uses 20-byte H160. Every account must call `Revive::map_account` once before its first contract call, otherwise it reverts with `AccountUnmapped`.
2. **Value units** — `msg.value` inside the contract is in wei (18 decimals). The Substrate SDK `value` field is in native plancks. You must divide by `NativeToEthRatio` before the SDK call. Passing `parseEther("0.01")` directly fails with `TransferFailed` even on a funded account. On Paseo Asset Hub: `0.01 PAS` → SDK `value = 10^8` → `msg.value = 10^16 wei`.

**Script:**
The same Solidity source is compiled twice — once with `solc` for standard EVM, once with `resolc` from Parity for PolkaVM (RISC-V). Both are deployed. On top sits an `eth-rpc` proxy that translates standard Ethereum JSON-RPC into Substrate extrinsics — so viem, alloy, MetaMask all just work.

There are three ways to drive it. The web app connects to PWallet — the Polkadot app — through the Triangle Host API from Nova Sama. PWallet holds the accounts and signs. The CLI uses alloy and a plain Ethereum RPC connection with its own signers. And the MCP server exposes every contract function as a typed tool over stdio so an LLM like Claude can create markets, buy shares, resolve, and claim — all through natural language, with no manual transaction signing. All three converge on the same deployed addresses.

Two things that will bite you when building on `pallet-revive`. First: every Substrate account has to call `map_account` once before touching a contract — 32-byte Substrate keys don't map to 20-byte Ethereum addresses automatically. Second: if you're calling the Substrate SDK directly rather than going through eth-rpc, the `value` field is in native plancks not wei. You divide by `NativeToEthRatio` before the call. Get this wrong and you get a `TransferFailed` on a perfectly funded account — which is a deeply confusing error.

---

## Slide 4 — Game Theory (~45 seconds)

**Title:** Why Resolvers Tell the Truth

**Content:**

State machine:
```
Open → Resolving → Proposed → Finalized
                      ↓
                  Disputed → Finalized (god oracle)
```

Resolution incentives:
```
Resolver posts bond + proposes outcome
  │
  ├─ no dispute in 24h → bond returned ✓
  │
  └─ dispute raised (disputer also posts bond)
       │
       └─ god oracle decides
            ├─ resolver was right → disputer loses bond to resolver
            └─ disputer was right → resolver loses bond to disputer
```

Key properties:
- No protocol fee — economics are self-funded through bond slashing
- Happy path is fully permissionless — god oracle only activates after a dispute
- Pool ratio = crowd-sourced probability (YES pool 75%, NO pool 25% → 75% implied YES)

**Script:**
The interesting design question is: how do you get permissionless, decentralized resolution without a trusted oracle? The answer is skin in the game. Anyone can resolve a market by posting a bond. If no one disputes within 24 hours, the market finalizes and they get the bond back. If someone thinks the outcome is wrong, they post a matching bond to challenge. Now both parties have money on the line and the contract owner — the god oracle — makes the final call. Loser's bond goes to the winner.

This means resolvers are honest because a wrong resolution loses their bond to the disputer. Disputers are honest because a frivolous dispute loses their bond to the resolver. No protocol fee. The economics are entirely self-funding.

Pricing is pool-based — the ratio of YES to NO deposits is the market's implied probability. Simple, auditable, good enough.

---

## Slide 5 — Future Improvements (~30 seconds)

**Title:** What Comes Next

**Content:**

Three concrete upgrades, each targeting a specific limitation:

**ERC-1155 shares** — right now positions are locked mappings in contract storage. Replace with ERC-1155 tokens so shares are tradeable on secondary markets and composable with DeFi before resolution.

**Decentralized oracle via voting pallet** — the god oracle is a single address. Replace it with a FRAME voting pallet: disputed markets trigger an on-chain vote by token holders, outcome posted back via XCM. No single point of trust.

**Bulletin Chain for market metadata** — markets currently store only a question string. Store a content hash on-chain instead, pointing to the Bulletin Chain (Polkadot's data availability parachain) for rich descriptions, resolution criteria, photos, and resolver evidence.

**Script:**
Three improvements worth building. First: ERC-1155 shares so positions are actual tokens you can sell before resolution — this makes secondary markets possible and plugs into DeFi. Second: replace the god oracle with the voting pallet — when a dispute is raised, trigger an on-chain governance vote instead of forwarding to one address, use XCM to post the result back to the contract. Third: use Polkadot's Bulletin Chain to store rich market metadata — descriptions, resolution criteria, photos — and keep only a hash in the contract. Each of these is a clean drop-in on top of what's already built.
