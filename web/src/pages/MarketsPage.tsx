import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient, type PolkadotClient, type PolkadotSigner, type TxEvent } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws-provider/web";
import { withPolkadotSdkCompat } from "polkadot-api/polkadot-sdk-compat";
import { callit, paseoHub } from "@polkadot-api/descriptors";
import type { ReviveSdkTypedApi } from "@polkadot-api/sdk-ink";
import {
	createPredictionMarketContract,
	mapAccount,
	type RawMarket,
} from "../lib/predictionMarketContract";
import { sr25519DevAccounts } from "../lib/devSigners";
import { setupHostProvider, isInsideHost, type HostProviderResult } from "../lib/hostProvider";
import { deployments } from "../config/deployments";

type MarketsNetworkKey = "local" | "paseoHub";

interface NetworkDef {
	label: string;
	wsUrl: string;
	descriptor: typeof callit | typeof paseoHub;
	genesis?: `0x${string}`;
	ss58Prefix: number;
	deployKey: "local" | "paseoHub";
}

const NETWORKS: Record<MarketsNetworkKey, NetworkDef> = {
	local: {
		label: "Local Dev",
		wsUrl: "ws://127.0.0.1:9944",
		descriptor: callit,
		ss58Prefix: 42,
		deployKey: "local",
	},
	paseoHub: {
		label: "Paseo Asset Hub",
		wsUrl: "wss://asset-hub-paseo-rpc.n.dwellir.com",
		descriptor: paseoHub,
		genesis: "0xd6eec26135305a8ad257a20d003357284c8aa03d0bdb2b357ab0a22371e11ef2",
		ss58Prefix: 0,
		deployKey: "paseoHub",
	},
};

type AccountKind = "host" | "alice" | "bob" | "charlie";

const DEV_ACCOUNT_INDEX: Record<Exclude<AccountKind, "host">, number> = {
	alice: 0,
	bob: 1,
	charlie: 2,
};

const MARKET_STATE_LABELS = ["Open", "Resolving", "Proposed", "Disputed", "Finalized"] as const;

const STORAGE_KEY = "prediction-market-address";
const NETWORK_STORAGE_KEY = "markets-network";
const ACCOUNT_STORAGE_KEY = "markets-account";

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
	if (addr.length <= 14) return addr;
	return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function loadStoredNetwork(): MarketsNetworkKey {
	const stored = typeof localStorage !== "undefined" ? localStorage.getItem(NETWORK_STORAGE_KEY) : null;
	if (stored === "local" || stored === "paseoHub") return stored;
	return "paseoHub";
}

function loadStoredAccount(): AccountKind {
	const stored = typeof localStorage !== "undefined" ? localStorage.getItem(ACCOUNT_STORAGE_KEY) : null;
	if (stored === "host" || stored === "alice" || stored === "bob" || stored === "charlie") return stored;
	return "host";
}

interface LogEntry {
	id: number;
	ts: string;
	text: string;
	level: "info" | "ok" | "err" | "finalized";
}

function levelClass(level: LogEntry["level"]): string {
	switch (level) {
		case "ok":
			return "text-accent-green";
		case "err":
			return "text-accent-red";
		case "finalized":
			return "text-accent-blue";
		default:
			return "text-text-secondary";
	}
}

