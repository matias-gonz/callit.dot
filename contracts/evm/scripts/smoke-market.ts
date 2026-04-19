import {
	createPublicClient,
	createWalletClient,
	http,
	defineChain,
	parseEventLogs,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { networkKeyForChainId, readDeployments } from "./deployments";

const ETH_RPC = process.env.ETH_RPC_HTTP || "http://127.0.0.1:8545";

const ALICE = privateKeyToAccount(
	"0x5fb92d6e98884f76de468fa3f6278f8807c48bebc13595d45af5bdc4da702133",
);

const abi = [
	{
		type: "function",
		name: "createMarket",
		inputs: [
			{ name: "question", type: "string" },
			{ name: "resolutionTimestamp", type: "uint256" },
		],
		outputs: [{ name: "marketId", type: "uint256" }],
		stateMutability: "nonpayable",
	},
	{
		type: "function",
		name: "getMarket",
		inputs: [{ name: "marketId", type: "uint256" }],
		outputs: [
			{ name: "creator", type: "address" },
			{ name: "question", type: "string" },
			{ name: "resolutionTimestamp", type: "uint256" },
			{ name: "state", type: "uint8" },
		],
		stateMutability: "view",
	},
	{
		type: "function",
		name: "getMarketCount",
		inputs: [],
		outputs: [{ name: "", type: "uint256" }],
		stateMutability: "view",
	},
	{
		type: "event",
		name: "MarketCreated",
		inputs: [
			{ name: "marketId", type: "uint256", indexed: true },
			{ name: "creator", type: "address", indexed: true },
			{ name: "question", type: "string", indexed: false },
			{ name: "resolutionTimestamp", type: "uint256", indexed: false },
		],
		anonymous: false,
	},
] as const;

async function main() {
	const publicClient = createPublicClient({ transport: http(ETH_RPC) });
	const chainId = await publicClient.getChainId();

	const networkKey = networkKeyForChainId(chainId);
	if (!networkKey) {
		throw new Error(
			`Unknown chainId ${chainId}. Expected 420420421 (local) or 420420417 (Paseo).`,
		);
	}
	const slot = readDeployments()[networkKey];
	if (!slot.evmPredictionMarket) {
		throw new Error(
			`deployments.${networkKey}.evmPredictionMarket is empty. Deploy first (npm run deploy:local / make deploy-paseo).`,
		);
	}
	const address = slot.evmPredictionMarket as `0x${string}`;
	const chain = defineChain({
		id: chainId,
		name: "Local",
		nativeCurrency: { name: "Unit", symbol: "UNIT", decimals: 18 },
		rpcUrls: { default: { http: [ETH_RPC] } },
	});
	const wallet = createWalletClient({ account: ALICE, chain, transport: http(ETH_RPC) });

	const code = await publicClient.getCode({ address });
	if (!code || code === "0x") throw new Error(`No contract code at ${address}`);
	console.log(`Contract present at ${address} (chainId ${chainId})`);

	const before = (await publicClient.readContract({
		address,
		abi,
		functionName: "getMarketCount",
	})) as bigint;
	console.log(`Markets before: ${before}`);

	const question = `smoke-test market @ ${new Date().toISOString()}`;
	const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
	console.log(`Creating market: "${question}" deadline ${deadline}`);

	const hash = await wallet.writeContract({
		address,
		abi,
		functionName: "createMarket",
		args: [question, deadline],
	});
	console.log(`tx: ${hash}`);
	const receipt = await publicClient.waitForTransactionReceipt({ hash });
	console.log(`mined in block ${receipt.blockNumber}, status=${receipt.status}`);

	const logs = parseEventLogs({
		abi,
		logs: receipt.logs,
		eventName: "MarketCreated",
	});
	if (logs.length !== 1) throw new Error(`Expected 1 MarketCreated log, got ${logs.length}`);
	const args = logs[0].args as unknown as {
		marketId: bigint;
		creator: string;
		question: string;
		resolutionTimestamp: bigint;
	};
	console.log(
		`MarketCreated: id=${args.marketId} creator=${args.creator} q="${args.question}" deadline=${args.resolutionTimestamp}`,
	);
	if (args.creator.toLowerCase() !== ALICE.address.toLowerCase())
		throw new Error(`creator mismatch: ${args.creator} != ${ALICE.address}`);
	if (args.question !== question) throw new Error(`question mismatch`);
	if (args.resolutionTimestamp !== deadline) throw new Error(`deadline mismatch`);

	const after = (await publicClient.readContract({
		address,
		abi,
		functionName: "getMarketCount",
	})) as bigint;
	console.log(`Markets after: ${after}`);
	if (after !== before + 1n) throw new Error(`count did not increment`);

	const [creator, storedQ, storedTs, state] = (await publicClient.readContract({
		address,
		abi,
		functionName: "getMarket",
		args: [args.marketId],
	})) as [string, string, bigint, number];
	console.log(`getMarket(${args.marketId}): creator=${creator} q="${storedQ}" ts=${storedTs} state=${state}`);
	if (creator.toLowerCase() !== ALICE.address.toLowerCase())
		throw new Error(`stored creator mismatch`);
	if (storedQ !== question) throw new Error(`stored question mismatch`);
	if (storedTs !== deadline) throw new Error(`stored ts mismatch`);
	if (state !== 0) throw new Error(`expected Open state (0), got ${state}`);

	console.log("\nSMOKE OK: end-to-end frontend ABI round-trips against live contract.");
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
