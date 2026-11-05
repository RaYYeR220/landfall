#!/usr/bin/env bash
# Mainnet-fork end-to-end: surfpool (Docker) forks mainnet, the reproducible build is deployed
# with the admin key as upgrade authority, then packages/sdk/scripts/e2e-fork.ts runs every flow.
#   ADMIN_KEYPAIR=… KEEPER_KEYPAIR=… PROGRAM_KEYPAIR=… scripts/fork.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
: "${ADMIN_KEYPAIR:?}" "${KEEPER_KEYPAIR:?}" "${PROGRAM_KEYPAIR:?}"
RPC=http://127.0.0.1:8899
NAME=landfall-fork
docker rm -f "$NAME" >/dev/null 2>&1 || true
MSYS_NO_PATHCONV=1 docker run -d --name "$NAME" -p 8899:8899 -p 8900:8900 surfpool/surfpool:latest \
  start --network mainnet --host 0.0.0.0 --no-tui --no-studio --no-deploy \
  --airdrop "$(solana address -k "$ADMIN_KEYPAIR")" --airdrop "$(solana address -k "$KEEPER_KEYPAIR")" >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 60); do solana cluster-version --url "$RPC" >/dev/null 2>&1 && break; sleep 1; done
[ -f "$ROOT/target/verifiable/landfall.so" ] || bash "$ROOT/scripts/verifiable-build.sh"
solana program deploy "$ROOT/target/verifiable/landfall.so" --program-id "$PROGRAM_KEYPAIR" \
  --keypair "$ADMIN_KEYPAIR" --upgrade-authority "$ADMIN_KEYPAIR" --url "$RPC" >/dev/null
echo "deployed $(solana address -k "$PROGRAM_KEYPAIR") to the fork"
cd "$ROOT/packages/sdk"
RPC="$RPC" OUT="${OUT:-$ROOT/eval/results/fork-e2e.json}" npx tsx scripts/e2e-fork.ts
