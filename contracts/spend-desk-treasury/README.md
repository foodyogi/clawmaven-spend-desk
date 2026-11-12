# Spend Desk treasury contract (NEAR testnet)

Rust / near-sdk contract that holds the Spend Desk demo funds and pays contractors from its own balance. The Spend Desk agent calls `payout` with a **function-call access key** scoped to this contract and the `payout` method only. That key cannot transfer NEAR, add keys, or call the owner methods below.

Deployed on testnet at `m22spend-treasury2.testnet`.

## Methods

| Method | Who | What |
| --- | --- | --- |
| `new(owner, agent, allowed_payees, per_payout_cap_yocto, total_cap_yocto)` | the treasury account, once, at deploy (`#[private]`) | Sets the owner, the only agent allowed to request payouts, the payee allowlist and both caps. |
| `payout(payee, amount_yocto, memo, idempotency_key)` | agent only, **zero deposit** | Pays from the contract balance and returns `true` when the transfer lands. Returns `false` and records the refusal when the treasury is paused, the key was already used, the payee isn't allowed, or the per-payout or total cap would be exceeded. A failed transfer is rolled back: the spend and key are released and the entry is marked `TransferFailed`. |
| `pause`, `unpause` | owner only | Kill switch: while paused, every payout is refused. |
| `set_per_payout_cap`, `set_total_cap`, `set_allowed_payees`, `reset_spent` | owner only | Change the caps or the allowlist, or start a new budget period (spent back to 0; the audit log and used keys are kept). |
| `get_config`, `get_spent`, `get_remaining`, `get_per_payout_cap`, `get_total_cap`, `is_paused`, `is_allowed_payee`, `is_key_used` | anyone (view) | Status, limits and totals. Remaining never goes below 0. |
| `get_audit_log(from_index?, limit?)` | anyone (view) | Audit entries oldest first, up to 50 per page: index, time, payee, amount, key, memo and outcome. |

**What's recorded:** every payout request from the agent, including refusals. Calls from any other account, an attached deposit, and malformed arguments fail the transaction and are not recorded. That way outsiders can't grow the log, whose storage the contract pays for. The agent's own requests are bounded by its key's gas allowance.

## Build and test

```bash
cargo test                              # unit tests + local NEAR Sandbox tests (no testnet account needed)
cargo near build non-reproducible-wasm  # writes target/near/spend_desk_treasury.wasm
```

The Sandbox test covers:

- a payout, a repeated key, and owner or stranger callers
- a disallowed payee, over the per-payout cap, over the total cap, and an attached deposit
- owner-only methods called by the agent or a stranger
- pause, then unpause
- a failed transfer rolled back
- the owner setters and `reset_spent`
- the exact audit log sequence and paging

Testnet only. No real funds.