export default function MarketsPage() {
	const [network, setNetwork] = useState<MarketsNetworkKey>(loadStoredNetwork);
	const [accountKind, setAccountKind] = useState<AccountKind>(loadStoredAccount);

	const networkDef = NETWORKS[network];
	const scopedStorageKey = `${STORAGE_KEY}:${network}`;
	const defaultAddress = deployments[networkDef.deployKey].evmPredictionMarket ?? undefined;

	const [contractAddress, setContractAddress] = useState("");
	const [question, setQuestion] = useState("");
	const [deadline, setDeadline] = useState(defaultDeadline());
	const [markets, setMarkets] = useState<RawMarket[]>([]);
	const [loading, setLoading] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [log, setLog] = useState<LogEntry[]>([]);
	const logIdRef = useRef(0);

	const [hostProvider, setHostProvider] = useState<HostProviderResult | null>(null);
	const [hostAddress, setHostAddress] = useState<string | null>(null);
	const [hostReady, setHostReady] = useState(false);
	const [hostError, setHostError] = useState<string | null>(null);

	const clientRef = useRef<PolkadotClient | null>(null);
	const [clientGen, setClientGen] = useState(0);

	const hostAvailable = useMemo(() => isInsideHost(), []);

	function pushLog(text: string, level: LogEntry["level"] = "info") {
		logIdRef.current += 1;
		const ts = new Date().toLocaleTimeString();
		setLog((prev) => [...prev, { id: logIdRef.current, ts, text, level }].slice(-50));
	}

	useEffect(() => {
		localStorage.setItem(NETWORK_STORAGE_KEY, network);
	}, [network]);

	useEffect(() => {
		localStorage.setItem(ACCOUNT_STORAGE_KEY, accountKind);
	}, [accountKind]);

	useEffect(() => {
		setContractAddress(localStorage.getItem(scopedStorageKey) || defaultAddress || "");
	}, [defaultAddress, scopedStorageKey]);

	useEffect(() => {
		let cancelled = false;

		async function setup() {
			if (clientRef.current) {
				try {
					clientRef.current.destroy();
				} catch {
					/* ignore */
				}
				clientRef.current = null;
			}
			setHostProvider(null);
			setHostAddress(null);
			setHostReady(false);
			setHostError(null);

			const useHost = network === "paseoHub" && accountKind === "host";

			try {
				if (useHost) {
					if (!networkDef.genesis) {
						throw new Error("Host API needs a genesis hash");
					}
					const provider = await setupHostProvider({
						genesis: networkDef.genesis,
						ss58Prefix: networkDef.ss58Prefix,
					});
					if (cancelled) {
						try {
							provider.client.destroy();
						} catch {
							/* ignore */
						}
						return;
					}
					clientRef.current = provider.client;
					setHostProvider(provider);
					provider.subscribeAccounts((accts) => {
						if (cancelled) return;
						const first = accts[0];
						setHostAddress(first ? first.address : null);
						setHostReady(!!first);
					});
					pushLog(`Connected to ${networkDef.label} via Host API`, "ok");
				} else {
					const client = createClient(withPolkadotSdkCompat(getWsProvider(networkDef.wsUrl)));
					if (cancelled) {
						try {
							client.destroy();
						} catch {
							/* ignore */
						}
						return;
					}
					clientRef.current = client;
					pushLog(`Connected to ${networkDef.label} (${networkDef.wsUrl})`, "ok");
				}
				if (!cancelled) setClientGen((g) => g + 1);
			} catch (e) {
				if (cancelled) return;
				const msg = e instanceof Error ? e.message : String(e);
				setHostError(msg);
				pushLog(`Connection failed: ${msg}`, "err");
			}
		}

		setup();

		return () => {
			cancelled = true;
			if (clientRef.current) {
				try {
					clientRef.current.destroy();
				} catch {
					/* ignore */
				}
				clientRef.current = null;
			}
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [network, accountKind]);

	function saveAddress(address: string) {
		setContractAddress(address);
		if (address) {
			localStorage.setItem(scopedStorageKey, address);
		} else {
			localStorage.removeItem(scopedStorageKey);
		}
	}

	const loadMarkets = useCallback(async () => {
		if (!contractAddress) {
			pushLog("Enter a contract address to load markets", "err");
			return;
		}
		if (!clientRef.current) {
			pushLog("Chain client not ready yet", "err");
			return;
		}
		setLoading(true);
		try {
			const typedApi = clientRef.current.getTypedApi(
				networkDef.descriptor,
			) as unknown as ReviveSdkTypedApi;
			const api = createPredictionMarketContract(typedApi, contractAddress);
			const count = await api.getMarketCount();
			const result: RawMarket[] = [];
			for (let i = 0n; i < count; i++) {
				result.push(await api.getMarket(i));
			}
			result.reverse();
			setMarkets(result);
			pushLog(`Loaded ${result.length} market${result.length === 1 ? "" : "s"}`, "ok");
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			pushLog(`Failed to load markets: ${msg}`, "err");
			setMarkets([]);
		} finally {
			setLoading(false);
		}
	}, [contractAddress, networkDef.descriptor]);

	useEffect(() => {
		if (clientGen > 0 && contractAddress) {
			loadMarkets();
		} else if (!contractAddress) {
			setMarkets([]);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [clientGen, contractAddress]);

	async function resolveSigner(): Promise<{ signer: PolkadotSigner; origin: string } | null> {
		if (accountKind === "host") {
			if (!hostProvider) {
				pushLog("Host API provider is not ready — open this app inside paseo.li", "err");
				return null;
			}
			const signer = hostProvider.getSigner();
			const origin = hostProvider.getAddress();
			if (!signer || !origin) {
				pushLog("No account paired in host yet — open your Polkadot App", "err");
				return null;
			}
			pushLog("Sending sign request to your Polkadot App via the host…");
			return { signer, origin };
		}

		const dev = sr25519DevAccounts[DEV_ACCOUNT_INDEX[accountKind]];
		return { signer: dev.signer, origin: dev.address };
	}

	function watchTx(
		obs: {
			subscribe: (o: {
				next: (ev: unknown) => void;
				error: (e: unknown) => void;
			}) => { unsubscribe: () => void };
		},
		label: string,
	): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			let settled = false;
			const sub = obs.subscribe({
				next: (raw: unknown) => {
					const ev = raw as TxEvent;
					switch (ev.type) {
						case "signed":
							pushLog(`${label}: signed ${ev.txHash.slice(0, 18)}…`);
							break;
						case "broadcasted":
							pushLog(`${label}: broadcasted`);
							break;
						case "txBestBlocksState":
							if (ev.found) {
								pushLog(`${label}: in best block #${ev.block.number}`, "ok");
								if (!settled) {
									settled = true;
									sub.unsubscribe();
									resolve();
								}
							}
							break;
						case "finalized":
							if (!settled) {
								settled = true;
								if (ev.ok) {
									pushLog(`${label}: finalized #${ev.block.number}`, "finalized");
									resolve();
								} else {
									pushLog(`${label}: failed ${ev.dispatchError.type}`, "err");
									reject(new Error(`${label} failed: ${ev.dispatchError.type}`));
								}
							}
							break;
					}
				},
				error: (err) => {
					sub.unsubscribe();
					reject(err);
				},
			});
		});
	}

	async function createMarket() {
		if (!contractAddress) {
			pushLog("Enter a contract address", "err");
			return;
		}
		const trimmed = question.trim();
		if (!trimmed) {
			pushLog("Enter a question", "err");
			return;
		}
		const deadlineMs = new Date(deadline).getTime();
		if (Number.isNaN(deadlineMs)) {
			pushLog("Invalid deadline", "err");
			return;
		}
		const deadlineSec = BigInt(Math.floor(deadlineMs / 1000));
		const nowSec = BigInt(Math.floor(Date.now() / 1000));
		if (deadlineSec <= nowSec) {
			pushLog("Deadline must be in the future", "err");
			return;
		}
		if (!clientRef.current) {
			pushLog("Chain client not ready", "err");
			return;
		}

		const resolved = await resolveSigner();
		if (!resolved) return;

		setSubmitting(true);
		try {
			const typedApi = clientRef.current.getTypedApi(
				networkDef.descriptor,
			) as unknown as ReviveSdkTypedApi;
			const api = createPredictionMarketContract(typedApi, contractAddress);

			const mapped = await api.isAddressMapped(resolved.origin);
			if (!mapped) {
				pushLog(`Account ${shortAddr(resolved.origin)} is not mapped — submitting Revive.map_account…`);
				const mapObs = mapAccount(typedApi, resolved.signer);
				await watchTx(mapObs, "map_account");
				pushLog("Account mapped", "ok");
			}

			pushLog(`Dry-running createMarket as ${shortAddr(resolved.origin)}…`);
			const obs = await api.createMarket(
				trimmed,
				deadlineSec,
				resolved.origin,
				resolved.signer,
			);

			await watchTx(obs, "createMarket");

			pushLog("Market created", "ok");
			setQuestion("");
			setDeadline(defaultDeadline());
			await loadMarkets();
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			pushLog(`createMarket failed: ${msg}`, "err");
		} finally {
			setSubmitting(false);
		}
	}

	const activeOrigin = useMemo(() => {
		if (accountKind === "host") return hostAddress ?? null;
		return sr25519DevAccounts[DEV_ACCOUNT_INDEX[accountKind]].address;
	}, [accountKind, hostAddress]);

	const stats = useMemo(() => {
		const origin = activeOrigin?.toLowerCase() ?? "";
		const open = markets.filter((m) => m.state === 0).length;
		const mine = origin
			? markets.filter((m) => m.creator.toLowerCase() === origin).length
			: 0;
		return { total: markets.length, open, mine };
	}, [markets, activeOrigin]);

	return (
		<div className="space-y-6 animate-fade-in">
			<div className="space-y-2">
				<h1 className="page-title text-accent-purple">Prediction Markets</h1>
				<p className="text-text-secondary">
					Create binary markets on the{" "}
					<code className="rounded border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 text-xs font-mono">
						PredictionMarket
					</code>{" "}
					contract through pallet-revive. Sign with the host-paired account (Polkadot App
					on paseo.li) or with one of the sr25519 dev accounts for testing.
				</p>
			</div>

			<div className="card space-y-4">
				<div>
					<label className="label">Network</label>
					<div className="flex flex-wrap gap-2">
						{(Object.keys(NETWORKS) as MarketsNetworkKey[]).map((key) => {
							const active = network === key;
							return (
								<button
									key={key}
									onClick={() => setNetwork(key)}
									className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
										active
											? "border-accent-purple/40 bg-accent-purple/15 text-accent-purple"
											: "border-white/[0.08] bg-white/[0.02] text-text-secondary hover:border-white/[0.15] hover:text-text-primary"
									}`}
								>
									{NETWORKS[key].label}
								</button>
							);
						})}
					</div>
					<p className="text-xs text-text-muted mt-1.5">
						Connecting via{" "}
						<code className="font-mono">
							{accountKind === "host" && network === "paseoHub"
								? `Host API (${networkDef.genesis?.slice(0, 10)}…)`
								: networkDef.wsUrl}
						</code>
					</p>
				</div>

				<div>
					<label className="label">Signing account</label>
					<div className="flex flex-wrap gap-2">
						{(
							[
								{ key: "host" as const, label: "My account (Host)" },
								{ key: "alice" as const, label: "Alice (dev)" },
								{ key: "bob" as const, label: "Bob (dev)" },
								{ key: "charlie" as const, label: "Charlie (dev)" },
							]
						).map(({ key, label }) => {
							const disabled = key === "host" && network === "local";
							const active = accountKind === key;
							return (
								<button
									key={key}
									disabled={disabled}
									onClick={() => setAccountKind(key)}
									title={disabled ? "Host API only works on Paseo Asset Hub" : undefined}
									className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
										disabled
											? "border-white/[0.04] bg-white/[0.01] text-text-muted cursor-not-allowed"
											: active
												? "border-accent-purple/40 bg-accent-purple/15 text-accent-purple"
												: "border-white/[0.08] bg-white/[0.02] text-text-secondary hover:border-white/[0.15] hover:text-text-primary"
									}`}
								>
									{label}
								</button>
							);
						})}
					</div>
					{accountKind === "host" && network === "paseoHub" && (
						<p className="text-xs text-text-muted mt-1.5">
							{hostError
								? `Host API error: ${hostError}`
								: hostReady && hostAddress
									? `Host account: ${shortAddr(hostAddress)}`
									: hostAvailable
										? "Waiting for the host to pair your Polkadot App…"
										: "Running outside a host — open this app inside paseo.li to use the Host account, or pick a dev account for testing."}
						</p>
					)}
					{accountKind !== "host" && (
						<p className="text-xs text-text-muted mt-1.5">
							Signing as{" "}
							<code className="font-mono">
								{sr25519DevAccounts[DEV_ACCOUNT_INDEX[accountKind]].address}
							</code>
						</p>
					)}
				</div>

				<div>
					<label className="label">Contract Address</label>
					<div className="flex gap-2">
						<input
							type="text"
							value={contractAddress}
							onChange={(e) => saveAddress(e.target.value)}
							placeholder="0x…"
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
					{!defaultAddress && (
						<p className="text-xs text-accent-yellow mt-1.5">
							No {networkDef.label} deployment recorded. Deploy with{" "}
							<code className="font-mono">
								{network === "local"
									? "cd contracts/evm && npm run deploy:local"
									: "make deploy-paseo-hub"}
							</code>
							.
						</p>
					)}
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
						disabled={submitting}
						className="btn-accent"
						style={{
							background: "linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)",
							boxShadow:
								"0 1px 2px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1)",
						}}
					>
						{submitting ? "Submitting…" : "Create Market"}
					</button>
				</div>
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
						{loading ? "Loading…" : "Refresh"}
					</button>
				</div>

				{markets.length === 0 ? (
					<p className="text-text-muted text-sm">No markets yet. Create one above.</p>
				) : (
					<div className="space-y-2">
						{markets.map((m) => {
							const mine =
								activeOrigin &&
								m.creator.toLowerCase() === activeOrigin.toLowerCase();
							const deadlineDate = new Date(Number(m.resolutionTimestamp) * 1000);
							const stateLabel = MARKET_STATE_LABELS[m.state] ?? `State ${m.state}`;
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

			<div className="card space-y-2">
				<h2 className="section-title">Transaction log</h2>
				{log.length === 0 ? (
					<p className="text-text-muted text-xs">No events yet.</p>
				) : (
					<div className="space-y-1 text-xs font-mono max-h-64 overflow-y-auto">
						{log.map((entry) => (
							<div key={entry.id} className={levelClass(entry.level)}>
								<span className="text-text-muted">[{entry.ts}]</span> {entry.text}
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
