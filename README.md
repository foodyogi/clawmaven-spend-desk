# ClawMaven Spend Desk

**Live app:** https://clawmaven-spend-desk.netlify.app · **Demo video:** https://youtu.be/Cut2wc_Txrs

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

## NEAR work in progress (branch `near`)

This branch is adding a **NEAR testnet payout rail** for the [NEAR HACKATHON](https://nearhackathon.com). It is work in progress. So far: a hardened Rust treasury contract with Sandbox tests, deployed on testnet, and a testnet smoke script (`pnpm near:smoke`). The app does not use the NEAR rail yet.

- **Baseline (not for NEAR judging):** everything up to tag [`paypal-hackathon-submission`](https://github.com/foodyogi/clawmaven-spend-desk/tree/paypal-hackathon-submission) (`c6f747c`, v0.1.8): the Agent-Native app, the PayPal Payouts sandbox rail, the human-only spend policy, and the screens described above. That version is the PayPal AI Hackathon submission, and `main` and the live site still run it.
- **New NEAR work:** only the commits on [`near`](https://github.com/foodyogi/clawmaven-spend-desk/tree/near) after that tag. See the diff: [paypal-hackathon-submission...near](https://github.com/foodyogi/clawmaven-spend-desk/compare/paypal-hackathon-submission...near).
- **Treasury contract:** [`contracts/spend-desk-treasury/`](./contracts/spend-desk-treasury/) (Rust, near-sdk) holds testnet NEAR and pays from its own balance. It enforces:
  - an agent-only caller, with zero deposit
  - the payee allowlist
  - a per-payout cap and a total budget cap
  - one-time idempotency keys, rolling back a failed transfer
  - an owner-only pause (the kill switch) and owner-only setters

  Every payout request from the agent, including refusals, goes into an on-chain audit log. The agent will sign only with a function-call access key scoped to that contract. The stored spend policy gets a `payoutRail` (`paypal` or `near`), allowed NEAR payees and a fixed demo-only USD-to-NEAR rate, still changeable only by a person.
- **Testnet only. No real funds.**

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
