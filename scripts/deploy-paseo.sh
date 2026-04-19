#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== Deploy Contracts to Paseo Asset Hub ==="
echo ""
echo "Tip: this is a thin wrapper around 'make deploy-paseo'."
echo "     Set PRIVATE_KEY via one of:"
echo "       cd contracts/evm && npx hardhat vars set PRIVATE_KEY"
echo "       cd contracts/pvm && npx hardhat vars set PRIVATE_KEY"
echo "       export PRIVATE_KEY=0x..."
echo ""
echo "Get testnet tokens at: https://faucet.polkadot.io/"
echo ""

exec make -C "$ROOT_DIR" deploy-paseo
