SHELL := /bin/bash

ROOT_DIR := $(shell pwd)
EVM_DIR  := $(ROOT_DIR)/contracts/evm
PVM_DIR  := $(ROOT_DIR)/contracts/pvm

# Load .env (repo-root) if present and export every var to sub-processes.
# Precedence (make side): command-line args > .env > shell env.
# For a one-off override use: `make deploy-paseo PRIVATE_KEY=0x...`
ifneq (,$(wildcard $(ROOT_DIR)/.env))
  include $(ROOT_DIR)/.env
  export
endif

# Strip surrounding quotes picked up by Make's `include` (e.g. MNEMONIC="a b c d").
# patsubst splits on whitespace so it won't handle a quoted multi-word phrase; we
# just strip every quote char instead. Neither mnemonics nor 0x keys contain them.
SINGLE_Q := '
DOUBLE_Q := "
MNEMONIC    := $(subst $(DOUBLE_Q),,$(subst $(SINGLE_Q),,$(MNEMONIC)))
PRIVATE_KEY := $(subst $(DOUBLE_Q),,$(subst $(SINGLE_Q),,$(PRIVATE_KEY)))

# Read PRIVATE_KEY / MNEMONIC from hardhat vars file if not already set in env.
# Hardhat stores vars at a platform-specific path; probe both macOS and Linux locations.
HARDHAT_VARS_MAC   := $(HOME)/Library/Preferences/hardhat-nodejs/vars.json
HARDHAT_VARS_LINUX := $(HOME)/.config/hardhat-nodejs/vars.json
HARDHAT_VARS_FILE  := $(firstword $(wildcard $(HARDHAT_VARS_MAC) $(HARDHAT_VARS_LINUX)))

ifndef PRIVATE_KEY
  ifneq ($(HARDHAT_VARS_FILE),)
    PRIVATE_KEY := $(shell node -e "try{const v=require('$(HARDHAT_VARS_FILE)');process.stdout.write(v.vars.PRIVATE_KEY??'')}catch(e){}" 2>/dev/null)
  endif
endif

ifndef MNEMONIC
  ifneq ($(HARDHAT_VARS_FILE),)
    MNEMONIC := $(shell node -e "try{const v=require('$(HARDHAT_VARS_FILE)');process.stdout.write(v.vars.MNEMONIC??'')}catch(e){}" 2>/dev/null)
  endif
endif

export PRIVATE_KEY
export MNEMONIC

.DEFAULT_GOAL := help

# ─── Help ─────────────────────────────────────────────────────────────────────

.PHONY: help
help:
	@echo "Callit make targets"
	@echo ""
	@echo "  deploy-paseo         Deploy EVM + PVM contracts to Paseo Asset Hub (via eth-rpc)"
	@echo "  deploy-paseo-evm     Deploy ProofOfExistence + PredictionMarket via solc"
	@echo "  deploy-paseo-pvm     Deploy ProofOfExistence via resolc (PolkaVM)"
	@echo "  deploy-paseo-papi    Deploy PredictionMarket to Paseo Asset Hub via PAPI"
	@echo "                       (uses Revive.instantiate_with_code; sr25519 mnemonic needed)"
	@echo "  deploy-frontend      Build the frontend and upload web/dist to IPFS via w3"
	@echo "  build-frontend       Install deps and run 'vite build' in web/"
	@echo "  check-key            Verify PRIVATE_KEY is set (prints deploying address)"
	@echo ""
	@echo "Environment:"
	@echo "  PRIVATE_KEY    Deployer private key (0x-prefixed)."
	@echo "                 Sources: .env at repo root, shell env, hardhat vars,"
	@echo "                 or 'make deploy-paseo PRIVATE_KEY=0x...' for a one-off."
	@echo "                 Quick start: cp .env.example .env && edit PRIVATE_KEY=0x..."
	@echo "  DOMAIN         (deploy-frontend) DotNS domain to associate (optional)."
	@echo ""

# ─── Paseo deploy ─────────────────────────────────────────────────────────────

.PHONY: deploy-paseo
deploy-paseo: check-key deploy-paseo-evm deploy-paseo-pvm
	@echo ""
	@echo "=== Paseo deployment complete ==="
	@cat $(ROOT_DIR)/deployments.json

.PHONY: deploy-paseo-evm
deploy-paseo-evm: check-key
	@echo "[1/2] Deploying EVM contracts (ProofOfExistence + PredictionMarket)..."
	@cd $(EVM_DIR) && npm install --silent && npx hardhat compile --quiet && npx hardhat run scripts/deploy.ts --network paseoHub

.PHONY: deploy-paseo-pvm
deploy-paseo-pvm: check-key
	@echo "[2/2] Deploying PVM contract (ProofOfExistence)..."
	@cd $(PVM_DIR) && npm install --silent && npx hardhat compile --network paseoHub --quiet && npx hardhat run scripts/deploy.ts --network paseoHub

# ─── Paseo Asset Hub deploy (PAPI / Revive.instantiate_with_code) ─────────────
# Use this path when you want to deploy via a Substrate extrinsic (sr25519
# mnemonic) instead of the eth-rpc/secp256k1 flow above.

.PHONY: deploy-paseo-papi
deploy-paseo-papi:
	@echo "Deploying PredictionMarket to Paseo Asset Hub via PAPI..."
	@echo "  Mnemonic source: DEV_ACCOUNT_SEED > MNEMONIC > //Alice (fallback)."
	@echo "  Fund the derived sr25519 address at https://faucet.polkadot.io/ (Paseo Asset Hub)."
	@cd $(PVM_DIR) && npm install --silent && npx hardhat compile --network paseoHub --quiet && npx hardhat run scripts/deploy-paseo-hub.ts --network paseoHub
	@echo ""
	@echo "=== Paseo Asset Hub deployment complete ==="
	@cat $(ROOT_DIR)/deployments.json

# ─── Frontend deploy ──────────────────────────────────────────────────────────

DOMAIN ?=

.PHONY: deploy-frontend
deploy-frontend: build-frontend
	@echo "Deploying frontend via scripts/deploy-frontend.sh ..."
	@DOMAIN="$(DOMAIN)" $(ROOT_DIR)/scripts/deploy-frontend.sh

.PHONY: build-frontend
build-frontend:
	@echo "Building frontend..."
	@cd $(ROOT_DIR)/web && npm install --silent && npm run build
	@echo "  Build output: web/dist/"

# ─── Guards ───────────────────────────────────────────────────────────────────

.PHONY: check-key
check-key:
	@if [ -z "$(PRIVATE_KEY)" ]; then \
		echo "ERROR: PRIVATE_KEY not set."; \
		echo "Run: cd contracts/evm && npx hardhat vars set PRIVATE_KEY"; \
		echo "Or:  export PRIVATE_KEY=0x..."; \
		echo "Get testnet tokens at: https://faucet.polkadot.io/"; \
		exit 1; \
	fi
	@addr=$$(node -e " \
		try { \
			const {privateKeyToAccount}=require('$(EVM_DIR)/node_modules/viem/accounts'); \
			const k='$(PRIVATE_KEY)'; \
			const pk=k.startsWith('0x')?k:'0x'+k; \
			console.log(privateKeyToAccount(pk).address); \
		} catch(e) { console.log('(address lookup unavailable: run npm install in contracts/evm first)'); } \
	" 2>/dev/null); \
	echo "Deploying from: $$addr"
