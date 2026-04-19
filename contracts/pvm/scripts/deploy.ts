import hre from "hardhat";
import {
	createPublicClient,
	createWalletClient,
	defineChain,
	http,
	type PublicClient,
	type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
	networkKeyForChainId,
	readDeployments,
	updateContract,
	writeDeployments,
} from "./deployments";

async function buildClients(): Promise<{
	walletClient: WalletClient;
	publicClient: PublicClient;
	deployerAddress: `0x${string}`;
}> {
	const netCfg = hre.network.config as { url?: string; accounts?: unknown };
	const url =
		typeof netCfg.url === "string" ? netCfg.url : process.env.ETH_RPC_HTTP || "";
	if (!url) {
		throw new Error(
			`No RPC URL for network '${hre.network.name}'. Configure it in hardhat.config.ts.`,
		);
	}

	let privateKey: string | undefined;
	if (Array.isArray(netCfg.accounts) && netCfg.accounts.length > 0) {
		privateKey = String(netCfg.accounts[0]);
	} else if (process.env.PRIVATE_KEY) {
		privateKey = process.env.PRIVATE_KEY;
	}
	if (!privateKey) {
		throw new Error(
			`No signer available for network '${hre.network.name}'. Set PRIVATE_KEY (env or .env) or configure accounts in hardhat.config.ts.`,
		);
	}
	const pkHex = (privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`) as `0x${string}`;
	const account = privateKeyToAccount(pkHex);

	const probeClient = createPublicClient({ transport: http(url) });
	const chainId = await probeClient.getChainId();

	const chain = defineChain({
		id: chainId,
		name: hre.network.name,
		nativeCurrency: { name: "Unit", symbol: "UNIT", decimals: 18 },
		rpcUrls: { default: { http: [url] } },
	});

	const publicClient = createPublicClient({ chain, transport: http(url) }) as PublicClient;
	const walletClient = createWalletClient({
		account,
		chain,
		transport: http(url),
	}) as WalletClient;

	return { walletClient, publicClient, deployerAddress: account.address };
}

async function main() {
	const { walletClient, publicClient, deployerAddress } = await buildClients();
	const chainId = await publicClient.getChainId();
	const networkKey = networkKeyForChainId(chainId);

	console.log(`Network: ${hre.network.name} (chainId ${chainId})`);
	console.log(`Deployer: ${deployerAddress}`);
	console.log(`Writing to deployments.${networkKey}`);

	console.log("Deploying ProofOfExistence (PVM/resolc)...");
	const artifact = await hre.artifacts.readArtifact("ProofOfExistence");

	const hash = await walletClient.deployContract({
		account: walletClient.account!,
		chain: walletClient.chain,
		abi: artifact.abi,
		bytecode: artifact.bytecode as `0x${string}`,
	});

	const receipt = await publicClient.waitForTransactionReceipt({
		hash,
		timeout: 120_000,
	});

	if (!receipt.contractAddress) {
		throw new Error(`Deploy tx ${hash} did not create a contract`);
	}

	console.log(`  → ${receipt.contractAddress}`);

	let data = readDeployments();
	data = updateContract(data, networkKey, "pvm", receipt.contractAddress);
	writeDeployments(data);
	console.log("Updated deployments.json");
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
