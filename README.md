# ClawMaven Spend Desk

An AI agent that pays a small team's contractors through **PayPal Payouts (sandbox)** once work is marked done, with guardrails:

- Payouts up to the **auto-approve limit** (default $25) run automatically.
- Larger payouts pause for a **human to edit and approve** (or reject).
- Anything over the **remaining monthly budget** (default cap $200) or to a payee not on the allowed list is blocked before it reaches PayPal.
- Every attempt writes a **receipt**.

**Sandbox only. No real money moves.**

### Human-only spend policy

The cap, auto-approve limit and allowed payees live in Postgres (defaults from [`policy.json`](./policy.json)) and can be changed from the **Spend Policy** card. Only a person can change them: `update-policy` is hidden from the agent and from MCP, accepted only from the app UI, and rejects any other caller. The agent can read the policy with `get-policy` but can never raise its own limits. **Reset demo** restores the defaults.

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
