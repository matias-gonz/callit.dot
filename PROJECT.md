# Callit: Decentralized Prediction Markets on PolkaVM

A binary prediction market where anyone can create a question, bet on YES or NO, and anyone can resolve the outcome by posting a bond — all on-chain with automatic payouts and no middleman.

Existing platforms like Polymarket are centralized: they control which markets exist, can freeze funds, and operate through centralized orderbooks. Callit removes the operator entirely — a single smart contract handles market creation, share purchases, resolution, and payouts.

## How It Works

1. A creator calls `createMarket("Will DOT reach $20 by July 1?", resolutionTimestamp)`
2. Users buy YES or NO shares by depositing native tokens — share price reflects the pool ratio
3. After the resolution date, **anyone** can propose an outcome by calling `resolveMarket(marketId, outcome)` and posting a bond
4. A dispute window opens (e.g. 24 hours). **Anyone** can call `disputeResolution(marketId)` if they believe the proposed outcome is wrong
5. If no one disputes, the market finalizes — the resolver gets their bond back
6. If disputed, the disputer also posts a bond and the owner (god oracle) makes the final, binding resolution. The wrong party loses their bond to the other
7. Winners call `claimWinnings(marketId)` and receive their proportional share of the total pool

## Architecture

```
Creator  → createMarket() ─────────────────► Contract stores question + deadline
                                                      |
Users    → buyShares(YES/NO) ──────────────────────►| Contract escrows funds
                                                      |
Anyone   → resolveMarket(outcome) + bond ──────────►| Dispute window opens (24h)
                                                      |
              No dispute? ─────────────────────────►| Market finalizes, resolver gets bond back
              Dispute raised? (disputer posts bond)►| Owner makes final call, loser's bond goes to winner
                                                      |
Winners  → claimWinnings() ◄───────────────────────►| Contract pays out proportionally
```

## Smart Contract

`PredictionMarket.sol` — a single contract inheriting OpenZeppelin's `Ownable` that manages the full lifecycle. The contract owner is the god oracle — all permissioned functions (`godResolve`, `setResolutionBond`, `setDisputeWindow`) use the `onlyOwner` modifier. Ownership is transferable via `transferOwnership()`.

- `createMarket(string question, uint256 resolutionTimestamp)` — anyone can create a market with a question and deadline
- `buyShares(uint256 marketId, bool outcome)` payable — deposit native tokens (PAS/DOT via `msg.value`) to buy YES or NO shares; share price is the ratio of your deposit to the total pool on your side. Reverts after the resolution timestamp
- `resolveMarket(uint256 marketId, bool outcome)` payable — anyone can propose an outcome after the resolution timestamp by posting a bond (native tokens, amount set by `resolutionBond`); opens the dispute window
- `disputeResolution(uint256 marketId)` payable — anyone can call during the dispute window by posting a matching bond; escalates to the owner
- `godResolve(uint256 marketId, bool outcome)` — `onlyOwner`; makes the final binding resolution after a dispute. The losing party's bond is transferred to the winning party (resolver or disputer)
- `claimWinnings(uint256 marketId)` — winners withdraw proportional share of the total pool (only after market is finalized)
- `setResolutionBond(uint256 amount)` — `onlyOwner`; sets the bond amount required to resolve or dispute a market
- `setDisputeWindow(uint256 duration)` — `onlyOwner`; sets the dispute window duration

### Constructor

`constructor(address initialOwner, uint256 initialResolutionBond, uint256 initialDisputeWindow)` — sets the owner (god oracle), the initial bond amount, and the initial dispute window duration.

### Events

- `MarketCreated(uint256 indexed marketId, address indexed creator, string question, uint256 resolutionTimestamp)`
- `SharesBought(uint256 indexed marketId, address indexed buyer, bool outcome, uint256 amount)`
- `MarketResolved(uint256 indexed marketId, address indexed resolver, bool outcome)`
- `DisputeRaised(uint256 indexed marketId, address indexed disputer)`
- `MarketFinalized(uint256 indexed marketId, bool outcome)`
- `WinningsClaimed(uint256 indexed marketId, address indexed claimant, uint256 amount)`

