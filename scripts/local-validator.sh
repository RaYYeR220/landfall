#!/usr/bin/env bash
# Local validator with the program, Kamino and Jupiter Lend (mainnet snapshots
# from scripts/dump-fixtures.sh). The USDC mint authority is replaced by a
# local test key so e2e runs can mint test USDC.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FX="$ROOT/programs/landfall/tests/fixtures"
WORK="$ROOT/target/e2e"
mkdir -p "$WORK/accounts"
[ -f "$WORK/usdc-authority.json" ] || solana-keygen new --no-bip39-passphrase --silent -o "$WORK/usdc-authority.json" >/dev/null
AUTH="$(solana address -k "$WORK/usdc-authority.json")"
"${PYTHON:-$(command -v python3 || command -v python)}" - "$FX/accounts" "$WORK/accounts" "$AUTH" <<'PY'
import base64, json, os, sys
src, dst, auth = sys.argv[1], sys.argv[2], sys.argv[3]
B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
n = 0
for c in auth: n = n * 58 + B58.index(c)
auth_b = n.to_bytes(32, "big")
for f in os.listdir(src):
    j = json.load(open(os.path.join(src, f)))
    if j["pubkey"] == "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v":
        d = bytearray(base64.b64decode(j["account"]["data"][0])); d[4:36] = auth_b
        j["account"]["data"][0] = base64.b64encode(bytes(d)).decode()
    j["account"]["rentEpoch"] = 0
    json.dump(j, open(os.path.join(dst, f), "w"))
PY
args=(--reset --ledger "$WORK/ledger" --quiet --rpc-port 8899)
args+=(--bpf-program 12pHvK6FYFHP748kom4F3AbKcymKGVN2r9n1GtX3zdyZ "$ROOT/target/deploy/landfall.so")
for p in KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9 jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC; do
  args+=(--bpf-program "$p" "$FX/programs/$p.so")
done
for f in "$WORK"/accounts/*.json; do
  args+=(--account "$(basename "$f" .json)" "$f")
done
exec solana-test-validator "${args[@]}"
