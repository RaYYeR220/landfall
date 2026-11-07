# Review in 5 minutes

<!-- results:links -->
- **Live app:** https://landfall-peach.vercel.app
- **Program:** [`12pHvK6FYFHP748kom4F3AbKcymKGVN2r9n1GtX3zdyZ`](https://solscan.io/account/12pHvK6FYFHP748kom4F3AbKcymKGVN2r9n1GtX3zdyZ)
- **Vault:** [`CpctatgJ8hBKgMF27LeHo4erLcDEhTYsXM829hLtbNnf`](https://solscan.io/account/CpctatgJ8hBKgMF27LeHo4erLcDEhTYsXM829hLtbNnf) · **Share token (lfUSDC):** [`2UrXgqxWHFk75NzWTAxviwgc7iY1N3xZCzjr9ttxp2Ce`](https://solscan.io/account/2UrXgqxWHFk75NzWTAxviwgc7iY1N3xZCzjr9ttxp2Ce)
<!-- /results:links -->

## 1. Watch a deposit land (1 minute, no wallet)

Open the landing page and press **Fire a live deposit**. A wallet on Base that only holds the demo budget sends a little ETH through Intents Connect: Aurora swaps it to USDC on Solana and the bridge-in steps deposit it into the vault in the same transaction. The second button sends to the demo owner's permanent address instead, where the keeper sweeps it. The drawer shows each step with its transaction, and the new shares show up on `/vault` under "Landed".

## 2. Get your own addresses (2 minutes, any wallet)

Open `/app`, connect an EVM or Solana wallet and sign the one-line ownership message. You get one permanent address per chain family (Bitcoin, Tron, Solana, TON, EVM and more), each with its transfer requirement and a QR code. Anything you send there lands as lfUSDC in your position. With a wallet you can also deposit in one signature through Intents Connect, and withdraw to the same wallet, any Solana address, or another chain.

## 3. Check the landing guarantee (1 minute)

Open `/vault`. The "Landing guarantee" table replays a $25 bridged landing against six adverse Kamino conditions on a mainnet snapshot: the documented direct deposit reverts in four and strands the funds, Landfall lands all six. The "Right now" column reads the live Kamino reserve, so you can see which of those conditions is happening at this moment.

<!-- results:headline -->
A direct bridge-and-deposit into Kamino reverts in 4 of 6 adverse market conditions and strands the bridged funds. Landfall lands 6 of 6.
<!-- /results:headline -->

Reproduce it: `cargo test --manifest-path programs/landfall/Cargo.toml --test eval_landing`.

## 4. Verify on chain (1 minute)

- The program, vault and share mint links above open on Solscan. `bash scripts/verifiable-build.sh` rebuilds the program in the Solana Foundation's verifiable-build image and `bash scripts/program-hash.sh` hashes what is deployed; both hashes are in PROOF.md.
- Every flow's mainnet transactions are listed in [PROOF.md](PROOF.md).

<!-- results:compute -->
| Transaction | Compute units |
|---|---|
| deposit | 16,474 |
| create the share account + deposit | 39,653 |
| deposit while both strategies hold funds | 17,428 |
| sweep an inbox (creates the share account) | 46,393 |
| refresh_reserve + allocate into Kamino | 85,856 |
| allocate into Jupiter Lend | 76,567 |
| refresh_reserve + withdraw through Kamino | 76,584 |
| withdraw through Jupiter Lend | 74,006 |

Program binary (reproducible build, `scripts/verifiable-build.sh`): 101,984 bytes, sha256 `861666e04005901566106c1fe72079e942fb29f3651725a63f42dcd180744e64`.
<!-- /results:compute -->

## Where to look in the code

| What | Where |
|---|---|
| The landing instruction (no lending CPI) | `programs/landfall/src/ix/landing.rs` |
| NAV from live Kamino / Jupiter Lend accounts | `programs/landfall/src/nav.rs`, `strategies/` |
| Intents Connect steps (bridge-in, finish, out-operation, steps-only) | `packages/sdk/src/recipes.ts` |
| Persistent addresses → inbox | `apps/web/lib/server/addresses.ts`, `programs/landfall/src/ix/landing.rs` (`sweep_inbox`) |
| Swap API withdrawal | `apps/web/app/api/withdraw/`, `packages/sdk/src/recipes.ts` (`swapOutIxs`) |
| Recovery for every terminal state | `apps/web/components/app/Recovery.tsx` |
| Adverse-condition eval | `programs/landfall/tests/eval_landing.rs` |

Each claim and its evidence tier: [CLAIMS.md](CLAIMS.md). Real vs simulated: [MOCKS.md](MOCKS.md).
