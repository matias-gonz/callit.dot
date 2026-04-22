import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createClient, type PolkadotClient, type PolkadotSigner, type TxEvent } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws-provider/web";
import { withPolkadotSdkCompat } from "polkadot-api/polkadot-sdk-compat";
import { callit, paseoHub } from "@polkadot-api/descriptors";
import type { ReviveSdkTypedApi } from "@polkadot-api/sdk-ink";
import { formatEther, parseEther } from "viem";
import {
	createPredictionMarketContract,
	mapAccount,
	type RawMarket,
	type UserPosition,
} from "../lib/predictionMarketContract";
import { sr25519DevAccounts } from "../lib/devSigners";
import { setupHostProvider, isInsideHost, type HostProviderResult } from "../lib/hostProvider";
import { deployments } from "../config/deployments";
import { useUiStore } from "../store/uiStore";

type MarketsNetworkKey = "local" | "paseoHub";

interface NetworkDef {
	label: string;
	wsUrl: string;
	descriptor: typeof callit | typeof paseoHub;
	genesis?: `0x${string}`;
	ss58Prefix: number;
	deployKey: "local" | "paseoHub";
	symbol: string;
}

const NETWORKS: Record<MarketsNetworkKey, NetworkDef> = {
	local: {
		label: "Local Dev",
		wsUrl: "ws://127.0.0.1:9944",
		descriptor: callit,
		ss58Prefix: 42,
		deployKey: "local",
		symbol: "UNIT",
	},
	paseoHub: {
		label: "Paseo Asset Hub",
		wsUrl: "wss://asset-hub-paseo-rpc.n.dwellir.com",
		descriptor: paseoHub,
		genesis: "0xd6eec26135305a8ad257a20d003357284c8aa03d0bdb2b357ab0a22371e11ef2",
		ss58Prefix: 0,
		deployKey: "paseoHub",
		symbol: "PAS",
	},
};

type AccountKind = "host" | "alice" | "bob" | "charlie";
type ContractKind = "evm" | "pvm";

const DEV_ACCOUNT_INDEX: Record<Exclude<AccountKind, "host">, number> = {
	alice: 0,
	bob: 1,
	charlie: 2,
};

const MARKET_STATE_LABELS = ["Open", "Resolving", "Proposed", "Disputed", "Finalized"] as const;

const STORAGE_KEY = "prediction-market-address";
const NETWORK_STORAGE_KEY = "markets-network";
const ACCOUNT_STORAGE_KEY = "markets-account";
const CONTRACT_KIND_STORAGE_KEY = "markets-contract-kind";

const CONTRACT_KIND_LABELS: Record<ContractKind, string> = {
	evm: "EVM (solc)",
	pvm: "PVM (resolc)",
};

const CONTRACT_KIND_DEPLOY_KEY: Record<
	ContractKind,
	"evmPredictionMarket" | "pvmPredictionMarket"
> = {
	evm: "evmPredictionMarket",
	pvm: "pvmPredictionMarket",
};

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

function formatDuration(seconds: bigint): string {
	const s = Number(seconds);
	if (s < 60) return `${s}s`;
	if (s < 3600) return `${Math.round(s / 60)}m`;
	if (s < 86_400) return `${(s / 3600).toFixed(s % 3600 === 0 ? 0 : 1)}h`;
	return `${(s / 86_400).toFixed(s % 86_400 === 0 ? 0 : 1)}d`;
}

