//! Library surface of `callit-cli`.
//!
//! The binary (`main.rs`) is a thin wrapper around this crate. Other binaries
//! — for example a future MCP server — can depend on `callit-cli` as a library
//! and reuse the same signer / deployments / contract-call logic.
//!
//! The most interesting entry point for programmatic callers is
//! [`commands::market::api`], which exposes typed async functions for every
//! PredictionMarket operation.

pub mod commands;

pub use commands::{chain, contract, deployments, market, prove, signer};
