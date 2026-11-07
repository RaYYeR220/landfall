#!/usr/bin/env bash
# sha256 of the program deployed on chain (trailing zero padding stripped), to compare with the build.
#   RPC=https://... scripts/program-hash.sh [program id]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PID="${1:-$(grep -oE 'address!\("[1-9A-HJ-NP-Za-km-z]+"\)' "$ROOT/programs/landfall/src/constants.rs" | head -1 | grep -oE '[1-9A-HJ-NP-Za-km-z]{32,44}')}"
TMP="$(mktemp)"
solana program dump "$PID" "$TMP" --url "${RPC:-https://api.mainnet-beta.solana.com}" >/dev/null
python - "$TMP" <<'PY'
import hashlib, sys
d = open(sys.argv[1], "rb").read().rstrip(b"\0")
print(f"on-chain {len(d)} bytes  sha256 {hashlib.sha256(d).hexdigest()}")
PY
rm -f "$TMP"
