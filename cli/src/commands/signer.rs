use alloy::signers::local::{coins_bip39::English, MnemonicBuilder, PrivateKeySigner};

pub const ALICE_KEY: &str = "0x5fb92d6e98884f76de468fa3f6278f8807c48bebc13595d45af5bdc4da702133";
pub const BOB_KEY: &str = "0x8075991ce870b93a8870eca0c0f91913d12f47948ca0fd25b49c6fa7cdbeee8b";
pub const CHARLIE_KEY: &str = "0x0b6e18cafb6ed99687ec547bd28139cafbd3a4f28014f8640076aba0082bf262";

/// Resolve a signer from one of several input forms:
/// - `alice` / `bob` / `charlie` (well-known Substrate dev accounts, Ethereum-format)
/// - `0x<64 hex chars>` raw Ethereum private key
/// - a BIP-39 mnemonic phrase (12/15/18/21/24 words, English wordlist)
///
/// When `account_index` is `None`, mnemonics default to index 0 on the standard
/// Ethereum derivation path (`m/44'/60'/0'/0/<index>`).
pub fn resolve_signer(
	input: &str,
	account_index: Option<u32>,
) -> Result<PrivateKeySigner, Box<dyn std::error::Error>> {
	let trimmed = input.trim();
	let lowered = trimmed.to_lowercase();

	match lowered.as_str() {
		"alice" => Ok(ALICE_KEY.parse()?),
		"bob" => Ok(BOB_KEY.parse()?),
		"charlie" => Ok(CHARLIE_KEY.parse()?),
		_ => {
			if let Some(stripped) = trimmed.strip_prefix("0x").or(Some(trimmed)) {
				let hex_like = stripped.trim_start_matches("0x");
				if hex_like.len() == 64 && hex_like.chars().all(|c| c.is_ascii_hexdigit()) {
					let with_prefix = if trimmed.starts_with("0x") {
						trimmed.to_string()
					} else {
						format!("0x{trimmed}")
					};
					return Ok(with_prefix.parse()?);
				}
			}

			let word_count = trimmed.split_whitespace().count();
			if matches!(word_count, 12 | 15 | 18 | 21 | 24) {
				let signer = MnemonicBuilder::<English>::default()
					.phrase(trimmed)
					.index(account_index.unwrap_or(0))?
					.build()?;
				return Ok(signer);
			}

			Err(format!(
				"Could not parse signer. Expected dev name (alice/bob/charlie), \
				0x-prefixed 32-byte hex private key, or a BIP-39 mnemonic phrase. \
				Got: {} ({} words).",
				preview(trimmed),
				word_count
			)
			.into())
		},
	}
}

fn preview(s: &str) -> String {
	if s.len() <= 16 {
		s.to_string()
	} else {
		format!("{}…{}", &s[..6], &s[s.len().saturating_sub(4)..])
	}
}

pub fn dev_signers() -> [(&'static str, PrivateKeySigner); 3] {
	[
		("Alice", ALICE_KEY.parse().expect("valid alice key")),
		("Bob", BOB_KEY.parse().expect("valid bob key")),
		("Charlie", CHARLIE_KEY.parse().expect("valid charlie key")),
	]
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn resolves_dev_names() {
		assert!(resolve_signer("alice", None).is_ok());
		assert!(resolve_signer("Alice", None).is_ok());
		assert!(resolve_signer("BOB", None).is_ok());
		assert!(resolve_signer("charlie", None).is_ok());
	}

	#[test]
	fn resolves_raw_private_key() {
		assert!(resolve_signer(ALICE_KEY, None).is_ok());
		let no_prefix = &ALICE_KEY[2..];
		assert!(resolve_signer(no_prefix, None).is_ok());
	}

	#[test]
	fn resolves_mnemonic() {
		let phrase = "test test test test test test test test test test test junk";
		let signer = resolve_signer(phrase, None).expect("mnemonic must resolve");
		assert_eq!(
			format!("{:?}", signer.address()).to_lowercase(),
			"0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"
		);
	}

	#[test]
	fn mnemonic_respects_index() {
		let phrase = "test test test test test test test test test test test junk";
		let signer = resolve_signer(phrase, Some(1)).expect("mnemonic must resolve");
		assert_eq!(
			format!("{:?}", signer.address()).to_lowercase(),
			"0x70997970c51812dc3a010c7d01b50e0d17dc79c8"
		);
	}

	#[test]
	fn rejects_garbage() {
		assert!(resolve_signer("not-a-key", None).is_err());
		assert!(resolve_signer("0xnothex", None).is_err());
	}
}
