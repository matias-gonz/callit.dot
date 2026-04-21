import { contracts } from "@polkadot-api/descriptors";
import { createReviveSdk, type ReviveSdkTypedApi } from "@polkadot-api/sdk-ink";
import { AccountId, type PolkadotSigner } from "polkadot-api";

const evmZeroBytes = new Uint8Array(32);
evmZeroBytes.fill(0xee, 20);
export const ZERO_READ_ORIGIN = AccountId().dec(evmZeroBytes);

export interface RawMarket {
	id: bigint;
	creator: string;
	question: string;
	resolutionTimestamp: bigint;
	state: number;
	proposedOutcome: boolean;
	yesPool: bigint;
	noPool: bigint;
}

export interface UserPosition {
	yesDeposit: bigint;
	noDeposit: bigint;
}

function formatDryRunError(v: unknown): string {
	if (!v) return "unknown error";
	try {
		return JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? val.toString() : val));
	} catch {
		return String(v);
	}
}

export function createPredictionMarketContract(
	typedApi: ReviveSdkTypedApi,
	contractAddress: string,
) {
	const sdk = createReviveSdk(typedApi, contracts.predictionMarket, { atBest: true });
	const contract = sdk.getContract(contractAddress);

	let ratioPromise: Promise<bigint> | null = null;
	function getNativeToEthRatio(): Promise<bigint> {
		if (!ratioPromise) {
			const constants = (typedApi as unknown as {
				constants: { Revive: { NativeToEthRatio: () => Promise<number | bigint> } };
			}).constants;
			ratioPromise = constants.Revive.NativeToEthRatio().then((r) => BigInt(r));
		}
		return ratioPromise;
	}

	async function weiToNative(valueWei: bigint): Promise<bigint> {
		const ratio = await getNativeToEthRatio();
		return valueWei / ratio;
	}

	async function readMessage<T>(
		message:
			| "getMarketCount"
			| "resolutionBond"
			| "disputeWindow"
			| "owner"
			| "getMarket"
			| "getUserPosition",
		data: Record<string, unknown> | undefined,
		origin: string,
	): Promise<T> {
		const args = (data ? { origin, data } : { origin }) as Parameters<typeof contract.query>[1];
		const result = await contract.query(message, args);
		if (!result.success) {
			throw new Error(`${message} query failed: ${formatDryRunError(result.value)}`);
		}
		return result.value.response as T;
	}

	async function dryRunWrite(
		message: Parameters<typeof contract.query>[0],
		data: Record<string, unknown> | undefined,
		origin: string,
		value?: bigint,
	) {
		const args = {
			origin,
			...(data ? { data } : {}),
			...(value !== undefined ? { value } : {}),
		} as Parameters<typeof contract.query>[1];
		const result = await contract.query(message, args);
		if (!result.success) {
			throw new Error(`${message} dry-run reverted: ${formatDryRunError(result.value)}`);
		}
		return result.value;
	}

	return {
		contract,

		getNativeToEthRatio,

		isAddressMapped(address: string): Promise<boolean> {
			return sdk.addressIsMapped(address);
		},

		getMarketCount(origin: string = ZERO_READ_ORIGIN): Promise<bigint> {
			return readMessage<bigint>("getMarketCount", undefined, origin);
		},

		getResolutionBond(origin: string = ZERO_READ_ORIGIN): Promise<bigint> {
			return readMessage<bigint>("resolutionBond", undefined, origin);
		},

		getDisputeWindow(origin: string = ZERO_READ_ORIGIN): Promise<bigint> {
			return readMessage<bigint>("disputeWindow", undefined, origin);
		},

		getOwner(origin: string = ZERO_READ_ORIGIN): Promise<string> {
			return readMessage<string>("owner", undefined, origin);
		},

		async getMarket(marketId: bigint, origin: string = ZERO_READ_ORIGIN): Promise<RawMarket> {
			const res = await readMessage<{
				creator: string;
				question: string;
				resolutionTimestamp: bigint;
				state: number;
				proposedOutcome: boolean;
				yesPool: bigint;
				noPool: bigint;
			}>("getMarket", { marketId }, origin);
			return { id: marketId, ...res };
		},

		getUserPosition(
			marketId: bigint,
			user: string,
			origin: string = ZERO_READ_ORIGIN,
		): Promise<UserPosition> {
			return readMessage<UserPosition>("getUserPosition", { marketId, user }, origin);
		},

		async createMarket(
			question: string,
			resolutionTimestamp: bigint,
			origin: string,
			signer: PolkadotSigner,
		) {
			const dry = await dryRunWrite(
				"createMarket",
				{ question, resolutionTimestamp },
				origin,
			);
			return dry.send().signSubmitAndWatch(signer);
		},

		async buyShares(
			marketId: bigint,
			outcome: boolean,
			valueWei: bigint,
			origin: string,
			signer: PolkadotSigner,
		) {
			const nativeValue = await weiToNative(valueWei);
			const dry = await dryRunWrite(
				"buyShares",
				{ marketId, outcome },
				origin,
				nativeValue,
			);
			return dry.send().signSubmitAndWatch(signer);
		},

		async resolveMarket(
			marketId: bigint,
			outcome: boolean,
			bondWei: bigint,
			origin: string,
			signer: PolkadotSigner,
		) {
			const nativeValue = await weiToNative(bondWei);
			const dry = await dryRunWrite(
				"resolveMarket",
				{ marketId, outcome },
				origin,
				nativeValue,
			);
			return dry.send().signSubmitAndWatch(signer);
		},

		async disputeResolution(
			marketId: bigint,
			bondWei: bigint,
			origin: string,
			signer: PolkadotSigner,
		) {
			const nativeValue = await weiToNative(bondWei);
			const dry = await dryRunWrite(
				"disputeResolution",
				{ marketId },
				origin,
				nativeValue,
			);
			return dry.send().signSubmitAndWatch(signer);
		},

		async godResolve(
			marketId: bigint,
			outcome: boolean,
			origin: string,
			signer: PolkadotSigner,
		) {
			const dry = await dryRunWrite("godResolve", { marketId, outcome }, origin);
			return dry.send().signSubmitAndWatch(signer);
		},

		async claimWinnings(marketId: bigint, origin: string, signer: PolkadotSigner) {
			const dry = await dryRunWrite("claimWinnings", { marketId }, origin);
			return dry.send().signSubmitAndWatch(signer);
		},

		async setResolutionBond(amount: bigint, origin: string, signer: PolkadotSigner) {
			const dry = await dryRunWrite("setResolutionBond", { amount }, origin);
			return dry.send().signSubmitAndWatch(signer);
		},

		async setDisputeWindow(duration: bigint, origin: string, signer: PolkadotSigner) {
			const dry = await dryRunWrite("setDisputeWindow", { duration }, origin);
			return dry.send().signSubmitAndWatch(signer);
		},
	};
}

type TxObservable = {
	subscribe: (o: { next: (ev: unknown) => void; error: (e: unknown) => void }) => {
		unsubscribe: () => void;
	};
};

export function mapAccount(typedApi: ReviveSdkTypedApi, signer: PolkadotSigner): TxObservable {
	const revive = typedApi.tx.Revive as unknown as {
		map_account: () => { signSubmitAndWatch: (s: PolkadotSigner) => TxObservable };
	};
	return revive.map_account().signSubmitAndWatch(signer);
}

export async function loadMarkets(
	typedApi: ReviveSdkTypedApi,
	contractAddress: string,
	origin: string = ZERO_READ_ORIGIN,
): Promise<RawMarket[]> {
	const api = createPredictionMarketContract(typedApi, contractAddress);
	const count = await api.getMarketCount(origin);
	const markets: RawMarket[] = [];
	for (let i = 0n; i < count; i++) {
		markets.push(await api.getMarket(i, origin));
	}
	markets.reverse();
	return markets;
}
