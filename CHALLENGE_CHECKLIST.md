# Aurora Intents bounty: criteria and evidence

| Criterion | Where it is met | Evidence |
|---|---|---|
| Ships a working integration of at least one Aurora Intents product, demoed live, not mocked | All three: **Intents Deposits** (permanent addresses per chain, paying each owner's inbox), **Intents Connect** (bridge-in whose steps land in the vault; steps-only finish and withdraw; out-operation), **Swap API** (withdrawals from Solana wallets to other chains) | Live app; "Fire a live deposit" on the landing page; PROOF.md lists each flow's mainnet transactions; MOCKS.md |
| Removes a real cross-chain friction point; credible user problem | Funds from an exchange, Bitcoin or Tron can't sign an intent. A permanent address turns any plain transfer into a yield position on Solana with no bridge, no signature and no SOL | README "Why the landing step matters"; `/app` address book |
| Correct settlement and refund handling | Landing can't revert after funds cross chains (eval below). Every terminal state has a recovery path: sweep now, finish a stranded bridge-in into the vault, Swap API refunds to the sender's wallet, failed persistent deposits linked to Aurora support | `eval/results/landing.json`; `apps/web/components/app/Recovery.tsx`; `apps/web/app/api/withdraw/` |
| Clean UX that hides cross-chain complexity, no unnecessary actions | One sign-in to get every address; after that, deposits need no action at all. Wallet deposits and withdrawals are one signature | `/app` |
| Fit and creativity in the chosen category (consumer / payments + DeFi infra) | "The address is the instruction": a deposit address that executes a vault deposit on arrival, which Intents Deposits lists as a coming custom action, built on Solana | Landing page; README |
| Custom fees / revenue share (organiser highlight) | Fee rules on the production key: 0.05% stablecoin routes, 0.25% others; 60% to Landfall | README "Fees"; PROOF.md quote |
| Bonus: multi-chain source coverage | 18 chain families, 30+ chains (EVM chains share one address), plus exchange withdrawals | `PERSISTENT_CHAINS` in `packages/sdk/src/aurora/intents.ts` |
| Bonus: contract-level composability via Intents Connect | Bridge-in steps call the Landfall program with `{MIN_AMOUNT_OUT}`; out-operation steps redeem from the vault before bridging out; both checked against Aurora's own step guards | `packages/sdk/src/recipes.ts`; `packages/sdk/test/sdk.test.ts` |
| Bonus: Confidential Intents use case | Confidential permanent addresses (`confidential: true`) that land in the same inbox; toggle in the address book | `apps/web/lib/server/addresses.ts`; `AddressBook.tsx` |

## Programme criteria

| Criterion | Evidence |
|---|---|
| What was built and works | Program on mainnet, web app, keeper, SDK, MCP server; JUDGES.md walks through it in 5 minutes |
| Technical depth | Pinocchio program priced from live Kamino and Jupiter Lend accounts; adverse-condition eval on mainnet snapshots; <!-- results:tests -->45 program tests (LiteSVM, mainnet snapshots), 32 SDK tests and 4 MCP server tests, all passing<!-- /results:tests --> |
| How well it uses Solana | Inbox PDAs as cross-chain recipients, permissionless sweep and allocation, CPI into Kamino and Jupiter Lend, Anchor-compatible events |