### View Functions

- `getMarket(uint256 marketId)` — returns question, resolution timestamp, current state, proposed outcome, total YES pool, total NO pool
- `getUserPosition(uint256 marketId, address user)` — returns user's YES deposit and NO deposit for a given market
- `getMarketCount()` — returns total number of markets created
- `resolutionBond()` — returns current bond amount
- `disputeWindow()` — returns current dispute window duration

## Frontend

- **Market list** — browse active markets with YES/NO probability bars showing current sentiment
- **Market detail** — buy shares, see the current odds, countdown to resolution
- **Portfolio** — your open positions and claimable winnings
- **Create market** — form to create a new market with question and deadline

## CLI (Stretch Goal)

- `cli market list` — show active markets with current odds
- `cli market buy <id> yes 0.5` — buy YES shares for 0.5 tokens
- `cli market resolve <id> yes` — resolve a market by posting a bond
- `cli market claim <id>` — withdraw winnings

## Tech Stack

| Layer              | Technology                                                        |
| ------------------ | ----------------------------------------------------------------- |
| Smart Contract     | Solidity 0.8.28 compiled to PolkaVM via resolc 1.0.0              |
| Contract Execution | pallet-revive on Polkadot Hub TestNet                             |
| Ethereum RPC       | eth-rpc proxy (port 8545)                                         |
| Frontend           | React 18, Vite, TypeScript, Tailwind, viem                        |
| CLI                | Rust, alloy, clap                                                 |
| Chain              | Local dev (chain ID 420420421) / Polkadot Hub TestNet (420420417) |

## Market State Machine

```
Open → Resolving → Proposed → Finalized
                       ↓
                   Disputed → Finalized
```

| State         | Trigger                                                          | Allowed actions                                                    |
| ------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Open**      | `createMarket()`                                                 | `buyShares()`                                                      |
| **Resolving** | Resolution timestamp passes                                      | `resolveMarket()` + bond                                           |
| **Proposed**  | Someone calls `resolveMarket()`                                  | `disputeResolution()` + bond, or wait for dispute window to expire |
| **Disputed**  | Someone calls `disputeResolution()`                              | `godResolve()` (owner only)                                        |
| **Finalized** | Dispute window expires undisputed, or owner calls `godResolve()` | `claimWinnings()`                                                  |

## Key Design Decisions

- **Two-layer resolution**: Anyone can resolve by posting a bond (skin in the game). The owner acts as the backstop if disputed. No protocol fee — the economics are self-funding through bonds. Resolvers are truthful because a wrong resolution means losing their bond to the disputer. Disputers are honest because a frivolous dispute means losing their bond to the resolver.
- **Pool-based pricing**: Share prices emerge from pooled liquidity and reflect collective probability estimates — information aggregation through market mechanisms.
- **Native tokens (PAS/DOT)**: All value flows use the chain's native token via `msg.value` — no ERC-20 deployments, no approve/transferFrom. Users send native tokens directly with their calls. The contract holds funds and pays out via `transfer()`.
- **Internal accounting for shares**: Shares are not tokens — they are tracked as deposit amounts in contract storage (`mapping(uint256 marketId => mapping(address => uint256))` for each side). When a user calls `buyShares`, their deposit is recorded. At payout, winnings are calculated as `userDeposit * totalPool / totalWinningSidePool` (multiply before divide to minimize truncation). Residual dust from integer rounding stays in the contract. This avoids the complexity of minting tokens and keeps the contract simple.
- **Configurable parameters**: The god oracle can adjust the resolution bond amount and dispute window duration via permissioned setters. This allows tuning the economics without redeploying the contract.
- **No operator, no custody**: The contract holds all funds and distributes them deterministically. Markets are permissionlessly created and permissionlessly resolved. The only trust assumption is the god oracle fallback, set once at contract deployment.

## Future Improvements

- **ERC-1155 shares**: Replace internal accounting with ERC-1155 tokens (one token ID per market outcome). This makes shares transferable and tradeable — users can sell positions before resolution, and shares become composable with other protocols. The contract interface stays the same; the change is under the hood.
