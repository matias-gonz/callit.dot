import {
	createAccountsProvider,
	sandboxTransport,
	createPapiProvider,
	hostApi,
	type ProductAccount,
} from "@novasamatech/product-sdk";
import { enumValue } from "@novasamatech/host-api";
import { createClient, AccountId, type PolkadotSigner } from "polkadot-api";

export interface HostProviderResult {
	client: ReturnType<typeof createClient>;
	getSigner: () => PolkadotSigner | null;
	getAddress: () => string | null;
	subscribeAccounts: (cb: (accounts: Array<{ address: string; name?: string }>) => void) => void;
}

export interface HostProviderOptions {
	genesis: `0x${string}`;
	ss58Prefix?: number;
}

export function isInsideHost(): boolean {
	if (typeof window === "undefined") return false;
	try {
		return window.parent !== window;
	} catch {
		return true;
	}
}

export async function setupHostProvider(options: HostProviderOptions): Promise<HostProviderResult> {
	const { genesis, ss58Prefix = 0 } = options;
	const accountsProvider = createAccountsProvider(sandboxTransport);
	const addressCodec = AccountId(ss58Prefix);

	await hostApi.permission(enumValue("v1", { tag: "TransactionSubmit", value: undefined })).match(
		() => {},
		(err: unknown) => console.warn("TransactionSubmit permission denied:", err),
	);

	const papiProvider = createPapiProvider(genesis);
	const client = createClient(papiProvider);

	let currentAccount: { publicKey: Uint8Array } | null = null;
	let currentAddress: string | null = null;

	async function fetchAccount(): Promise<{ address: string; name?: string } | null> {
		const res = await accountsProvider.getNonProductAccounts();
		return res.match(
			(accts: { publicKey: Uint8Array; name: string | undefined }[]) => {
				const acct = accts[0];
				if (!acct) return null;
				currentAccount = { publicKey: acct.publicKey };
				currentAddress = addressCodec.dec(acct.publicKey);
				return { address: currentAddress, name: acct.name };
			},
			() => {
				currentAccount = null;
				currentAddress = null;
				return null;
			},
		);
	}

	const initial = await fetchAccount();

	return {
		client,
		getSigner() {
			if (!currentAccount) return null;
			return accountsProvider.getNonProductAccountSigner(
				currentAccount as unknown as ProductAccount,
			);
		},
		getAddress() {
			return currentAddress;
		},
		subscribeAccounts(cb) {
			cb(initial ? [initial] : []);
			accountsProvider.subscribeAccountConnectionStatus(async (status: string) => {
				if (status === "connected") {
					const acct = await fetchAccount();
					cb(acct ? [acct] : []);
				} else {
					currentAccount = null;
					currentAddress = null;
					cb([]);
				}
			});
		},
	};
}
