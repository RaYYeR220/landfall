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
| A zero amount, a dust amount that would mint 0 shares, and a written-off strategy are all no-ops, never reverts | REPRODUCIBLE | `core.rs`: `deposit_zero_is_noop`, dust and write-off tests | `cargo test … --test core` |
| Bridge-in steps pass Aurora's own step guards and use `{MIN_AMOUNT_OUT}` | REPRODUCIBLE | `packages/sdk/test/sdk.test.ts` uses `guards` from `@aurora-is-near/intents-connect` | `pnpm --filter @landfall/sdk test` |
| The Intents Connect API accepts Landfall's steps | VERIFIED-LIVE | a dry create of a steps-only execution returned `OPERATION_PENDING` | see PROOF.md |

## Vault

| Claim | Tier | Evidence | Reproduce |
|---|---|---|---|
| Shares are priced from live on-chain Kamino and Jupiter Lend accounts in every pricing instruction | REPRODUCIBLE | `programs/landfall/src/nav.rs`; `kamino.rs`, `jlend.rs` tests | `cargo test …` |
| First-depositor and donation attacks are unprofitable | REPRODUCIBLE | `core.rs` donation / inflation tests | `cargo test … --test core` |
| The curator can't move funds, stop withdrawals, or raise the minimum sweep above 5 USDC | REPRODUCIBLE | `ix/admin.rs`; `curator_cannot_raise_min_sweep_out_of_reach` | `cargo test … --test core` |
| Only the program's upgrade authority can initialise the vault | REPRODUCIBLE | `init_vault` checks ProgramData; test `init_vault_requires_upgrade_authority` | `cargo test … --test core` |
| The TypeScript SDK builds byte-identical instructions to the Rust client | REPRODUCIBLE | `packages/sdk/test/vectors.json` written by `tests/client_vectors.rs` | both test suites |
| Compute units per transaction | REPRODUCIBLE | `eval/results/compute/*.json` | `cargo test …` |
| The live Kamino reserve has room under its deposit limit, is active and not in emergency mode | VERIFIED-LIVE | `/vault` page, "Right now" column; `/api/vault/health` | open `/vault` |

## Aurora Intents

| Claim | Tier | Evidence |
|---|---|---|
| Intents Deposits: one persistent address per chain family per owner, paying the owner's inbox on Solana | VERIFIED-LIVE once the API key is approved | `apps/web/lib/server/addresses.ts`; PROOF.md |
| Intents Connect bridge-in that lands in the vault in one signature | VERIFIED-LIVE | PROOF.md (bridge-in from Base) |
| Intents Connect out-operation that redeems on Solana and bridges out | VERIFIED-LIVE | PROOF.md |
| Swap API withdrawal from a Solana wallet to another chain, with refunds to the wallet | VERIFIED-LIVE | PROOF.md |
| Confidential persistent addresses land in the same inbox | VERIFIED-LIVE when Aurora serves them for the key | PROOF.md |

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
