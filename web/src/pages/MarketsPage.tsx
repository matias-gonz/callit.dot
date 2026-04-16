import { useCallback, useEffect, useMemo, useState } from "react";
import { type Address } from "viem";
import {
	predictionMarketAbi,
	marketStateLabels,
	evmDevAccounts,
	getPublicClient,
	getWalletClient,
} from "../config/evm";
import { deployments } from "../config/deployments";
import { useChainStore } from "../store/chainStore";

interface Market {
	id: bigint;
	creator: string;
	question: string;
	resolutionTimestamp: bigint;
	state: number;
}

const STORAGE_KEY = "prediction-market-address";

function toLocalDateTimeInput(date: Date): string {
	const pad = (n: number) => n.toString().padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultDeadline(): string {
	const d = new Date();
	d.setDate(d.getDate() + 7);
	d.setHours(12, 0, 0, 0);
	return toLocalDateTimeInput(d);
}

function formatRelative(unixSeconds: bigint): string {
	const nowMs = Date.now();
	const targetMs = Number(unixSeconds) * 1000;
	const deltaSec = Math.round((targetMs - nowMs) / 1000);
	const abs = Math.abs(deltaSec);
	const past = deltaSec < 0;
	let value: string;
	if (abs < 60) value = `${abs}s`;
	else if (abs < 3600) value = `${Math.round(abs / 60)}m`;
	else if (abs < 86_400) value = `${Math.round(abs / 3600)}h`;
	else value = `${Math.round(abs / 86_400)}d`;
	return past ? `${value} ago` : `in ${value}`;
}

function shortAddr(addr: string): string {
	return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function MarketsPage() {
	const ethRpcUrl = useChainStore((s) => s.ethRpcUrl);
	const scopedStorageKey = `${STORAGE_KEY}:${ethRpcUrl}`;
	const defaultAddress = deployments.evmPredictionMarket ?? undefined;

	const [contractAddress, setContractAddress] = useState("");
	const [selectedAccount, setSelectedAccount] = useState(0);
	const [question, setQuestion] = useState("");
	const [deadline, setDeadline] = useState(defaultDeadline());
	const [markets, setMarkets] = useState<Market[]>([]);
	const [txStatus, setTxStatus] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		setContractAddress(localStorage.getItem(scopedStorageKey) || defaultAddress || "");
	}, [defaultAddress, scopedStorageKey]);

	function saveAddress(address: string) {
		setContractAddress(address);
		if (address) {
			localStorage.setItem(scopedStorageKey, address);
		} else {
			localStorage.removeItem(scopedStorageKey);
		}
	}

	function missingContractMessage() {
		return [
			"Error: No PredictionMarket contract was found at this address on",
			`${ethRpcUrl}.`,
			"Deploy one with: cd contracts/evm && npm run deploy:local.",
		].join(" ");
	}

	const loadMarkets = useCallback(async () => {
		if (!contractAddress) {
			setTxStatus("Error: Enter a contract address first");
			return;
		}
		try {
			setLoading(true);
			setTxStatus(null);
			const client = getPublicClient(ethRpcUrl);
			const addr = contractAddress as Address;

			const code = await client.getCode({ address: addr });
			if (!code || code === "0x") {
				setMarkets([]);
				setTxStatus(missingContractMessage());
				return;
			}

			const count = (await client.readContract({
				address: addr,
				abi: predictionMarketAbi,
				functionName: "getMarketCount",
			})) as bigint;

			const result: Market[] = [];
			for (let i = 0n; i < count; i++) {
				const [creator, q, ts, state] = (await client.readContract({
					address: addr,
					abi: predictionMarketAbi,
					functionName: "getMarket",
					args: [i],
				})) as [string, string, bigint, number];
				result.push({ id: i, creator, question: q, resolutionTimestamp: ts, state });
			}
			result.reverse();
			setMarkets(result);
		} catch (e) {
			console.error("Failed to load markets:", e);
			setTxStatus(`Error: ${e instanceof Error ? e.message : e}`);
		} finally {
			setLoading(false);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [contractAddress, ethRpcUrl]);

	useEffect(() => {
		if (contractAddress) {
			loadMarkets();
		} else {
			setMarkets([]);
			setTxStatus(null);
		}
	}, [contractAddress, ethRpcUrl, loadMarkets]);

	async function createMarket() {
		if (!contractAddress) {
			setTxStatus("Error: Enter a contract address");
			return;
		}
		const trimmed = question.trim();
		if (!trimmed) {
			setTxStatus("Error: Enter a question");
			return;
		}
		const deadlineMs = new Date(deadline).getTime();
		if (Number.isNaN(deadlineMs)) {
			setTxStatus("Error: Invalid deadline");
			return;
		}
		const deadlineSec = BigInt(Math.floor(deadlineMs / 1000));
		const nowSec = BigInt(Math.floor(Date.now() / 1000));
		if (deadlineSec <= nowSec) {
			setTxStatus("Error: Deadline must be in the future");
			return;
		}

		try {
			const publicClient = getPublicClient(ethRpcUrl);
			const code = await publicClient.getCode({ address: contractAddress as Address });
			if (!code || code === "0x") {
				setTxStatus(missingContractMessage());
				return;
			}
			setTxStatus("Submitting createMarket...");
			const walletClient = await getWalletClient(selectedAccount, ethRpcUrl);
			const hash = await walletClient.writeContract({
				address: contractAddress as Address,
				abi: predictionMarketAbi,
				functionName: "createMarket",
				args: [trimmed, deadlineSec],
			});
			setTxStatus(`Transaction submitted: ${hash}`);
			await publicClient.waitForTransactionReceipt({ hash });
			setTxStatus("Market created!");
			setQuestion("");
			setDeadline(defaultDeadline());
			loadMarkets();
		} catch (e) {
			console.error("Transaction failed:", e);
			setTxStatus(`Error: ${e instanceof Error ? e.message : e}`);
		}
	}

	const currentAddress = evmDevAccounts[selectedAccount].account.address.toLowerCase();

	const stats = useMemo(() => {
		const open = markets.filter((m) => m.state === 0).length;
		const mine = markets.filter((m) => m.creator.toLowerCase() === currentAddress).length;
		return { total: markets.length, open, mine };
	}, [markets, currentAddress]);

	return (
		<div className="space-y-6 animate-fade-in">
			<div className="space-y-2">
				<h1 className="page-title text-accent-purple">Prediction Markets</h1>
				<p className="text-text-secondary">
					Create binary markets on the{" "}
					<code className="rounded border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 text-xs font-mono">
						PredictionMarket
					</code>{" "}
					contract. Anyone can call{" "}
					<code className="rounded border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 text-xs font-mono">
						createMarket
					</code>{" "}
					with a question and a resolution timestamp.
				</p>
			</div>

			<div className="card space-y-4">
				<div>
					<label className="label">Contract Address</label>
					<div className="flex gap-2">
						<input
							type="text"
							value={contractAddress}
							onChange={(e) => saveAddress(e.target.value)}
							placeholder="0x..."
							className="input-field w-full"
						/>
						{defaultAddress && contractAddress !== defaultAddress && (
							<button
								onClick={() => saveAddress(defaultAddress)}
								className="btn-secondary text-xs whitespace-nowrap"
							>
								Reset
							</button>
						)}
					</div>
				</div>

				<div>
					<label className="label">Dev Account</label>
					<select
						value={selectedAccount}
						onChange={(e) => setSelectedAccount(parseInt(e.target.value))}
						className="input-field w-full"
					>
						{evmDevAccounts.map((acc, i) => (
							<option key={i} value={i}>
								{acc.name} ({acc.account.address})
							</option>
						))}
					</select>
				</div>

				<div className="space-y-3">
					<div>
						<label className="label">Question</label>
						<input
							type="text"
							value={question}
							onChange={(e) => setQuestion(e.target.value)}
							placeholder="Will DOT reach $20 by July 1?"
							className="input-field w-full"
							maxLength={240}
						/>
					</div>
					<div>
						<label className="label">Resolution Deadline</label>
						<input
							type="datetime-local"
							value={deadline}
							onChange={(e) => setDeadline(e.target.value)}
							className="input-field w-full"
						/>
						<p className="text-xs text-text-muted mt-1.5">
							After this time anyone can propose an outcome by posting a bond.
						</p>
					</div>
					<button
						onClick={createMarket}
						className="btn-accent"
						style={{
							background: "linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)",
							boxShadow:
								"0 1px 2px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1)",
						}}
					>
						Create Market
					</button>
				</div>

				{txStatus && (
					<p
						className={`text-sm font-medium ${txStatus.startsWith("Error") ? "text-accent-red" : "text-accent-green"}`}
					>
						{txStatus}
					</p>
				)}
			</div>

			<div className="card space-y-4">
				<div className="flex items-center justify-between gap-3">
					<div>
						<h2 className="section-title">Markets</h2>
						<p className="text-xs text-text-tertiary mt-0.5">
							{stats.total} total · {stats.open} open · {stats.mine} yours
						</p>
					</div>
					<button
						onClick={loadMarkets}
						disabled={loading}
						className="btn-secondary text-xs"
					>
						{loading ? "Loading..." : "Refresh"}
					</button>
				</div>

				{markets.length === 0 ? (
					<p className="text-text-muted text-sm">No markets yet. Create one above.</p>
				) : (
					<div className="space-y-2">
						{markets.map((m) => {
							const mine = m.creator.toLowerCase() === currentAddress;
							const deadlineDate = new Date(Number(m.resolutionTimestamp) * 1000);
							const stateLabel = marketStateLabels[m.state] ?? `State ${m.state}`;
							const past = deadlineDate.getTime() <= Date.now();
							return (
								<div
									key={m.id.toString()}
									className="rounded-lg border border-white/[0.04] bg-white/[0.02] p-3 text-sm space-y-1.5"
								>
									<div className="flex items-start justify-between gap-3">
										<p className="text-text-primary font-medium">
											{m.question}
										</p>
										<span className="text-xs font-mono text-text-tertiary shrink-0">
											#{m.id.toString()}
										</span>
									</div>
									<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-tertiary">
										<span
											className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 ${
												m.state === 0
													? "bg-accent-green/10 text-accent-green"
													: "bg-white/[0.04] text-text-secondary"
											}`}
										>
											{stateLabel}
										</span>
										<span>
											Creator:{" "}
											<span className="text-text-secondary font-mono">
												{shortAddr(m.creator)}
											</span>
											{mine && (
												<span className="ml-1 text-accent-purple">
													(you)
												</span>
											)}
										</span>
										<span className={past ? "text-accent-yellow" : undefined}>
											Resolves {formatRelative(m.resolutionTimestamp)} (
											{deadlineDate.toLocaleString()})
										</span>
									</div>
								</div>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}
