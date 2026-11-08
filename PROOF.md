# Proof

Every claim here is a link to Solana mainnet (or Base / Ethereum for the origin side).

## Deployment

| What | Link |
|---|---|
| Program `12pHvK6FYFHP748kom4F3AbKcymKGVN2r9n1GtX3zdyZ` | [Solscan](https://solscan.io/account/12pHvK6FYFHP748kom4F3AbKcymKGVN2r9n1GtX3zdyZ) |
| Deploy (from the reproducible build) | [41kJAWdt…](https://solscan.io/tx/41kJAWdtNSyz795LBJ6wUBsX9ukVU48Aw9WsJVyZqcv7G72xVALbCC9tPanAiFDxXhBdPaBhJnfRUDNPCfev7Uyf) |
| Vault `CpctatgJ8hBKgMF27LeHo4erLcDEhTYsXM829hLtbNnf` created, 1 USDC of dead shares seeded | [ViPHdFZt…](https://solscan.io/tx/ViPHdFZtehVwfcdRj1EMwvhZqM3FGqvjuZJiRcCohcjQp4MfMEuAfCTdEc6QCrAPwXEZEcswV6cnWzpjRt6kvWV) |
| Kamino USDC reserve and Jupiter Lend USDC pool configured | [4vDrRjBa…](https://solscan.io/tx/4vDrRjBa5Y6grLMTXGgnajoyay78HkgdvqQVMmAGhh2LT46BaL4vRFSDAfr1eA4zmZcuBwrbQAa6qXh4cPjKx5GU) |
| Curator weights 60 / 40, caps, idle buffer, sweep fee | [2TdP3agv…](https://solscan.io/tx/2TdP3agv6263WH9EWFUuUgsHwQoi48sk5fWPx3YoCtpM8ciKdtYzPung6usoB7kUk9WzaDTESFyhMqL9UduYEJy2) |
| Keeper's first `sync_nav` | [trXwjaoW…](https://solscan.io/tx/trXwjaoWLzg8Wqqof54bAaSju25byVLgA2A8y1j8RiA9CZhqPA9SxwEt26swPBHKvQ3qhYFyFJuCEbh8NQ7UV2X) |
| Share token (lfUSDC) | [2UrXgqxW…](https://solscan.io/token/2UrXgqxWHFk75NzWTAxviwgc7iY1N3xZCzjr9ttxp2Ce) |

## The deployed program is this repository

```
$ bash scripts/verifiable-build.sh          # Solana Foundation verifiable-build image 3.1.14
sha256 861666e04005901566106c1fe72079e942fb29f3651725a63f42dcd180744e64

$ bash scripts/program-hash.sh              # dumps the program from mainnet
on-chain  101984 bytes  sha256 861666e04005901566106c1fe72079e942fb29f3651725a63f42dcd180744e64
build     101984 bytes  sha256 861666e04005901566106c1fe72079e942fb29f3651725a63f42dcd180744e64
MATCH
```

## Integrator fees on the Aurora key

Quotes from the production key carry the fee rules set in Intents Studio (`appFees` in the quote request echo):

| Route | Fee | Split |
|---|---|---|
| USDC on Base → USDC on Solana | 5 bps | Landfall 3, Aurora 2 |
| ETH on Base → USDC on Solana | 25 bps | Landfall 15, Aurora 10 |

## Flows

### 1. ETH on Base to a permanent address, landed in the vault with no signature

The demo wallet `0xA37000D10e8e7Bf120461c873d2901aD38B2d3cE` sent 0.0006 ETH on Base to its permanent EVM deposit address. Aurora swapped it to USDC and paid the owner's inbox on Solana; the keeper swept it into the vault six seconds later.

| Step | Time (UTC, Nov 7) | Link |
|---|---|---|
| Keeper opens the owner's inbox (after the signed sign-in) | 23:08:42 | [43uP43Ta…](https://solscan.io/tx/43uP43TaTYAbaSpMoCRRsU3VK6JDSGD5zEKF2BQXrWi1qpJn7RPexKf1XxUiMv2VuBjHv6ComdBtFjSoiQg58SoU) |
| 0.0006 ETH sent on Base to `0x0C42B9Ad948CB00650c56DE2E99Bc3f8a2dFf2EC` | 23:08:47 | [0x0d16f7ca…](https://basescan.org/tx/0x0d16f7caa21049f689833afc033ea72fa46f198812dfe9f200e26c1c09f310ed) |
| Aurora pays USDC into inbox `93VdSUGN…` | 23:10:19 | [2GVYg5sN…](https://solscan.io/tx/2GVYg5sN6tqgB3yK8vqbEz7SLrgsRNzriJhycV2vnpfDV69xFzdYKa3Are65KeYJEsVc7Se6cC9REwU1XSS2ZNd4) |
| Keeper sweeps the inbox, lfUSDC minted to the owner | 23:10:25 | [SUxzdc1c…](https://solscan.io/tx/SUxzdc1cnNXWGwhLsy4s4B2jsdVH2bzAVnBQ91fbiyFhLPDAoDbPKu1YatnW5vFU4AUdM1jxFRzGLZfWQTeH9CK) |

From ETH on Base to vault shares on Solana in about 100 seconds, with nothing signed after the one-time sign-in.

### 2. The keeper allocates idle USDC into Kamino and Jupiter Lend

Permissionless allocation toward the curator's 60 / 40 weights, above the 10% idle buffer, priced and capped by the program.

| Step | Time (UTC, Nov 8) | Link |
|---|---|---|
| `refresh_reserve` + `allocate_kamino` 1.389015 USDC | 02:46:55 | [2uEE1REJ…](https://solscan.io/tx/2uEE1REJMhLRm8PpjuXMtAD8P7Ts6E19N7RpJucXodCNJ6KgPp3xiVygXNBruRW1fcTEkj9iHEab22ZEtptw84Jf) |
| `allocate_jlend` 0.694509 USDC | 02:46:55 | [337vUeph…](https://solscan.io/tx/337vUephfqSvnxakTbajdPiTSseD6HQVHNfKSL6iSowzKgcXj4jsaPK6xbcLPpqwDVgjVoKPT9DcEUadQTjDWh9Q) |
| `sync_nav` caches both strategies' live values | 02:46:55 | [2r6p2srM…](https://solscan.io/tx/2r6p2srMPv5om212yDXTqmhikrE9kaqyBgjzvS56HJ9JZ6DCaMRgwSE8a21JU68EbwycvMKaG3Kte4WjUfdBcEGt) |

### 3. Intents Connect on mainnet: signed and accepted, never broadcast by Aurora's executor

All three Intents Connect executions below were created with Landfall's steps, signed by the demo wallet and accepted by the API. Aurora's Solana executor then marked each `OPERATION_FAILED` without broadcasting a transaction; there is no failed transaction on chain. The same steps, encoded the way the Aurora backend encodes them, run end to end on a mainnet fork (`bash scripts/fork.sh`) and simulate cleanly against mainnet (landing step: 11,677 compute units).

| Execution | Kind | Created (UTC) | Result |
|---|---|---|---|
| `d684e086-ef5a-4e20-a006-34a33d956681` | bridge-in, 0.0006 ETH on Base ([0x92ce8d07…](https://basescan.org/tx/0x92ce8d07af60c9f4067b4cc194b2fdf1114760c633786ec8d38f9777033af641)) → deposit into the vault | Nov 7 23:11 | bridged 1.097318 USDC arrived in the intermediary ([4ZKQf9UA…](https://solscan.io/tx/4ZKQf9UAFGuaBo2ArZRmK947ypFZSeqz1kqh8gRpKxYfPTEP5mJ8sLfkuwvnCY3k4wqPgtrqkuCVeyhKzX5fGrJR)); the step transaction was never sent |
| `f9ab7077-5488-4e3b-91f0-dda53b46036f` | steps-only recovery: finish that USDC into the vault | Nov 8 02:22 | never sent |
| `a8ed5f08-02e2-499e-87a2-bbcd9bb2ee48` | out-operation: redeem and bridge back to USDC on Base | Nov 8 02:32 | never sent |

Nothing was lost. The 1.097318 USDC and the 1.315026 lfUSDC from flow 1 sit in the demo wallet's Intents Connect account [`4jxzL1Yw…`](https://solscan.io/account/4jxzL1YwFw5FtcraNLbkUFZo1P8spZAcjERWqXPYuytg), which only that wallet's signature can move, and the app's recovery centre lists the loose USDC with a "Finish into vault" action for when the executor runs.
