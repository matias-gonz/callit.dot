# pallet-revive gotchas

Two things you need to know when calling a `pallet-revive` contract from a Substrate frontend.

## 1. Map the account first

Substrate accounts are 32 bytes; `pallet-revive` uses 20-byte H160. Every account must run `Revive::map_account` once before its first contract call, otherwise it reverts with `Revive: AccountUnmapped`.

```ts
if (!(await api.isAddressMapped(origin))) {
    await watchTx(mapAccount(typedApi, signer), "map_account");
}
```

Deploy scripts map the deployer too, swallowing `AlreadyMapped`. The account needs a small native balance to pay for the mapping.

## 2. `value` is in native plancks, not contract wei

`sdk-ink` / `Revive.call` take `value` in Substrate-native units. The runtime scales it to the contract's 18-decimal `msg.value`:

```
msg.value (wei) = substrate_value (plancks) × Revive::NativeToEthRatio
```

On Asset Hub Paseo (PAS = 10 dec, ratio = `10^8`): `0.01 PAS` → SDK `value = 10^8` → `msg.value = 10^16`.

Passing `parseEther("0.01") = 10^16` as the SDK `value` asks revive to move `10^6 PAS` and errors with `TransferFailed` — even on a well-funded account.

**Fix**: keep all app-level amounts in contract-wei (what `parseEther` / `formatEther` produce, what the contract stores), and divide by `NativeToEthRatio` right before calling the SDK:

```ts
const nativeValue = valueWei / (await typedApi.constants.Revive.NativeToEthRatio());
```

Rules of thumb:

- Contract reads / stores / `msg.value` checks → wei.
- `sdk-ink` / `Revive.call` `value` field → plancks (= wei ÷ ratio).
- Don't hardcode the ratio; it varies per chain.
- `TransferFailed` on a funded account ≈ this bug.
