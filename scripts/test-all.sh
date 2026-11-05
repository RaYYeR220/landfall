#!/usr/bin/env bash
# Runs every test suite, records the counts in eval/results/tests/, and refreshes the docs.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p eval/results/tests
pnpm build:program
out="$(cargo test --manifest-path programs/landfall/Cargo.toml 2>&1 | tee /dev/stderr)"
passed=$(echo "$out" | awk '/^test result:/ { for (i = 1; i <= NF; i++) if ($(i + 1) ~ /^passed/) s += $i } END { print s + 0 }')
failed=$(echo "$out" | awk '/^test result:/ { for (i = 1; i <= NF; i++) if ($(i + 1) ~ /^failed/) s += $i } END { print s + 0 }')
printf '{\n  "suite": "program",\n  "numPassedTests": %s,\n  "numFailedTests": %s\n}\n' "$passed" "$failed" > eval/results/tests/program.json
pnpm --filter @landfall/sdk test
pnpm --filter @landfall/mcp test
node scripts/render-results.mjs
