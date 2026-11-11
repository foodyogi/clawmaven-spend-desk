# Changelog

All notable user-facing changes to this app are documented here.

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
