#!/usr/bin/env bash
# Deploy (or upgrade) the program.
#   ADMIN_KEYPAIR=path/to/admin.json RPC=https://... scripts/deploy.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RPC="${RPC:-https://api.mainnet-beta.solana.com}"
: "${ADMIN_KEYPAIR:?set ADMIN_KEYPAIR}"
# deploy the reproducible build (scripts/verifiable-build.sh) unless SO is given
SO="${SO:-$ROOT/target/verifiable/landfall.so}"
[ -f "$SO" ] || { echo "missing $SO — run scripts/verifiable-build.sh"; exit 1; }
PROGRAM_KEYPAIR="${PROGRAM_KEYPAIR:-$ROOT/target/deploy/landfall-keypair.json}"
EXPECTED="$(grep -oE 'address!\("[1-9A-HJ-NP-Za-km-z]+"\)' "$ROOT/programs/landfall/src/constants.rs" | head -1 | grep -oE '[1-9A-HJ-NP-Za-km-z]{32,44}')"
GOT="$(solana address -k "$PROGRAM_KEYPAIR")"
[ "$GOT" = "$EXPECTED" ] || { echo "program keypair $GOT does not match the id compiled into the program ($EXPECTED)"; exit 1; }
echo "program  $GOT"
echo "payer    $(solana address -k "$ADMIN_KEYPAIR")  balance $(solana balance -k "$ADMIN_KEYPAIR" --url "$RPC")"
echo "binary   $(wc -c < "$SO") bytes  sha256 $(sha256sum "$SO" | cut -d' ' -f1)"
solana program deploy "$SO" \
  --program-id "$PROGRAM_KEYPAIR" \
  --keypair "$ADMIN_KEYPAIR" \
  --upgrade-authority "$ADMIN_KEYPAIR" \
  --url "$RPC" \
  --with-compute-unit-price "${CU_PRICE:-200000}" \
  --max-sign-attempts 100 \
  --use-rpc
solana program show "$GOT" --url "$RPC"
