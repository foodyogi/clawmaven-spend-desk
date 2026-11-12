# ClawMaven Spend Desk

**Live app:** https://clawmaven-spend-desk.netlify.app · **Demo video:** https://youtu.be/Cut2wc_Txrs

> **NEAR HACKATHON judges:** start at [NEAR HACKATHON: NEAR testnet payout rail](#near-hackathon-near-testnet-payout-rail). The live app and video above show the PayPal entry (baseline).

An AI agent that pays a small team's contractors through **PayPal Payouts (sandbox)** once work is marked done, with guardrails:

- Payouts up to the **auto-approve limit** (default $25) run automatically.
- Larger payouts pause for a **human to edit and approve** (or reject).
- Anything over the **remaining monthly budget** (default cap $200) or to a payee not on the allowed list is blocked before it reaches PayPal.
- Every attempt writes a **receipt**.

**Sandbox only. No real money moves.**

### Human-only spend policy

The cap, auto-approve limit and allowed payees live in Postgres (defaults from [`policy.json`](./policy.json)) and can be changed from the **Spend Policy** card. Only a person can change them: `update-policy` is hidden from the agent and from MCP, accepted only from the app UI, and rejects any other caller. The agent can read the policy with `get-policy` but can never raise its own limits. **Reset demo** restores the defaults.

## For judges

### Get in

1. Open https://clawmaven-spend-desk.netlify.app. You see the ClawMaven Spend Desk sign-in page.
2. Choose **Create account** and enter any email address and a password of at least 12 characters, twice. Sign-up is email and password only: no Google sign-in, no magic link.
3. No verification email is sent: this deployment has no email provider, so the framework doesn't require one. You are signed in straight away and land on the **Spend Desk** page (`/desk`). Next time, use **Sign in** with the same email and password.

### Run the demo story

1. On the Spend Desk page, press **Reset demo** (top right) and confirm. The demo returns to four completed jobs, $0 spent, and the default policy ($200 monthly cap, $25 auto-approve limit).
2. Open the agent chat with the panel button at the top right, type **`Close out this week's jobs.`** and send it. The agent takes about a minute and a half.
3. What to expect:
   - **Logo tweak, $18:** auto-paid. It's under the $25 limit, so a PayPal sandbox payout is sent and the receipt says `auto_paid` with a PayPal batch id.
   - **Blog edit, $40** and **Video edit, $120:** proposed and left in the **Approval queue** with a "Needs your approval" chip. The agent does not pay these on its own.
   - **Site rebuild, $400:** blocked, because it's over the remaining budget. The receipt says `blocked_over_budget` and nothing is sent to PayPal.
   - The budget bar, queue and receipts ledger update while the agent works, with no reload.
4. Finish as a human: in the queue, **Edit** the Video payment from $120 to $100, then **Approve** it and the Blog payment. The final budget is $158 spent, $42 remaining. Click any receipt to see its policy result, approver, PayPal batch and item ids, and the budget left.

### Try the policy

In the **Spend Policy** card, choose **Edit** and lower **Auto-approve up to** (for example, to $10). The queue's status chips change straight away: a payment that was "Will auto-pay" now shows "Needs your approval". Lower the **Monthly cap** below a pending amount and its chip becomes "Will be blocked: over budget". Invalid values (a cap outside $1 to $1,000, an auto limit above the cap, more than 10 payees, or a bad email) are refused with a message. **Reset demo** restores the defaults.

### Good to know

- Everyone shares **one sandbox ledger**: other judges may have run the demo, so press **Reset demo** first. Your chat threads are your own.
- Payouts go to PayPal **sandbox** accounts. **No real money moves.**

## How PayPal is used

Spend Desk calls the **PayPal Payouts REST API in the sandbox** directly with `fetch`. There is no PayPal SDK.

| Call | What it does |
| --- | --- |
| `POST /v1/oauth2/token` | Gets an OAuth access token with the sandbox app's client id and secret (client credentials grant). |
| `POST /v1/payments/payouts` | Creates a single-item payout batch to the payee's PayPal email. `sender_batch_id` is the Spend Desk payment id, so PayPal rejects a repeat and one payment can never be paid twice. |
| `GET /v1/payments/payouts/{batch_id}` | Polls the batch every 3 s, for up to 30 s, until the item leaves `PENDING`. This records the payout item id and status on the receipt. |

- **Code:** [`server/spend-desk/paypal.ts`](./server/spend-desk/paypal.ts) (`sendPayout`) makes these calls. Its only caller is the [`execute-payout`](./actions/execute-payout.ts) action. [`scripts/paypal-payout-smoke.ts`](./scripts/paypal-payout-smoke.ts) (`pnpm paypal:smoke`) makes the same three calls to send one $1.00 sandbox payout as a connectivity check.
- **Sandbox only:** the base URL comes from `PAYPAL_API_BASE`, and the code refuses any host that isn't a PayPal sandbox host.
- **Blocked or rejected payments never reach PayPal.** `execute-payout` handles a rejected payment, a payee not on the allowed list, and an amount over the remaining budget before `sendPayout` is called. Each writes its receipt (`rejected`, `blocked_payee_not_allowed`, `blocked_over_budget`) with no PayPal batch id.
- **Budget accounting:** the budget is reserved in one atomic database update before the payout, and released if PayPal returns an error. That failure is recorded as `paypal_error`.

## How AI is used

- **The agent:** the in-app agent runs on **Anthropic Claude** (the `anthropic` engine; default model `claude-sonnet-5-5`) through **Builder.io's [Agent-Native](https://github.com/BuilderIO/agent-native) framework**. Its instructions are in [`server/plugins/agent-chat.ts`](./server/plugins/agent-chat.ts).
- **Its tools:** every capability is a `defineAction` in [`actions/`](./actions) that the agent calls as a tool and the UI calls through the same code: `list-completed-tasks`, `propose-payment`, `edit-payment`, `list-payments`, `execute-payout`, `get-budget`, `get-policy`, `list-receipts`.
- **The approval gate:** `execute-payout` sets a `needsApproval` predicate. A payout over the auto-approve limit that fits the budget pauses the agent until a person approves that exact call, either with the Approve card in chat or the Approve button in the queue. At or under the limit, it runs. Over the remaining budget, it doesn't pause, because `run()` refuses it.
- **Live policy:** the agent reads the current limits with `get-policy`, and `execute-payout` re-checks the live policy and budget whenever it runs.
- **Credentials:** the model never sees PayPal credentials. They live only in server environment variables.

**Governance:** only a human can change the spending policy. `update-policy` is hidden from the agent, accepted only from the signed-in app UI, and rejects any other caller, so the agent can never raise its own limits.

## What came from the template and what is new

The repo was started on Nov 7, 2026 with the Agent-Native create command (`--standalone --template chat`).

**From the template and other pre-existing work:**

- The Agent-Native framework and its chat template: chat UI, threads, sign-in, agent loop, the approval UI for `needsApproval`, and the toolkit UI components.
- The PayPal Payouts sandbox REST API.
- The ClawMaven product concept (budget caps, approval gates, receipts) and its logo assets, from https://clawmaven.com.

**New in this repo, from the git history:**

| Date | Commit | What changed |
| --- | --- | --- |
| Nov 7 | `809fcea` | Scaffolded the chat template, plus MIT license, `.env.example` and a version label. |
| Nov 7 | `b1384d6` | Data model (tasks, payments, receipts, budget) on Neon Postgres; `policy.json` and idempotent demo seed; seven actions with the `needsApproval` policy gate; PayPal Payouts client; sandbox smoke script; tests. |
| Nov 7 | `8642b67` | Spend Desk page (budget, approval queue, receipts ledger, receipt detail, Reset demo); `list-payments`; agent instructions. |
| Nov 7 | `b28c55c` | Fix: the first chat turn no longer sends a model the Anthropic engine doesn't offer. |
| Nov 7 | `9d1cc2d` | Netlify-ready config; template branding and links removed; policy bundled into the server; `DEPLOY.md`. |
| Nov 7 | `32bccb0` | ClawMaven branding, brand colour and page titles. |
| Nov 11 | `f551ee1` | Editable, human-only Spend Policy (`get-policy`, `update-policy`, Spend Policy card). |

## NEAR HACKATHON: NEAR testnet payout rail

**This branch (`near`) is ClawMaven Spend Desk's entry for the [NEAR HACKATHON](https://nearhackathon.com). It is Paul Rodney Turner's only NEAR HACKATHON project.** Tracks: AI Security & Defense (primary), Agent Economy, Autonomous Business. **Testnet only. No real funds.**

### The problem

An AI agent that pays people needs spending power, but an agent's key, prompt or tools can be compromised. App-level rules alone are not enough: if the agent process holds a wallet key, a bad prompt or a leaked key can drain the wallet. Spend Desk gives the agent a NEAR testnet wallet it can spend from **without ever holding the keys to the money**.

### How NEAR fits

- **Treasury contract.** [`contracts/spend-desk-treasury/`](./contracts/spend-desk-treasury/) (Rust, near-sdk) holds the demo funds on `m22spend-treasury2.testnet` and pays contractors from its own balance.
- **Function-call access key.** The agent signs with a key that can call **only** `payout` on the treasury, with a finite **0.25 NEAR gas allowance**. A function-call key can't attach a deposit, so it can't move NEAR itself. It can't call the owner methods, other contracts, or add or delete keys. The app checks the key's scope on chain and refuses to sign with a full-access key.
- **On-chain caps.** The contract enforces:
  - an agent-only caller, with zero deposit
  - a payee allowlist
  - a per-payout cap (0.15 NEAR) and a total budget cap (0.2 NEAR)
  - one-time idempotency keys (the Spend Desk payment id), so a retry can't pay twice

  These sit **in addition to** the app's policy ($25 auto-approve, $200 monthly cap, human approval in between). Either layer saying no is a hard stop.
- **Kill switch.** The owner can **pause** the contract, so every payout is refused on chain, and can **revoke** the agent's key, so the network refuses the agent's transactions. Either way the app fails closed: a `blocked_on_chain` or `near_error` receipt, the budget released, and no fallback to another rail. See [`docs/near-kill-switch-demo.md`](./docs/near-kill-switch-demo.md).
- **On-chain audit log.** Every payout request from the agent, including refusals (paused, duplicate key, payee not allowed, over a cap), is recorded on chain and readable with `get_audit_log`.
- **Human-only rail switch.** The stored spend policy holds the rail (`paypal` or `near`), the allowed NEAR payees and a fixed **demo-only** USD-to-NEAR rate ($1 = 0.001 testnet NEAR, not a market rate). Like the rest of the policy, only a person can change these, in the Spend Policy card; the agent can't.

```
agent (Claude) ─ execute-payout ─▶ app policy + needsApproval + budget reserve
                                    │  (paypal rail: PayPal sandbox, unchanged)
                                    ▼  (near rail)
          function-call key (payout only, 0.25 NEAR allowance)
                                    ▼
          m22spend-treasury2.testnet: paused? allowlist? caps? key used?
                                    │ yes: transfer from contract balance + audit "Paid"
                                    │ no:  return false + audit "Refused…"
                                    ▼
          receipt: auto_paid / approved_and_paid (tx hash) · blocked_on_chain · near_error
```

### For judges: do X, see Y

**A. No NEAR account needed (about 5 minutes):**

1. `git clone https://github.com/foodyogi/clawmaven-spend-desk && cd clawmaven-spend-desk && git checkout near && pnpm install`
2. `pnpm test`. **See** 85 tests pass, including the NEAR rail (`tests/near-rail.test.ts`) and the kill switch (`tests/near-kill-switch.test.ts`), with NEAR mocked.
3. `cd contracts/spend-desk-treasury && cargo test`. This needs Rust 1.99 and cargo-near. **See** 6 unit tests, plus a Sandbox test that deploys the real wasm to a local NEAR node and checks:
   - a payout and a repeated key
   - unauthorized callers
   - a disallowed payee, both caps and an attached deposit
   - owner-only methods
   - pause and unpause
   - a failed transfer rolled back
   - the exact audit log
4. Read the live contract (no key needed): `near contract call-function as-read-only m22spend-treasury2.testnet get_audit_log json-args '{}' network-config testnet now`. **See** every agent request with its outcome: `Paid`, `RefusedDuplicateKey`, `RefusedOverPerPayoutCap`, `RefusedPaused`.
5. Open the transaction links below on testnet.nearblocks.io.

**B. With your own testnet accounts (full run, about 30 minutes):**

1. Create a treasury account, an agent account and an owner account with `near create-account <id> --useFaucet --networkId testnet`.
2. Build and deploy the contract:

   ```bash
   cd contracts/spend-desk-treasury && cargo near build non-reproducible-wasm
   ```

   ```bash
   near contract deploy <treasury> use-file target/near/spend_desk_treasury.wasm with-init-call new json-args '{"owner":"<owner>","agent":"<agent>","allowed_payees":["m22spend-payee1.testnet","m22spend-payee2.testnet","m22spend-payee3.testnet"],"per_payout_cap_yocto":"150000000000000000000000","total_cap_yocto":"200000000000000000000000"}' prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-keychain send
   ```

   The payees are existing testnet accounts used by the seed data.
3. Add the agent's payout-only key:

   ```bash
   near account add-key <agent> grant-function-call-access --allowance '0.25 NEAR' --contract-account-id <treasury> --function-names payout autogenerate-new-keypair save-to-legacy-keychain network-config testnet sign-with-keychain send
   ```

4. In `.env` (from `.env.example`), set:
   - `NEAR_NETWORK=testnet`, `NEAR_CONTRACT_ID`, `NEAR_AGENT_ACCOUNT_ID`, `NEAR_OWNER_ACCOUNT_ID`
   - `ANTHROPIC_API_KEY` for the agent
   - `AUTH_DISABLED=true` for a local run

   Leave `DATABASE_URL` unset to use a local database. Then run `pnpm near:set-agent-key`, which copies the key into `.env` after checking its scope on chain.
5. `pnpm near:smoke`. **See** a tiny payout with its transaction hash, then the same-key retry refused (`RefusedDuplicateKey`).
6. `pnpm dev`, then open http://localhost:8080/desk.
   - In **Spend Policy**, choose **Edit**, select **NEAR testnet**, and save. **See** the banner say "Payout rail: NEAR testnet".
   - In the chat, send "Close out this week's jobs." **See** $18 auto-paid with a NEAR tx link, $40 and $120 waiting for approval, and $400 blocked.
   - Approve $40, edit $120 to $100 and approve it. **See** the app at $158 / $42 and `get_config` at 0.158 NEAR spent.
7. Kill switch: follow [`docs/near-kill-switch-demo.md`](./docs/near-kill-switch-demo.md). `pnpm near:pause`, `pnpm near:unpause` and `pnpm near:revoke` print the owner commands.

### Baseline vs new work

- **Baseline (not for NEAR judging):** everything up to tag [`paypal-hackathon-submission`](https://github.com/foodyogi/clawmaven-spend-desk/tree/paypal-hackathon-submission) (`c6f747c`, v0.1.8). That covers the Agent-Native app and chat, the PayPal Payouts sandbox rail, the human-only spend policy and the desk screens. It is the PayPal AI Hackathon submission, and `main` and the live site still run it.
- **New NEAR work, to judge:**
  - the treasury contract and its Sandbox tests
  - the function-call key setup and scope checks
  - on-chain caps, allowlist and idempotency
  - the kill switch (pause and key revoke) with fail-closed handling in the app
  - the on-chain audit log
  - the NEAR rail and the human-only rail switch in the app
  - the smoke and owner-command scripts

  All of it is on [`near`](https://github.com/foodyogi/clawmaven-spend-desk/tree/near) after the tag, built Nov 12 to 14, 2026. **Diff:** [paypal-hackathon-submission...near](https://github.com/foodyogi/clawmaven-spend-desk/compare/paypal-hackathon-submission...near).

### Key limits and caveats

- **The agent's key can only call `payout` on the treasury.** It can't attach NEAR, transfer, call `pause` or the setters, call other contracts, or manage keys. A `pause` attempt with it is rejected by the network before it reaches the contract.
- **Allowance exhaustion.** The key's 0.25 NEAR gas allowance pays for its transactions. When it runs out, the network rejects them (`NotEnoughAllowance`): the app records `near_error`, releases the budget, and payouts stop until the owner adds a new key. That's a deliberate fail-closed limit, and the agent can't top it up.
- **Full-access keys stay out of the app.** The agent and owner accounts' full-access keys stay in the owner's local keychain and are never in `.env` or a host. The app refuses to sign with a full-access key.
- **The total cap is cumulative** until the owner calls `reset_spent`. The app's Reset demo can't reset it.
- **Refusals are recorded only for the agent's own calls.** Calls from any other account fail without an audit entry, so outsiders can't grow the log and its storage.
- **Demo-only rate.** The USD-to-NEAR rate is fixed. There is no price oracle.
- **Unconfirmed sends.** If a NEAR transaction times out after reaching the network, the receipt says `near_error` (not confirmed) and the budget is released. A retry of the same payment is still safe, because the contract refuses the duplicate key.
- **Testnet only.** The NEAR rail refuses to run unless `NEAR_NETWORK=testnet`.

### Libraries and versions

| Part | Library | Version |
| --- | --- | --- |
| Contract | near-sdk (Rust) | 5.30.1 |
| Contract build | cargo-near / Rust | 0.23.0 / 1.99.1 |
| Contract tests | near-sandbox, near-api (Rust) | 0.4.0, 0.8 |
| App and scripts | near-api-js | 7.5.3 |
| Owner commands | near-cli-rs | 0.31.1 |
| App | Agent-Native (`@agent-native/core`) | 0.226.0 |
| Testnet RPC | FASTNEAR | https://test.rpc.fastnear.com |

### Testnet accounts

| Role | Account |
| --- | --- |
| Treasury contract | `m22spend-treasury2.testnet` |
| Owner (pause, unpause, setters) | `m22spend-owner.testnet` |
| Agent (payout-only function-call key) | `m22spend-agent.testnet` |
| Payees | `m22spend-payee1.testnet`, `m22spend-payee2.testnet`, `m22spend-payee3.testnet` |

### Testnet transactions

**Checkpoint E: the app's demo story on the NEAR rail** (Nov 12):

| What | Outcome | Transaction |
| --- | --- | --- |
| Owner `reset_spent` | ok | [nCqgTLp4…](https://testnet.nearblocks.io/txns/nCqgTLp4ySN3TXrjvYHjyJR3rJNQNGxaXohLUiSiUN2) |
| Logo $18 auto-paid, 0.018 NEAR to payee1 | `Paid` | [5KKrbvtk…](https://testnet.nearblocks.io/txns/5KKrbvtkJg2vXhPmX8XnYi6Gcx2YyE4hN3KQMLpGKooP) |
| Blog $40 approved, 0.04 NEAR to payee2 | `Paid` | [AJHW4z33…](https://testnet.nearblocks.io/txns/AJHW4z33NF25hVuGHxtZfheiZJVkoGACuyHPoB5sgyN3) |
| Video edited $120 → $100 and approved, 0.1 NEAR to payee3 | `Paid` | [DxkRcm3n…](https://testnet.nearblocks.io/txns/DxkRcm3nuKtUUoWYZLK7vtd5swqyqn9mYDjMQSGaB134) |
| Site $400 | blocked by the app's budget, never sent | none |

**Checkpoint D: hardened contract smoke tests** (Nov 12):

| What | On-chain outcome | Transaction |
| --- | --- | --- |
| Deploy and init `m22spend-treasury2.testnet` | ok | [BFXpDmZD…](https://testnet.nearblocks.io/txns/BFXpDmZDfQnoXFMpRtTXfDRL2GRx2S2K2N9wy5xinoyq) |
| Payout 0.01 NEAR | `Paid` | [6HSr6jUM…](https://testnet.nearblocks.io/txns/6HSr6jUMXEovy7tezciM5M4GQGHGZov5yf9XU25m5whW) |
| Same idempotency key again | `RefusedDuplicateKey` | [KKDf7gMD…](https://testnet.nearblocks.io/txns/KKDf7gMDSWoLXDqeLG7ZhbYEWoeo1bTgABm9WoRnr1m) |
| Payout 0.01 NEAR | `Paid` | [BVAJgo5U…](https://testnet.nearblocks.io/txns/BVAJgo5UEB9cKPNNEWTcZFQkuHadqxbqdkacb5MC2tVf) |
| Same key again | `RefusedDuplicateKey` | [G27ZBj7M…](https://testnet.nearblocks.io/txns/G27ZBj7MRx5k8eHxguCvA94fNcYzaxpbZKEHBsWmmc6F) |
| 0.15 NEAR + 1 yocto (over the per-payout cap) | `RefusedOverPerPayoutCap` | [6Cm4tWCA…](https://testnet.nearblocks.io/txns/6Cm4tWCAHhp9tbKXomyE5MaBej2SX9L4bbtk4WSEEmqU) |
| Payout 0.01 NEAR | `Paid` | [DEEHp3YX…](https://testnet.nearblocks.io/txns/DEEHp3YXcTfFbSPBKYiRz5LTZyg98kKijSibL3ytYFkB) |
| Same key again | `RefusedDuplicateKey` | [H2Vy38aL…](https://testnet.nearblocks.io/txns/H2Vy38aLxhB6So9dJqNqoP6g7i4BUGcGfKAQKQpZ4i94) |
| Over the per-payout cap | `RefusedOverPerPayoutCap` | [5dM45AEs…](https://testnet.nearblocks.io/txns/5dM45AEskTSbTaiFTx8TkNqBJPbnRNJ56Yuo4X13ouhx) |
| Owner `pause` | ok | [EReepLat…](https://testnet.nearblocks.io/txns/EReepLatQRk6pspzQxTV4RKdyAK6aUUMP5pi1Ws5mNpG) |
| Payout while paused | `RefusedPaused` | [BY7p65Mw…](https://testnet.nearblocks.io/txns/BY7p65MwJGPQoSdy1aNTt4H8gF4oJLVHRgugj4C4nQGP) |
| Owner `unpause` | ok | [DF8bVAVD…](https://testnet.nearblocks.io/txns/DF8bVAVDCp2mQjN7Vxo4bWQAfgfifhWf7Q3EeGFg3Xvv) |
| Same payout after unpause | `Paid` | [5YVNAoNc…](https://testnet.nearblocks.io/txns/5YVNAoNcP1w1Jzsspfokybmr6Awa8v4axcQJwQg3Hb9B) |

The agent key's attempt to call `pause` was rejected by the network before reaching the chain, so it has no transaction.

**Checkpoint C: first smoke test** (Nov 12), on the v1 treasury `m22spend-treasury.testnet`, since deleted: payout [Adxr9Y3U…](https://testnet.nearblocks.io/txns/Adxr9Y3U9Yd7hgvdo6cirFCBC7dwcknxvMQtWUCa1NmC) and the refused same-key retry [bdrfYaBb…](https://testnet.nearblocks.io/txns/bdrfYaBb36QRrYqcM1sNEAfzNL9MwX2vK1KjfTmxUqS).

## Run locally

Requires Node.js 22.22+ and pnpm.

```bash
cp .env.example .env   # fill in sandbox and LLM values
pnpm install
pnpm dev
```

The Spend Desk page is at `/desk`. Run the tests with `pnpm test`, and the PayPal sandbox smoke test (sends one $1.00 sandbox payout) with `pnpm paypal:smoke`.

## Deploy

See [DEPLOY.md](./DEPLOY.md) for Netlify settings and environment variables.

## Built with

Started from the [Agent-Native](https://github.com/BuilderIO/agent-native) chat template (Builder.io). Spend Desk's actions, policy gate, PayPal sandbox wiring and screens are new in this repo.

## License

[MIT](./LICENSE) © 2026 Paul Rodney Turner
