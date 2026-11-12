# Changelog

All notable user-facing changes to this app are documented here.

## 0.1.12 — 2026-11-12

### Added (branch `near`, testnet only)

- NEAR payout rail in the app.
  - The stored spend policy gains `payoutRail` (`paypal` by default), allowed NEAR testnet payees and a demo-only USD-to-NEAR rate ($1 = 0.001 testnet NEAR). All three are human-only, in the Spend Policy card.
  - `execute-payout` keeps its `needsApproval` predicate and budget reservation, then pays through PayPal or the NEAR treasury contract by the live rail.
  - A contract refusal releases the budget and writes a `blocked_on_chain` receipt naming the on-chain outcome. A NEAR error writes `near_error`.
- Payments and receipts gain `payeeNearAccount` and `nearTxHash` through an additive migration. The seed tasks map to `m22spend-payee1`, `payee2` and `payee3.testnet`.
- The desk shows the active rail, and NEAR receipts link their transaction on testnet.nearblocks.io.

## 0.1.11 — 2026-11-12

### Changed (branch `near`, testnet only)

- Treasury contract hardened:
  - owner-only `pause` and `unpause` (the kill switch)
  - a total budget cap, with `get_remaining`
  - owner-only setters for both caps and the payee allowlist, plus `reset_spent` for a new demo period
  - an on-chain audit log of every agent payout request, including refusals, with the paged `get_audit_log`

  Policy refusals now return `false` and are recorded instead of failing the transaction. Unauthorized callers and attached deposits still fail.
- Redeployed fresh to `m22spend-treasury2.testnet` (the v1 state layout is not compatible).
- `pnpm near:smoke` gains `--over-cap` and `--pause-cycle`; the default run is unchanged.

## 0.1.10 — 2026-11-12

### Added (branch `near`, testnet only)

- Treasury contract (`contracts/spend-desk-treasury/`, Rust and near-sdk): agent-only, zero-deposit `payout` from the contract balance, a payee allowlist, a per-payout cap, one-time idempotency keys, spent tracking and view methods. A failed transfer rolls back the spend and releases its key. Unit tests and local Sandbox tests.
- `pnpm near:smoke`: one 0.01 testnet NEAR payout signed only with the agent's function-call key, then a retry with the same idempotency key to show it is not paid twice. Refuses to run unless `NEAR_NETWORK=testnet` and the key is a function-call key scoped to the treasury's `payout`.
- `pnpm near:set-agent-key`: copies that function-call key from NEAR CLI's legacy key store into `.env` without printing it, after checking its scope on chain.
- `near-api-js` 7.5.3.

## 0.1.9 — 2026-11-12

### Changed

- Branch `near`: workspace for a NEAR testnet payout rail. Adds a placeholder `contracts/spend-desk-treasury/`, `NEAR_*` variable names in `.env.example`, and a README section separating the baseline (tag `paypal-hackathon-submission`) from new NEAR work. No app behavior changes.

## 0.1.8 — 2026-11-11

### Docs

- README: live app and demo video links, a step-by-step guide for judges, how PayPal Payouts and Anthropic Claude are used, the governance rule, and what came from the template versus what is new. No app changes.

## 0.1.7 — 2026-11-11

### Added

- Spend Policy card on the desk: the monthly cap, auto-approve limit and allowed payees are stored in Postgres (defaults from `policy.json`) and editable by a person. The approval gate, payouts and queue status chips use the live values immediately.
- The policy is human-only. `update-policy` is hidden from the agent and from MCP and accepted only from the signed-in app UI, so the agent can never raise its own limits. The agent can read it with `get-policy`.
- Validation: cap $1 to $1,000, auto-approve limit $0 to the cap, at most 10 valid payee emails. If the cap drops below what is already spent, remaining shows $0.
- Reset demo also restores the default policy.

## 0.1.6 — 2026-11-07

### Changed

- ClawMaven branding replaces the Agent-Native marks: favicon, app icons and manifest, the sidebar mark, the Home logo, and the sign-in page mark.
- The sign-in page shows "ClawMaven Spend Desk" with the line "Governed agent payouts. Small ones pay, big ones wait for you, over-budget ones never leave."
- Buttons, the budget bar and focus rings use the ClawMaven blue in light and dark themes. Status colours are unchanged.
- Every page's browser title and description name ClawMaven Spend Desk.

## 0.1.5 — 2026-11-07

### Changed

- Netlify-ready: removed the starter template's Google Analytics and Tag Manager IDs and its trusted auth origins from `netlify.toml`. `BETTER_AUTH_TRUSTED_ORIGINS` and all runtime secrets now come from Netlify environment variables (see `DEPLOY.md`).
- The embedded coding-agent harness (Claude Code, Codex, Pi) is turned off; Spend Desk does not use it.
- The Home page no longer shows the template's Documentation and Connect with us links, and the page title, description and app manifest describe Spend Desk.

### Fixed

- `policy.json` is bundled into the server functions, so the policy loads on Netlify, where repo files are not available at runtime.

## 0.1.4 — 2026-11-07

### Fixed

- The first chat message after a page load no longer fails with an Anthropic 404 for model `gpt-6-luna`. Before the engine catalog loaded, the composer sent the framework's default OpenAI model to the anthropic engine. Chat requests now carry a model only when the active engine offers it; otherwise the server uses the engine default (`claude-sonnet-5-5`).
- A saved model the active engine does not offer is replaced with the engine default, and the model picker shows a model name instead of a blank label while it loads.

## 2026-10-10

### Fixed

- Large prompts with full context remain available to retry when sending fails.

## 2026-09-30

### Improved

- Chat uses a compact + menu with context submenus, keeps task, automation, and skill actions at the root, and omits Generate Image.

## 2026-09-27

### Fixed

- Chat retries the original request with its attachments after model setup.

## 2026-08-27

### Fixed

- Chat includes the runtime packages needed for provider keys after deployment.

For the full list of updates, see the [changelog folder](./changelog/).
