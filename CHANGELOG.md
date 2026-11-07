# Changelog

All notable user-facing changes to this app are documented here.

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
