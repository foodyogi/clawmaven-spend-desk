# Spend Desk treasury contract (NEAR testnet) — placeholder

Work in progress on the `near` branch. No contract code yet.

Planned, per the NEAR build brief (Rust, near-sdk-rs, testnet only):

- The contract holds the demo testnet NEAR and pays contractors from its own balance with a zero-deposit `payout` method.
- The Spend Desk agent signs only with a **function-call access key** scoped to this contract and the payout method, with a finite gas allowance. That key cannot transfer NEAR or add keys itself.
- Enforced on chain: owner-only pause (kill switch), per-payout cap, total budget cap, allowed payees, idempotency key (a retry can't pay twice), and an audit log, all readable through view methods.
- Sandbox tests with `cargo test`; build with `cargo near build non-reproducible-wasm`.

The owner's full-access key never goes into the app's `.env` or Netlify. Owner actions (deploy, fund, pause, revoke the agent key) are signed with NEAR CLI from the owner's local key store.
