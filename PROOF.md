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

<!-- filled in as each flow runs on mainnet -->
