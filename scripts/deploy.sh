#!/usr/bin/env bash
# Deploy (or upgrade) the program.
#   ADMIN_KEYPAIR=path/to/admin.json RPC=https://... scripts/deploy.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RPC="${RPC:-https://api.mainnet-beta.solana.com}"
: "${ADMIN_KEYPAIR:?set ADMIN_KEYPAIR}"
SO="$ROOT/target/deploy/landfall.so"
echo "program  $(solana address -k "$ROOT/target/deploy/landfall-keypair.json")"
echo "payer    $(solana address -k "$ADMIN_KEYPAIR")  balance $(solana balance -k "$ADMIN_KEYPAIR" --url "$RPC")"
echo "binary   $(wc -c < "$SO") bytes  sha256 $(sha256sum "$SO" | cut -d' ' -f1)"
solana program deploy "$SO" \
  --program-id "$ROOT/target/deploy/landfall-keypair.json" \
  --keypair "$ADMIN_KEYPAIR" \
  --upgrade-authority "$ADMIN_KEYPAIR" \
  --url "$RPC" \
  --with-compute-unit-price "${CU_PRICE:-200000}" \
  --max-sign-attempts 100 \
  --use-rpc
solana program show "$(solana address -k "$ROOT/target/deploy/landfall-keypair.json")" --url "$RPC"
