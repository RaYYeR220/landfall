#!/usr/bin/env bash
# Compares the program deployed on chain with the reproducible build, byte for byte.
#   RPC=https://... scripts/program-hash.sh [program id] [local .so]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PID="${1:-$(grep -oE 'address!\("[1-9A-HJ-NP-Za-km-z]+"\)' "$ROOT/programs/landfall/src/constants.rs" | head -1 | grep -oE '[1-9A-HJ-NP-Za-km-z]{32,44}')}"
LOCAL="${2:-$ROOT/target/verifiable/landfall.so}"
TMP="$(mktemp)"
solana program dump "$PID" "$TMP" --url "${RPC:-https://api.mainnet-beta.solana.com}" >/dev/null
python - "$TMP" "$LOCAL" <<'PY'
import hashlib, sys
chain = open(sys.argv[1], "rb").read()
local = open(sys.argv[2], "rb").read()
# program data may be longer than the binary (max length); the tail must be zero padding
body, tail = chain[: len(local)], chain[len(local):]
same = body == local and not tail.strip(b"\0")
print(f"on-chain  {len(chain)} bytes  sha256 {hashlib.sha256(body).hexdigest()} (first {len(local)} bytes)")
print(f"build     {len(local)} bytes  sha256 {hashlib.sha256(local).hexdigest()}")
print("MATCH" if same else "MISMATCH")
sys.exit(0 if same else 1)
PY
rm -f "$TMP"
