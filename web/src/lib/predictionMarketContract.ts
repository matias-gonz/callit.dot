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
}

export function createPredictionMarketContract(
	typedApi: ReviveSdkTypedApi,
	contractAddress: string,
) {
	const sdk = createReviveSdk(typedApi, contracts.predictionMarket, { atBest: true });
	const contract = sdk.getContract(contractAddress);

	return {
		isAddressMapped(address: string): Promise<boolean> {
			return sdk.addressIsMapped(address);
		},

		async getMarketCount(origin: string = ZERO_READ_ORIGIN): Promise<bigint> {
			const result = await contract.query("getMarketCount", { origin });
			if (!result.success) throw new Error("getMarketCount query failed");
			return result.value.response as bigint;
		},

		async getMarket(marketId: bigint, origin: string = ZERO_READ_ORIGIN): Promise<RawMarket> {
			const result = await contract.query("getMarket", {
				origin,
				data: { marketId },
			});
			if (!result.success) throw new Error(`getMarket(${marketId}) query failed`);
			const response = result.value.response as {
				creator: string;
				question: string;
				resolutionTimestamp: bigint;
				state: number;
			};
			return {
				id: marketId,
				creator: response.creator,
				question: response.question,
				resolutionTimestamp: response.resolutionTimestamp,
				state: response.state,
			};
		},

		async dryRunCreateMarket(
			question: string,
			resolutionTimestamp: bigint,
			origin: string,
		) {
			const result = await contract.query("createMarket", {
				origin,
				data: { question, resolutionTimestamp },
			});
			if (!result.success) {
				const v = result.value as Record<string, unknown> | undefined;
				const detail = v
					? JSON.stringify(v, (_k, val) =>
							typeof val === "bigint" ? val.toString() : val,
						)
					: "unknown error";
				throw new Error(`createMarket dry-run reverted: ${detail}`);
			}
			return result.value;
		},

		async createMarket(
			question: string,
			resolutionTimestamp: bigint,
			origin: string,
			signer: PolkadotSigner,
		) {
			const dryRun = await this.dryRunCreateMarket(question, resolutionTimestamp, origin);
			return dryRun.send().signSubmitAndWatch(signer);
		},

		contract,
	};
}

type TxObservable = {
	subscribe: (o: {
		next: (ev: unknown) => void;
		error: (e: unknown) => void;
	}) => { unsubscribe: () => void };
};

export function mapAccount(
	typedApi: ReviveSdkTypedApi,
	signer: PolkadotSigner,
): TxObservable {
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
