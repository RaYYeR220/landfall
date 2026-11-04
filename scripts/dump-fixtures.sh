#!/usr/bin/env bash
# Snapshot the mainnet programs and accounts the program tests run against.
# Usage: scripts/dump-fixtures.sh [rpc-url]
set -euo pipefail
RPC="${1:-https://api.mainnet-beta.solana.com}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/programs/landfall/tests/fixtures"
mkdir -p "$OUT/programs" "$OUT/accounts"

programs=(
  KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD   # Kamino Lending
  jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9   # Jupiter Lend (lending)
  jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC   # Jupiter Lend (liquidity)
)
accounts=(
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v  # USDC mint
  # Kamino main market, USDC reserve
  7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59
  Bgq7trRgVMeq33yt235zM2onQ4bRDBsY5EWiTetF4qw6 B8V6WVjPxW1UGwVDfxH2d2r8SyT4cqn7dQRK6XneVa7D
  3t4JZcueEzTbVP6kLxXrL3VpWx45jDer4eqysweBchNH
  # Jupiter Lend USDC market
  5nmGjA4s7ATzpBQXC5RNceRpaJ7pYw2wKsNBWyuSAZV6 2vVYHYM8VYnvZqQWpTJSj8o8DBf1wM8pVs3bsTgYZiqJ
  9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D 94vK29npVbyRHXH63rRcTiSr26SFhrQTzbpNJuhQEDu
  Hf9gtkM4dpVBahVSzEXSVCAPpKzBsBcns3s8As3z77oF 5pjzT5dFTsXcwixoab1QDLvZQvpYJxJeBphkyfHGn688
  BmkUoKMFYBxNSzWXyUjyMJjMAaVz4d8ZnxwwmhDCUXFB 7s1da8DduuBFqGra5bJBjpnvL5E9mGzCuMk1Qkh4or2Z
  5xSPBiD3TibamAnwHDhZABdB4z4F9dcj5PnbteroBTTd
)
for p in "${programs[@]}"; do
  solana program dump --url "$RPC" "$p" "$OUT/programs/$p.so" >/dev/null && echo "program $p"
done
for a in "${accounts[@]}"; do
  solana account --url "$RPC" "$a" --output json-compact -o "$OUT/accounts/$a.json" >/dev/null && echo "account $a"
  sleep 0.3
done
solana slot --url "$RPC" > "$OUT/slot.txt"
date -u +%s > "$OUT/unix.txt"
