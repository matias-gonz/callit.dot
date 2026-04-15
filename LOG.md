# Change Log

## Remove PoE Pallet (`551e502`)

Removed the Proof of Existence pallet and all references across the stack:

- **Pallet**: Deleted `blockchain/pallets/template/` (lib, tests, benchmarks, weights, mock).
- **Runtime**: Removed `Statement` (index 40) and `TemplatePallet` (index 50) from the runtime, their `Config` impls, the `ValidateStatement` runtime API, and `pallet-template`/`pallet-statement`/`sp-statement-store` dependencies.
- **CLI**: Removed the `pallet` subcommand and `commands/pallet.rs`.
- **Frontend**: Deleted `PalletPage.tsx`, removed its route/nav entry, removed the "Pallet PoE" feature card from the home page, and dropped `templatePallet` detection from the connection hook and store.
- **PAPI descriptors**: Regenerated to reflect the smaller runtime metadata.
