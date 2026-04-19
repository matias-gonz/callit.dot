import * as fs from "node:fs";
import * as path from "node:path";
import hre from "hardhat";
import { createClient, Binary } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws-provider/node";
import { withPolkadotSdkCompat } from "polkadot-api/polkadot-sdk-compat";
import { getPolkadotSigner } from "polkadot-api/signer";
import { sr25519CreateDerive } from "@polkadot-labs/hdkd";
import {
	DEV_PHRASE,
	entropyToMiniSecret,
	mnemonicToEntropy,
} from "@polkadot-labs/hdkd-helpers";
import { readDeployments, updateContract, writeDeployments } from "./deployments";

const PASEO_HUB_WS =
	process.env.PASEO_HUB_WS || "wss://asset-hub-paseo-rpc.n.dwellir.com";

function loadRootEnv() {
	const rootEnv = path.resolve(__dirname, "../../../.env");
	if (!fs.existsSync(rootEnv)) return;
	for (const line of fs.readFileSync(rootEnv, "utf8").split(/\r?\n/)) {
		if (line.trim().startsWith("#")) continue;
		const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
		if (!m) continue;
		if (!(m[1] in process.env)) {
			process.env[m[1]] = m[2].replace(/^['"](.*)['"]$/, "$1");
		}
	}
}

async function main() {
	loadRootEnv();

	const mnemonic =
		process.env.DEV_ACCOUNT_SEED || process.env.MNEMONIC || DEV_PHRASE;
	if (!mnemonic) {
		throw new Error(
			"No mnemonic. Set DEV_ACCOUNT_SEED or MNEMONIC in .env (or rely on the dev seed).",
		);
	}
	if (mnemonic === DEV_PHRASE) {
		console.warn(
			"Warning: using the public dev mnemonic (//Alice). This only works on dev chains.",
		);
	}

	const entropy = mnemonicToEntropy(mnemonic);
	const miniSecret = entropyToMiniSecret(entropy);
	const derive = sr25519CreateDerive(miniSecret);
	const keypair = derive("");
	const signer = getPolkadotSigner(keypair.publicKey, "Sr25519", keypair.sign);

	console.log(`Connecting to ${PASEO_HUB_WS}...`);
	const client = createClient(withPolkadotSdkCompat(getWsProvider(PASEO_HUB_WS)));
	const api = client.getUnsafeApi();

	console.log("Ensuring account is mapped (Revive.map_account)...");
	try {
		await api.tx.Revive.map_account().signAndSubmit(signer);
		console.log("Account mapped.");
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		if (/AlreadyMapped|already mapped/i.test(msg)) {
			console.log("Account already mapped.");
		} else {
			throw err;
		}
	}

	console.log("Compiling PredictionMarket (PVM/resolc)...");
	await hre.run("compile");
	const artifact = await hre.artifacts.readArtifact("PredictionMarket");
	const bytecodeHex = artifact.bytecode as `0x${string}`;
	if (!bytecodeHex || bytecodeHex === "0x") {
		throw new Error(
			"PredictionMarket has no bytecode. Did resolc compile it into contracts/pvm/artifacts?",
		);
	}
	console.log(`Bytecode size: ${(bytecodeHex.length - 2) / 2} bytes`);
	const code = Binary.fromHex(bytecodeHex);

	console.log("Deploying PredictionMarket via Revive.instantiate_with_code...");
	const result = await api.tx.Revive.instantiate_with_code({
		value: 0n,
		weight_limit: { ref_time: 500_000_000_000n, proof_size: 500_000n },
		storage_deposit_limit: 10_000_000_000_000n,
		code,
		data: Binary.fromHex("0x"),
		salt: undefined,
	}).signAndSubmit(signer);

	if (!result.ok) {
		console.error("Deployment failed:", JSON.stringify(result.dispatchError));
		client.destroy();
		process.exit(1);
	}

	console.log("Tx hash:", result.txHash);
	console.log("Block:", result.block.hash, "#", result.block.number);

	let contractAddress: string | null = null;
	for (const event of result.events) {
		if (event.type === "Revive" && event.value?.type === "Instantiated") {
			const payload = event.value.value as Record<string, unknown> | undefined;
			const addr = payload?.contract ?? payload?.Contract;
			if (addr) {
				contractAddress =
					typeof addr === "string"
						? addr
						: typeof (addr as { asHex?: () => string }).asHex === "function"
							? (addr as { asHex: () => string }).asHex()
							: "0x" +
								Array.from(new Uint8Array(addr as ArrayBufferLike))
									.map((b) => b.toString(16).padStart(2, "0"))
									.join("");
				break;
			}
		}
	}

	if (!contractAddress) {
		for (const event of result.events) {
			console.log(
				"Event:",
				JSON.stringify(event, (_, v) =>
					typeof v === "bigint"
						? v.toString()
						: typeof v?.asHex === "function"
							? v.asHex()
							: v,
				),
			);
		}
		client.destroy();
		throw new Error("Could not find Instantiated event in deploy result.");
	}

	console.log(`\nPredictionMarket deployed: ${contractAddress}`);

	let data = readDeployments();
	data = updateContract(data, "paseoHub", "evmPredictionMarket", contractAddress);
	writeDeployments(data);
	console.log("Updated deployments.paseoHub.evmPredictionMarket");

	client.destroy();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
