# NEAR kill switch demo (testnet)

A step-by-step script for recording the Spend Desk NEAR kill switch. Everything is on **NEAR testnet**; no real money moves.

The kill switch has two parts, and the app fails closed after either one:

1. **Pause the treasury contract** (owner only). Every payout request is refused on chain (`RefusedPaused`).
2. **Revoke the agent's function-call key.** The network rejects the agent's transactions, so it can't even ask.

| | |
| --- | --- |
| Treasury contract | `m22spend-treasury2.testnet` |
| Owner (pauses, unpauses) | `m22spend-owner.testnet` |
| Agent (holds the payout-only key) | `m22spend-agent.testnet` |
| Agent payout key to revoke | `ed25519:6GyBn3DoaeML2wyiTLNrWfbLn4E5gMXhw3NviwwVaLL` |
| Payees | `m22spend-payee1.testnet` (logo, site), `payee2` (blog), `payee3` (video) |

Owner commands are signed with keys from your macOS keychain. `pnpm near:pause`, `pnpm near:unpause` and `pnpm near:revoke` print the exact commands; they never send anything.

## Before you record

```bash
cd ~/Development/clawmaven-spend-desk
```

**1. Reset the on-chain spent total** so the demo has the full 0.2 NEAR budget:

```bash
near contract call-function as-transaction m22spend-treasury2.testnet reset_spent json-args '{}' prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' sign-as m22spend-owner.testnet network-config testnet sign-with-keychain send
```

```bash
near contract call-function as-read-only m22spend-treasury2.testnet get_config json-args '{}' network-config testnet now
```

Expected: `"paused": false`, `"spent_yocto": "0"`, `"remaining_yocto": "200000000000000000000000"` (0.2 NEAR).

**2. Start the app:** `pnpm dev`, then open http://localhost:8080/desk.

**3. Get the app ready.** Press **Reset demo** and confirm. Then in **Spend Policy**, choose **Edit**, select **NEAR testnet**, and choose **Save policy**.

Expected: the banner reads **Payout rail: NEAR testnet**, paid from `m22spend-treasury2.testnet`. The budget shows $0 spent of $200.

## The recording

### Step 1: pay one (normal operation)

In the agent chat, send **`Close out this week's jobs.`**

Expected, in about a minute:

- **Logo tweak, $18:** receipt `auto_paid`, with a **NEAR tx** link to testnet.nearblocks.io. 0.018 NEAR went to `m22spend-payee1.testnet`.
- **Blog edit, $40** and **Video edit, $120:** in the queue, "Needs your approval".
- **Site rebuild, $400:** `blocked_over_budget`. Nothing was sent to the NEAR treasury.
- Budget: $18 spent, $182 remaining.

### Step 2: pause the treasury (kill switch 1)

```bash
pnpm near:pause
```

Run the printed pause command:

```bash
near contract call-function as-transaction m22spend-treasury2.testnet pause json-args '{}' prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' sign-as m22spend-owner.testnet network-config testnet sign-with-keychain send
```

Expected: the transaction succeeds, and `get_config` shows `"paused": true`.

### Step 3: a payout attempt is refused on chain

In the queue, **Approve** the **Blog edit, $40**, and confirm.

Expected:

- Receipt **`blocked_on_chain`**, approver `contract`, with detail "The treasury contract refused the payout on chain (**RefusedPaused**); no NEAR moved and the budget was released."
- The receipt still has a **NEAR tx** link: the request is on chain, recorded and refused.
- Budget unchanged at $18 spent. The blog task is back to "completed".

### Step 4: unpause

```bash
pnpm near:unpause
```

```bash
near contract call-function as-transaction m22spend-treasury2.testnet unpause json-args '{}' prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' sign-as m22spend-owner.testnet network-config testnet sign-with-keychain send
```

Expected: `"paused": false`.

### Step 5: revoke the agent's key (kill switch 2)

```bash
pnpm near:revoke
```

Run the printed delete command. It's signed by the agent account's **full-access** key from your keychain; keep that key.

```bash
near account delete-keys m22spend-agent.testnet public-keys 'ed25519:6GyBn3DoaeML2wyiTLNrWfbLn4E5gMXhw3NviwwVaLL' network-config testnet sign-with-keychain send
```

```bash
near account list-keys m22spend-agent.testnet network-config testnet now
```

Expected: the payout key `ed25519:6GyBn…aLL` is gone, and only the full-access key remains.

### Step 6: a payout attempt fails closed

In the queue, **Approve** the **Video edit, $120**. You can **Edit** it to $100 first.

Expected:

- Receipt **`near_error`**, with detail "NEAR error (payout not confirmed, budget released): … the agent's NEAR key was rejected (revoked or replaced); the owner must add a new function-call key".
- **No** NEAR tx link: the network refused the transaction, so nothing reached the contract.
- Budget unchanged at $18 spent. The video task is back to "completed". The app did not crash and did not fall back to PayPal.

### Step 7: add a new key and recover

Add a fresh payout-only key, scoped to the treasury, with a finite allowance:

```bash
near account add-key m22spend-agent.testnet grant-function-call-access --allowance '0.25 NEAR' --contract-account-id m22spend-treasury2.testnet --function-names payout autogenerate-new-keypair save-to-legacy-keychain network-config testnet sign-with-keychain send
```

Load the new key into `.env`. This checks its scope on chain and never prints the private key.

```bash
pnpm near:set-agent-key
```

Expected: `function-call key for payout (accepted)` and `Wrote NEAR_AGENT_PRIVATE_KEY to .env`.

Restart the app (stop `pnpm dev`, then run it again) so it loads the new key. Then in the chat, send **`Propose the blog edit again and leave it for my approval.`** and **Approve** it in the queue.

Expected: `approved_and_paid`, with a NEAR tx link. 0.04 NEAR went to `m22spend-payee2.testnet`.

## After recording

- In **Spend Policy**, choose **Edit**, select **PayPal sandbox**, and save. Then press **Reset demo**.
- Optionally reset the on-chain total again with the `reset_spent` command above.
- See every attempt, including the refused one, in the on-chain audit log:

```bash
near contract call-function as-read-only m22spend-treasury2.testnet get_audit_log json-args '{"from_index":"13"}' network-config testnet now
```

Expected new entries: `Paid` (logo), `RefusedPaused` (blog), then `Paid` (blog, new key). The revoked-key attempt is not there, because the network rejected it before it reached the contract.

## If something goes wrong

- **The pause or unpause transaction fails:** make sure it is signed by `m22spend-owner.testnet`. The agent's key can't call them, by design.
- **`pnpm near:set-agent-key` says no matching key:** check that `NEAR_CONTRACT_ID=m22spend-treasury2.testnet` in `.env`, and that the add-key command used `save-to-legacy-keychain`.
- **The app still uses the old key:** restart `pnpm dev`. The app reads `.env` at startup.
