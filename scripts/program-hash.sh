#!/usr/bin/env bash
# sha256 of the program deployed on chain (trailing zero padding stripped), to compare with the build.
#   RPC=https://... scripts/program-hash.sh [program id]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PID="${1:-$(solana address -k "$ROOT/target/deploy/landfall-keypair.json")}"
TMP="$(mktemp)"
solana program dump "$PID" "$TMP" --url "${RPC:-https://api.mainnet-beta.solana.com}" >/dev/null
python - "$TMP" <<'PY'
import hashlib, sys
d = open(sys.argv[1], "rb").read().rstrip(b"\0")
print(f"on-chain {len(d)} bytes  sha256 {hashlib.sha256(d).hexdigest()}")
PY
rm -f "$TMP"
