# Real vs simulated

The line between what runs for real and what is a simulation, part by part.

| Part | Real | Simulated |
|---|---|---|
| Landfall program | Deployed on Solana mainnet; every app action is a mainnet transaction | — |
| Kamino and Jupiter Lend | The live mainnet USDC reserve and lending pool; allocations are real CPIs | — |
| Aurora Intents (Deposits, Connect, Swap API) | Production Aurora APIs; there is no Aurora testnet | — |
| "Fire a live deposit" | A real 1 USDC transfer on Base from a spend-capped wallet, landing on Solana mainnet | — |
| Vault numbers on `/vault` and the landing page | Read from chain on every request (NAV, shares, allocation, Kamino reserve limits) | — |
| APYs | Kamino's and Jupiter's public APIs, cached for 5 minutes | — |
| Landing eval (`eval/results/landing.json`) | Real mainnet account snapshots of Kamino, Jupiter Lend and USDC, real program binaries, real transactions in LiteSVM | Each adverse condition is one patched byte range of a snapshot (for example the reserve's deposit limit set to its current liquidity). The direct recipe is the documented Kamino bridge-in, rebuilt as the same steps. |
| Program tests | LiteSVM with the Kamino and Jupiter Lend programs dumped from mainnet | Token balances are written directly where a test needs a starting state |
| Landing-page hero | Chain list, address formats, transfer requirements and the vault split | Sample addresses (labelled "sample") and arrival times (labelled "illustrative"); a fired deposit replaces them with the real one |

Nothing in the app falls back to made-up data. If a dependency is down the app says so: `/api/vault` returns an error instead of a number, persistent addresses show `pending-approval` without an approved key, and the demo button shows the API's own error text.
