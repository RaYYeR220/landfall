# Claims

Every public statement about Landfall, the evidence behind it, and how to reproduce it.

Tiers:
- **REPRODUCIBLE**: a command in this repo regenerates it.
- **VERIFIED-LIVE**: visible on Solana mainnet (or another mainnet) right now.
- **MODELED**: illustrative, not measured.
- **NOT-CLAIMED**: things we deliberately don't say.

## Landing

| Claim | Tier | Evidence | Reproduce |
|---|---|---|---|
| A direct bridge-and-deposit into Kamino reverts in 4 of 6 adverse conditions and strands the bridged USDC; Landfall's landing lands in all 6 | REPRODUCIBLE | `eval/results/landing.json` | `cargo test --manifest-path programs/landfall/Cargo.toml --test eval_landing` |
| The normal-conditions control lands for both, and the direct recipe also survives a stale oracle and an out-of-band price | REPRODUCIBLE | same file, rows `healthy`, `oracle_stale`, `usdc_outside_price_band` | same |
| Landing never calls a lending protocol | REPRODUCIBLE | `programs/landfall/src/ix/landing.rs` (`deposit` has no CPI besides SPL Token) | read the instruction; `core.rs` tests |
| A zero amount, a dust amount that would mint 0 shares, and a written-off strategy are all no-ops, never reverts | REPRODUCIBLE | `core.rs`: `zero_deposit_is_noop`, `dust_deposit_stays_with_depositor`, `write_off_pauses_landings_without_reverting` | `cargo test … --test core` |
| Bridge-in steps pass Aurora's own step guards and use `{MIN_AMOUNT_OUT}` | REPRODUCIBLE | `packages/sdk/test/sdk.test.ts` uses `guards` from `@aurora-is-near/intents-connect` | `pnpm --filter @landfall/sdk test` |
| Every flow works end to end against live Kamino and Jupiter Lend state: wallet deposit, Intents Connect bridge-in steps, inbox sweep and keeper allocation, out-operation, steps-only withdrawal, Swap API payout, recovery | REPRODUCIBLE | `eval/results/fork-e2e.json` (mainnet fork; Intents Connect steps encoded the way the Aurora backend encodes them) | `bash scripts/fork.sh` |
| The Intents Connect API accepts Landfall's steps | VERIFIED-LIVE | a dry create of a steps-only execution returned `OPERATION_PENDING` | see PROOF.md |

## Vault

| Claim | Tier | Evidence | Reproduce |
|---|---|---|---|
| Shares are priced from live on-chain Kamino and Jupiter Lend accounts in every pricing instruction | REPRODUCIBLE | `programs/landfall/src/nav.rs`; `allocate_moves_spare_idle_into_kamino_at_kamino_price`, `nav_counts_both_strategies`, `landing_rejects_caller_chosen_valuation`, `interest_accrues_to_share_holders` | `cargo test …` |
| First-depositor and donation attacks are unprofitable | REPRODUCIBLE | `core.rs`: `donation_cannot_zero_out_depositor`, `init_seeds_dead_shares` | `cargo test … --test core` |
| The curator can't move funds, stop withdrawals, or raise the minimum sweep above 5 USDC | REPRODUCIBLE | `core.rs`: `pause_does_not_block_withdrawals`, `non_curator_cannot_pause`, `curator_cannot_raise_min_sweep_out_of_reach`, `sweep_fee_is_capped_at_one_percent` | `cargo test … --test core` |
| Only the program's upgrade authority can initialise the vault | REPRODUCIBLE | `core.rs`: `only_the_upgrade_authority_can_create_the_vault`, `prefunding_the_share_mint_address_does_not_brick_init` | `cargo test … --test core` |
| The TypeScript SDK builds byte-identical instructions to the Rust client | REPRODUCIBLE | `packages/sdk/test/vectors.json` written by `tests/client_vectors.rs` | both test suites |
| Compute units per transaction | REPRODUCIBLE | `eval/results/compute/*.json` | `cargo test …` |
| The live Kamino reserve has room under its deposit limit, is active and not in emergency mode | VERIFIED-LIVE | `/vault` page, "Right now" column; `/api/vault/health` | open `/vault` |

## Aurora Intents

| Claim | Tier | Evidence |
|---|---|---|
| Intents Deposits: one permanent address per chain family per owner, paying the owner's inbox on Solana; ETH on Base landed as vault shares in ~100 s with no signature | VERIFIED-LIVE | PROOF.md, flow 1 |
| Cross-chain swap built in: ETH on Base arrives as USDC on Solana | VERIFIED-LIVE | PROOF.md, flow 1 (Aurora payout tx) |
| Integrator revenue: 0.05% on stablecoin routes, 0.25% on others, 60% to Landfall (Intents Studio fee rules on the production key) | VERIFIED-LIVE | quotes from the production key; PROOF.md |
| The Intents Connect API accepts Landfall's steps (bridge-in, steps-only, out-operation) and the wallet signature | VERIFIED-LIVE | execution ids in PROOF.md, flow 3 |
| Intents Connect bridge-in, steps-only recovery and out-operation run end to end | REPRODUCIBLE | `bash scripts/fork.sh` (mainnet fork, steps encoded the way the Aurora backend encodes them) |
| … and on mainnet | NOT-CLAIMED | Aurora's Solana executor did not broadcast any of our three mainnet executions that call the Landfall program, while a control execution with a plain USDC transfer from the same wallet succeeded in ten seconds (PROOF.md, flow 3). The same steps simulate successfully against mainnet. No funds were lost: the bridged USDC sits in the wallet's own Intents Connect account. |
| Swap API withdrawal from a Solana wallet to another chain, refunds to the wallet | REPRODUCIBLE | fork run (`swap-out`), live quote from the production key; not yet executed on mainnet |
| Confidential permanent addresses land in the same inbox | NOT-CLAIMED live | implemented (`confidential: true` in the address book); not exercised on mainnet |

## Modeled

| Claim | Tier |
|---|---|
| Arrival times on the landing page ("~1–2 min" for Tron, Bitcoin's ~14 min compressed to 14 s) | MODELED: typical times, labelled "illustrative" on the page |
| Sample addresses in the landing hero | MODELED: labelled "sample"; real addresses appear only in the app |

## Not claimed

- No audit. The program has been reviewed by us only.
- No claim that Landfall is cheaper than a direct deposit; it adds one permissionless allocation transaction, paid by the keeper.
- No claim about yields beyond what Kamino and Jupiter Lend report through their public APIs at the time you look.
- No testnet deployment: Aurora Intents has no testnet, so the program was tested on LiteSVM against mainnet snapshots and runs on mainnet with small caps.
