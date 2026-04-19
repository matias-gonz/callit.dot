import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-viem";
import "@parity/hardhat-polkadot";
import { vars } from "hardhat/config";
import * as fs from "fs";
import * as path from "path";

const rootEnv = path.resolve(__dirname, "../../.env");
if (fs.existsSync(rootEnv)) {
	for (const line of fs.readFileSync(rootEnv, "utf8").split(/\r?\n/)) {
		const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
		if (!m || line.trim().startsWith("#")) continue;
		if (!(m[1] in process.env)) {
			process.env[m[1]] = m[2].replace(/^['"](.*)['"]$/, "$1");
		}
	}
}

const config: HardhatUserConfig = {
	solidity: "0.8.28",
	resolc: {
		version: "1.0.0",
	},
	networks: {
		local: {
			url: process.env.ETH_RPC_HTTP || "http://127.0.0.1:8545",
			accounts: [
				"0x5fb92d6e98884f76de468fa3f6278f8807c48bebc13595d45af5bdc4da702133",
			],
		},
		polkadotTestnet: {
			url: "https://services.polkadothub-rpc.com/testnet",
			chainId: 420420417,
			accounts: [process.env.PRIVATE_KEY || vars.get("PRIVATE_KEY", "")].filter(Boolean),
		},
		paseoHub: {
			url: process.env.PASEO_HUB_ETH_RPC || "https://eth-rpc-testnet.polkadot.io/",
			polkadot: true,
			accounts: [process.env.PRIVATE_KEY || vars.get("PRIVATE_KEY", "")].filter(Boolean),
		},
	},
};

export default config;
