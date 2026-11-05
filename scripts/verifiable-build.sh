#!/usr/bin/env bash
# Reproducible build of the program in the Solana Foundation's verifiable-build image.
# The deployed binary is this one: anyone can rebuild it and compare hashes.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="${IMAGE:-solanafoundation/solana-verifiable-build:3.1.14}"
MOUNT="$ROOT"
command -v cygpath >/dev/null && MOUNT="$(cygpath -w "$ROOT")"
mkdir -p "$ROOT/target/verifiable"
MSYS_NO_PATHCONV=1 docker run --rm -v "$MOUNT:/build" -w /build/programs/landfall "$IMAGE" bash -c \
  'export CARGO_TARGET_DIR=/tmp/target && cargo build-sbf --sbf-out-dir /tmp/out -- --locked >/dev/null && cp /tmp/out/landfall.so /build/target/verifiable/landfall.so'
echo "target/verifiable/landfall.so  $(wc -c < "$ROOT/target/verifiable/landfall.so") bytes"
echo "sha256 $(sha256sum "$ROOT/target/verifiable/landfall.so" | cut -d' ' -f1)"
