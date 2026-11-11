# Spend Desk treasury contract (NEAR testnet)

Rust / near-sdk contract that holds the Spend Desk demo funds and pays contractors from its own balance. The Spend Desk agent calls `payout` with a **function-call access key** scoped to this contract and method, which cannot move NEAR on its own.

## Methods

| Method | Who | What |
| --- | --- | --- |
| `new(owner, agent, allowed_payees, per_payout_cap_yocto)` | the treasury account, once, at deploy (`#[private]`) | Sets the owner, the only agent account allowed to request payouts, the payee allowlist and a temporary per-payout cap. |
| `payout(payee, amount_yocto, memo, idempotency_key)` | the agent account only, **zero deposit** | Refuses an unknown caller, a payee not on the allowlist, an amount over the cap, or an idempotency key already used. Otherwise records the spend and transfers from the contract balance. If the transfer fails, a callback rolls back the spend and releases the key. |
| `get_spent`, `get_per_payout_cap`, `is_allowed_payee`, `is_key_used`, `get_config` | anyone (view) | Totals, limits and allowlist. |

Step C (testnet smoke) scope. Pause, a total budget cap, owner admin methods and an on-chain audit log come next.

## Build and test

```bash
cargo test                              # unit tests + local NEAR Sandbox tests (no testnet account needed)
cargo near build non-reproducible-wasm  # writes target/near/spend_desk_treasury.wasm
```

Testnet only. No real funds.