function shortAddr(addr: string): string {
	if (!addr) return "";
	if (addr.length <= 14) return addr;
	return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatAmount(wei: bigint, symbol: string, digits = 4): string {
	const s = formatEther(wei);
	const [whole, frac = ""] = s.split(".");
	const trimmed = frac.slice(0, digits).replace(/0+$/, "");
	const body = trimmed ? `${whole}.${trimmed}` : whole;
	return `${body} ${symbol}`;
}

function loadStoredNetwork(): MarketsNetworkKey {
	const stored =
		typeof localStorage !== "undefined" ? localStorage.getItem(NETWORK_STORAGE_KEY) : null;
	if (stored === "local" || stored === "paseoHub") return stored;
	return "paseoHub";
}

function loadStoredAccount(): AccountKind {
	const stored =
		typeof localStorage !== "undefined" ? localStorage.getItem(ACCOUNT_STORAGE_KEY) : null;
	if (stored === "host" || stored === "alice" || stored === "bob" || stored === "charlie")
		return stored;
	return "host";
}

function loadStoredContractKind(): ContractKind {
	const stored =
		typeof localStorage !== "undefined"
			? localStorage.getItem(CONTRACT_KIND_STORAGE_KEY)
			: null;
	if (stored === "evm" || stored === "pvm") return stored;
	return "pvm";
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

interface MarketContext {
	now: number;
	beforeClose: boolean;
	withinDispute: boolean;
	pastDispute: boolean;
	totalPool: bigint;
	yesOdds: number;
	noOdds: number;
}

function deriveContext(
	m: RawMarket,
	disputeWindow: bigint | null,
	nowSeconds: number,
): MarketContext {
	const beforeClose = nowSeconds < Number(m.resolutionTimestamp);
	const disputeDeadlineApprox =
		disputeWindow != null
			? Number(m.resolutionTimestamp) + Number(disputeWindow)
			: Number(m.resolutionTimestamp);
	const withinDispute = nowSeconds <= disputeDeadlineApprox;
	const pastDispute = nowSeconds > disputeDeadlineApprox;
	const totalPool = m.yesPool + m.noPool;
	const yesOdds = totalPool === 0n ? 0.5 : Number(m.yesPool) / Number(totalPool);
	return {
		now: nowSeconds,
		beforeClose,
		withinDispute,
		pastDispute,
		totalPool,
		yesOdds,
		noOdds: 1 - yesOdds,
	};
}

type MarketFilter = "all" | "open" | "resolving" | "finalized" | "mine";

export default function MarketsPage() {
	const [network, setNetwork] = useState<MarketsNetworkKey>(loadStoredNetwork);
	const [accountKind, setAccountKind] = useState<AccountKind>(loadStoredAccount);
	const [contractKind, setContractKind] = useState<ContractKind>(loadStoredContractKind);

	const networkDef = NETWORKS[network];
	const scopedStorageKey = `${STORAGE_KEY}:${network}:${contractKind}`;
	const defaultAddress =
		deployments[networkDef.deployKey][CONTRACT_KIND_DEPLOY_KEY[contractKind]] ?? undefined;

	const [contractAddress, setContractAddress] = useState("");
	const [question, setQuestion] = useState("");
	const [deadline, setDeadline] = useState(defaultDeadline());
	const [markets, setMarkets] = useState<RawMarket[]>([]);
	const [positions, setPositions] = useState<Record<string, UserPosition>>({});
	const [loading, setLoading] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [busyMarketId, setBusyMarketId] = useState<bigint | null>(null);
	const [log, setLog] = useState<LogEntry[]>([]);
	const logIdRef = useRef(0);

	const [resolutionBond, setResolutionBond] = useState<bigint | null>(null);
	const [disputeWindow, setDisputeWindow] = useState<bigint | null>(null);
	const [ownerAddress, setOwnerAddress] = useState<string | null>(null);

	const settingsOpen = useUiStore((s) => s.settingsOpen);
	const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
	const [composerOpen, setComposerOpen] = useState(false);
	const [logOpen, setLogOpen] = useState(false);
	const [filter, setFilter] = useState<MarketFilter>("all");

	const [hostProvider, setHostProvider] = useState<HostProviderResult | null>(null);
	const [hostAddress, setHostAddress] = useState<string | null>(null);
	const [hostReady, setHostReady] = useState(false);
	const [hostError, setHostError] = useState<string | null>(null);

	const clientRef = useRef<PolkadotClient | null>(null);
	const [clientGen, setClientGen] = useState(0);

	const hostAvailable = useMemo(() => isInsideHost(), []);
	const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));
	useEffect(() => {
		const id = setInterval(() => setNowSeconds(Math.floor(Date.now() / 1000)), 1000);
		return () => clearInterval(id);
	}, []);

	function pushLog(text: string, level: LogEntry["level"] = "info") {
		logIdRef.current += 1;
		const ts = new Date().toLocaleTimeString();
		setLog((prev) => [...prev, { id: logIdRef.current, ts, text, level }].slice(-80));
	}

	useEffect(() => {
		localStorage.setItem(NETWORK_STORAGE_KEY, network);
	}, [network]);

	useEffect(() => {
		localStorage.setItem(ACCOUNT_STORAGE_KEY, accountKind);
	}, [accountKind]);

	useEffect(() => {
		localStorage.setItem(CONTRACT_KIND_STORAGE_KEY, contractKind);
	}, [contractKind]);

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
					const client = createClient(
						withPolkadotSdkCompat(getWsProvider(networkDef.wsUrl)),
					);
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

	const activeOrigin = useMemo(() => {
		if (accountKind === "host") return hostAddress ?? null;
		return sr25519DevAccounts[DEV_ACCOUNT_INDEX[accountKind]].address;
	}, [accountKind, hostAddress]);

	const getApi = useCallback(() => {
		if (!clientRef.current) throw new Error("Chain client not ready");
		if (!contractAddress) throw new Error("Contract address missing");
		const typedApi = clientRef.current.getTypedApi(
			networkDef.descriptor,
		) as unknown as ReviveSdkTypedApi;
		return {
			typedApi,
			api: createPredictionMarketContract(typedApi, contractAddress),
		};
	}, [contractAddress, networkDef.descriptor]);

	const refreshGlobals = useCallback(async () => {
		if (!contractAddress || !clientRef.current) return;
		try {
			const { api } = getApi();
			const [bond, win, owner] = await Promise.all([
				api.getResolutionBond(),
				api.getDisputeWindow(),
				api.getOwner(),
			]);
			setResolutionBond(bond);
			setDisputeWindow(win);
			setOwnerAddress(owner);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			pushLog(`Failed to read contract globals: ${msg}`, "err");
		}
	}, [contractAddress, getApi]);

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
			const { api } = getApi();
			const count = await api.getMarketCount();
			const result: RawMarket[] = [];
			for (let i = 0n; i < count; i++) {
				result.push(await api.getMarket(i));
			}
			result.reverse();
			setMarkets(result);

			if (activeOrigin) {
				const entries = await Promise.all(
					result.map(async (m) => {
						try {
							const pos = await api.getUserPosition(m.id, activeOrigin);
							return [m.id.toString(), pos] as const;
						} catch {
							return [m.id.toString(), { yesDeposit: 0n, noDeposit: 0n }] as const;
						}
					}),
				);
				setPositions(Object.fromEntries(entries));
			} else {
				setPositions({});
			}
			pushLog(`Loaded ${result.length} market${result.length === 1 ? "" : "s"}`, "ok");
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			pushLog(`Failed to load markets: ${msg}`, "err");
			setMarkets([]);
		} finally {
			setLoading(false);
		}
	}, [contractAddress, getApi, activeOrigin]);

	useEffect(() => {
		if (clientGen > 0 && contractAddress) {
			refreshGlobals();
			loadMarkets();
		} else if (!contractAddress) {
			setMarkets([]);
			setPositions({});
			setResolutionBond(null);
			setDisputeWindow(null);
			setOwnerAddress(null);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [clientGen, contractAddress, activeOrigin]);

	async function resolveSigner(): Promise<{
		signer: PolkadotSigner;
		origin: string;
	} | null> {
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
			subscribe: (o: { next: (ev: unknown) => void; error: (e: unknown) => void }) => {
				unsubscribe: () => void;
			};
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

	async function ensureMapped(
		typedApi: ReviveSdkTypedApi,
		resolved: { signer: PolkadotSigner; origin: string },
	) {
		const { api } = getApi();
		const mapped = await api.isAddressMapped(resolved.origin);
		if (!mapped) {
			pushLog(
				`Account ${shortAddr(resolved.origin)} is not mapped — submitting Revive.map_account…`,
			);
			const mapObs = mapAccount(typedApi, resolved.signer);
			await watchTx(mapObs, "map_account");
			pushLog("Account mapped", "ok");
		}
	}

	async function runTx(
		marketId: bigint | null,
		label: string,
		run: (ctx: {
			api: ReturnType<typeof createPredictionMarketContract>;
			typedApi: ReviveSdkTypedApi;
			resolved: { signer: PolkadotSigner; origin: string };
		}) => Promise<{
			subscribe: (o: { next: (ev: unknown) => void; error: (e: unknown) => void }) => {
				unsubscribe: () => void;
			};
		}>,
	) {
		if (!contractAddress) {
			pushLog("Contract address missing", "err");
			return;
		}
		if (!clientRef.current) {
			pushLog("Chain client not ready", "err");
			return;
		}
		const resolved = await resolveSigner();
		if (!resolved) return;

		if (marketId !== null) setBusyMarketId(marketId);
		else setSubmitting(true);

		setLogOpen(true);

		try {
			const { api, typedApi } = getApi();
			await ensureMapped(typedApi, resolved);
			pushLog(`Dry-running ${label} as ${shortAddr(resolved.origin)}…`);
			const obs = await run({ api, typedApi, resolved });
			await watchTx(obs, label);
			pushLog(`${label} succeeded`, "ok");
			await loadMarkets();
			await refreshGlobals();
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			pushLog(`${label} failed: ${msg}`, "err");
		} finally {
			if (marketId !== null) setBusyMarketId(null);
			else setSubmitting(false);
		}
	}

	async function createMarket() {
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
		await runTx(null, "createMarket", async ({ api, resolved }) => {
			const obs = await api.createMarket(
				trimmed,
				deadlineSec,
				resolved.origin,
				resolved.signer,
			);
			setQuestion("");
			setDeadline(defaultDeadline());
			setComposerOpen(false);
			return obs;
		});
	}

	async function buyShares(marketId: bigint, outcome: boolean, amount: string) {
		let value: bigint;
		try {
			value = parseEther(amount as `${number}`);
		} catch {
			pushLog(`Invalid amount: ${amount}`, "err");
			return;
		}
		if (value <= 0n) {
			pushLog("Amount must be > 0", "err");
			return;
		}
		await runTx(
			marketId,
			`buyShares #${marketId} ${outcome ? "YES" : "NO"}`,
			async ({ api, resolved }) => {
				return api.buyShares(marketId, outcome, value, resolved.origin, resolved.signer);
			},
		);
	}

	async function resolveMarket(marketId: bigint, outcome: boolean) {
		if (resolutionBond == null) {
			pushLog("resolutionBond not loaded", "err");
			return;
		}
		await runTx(
			marketId,
			`resolveMarket #${marketId} ${outcome ? "YES" : "NO"}`,
			async ({ api, resolved }) => {
				return api.resolveMarket(
					marketId,
					outcome,
					resolutionBond,
					resolved.origin,
					resolved.signer,
				);
			},
		);
	}

	async function disputeResolution(marketId: bigint) {
		if (resolutionBond == null) {
			pushLog("resolutionBond not loaded", "err");
			return;
		}
		await runTx(marketId, `disputeResolution #${marketId}`, async ({ api, resolved }) => {
			return api.disputeResolution(
				marketId,
				resolutionBond,
				resolved.origin,
				resolved.signer,
			);
		});
	}

	async function godResolve(marketId: bigint, outcome: boolean) {
		await runTx(
			marketId,
			`godResolve #${marketId} ${outcome ? "YES" : "NO"}`,
			async ({ api, resolved }) => {
				return api.godResolve(marketId, outcome, resolved.origin, resolved.signer);
			},
		);
	}

	async function claimWinnings(marketId: bigint) {
		await runTx(marketId, `claimWinnings #${marketId}`, async ({ api, resolved }) => {
			return api.claimWinnings(marketId, resolved.origin, resolved.signer);
		});
	}

	async function updateResolutionBond(amountStr: string) {
		let value: bigint;
		try {
			value = parseEther(amountStr as `${number}`);
		} catch {
			pushLog(`Invalid bond amount: ${amountStr}`, "err");
			return;
		}
		await runTx(null, `setResolutionBond`, async ({ api, resolved }) => {
			return api.setResolutionBond(value, resolved.origin, resolved.signer);
		});
	}

	async function updateDisputeWindow(secondsStr: string) {
		let value: bigint;
		try {
			value = BigInt(secondsStr);
		} catch {
			pushLog(`Invalid duration: ${secondsStr}`, "err");
			return;
		}
		if (value < 0n) {
			pushLog(`Duration must be ≥ 0`, "err");
			return;
		}
		await runTx(null, `setDisputeWindow`, async ({ api, resolved }) => {
			return api.setDisputeWindow(value, resolved.origin, resolved.signer);
		});
	}

	const stats = useMemo(() => {
		const origin = activeOrigin?.toLowerCase() ?? "";
		const open = markets.filter((m) => m.state === 0).length;
		const mine = origin ? markets.filter((m) => m.creator.toLowerCase() === origin).length : 0;
		const totalVolume = markets.reduce((acc, m) => acc + m.yesPool + m.noPool, 0n);
		return { total: markets.length, open, mine, totalVolume };
	}, [markets, activeOrigin]);

	const isOwner = useMemo(() => {
		if (!ownerAddress || !activeOrigin) return false;
		return ownerAddress.toLowerCase() === activeOrigin.toLowerCase();
	}, [ownerAddress, activeOrigin]);

	const filteredMarkets = useMemo(() => {
		const origin = activeOrigin?.toLowerCase() ?? "";
		switch (filter) {
			case "open":
				return markets.filter((m) => m.state === 0);
			case "resolving":
				return markets.filter((m) => m.state === 1 || m.state === 2 || m.state === 3);
			case "finalized":
				return markets.filter((m) => m.state === 4);
			case "mine":
				return origin ? markets.filter((m) => m.creator.toLowerCase() === origin) : [];
			default:
				return markets;
		}
	}, [markets, filter, activeOrigin]);

	const lastLogEntry = log[log.length - 1];
	const hasError = !!hostError || (contractAddress === "" && !defaultAddress);

	return (
		<div className="space-y-6 animate-fade-in pb-24">
			{/* Hero */}
			<div className="flex flex-wrap items-end justify-between gap-4">
				<div className="space-y-1.5">
					<div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-text-tertiary">
						<span className="inline-flex h-1.5 w-1.5 rounded-full bg-polka-500" />
						Prediction markets
					</div>
					<h1 className="text-4xl font-bold tracking-tight font-display text-text-primary">
						What will happen next?
					</h1>
					<p className="text-text-secondary max-w-2xl text-sm">
						Trade binary outcomes on-chain. Buy YES/NO, propose resolutions, dispute bad
						calls, claim winnings — backed by a bond.
					</p>
				</div>
				<div className="flex items-center gap-2">
					<button
						onClick={() => setComposerOpen((v) => !v)}
						disabled={!contractAddress}
						className="btn-primary text-sm inline-flex items-center gap-2"
					>
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2.5"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<path d="M12 5v14M5 12h14" />
						</svg>
						{composerOpen ? "Close" : "New market"}
					</button>
				</div>
			</div>

			{/* Stat cards */}
			<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
				<StatCard
					label="Total markets"
					value={stats.total.toString()}
					hint={loading ? "Loading…" : `${networkDef.label}`}
				/>
				<StatCard
					label="Open"
					value={stats.open.toString()}
					accent="green"
					hint="Trading live"
				/>
				<StatCard
					label="Total volume"
					value={
						stats.totalVolume > 0n
							? formatAmount(stats.totalVolume, networkDef.symbol, 3)
							: `0 ${networkDef.symbol}`
					}
					hint={`Across ${stats.total} market${stats.total === 1 ? "" : "s"}`}
				/>
				<StatCard
					label="Your markets"
					value={stats.mine.toString()}
					hint={activeOrigin ? shortAddr(activeOrigin) : "—"}
					accent="purple"
				/>
			</div>

			{/* Environment strip */}
			<div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2 text-xs">
				<InfoPill label="Network" value={networkDef.label} tone="blue" />
				<InfoPill
					label="Flavor"
					value={contractKind.toUpperCase()}
					tone={contractKind === "pvm" ? "green" : "purple"}
				/>
				<InfoPill
					label="Account"
					value={activeOrigin ? shortAddr(activeOrigin) : "none"}
					mono
				/>
				<InfoPill
					label="Contract"
					value={contractAddress ? shortAddr(contractAddress) : "not set"}
					mono
					tone={contractAddress ? "default" : "red"}
				/>
				<InfoPill
					label="Bond"
					value={
						resolutionBond != null
							? formatAmount(resolutionBond, networkDef.symbol)
							: "—"
					}
				/>
				<InfoPill
					label="Dispute"
					value={disputeWindow != null ? formatDuration(disputeWindow) : "—"}
				/>
				{isOwner && (
					<span className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-accent-purple/10 border border-accent-purple/30 px-2 py-0.5 text-accent-purple text-[11px] font-semibold uppercase tracking-wide">
						<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
							<path d="M12 2l2.39 7.36H22l-6.19 4.5L18.2 21 12 16.5 5.8 21l2.39-7.14L2 9.36h7.61z" />
						</svg>
						Owner
					</span>
				)}
			</div>

			{hasError && !contractAddress && !defaultAddress && (
				<div className="rounded-xl border border-accent-yellow/30 bg-accent-yellow/10 px-4 py-3 text-sm text-accent-yellow">
					No contract address configured for {networkDef.label} ·{" "}
					{CONTRACT_KIND_LABELS[contractKind]}. Open{" "}
					<button onClick={() => setSettingsOpen(true)} className="underline font-medium">
						settings
					</button>{" "}
					to set one.
				</div>
			)}

			{/* Composer */}
			{composerOpen && (
				<div className="card space-y-4 animate-slide-up border-polka-500/20">
					<div className="flex items-center justify-between">
						<div>
							<h2 className="section-title">Create a market</h2>
							<p className="text-xs text-text-muted mt-0.5">
								A binary question answered after its resolution time.
							</p>
						</div>
						<button
							onClick={() => setComposerOpen(false)}
							className="text-text-muted hover:text-text-primary transition-colors"
							aria-label="Close composer"
						>
							<svg
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
							>
								<path d="M18 6L6 18M6 6l12 12" />
							</svg>
						</button>
					</div>
					<div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
						<div>
							<label className="label">Question</label>
							<input
								type="text"
								value={question}
								onChange={(e) => setQuestion(e.target.value)}
								placeholder="Will DOT reach $20 by July 1?"
								className="input-field w-full font-body text-base"
								maxLength={240}
							/>
						</div>
						<div>
							<label className="label">Resolution deadline</label>
							<input
								type="datetime-local"
								value={deadline}
								onChange={(e) => setDeadline(e.target.value)}
								className="input-field w-full"
							/>
						</div>
					</div>
					<div className="flex items-center justify-between gap-3 text-xs text-text-muted">
						<span>
							After the deadline, anyone can propose an outcome by posting a{" "}
							<span className="text-text-secondary font-medium">
								{resolutionBond != null
									? formatAmount(resolutionBond, networkDef.symbol)
									: "—"}
							</span>{" "}
							bond.
						</span>
						<button
							onClick={createMarket}
							disabled={submitting || !contractAddress}
							className="btn-primary"
						>
							{submitting ? "Submitting…" : "Launch market"}
						</button>
					</div>
				</div>
			)}

			{/* Markets header + filters */}
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-1 rounded-lg border border-white/[0.06] bg-white/[0.02] p-1">
					{(
						[
							{ id: "all", label: "All", count: markets.length },
							{ id: "open", label: "Open", count: stats.open },
							{
								id: "resolving",
								label: "Resolving",
								count: markets.filter(
									(m) => m.state === 1 || m.state === 2 || m.state === 3,
								).length,
							},
							{
								id: "finalized",
								label: "Finalized",
								count: markets.filter((m) => m.state === 4).length,
							},
							{ id: "mine", label: "Yours", count: stats.mine },
						] as const
					).map(({ id, label, count }) => {
						const active = filter === id;
						return (
							<button
								key={id}
								onClick={() => setFilter(id)}
								className={`relative px-3 py-1.5 text-xs font-medium rounded-md transition-all whitespace-nowrap ${
									active
										? "bg-white/[0.08] text-text-primary"
										: "text-text-tertiary hover:text-text-primary"
								}`}
							>
								{label}
								<span
									className={`ml-1.5 text-[10px] ${
										active ? "text-text-secondary" : "text-text-muted"
									}`}
								>
									{count}
								</span>
							</button>
						);
					})}
				</div>
				<button
					onClick={loadMarkets}
					disabled={loading}
					className="btn-secondary text-xs inline-flex items-center gap-1.5"
				>
					<svg
						width="12"
						height="12"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2.2"
						strokeLinecap="round"
						strokeLinejoin="round"
						className={loading ? "animate-spin" : ""}
					>
						<path d="M21 12a9 9 0 11-9-9c2.5 0 4.8 1 6.5 2.7L21 8" />
						<path d="M21 3v5h-5" />
					</svg>
					{loading ? "Loading" : "Refresh"}
				</button>
			</div>

			{/* Markets grid */}
			{markets.length === 0 ? (
				<EmptyState
					loading={loading}
					hasContract={!!contractAddress}
					onOpenComposer={() => setComposerOpen(true)}
					onOpenSettings={() => setSettingsOpen(true)}
				/>
			) : filteredMarkets.length === 0 ? (
				<div className="card text-sm text-text-muted text-center py-8">
					No markets match the <span className="text-text-secondary">"{filter}"</span>{" "}
					filter.
				</div>
			) : (
				<div className="grid gap-4 md:grid-cols-2">
					{filteredMarkets.map((m) => (
						<MarketCard
							key={m.id.toString()}
							m={m}
							position={positions[m.id.toString()]}
							context={deriveContext(m, disputeWindow, nowSeconds)}
							activeOrigin={activeOrigin}
							isOwner={isOwner}
							resolutionBond={resolutionBond}
							symbol={networkDef.symbol}
							busy={busyMarketId === m.id}
							anyBusy={busyMarketId !== null || submitting}
							onBuy={buyShares}
							onResolve={resolveMarket}
							onDispute={disputeResolution}
							onGodResolve={godResolve}
							onClaim={claimWinnings}
						/>
					))}
				</div>
			)}

			{/* Settings drawer */}
			{settingsOpen && (
				<SettingsDrawer onClose={() => setSettingsOpen(false)}>
					<SettingsPanel
						network={network}
						setNetwork={setNetwork}
						accountKind={accountKind}
						setAccountKind={setAccountKind}
						contractKind={contractKind}
						setContractKind={setContractKind}
						networkDef={networkDef}
						hostError={hostError}
						hostReady={hostReady}
						hostAddress={hostAddress}
						hostAvailable={hostAvailable}
						contractAddress={contractAddress}
						defaultAddress={defaultAddress}
						saveAddress={saveAddress}
						resolutionBond={resolutionBond}
						disputeWindow={disputeWindow}
						ownerAddress={ownerAddress}
						isOwner={isOwner}
						updateResolutionBond={updateResolutionBond}
						updateDisputeWindow={updateDisputeWindow}
						submitting={submitting}
						symbol={networkDef.symbol}
					/>
				</SettingsDrawer>
			)}

			{/* Activity log (collapsed bottom bar) */}
			<ActivityLog log={log} open={logOpen} setOpen={setLogOpen} lastEntry={lastLogEntry} />
		</div>
	);
}

function StatCard({
	label,
	value,
	hint,
	accent,
}: {
	label: string;
	value: string;
	hint?: string;
	accent?: "green" | "purple";
}) {
	const accentClass =
		accent === "green"
			? "text-accent-green"
			: accent === "purple"
				? "text-accent-purple"
				: "text-text-primary";
	return (
		<div className="card !p-4">
			<div className="text-[11px] uppercase tracking-wider text-text-tertiary font-medium">
				{label}
			</div>
			<div
				className={`mt-1 text-2xl font-semibold font-display tracking-tight ${accentClass}`}
			>
				{value}
			</div>
			{hint && <div className="mt-0.5 text-[11px] text-text-muted truncate">{hint}</div>}
		</div>
	);
}

function InfoPill({
	label,
	value,
	mono,
	tone = "default",
}: {
	label: string;
	value: string;
	mono?: boolean;
	tone?: "default" | "green" | "purple" | "blue" | "red";
}) {
	const toneMap = {
		default: "text-text-secondary",
		green: "text-accent-green",
		purple: "text-accent-purple",
		blue: "text-accent-blue",
		red: "text-accent-red",
	};
	return (
		<span className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.05] bg-white/[0.02] px-2 py-1">
			<span className="text-[10px] uppercase tracking-wider text-text-muted">{label}</span>
			<span className={`${toneMap[tone]} ${mono ? "font-mono" : ""} text-xs`}>{value}</span>
		</span>
	);
}

function EmptyState({
	loading,
	hasContract,
	onOpenComposer,
	onOpenSettings,
}: {
	loading: boolean;
	hasContract: boolean;
	onOpenComposer: () => void;
	onOpenSettings: () => void;
}) {
	return (
		<div className="card text-center py-12">
			<div className="mx-auto w-12 h-12 rounded-xl bg-gradient-to-br from-polka-500/20 to-polka-700/10 border border-polka-500/20 flex items-center justify-center mb-3">
				<svg
					width="22"
					height="22"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.8"
					className="text-polka-400"
				>
					<path d="M3 3v18h18" />
					<path d="M7 14l4-4 4 4 5-5" />
				</svg>
			</div>
			<h3 className="text-base font-semibold text-text-primary">
				{loading ? "Loading markets…" : "No markets yet"}
			</h3>
			<p className="text-sm text-text-tertiary mt-1 max-w-sm mx-auto">
				{loading
					? "Pulling active markets from the contract."
					: hasContract
						? "Be the first to launch a prediction market."
						: "Configure a contract address to start creating and trading markets."}
			</p>
			{!loading && (
				<div className="mt-4 flex items-center justify-center gap-2">
					{hasContract ? (
						<button onClick={onOpenComposer} className="btn-primary text-sm">
							Create first market
						</button>
					) : (
						<button onClick={onOpenSettings} className="btn-primary text-sm">
							Open settings
						</button>
					)}
				</div>
			)}
		</div>
	);
}

function ActivityLog({
	log,
	open,
	setOpen,
	lastEntry,
}: {
	log: LogEntry[];
	open: boolean;
	setOpen: (v: boolean) => void;
	lastEntry: LogEntry | undefined;
}) {
	return (
		<div className="fixed bottom-4 right-4 z-30 max-w-md w-[calc(100vw-2rem)]">
			<div className="rounded-xl border border-white/[0.08] bg-surface-800/95 backdrop-blur-xl shadow-card-hover overflow-hidden">
				<button
					onClick={() => setOpen(!open)}
					className="w-full flex items-center gap-3 px-3.5 py-2.5 hover:bg-white/[0.03] transition-colors"
				>
					<span className="inline-flex items-center gap-2">
						<span className="relative flex h-2 w-2">
							{lastEntry && lastEntry.level === "err" && (
								<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-red/70 opacity-75" />
							)}
							<span
								className={`relative inline-flex rounded-full h-2 w-2 ${
									lastEntry
										? lastEntry.level === "err"
											? "bg-accent-red"
											: lastEntry.level === "finalized"
												? "bg-accent-blue"
												: lastEntry.level === "ok"
													? "bg-accent-green"
													: "bg-text-tertiary"
										: "bg-text-muted"
								}`}
							/>
						</span>
						<span className="text-xs font-medium text-text-secondary">Activity</span>
					</span>
					{lastEntry ? (
						<span
							className={`text-xs truncate flex-1 text-left ${levelClass(
								lastEntry.level,
							)}`}
						>
							{lastEntry.text}
						</span>
					) : (
						<span className="text-xs text-text-muted flex-1 text-left">
							No events yet.
						</span>
					)}
					<span className="text-[10px] text-text-muted">{log.length}</span>
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						className={`text-text-tertiary transition-transform ${
							open ? "rotate-180" : ""
						}`}
					>
						<polyline points="18 15 12 9 6 15" />
					</svg>
				</button>
				{open && (
					<div className="border-t border-white/[0.06] max-h-72 overflow-y-auto">
						{log.length === 0 ? (
							<p className="text-text-muted text-xs px-3.5 py-3">No events yet.</p>
						) : (
							<div className="px-3.5 py-2 space-y-1 text-xs font-mono">
								{log
									.slice()
									.reverse()
									.map((entry) => (
										<div key={entry.id} className={levelClass(entry.level)}>
											<span className="text-text-muted">[{entry.ts}]</span>{" "}
											{entry.text}
										</div>
									))}
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	);
}

function SettingsDrawer({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);
	useEffect(() => {
		const prev = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.body.style.overflow = prev;
		};
	}, []);
	return createPortal(
		<div className="fixed inset-0 z-[100] flex">
			<button
				onClick={onClose}
				aria-label="Close settings"
				className="flex-1 bg-black/60 backdrop-blur-sm animate-fade-in"
			/>
			<div className="w-full max-w-md h-full bg-surface-950/98 border-l border-white/[0.08] backdrop-blur-xl shadow-2xl overflow-y-auto animate-slide-up">
				<div className="sticky top-0 z-10 flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06] bg-surface-950/95 backdrop-blur-xl">
					<div className="flex items-center gap-2">
						<svg
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							className="text-text-secondary"
						>
							<circle cx="12" cy="12" r="3" />
							<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
						</svg>
						<h2 className="text-sm font-semibold text-text-primary">Settings</h2>
					</div>
					<button
						onClick={onClose}
						className="p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-white/[0.05] transition-colors"
						aria-label="Close"
					>
						<svg
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
						>
							<path d="M18 6L6 18M6 6l12 12" />
						</svg>
					</button>
				</div>
				<div className="p-5">{children}</div>
			</div>
		</div>,
		document.body,
	);
}

interface SettingsPanelProps {
	network: MarketsNetworkKey;
	setNetwork: (k: MarketsNetworkKey) => void;
	accountKind: AccountKind;
	setAccountKind: (k: AccountKind) => void;
	contractKind: ContractKind;
	setContractKind: (k: ContractKind) => void;
	networkDef: NetworkDef;
	hostError: string | null;
	hostReady: boolean;
	hostAddress: string | null;
	hostAvailable: boolean;
	contractAddress: string;
	defaultAddress: string | undefined;
	saveAddress: (a: string) => void;
	resolutionBond: bigint | null;
	disputeWindow: bigint | null;
	ownerAddress: string | null;
	isOwner: boolean;
	updateResolutionBond: (amt: string) => void;
	updateDisputeWindow: (secs: string) => void;
	submitting: boolean;
	symbol: string;
}

function SettingsPanel({
	network,
	setNetwork,
	accountKind,
	setAccountKind,
	contractKind,
	setContractKind,
	networkDef,
	hostError,
	hostReady,
	hostAddress,
	hostAvailable,
	contractAddress,
	defaultAddress,
	saveAddress,
	resolutionBond,
	disputeWindow,
	ownerAddress,
	isOwner,
	updateResolutionBond,
	updateDisputeWindow,
	submitting,
	symbol,
}: SettingsPanelProps) {
	const [bondInput, setBondInput] = useState(() =>
		resolutionBond != null ? formatEther(resolutionBond) : "",
	);
	const [windowInput, setWindowInput] = useState(() =>
		disputeWindow != null ? disputeWindow.toString() : "",
	);
	const [lastBond, setLastBond] = useState(resolutionBond);
	const [lastWindow, setLastWindow] = useState(disputeWindow);

	if (resolutionBond !== lastBond) {
		setLastBond(resolutionBond);
		if (resolutionBond != null) setBondInput(formatEther(resolutionBond));
	}
	if (disputeWindow !== lastWindow) {
		setLastWindow(disputeWindow);
		if (disputeWindow != null) setWindowInput(disputeWindow.toString());
	}

	return (
		<div className="space-y-6">
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
				<p className="text-xs text-text-muted mt-1.5 break-all">
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
					{[
						{ key: "host" as const, label: "My account (Host)" },
						{ key: "alice" as const, label: "Alice (dev)" },
						{ key: "bob" as const, label: "Bob (dev)" },
						{ key: "charlie" as const, label: "Charlie (dev)" },
					].map(({ key, label }) => {
						const disabled = key === "host" && network === "local";
						const active = accountKind === key;
						return (
							<button
								key={key}
								disabled={disabled}
								onClick={() => setAccountKind(key)}
								title={
									disabled ? "Host API only works on Paseo Asset Hub" : undefined
								}
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
					<p className="text-xs text-text-muted mt-1.5 break-all">
						Signing as{" "}
						<code className="font-mono">
							{sr25519DevAccounts[DEV_ACCOUNT_INDEX[accountKind]].address}
						</code>
					</p>
				)}
			</div>

			<div>
				<label className="label">Contract flavor</label>
				<div className="flex flex-wrap gap-2">
					{(Object.keys(CONTRACT_KIND_LABELS) as ContractKind[]).map((key) => {
						const active = contractKind === key;
						const activeClass =
							key === "pvm"
								? "border-accent-green/40 bg-accent-green/15 text-accent-green"
								: "border-accent-purple/40 bg-accent-purple/15 text-accent-purple";
						return (
							<button
								key={key}
								onClick={() => setContractKind(key)}
								className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
									active
										? activeClass
										: "border-white/[0.08] bg-white/[0.02] text-text-secondary hover:border-white/[0.15] hover:text-text-primary"
								}`}
							>
								{CONTRACT_KIND_LABELS[key]}
							</button>
						);
					})}
				</div>
				<p className="text-xs text-text-muted mt-1.5">
					Same Solidity source, different bytecode. Calls go through pallet-revive either
					way.
				</p>
			</div>

			<div>
				<label className="label">Contract address</label>
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
						No {CONTRACT_KIND_LABELS[contractKind]} deployment recorded for{" "}
						{networkDef.label}. Deploy with{" "}
						<code className="font-mono">
							{contractKind === "pvm"
								? network === "local"
									? "cd contracts/pvm && npm run deploy:local"
									: "make deploy-paseo-pvm"
								: network === "local"
									? "cd contracts/evm && npm run deploy:local"
									: "make deploy-paseo-evm"}
						</code>
						.
					</p>
				)}
				{ownerAddress && (
					<p className="text-xs text-text-muted mt-1.5">
						Owner:{" "}
						<code className="font-mono text-text-secondary">
							{shortAddr(ownerAddress)}
						</code>
						{isOwner && <span className="ml-1 text-accent-purple">(that's you)</span>}
					</p>
				)}
			</div>

			<div className="pt-4 border-t border-white/[0.05]">
				<h3 className="section-title text-sm">Admin</h3>
				<p className="text-xs text-text-muted mt-0.5 mb-3">
					{isOwner
						? "You are the contract owner — you can tune parameters and finalize disputes."
						: "Visible to the owner only. Non-owners will see these calls revert."}
				</p>
				<div className="grid grid-cols-1 gap-3">
					<div>
						<label className="label">Resolution bond ({symbol})</label>
						<div className="flex gap-2">
							<input
								type="text"
								value={bondInput}
								onChange={(e) => setBondInput(e.target.value)}
								className="input-field w-full"
								disabled={!isOwner || submitting}
							/>
							<button
								onClick={() => updateResolutionBond(bondInput)}
								disabled={!isOwner || submitting}
								className="btn-secondary text-xs whitespace-nowrap"
							>
								Update
							</button>
						</div>
					</div>
					<div>
						<label className="label">Dispute window (seconds)</label>
						<div className="flex gap-2">
							<input
								type="text"
								value={windowInput}
								onChange={(e) => setWindowInput(e.target.value)}
								className="input-field w-full"
								disabled={!isOwner || submitting}
							/>
							<button
								onClick={() => updateDisputeWindow(windowInput)}
								disabled={!isOwner || submitting}
								className="btn-secondary text-xs whitespace-nowrap"
							>
								Update
							</button>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

interface MarketCardProps {
	m: RawMarket;
	position: UserPosition | undefined;
	context: MarketContext;
	activeOrigin: string | null;
	isOwner: boolean;
	resolutionBond: bigint | null;
	symbol: string;
	busy: boolean;
	anyBusy: boolean;
	onBuy: (id: bigint, outcome: boolean, amount: string) => void;
	onResolve: (id: bigint, outcome: boolean) => void;
	onDispute: (id: bigint) => void;
	onGodResolve: (id: bigint, outcome: boolean) => void;
	onClaim: (id: bigint) => void;
}

function MarketCard({
	m,
	position,
	context,
	activeOrigin,
	isOwner,
	resolutionBond,
	symbol,
	busy,
	anyBusy,
	onBuy,
	onResolve,
	onDispute,
	onGodResolve,
	onClaim,
}: MarketCardProps) {
	const [amount, setAmount] = useState("0.01");
	const mine = activeOrigin && m.creator.toLowerCase() === activeOrigin.toLowerCase();
	const deadlineDate = new Date(Number(m.resolutionTimestamp) * 1000);
	const stateLabel = MARKET_STATE_LABELS[m.state] ?? `State ${m.state}`;
	const yesPct = Math.round(context.yesOdds * 100);
	const noPct = 100 - yesPct;
	const totalPool = context.totalPool;
	const disabled = busy || anyBusy;

	const hasYes = (position?.yesDeposit ?? 0n) > 0n;
	const hasNo = (position?.noDeposit ?? 0n) > 0n;

	const stateBadgeClass =
		m.state === 0
			? "bg-accent-green/10 text-accent-green border-accent-green/20"
			: m.state === 1
				? "bg-accent-blue/10 text-accent-blue border-accent-blue/20"
				: m.state === 2
					? "bg-accent-blue/10 text-accent-blue border-accent-blue/20"
					: m.state === 3
						? "bg-accent-red/10 text-accent-red border-accent-red/20"
						: m.state === 4
							? "bg-accent-purple/10 text-accent-purple border-accent-purple/20"
							: "bg-white/[0.04] text-text-secondary border-white/[0.06]";

	const stateDot =
		m.state === 0
			? "bg-accent-green"
			: m.state === 3
				? "bg-accent-red"
				: m.state === 4
					? "bg-accent-purple"
					: "bg-accent-blue";

	return (
		<div
			className={`relative group rounded-xl border bg-gradient-to-br from-surface-900 to-surface-800/60 backdrop-blur-sm p-5 flex flex-col gap-4 transition-all duration-200 ${
				busy
					? "border-polka-500/40 shadow-glow"
					: "border-white/[0.06] hover:border-white/[0.12] hover:shadow-card-hover"
			}`}
		>
			{busy && (
				<div className="absolute inset-0 rounded-xl bg-polka-500/5 pointer-events-none animate-pulse" />
			)}

			{/* Header */}
			<div className="flex items-start justify-between gap-3">
				<div className="space-y-1.5 flex-1 min-w-0">
					<div className="flex items-center gap-2">
						<span
							className={`inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[10px] uppercase tracking-wider font-semibold ${stateBadgeClass}`}
						>
							<span className={`w-1 h-1 rounded-full ${stateDot}`} />
							{stateLabel}
						</span>
						{mine && (
							<span className="inline-flex items-center rounded-md bg-accent-purple/10 border border-accent-purple/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wider font-semibold text-accent-purple">
								You
							</span>
						)}
						<span className="ml-auto text-[11px] font-mono text-text-muted">
							#{m.id.toString()}
						</span>
					</div>
					<h3 className="text-base font-semibold text-text-primary leading-snug">
						{m.question}
					</h3>
				</div>
			</div>

			{/* Big probability display */}
			<PoolBar
				yesPool={m.yesPool}
				noPool={m.noPool}
				yesPct={yesPct}
				noPct={noPct}
				totalPool={totalPool}
				symbol={symbol}
			/>

			{/* Meta row */}
			<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-tertiary">
				<span
					title={deadlineDate.toLocaleString()}
					className={!context.beforeClose ? "text-accent-yellow" : undefined}
				>
					<span className="text-text-muted">Resolves</span>{" "}
					{formatRelative(m.resolutionTimestamp)}
				</span>
				<span>
					<span className="text-text-muted">By</span>{" "}
					<span className="font-mono">{shortAddr(m.creator)}</span>
				</span>
				{totalPool > 0n && (
					<span>
						<span className="text-text-muted">Vol</span>{" "}
						{formatAmount(totalPool, symbol)}
					</span>
				)}
			</div>

			{/* Position pills */}
			{(hasYes || hasNo) && (
				<div className="flex flex-wrap gap-1.5">
					{hasYes && (
						<span className="inline-flex items-center gap-1.5 rounded-md border border-accent-green/30 bg-accent-green/10 px-2 py-1 text-[11px] text-accent-green">
							<span className="opacity-70">Your YES</span>
							<span className="font-semibold">
								{formatAmount(position!.yesDeposit, symbol)}
							</span>
						</span>
					)}
					{hasNo && (
						<span className="inline-flex items-center gap-1.5 rounded-md border border-accent-red/30 bg-accent-red/10 px-2 py-1 text-[11px] text-accent-red">
							<span className="opacity-70">Your NO</span>
							<span className="font-semibold">
								{formatAmount(position!.noDeposit, symbol)}
							</span>
						</span>
					)}
				</div>
			)}

			{/* Action zone */}
			<div className="pt-1 border-t border-white/[0.04]">
				{m.state === 0 && context.beforeClose && (
					<div className="pt-3 space-y-2">
						<div className="flex items-center gap-2">
							<div className="relative flex-1">
								<input
									type="text"
									value={amount}
									onChange={(e) => setAmount(e.target.value)}
									className="input-field w-full pr-14"
									placeholder="0.01"
									disabled={disabled}
								/>
								<span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-text-muted pointer-events-none">
									{symbol}
								</span>
							</div>
						</div>
						<div className="grid grid-cols-2 gap-2">
							<button
								className="btn-trade-yes"
								disabled={disabled}
								onClick={() => onBuy(m.id, true, amount)}
							>
								<span className="font-semibold">Buy YES</span>
								<span className="opacity-80 text-[11px]">{yesPct}¢</span>
							</button>
							<button
								className="btn-trade-no"
								disabled={disabled}
								onClick={() => onBuy(m.id, false, amount)}
							>
								<span className="font-semibold">Buy NO</span>
								<span className="opacity-80 text-[11px]">{noPct}¢</span>
							</button>
						</div>
					</div>
				)}

				{m.state === 0 && !context.beforeClose && (
					<div className="pt-3 space-y-2">
						<p className="text-xs text-text-muted">
							Trading closed. Propose the outcome by posting a bond of{" "}
							<span className="text-text-secondary font-medium">
								{resolutionBond != null
									? formatAmount(resolutionBond, symbol)
									: "—"}
							</span>
							.
						</p>
						<div className="grid grid-cols-2 gap-2">
							<button
								className="btn-outline-yes"
								disabled={disabled || resolutionBond == null}
								onClick={() => onResolve(m.id, true)}
							>
								Resolve YES
							</button>
							<button
								className="btn-outline-no"
								disabled={disabled || resolutionBond == null}
								onClick={() => onResolve(m.id, false)}
							>
								Resolve NO
							</button>
						</div>
					</div>
				)}

				{m.state === 2 && (
					<div className="pt-3 space-y-2">
						<p className="text-xs text-text-muted">
							Proposed outcome:{" "}
							<span
								className={
									m.proposedOutcome ? "text-accent-green" : "text-accent-red"
								}
							>
								{m.proposedOutcome ? "YES" : "NO"}
							</span>
							{". "}
							{context.withinDispute
								? "Dispute window open — stake a bond to dispute, or wait to finalize."
								: "Dispute window closed — anyone can finalize now."}
						</p>
						<div className="flex flex-wrap gap-2">
							{context.withinDispute && (
								<button
									className="btn-secondary text-xs border-accent-yellow/40 text-accent-yellow"
									disabled={disabled || resolutionBond == null}
									onClick={() => onDispute(m.id)}
								>
									Dispute
								</button>
							)}
							{!context.withinDispute && (
								<button
									className="btn-primary text-xs"
									disabled={disabled}
									onClick={() => onClaim(m.id)}
								>
									Finalize &amp; claim
								</button>
							)}
						</div>
					</div>
				)}

				{m.state === 3 && (
					<div className="pt-3 space-y-2">
						<p className="text-xs text-text-muted">
							Disputed. Waiting for contract owner to finalize.
						</p>
						{isOwner && (
							<div className="grid grid-cols-2 gap-2">
								<button
									className="btn-outline-yes"
									disabled={disabled}
									onClick={() => onGodResolve(m.id, true)}
								>
									God resolve YES
								</button>
								<button
									className="btn-outline-no"
									disabled={disabled}
									onClick={() => onGodResolve(m.id, false)}
								>
									God resolve NO
								</button>
							</div>
						)}
					</div>
				)}

				{m.state === 4 && (
					<div className="pt-3 flex flex-wrap items-center gap-2">
						<p className="text-xs text-text-muted flex-1">
							Market finalized. Claim any winning position.
						</p>
						<button
							className="btn-primary text-xs"
							disabled={disabled}
							onClick={() => onClaim(m.id)}
						>
							Claim winnings
						</button>
					</div>
				)}
			</div>
		</div>
	);
}

function PoolBar({
	yesPool,
	noPool,
	yesPct,
	noPct,
	totalPool,
	symbol,
}: {
	yesPool: bigint;
	noPool: bigint;
	yesPct: number;
	noPct: number;
	totalPool: bigint;
	symbol: string;
}) {
	return (
		<div className="space-y-2">
			<div className="flex items-end justify-between gap-4">
				<div className="flex items-baseline gap-1.5">
					<span className="text-[11px] uppercase tracking-wider text-accent-green font-semibold">
						YES
					</span>
					<span className="text-2xl font-bold text-accent-green font-display tabular-nums">
						{yesPct}%
					</span>
				</div>
				<div className="flex items-baseline gap-1.5">
					<span className="text-2xl font-bold text-accent-red font-display tabular-nums">
						{noPct}%
					</span>
					<span className="text-[11px] uppercase tracking-wider text-accent-red font-semibold">
						NO
					</span>
				</div>
			</div>
			<div className="flex h-2 w-full overflow-hidden rounded-full bg-white/[0.04]">
				<div
					className="h-full bg-gradient-to-r from-accent-green/80 to-accent-green/60 transition-all"
					style={{ width: totalPool === 0n ? "50%" : `${yesPct}%` }}
				/>
				<div
					className="h-full bg-gradient-to-r from-accent-red/60 to-accent-red/80 transition-all"
					style={{ width: totalPool === 0n ? "50%" : `${noPct}%` }}
				/>
			</div>
			<div className="flex items-center justify-between text-[10px] font-mono text-text-muted">
				<span>{formatAmount(yesPool, symbol)}</span>
				<span>{formatAmount(noPool, symbol)}</span>
			</div>
		</div>
	);
}
