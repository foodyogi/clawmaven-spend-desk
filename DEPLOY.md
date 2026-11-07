# Deploying ClawMaven Spend Desk to Netlify

Netlify builds the app with the command in [`netlify.toml`](./netlify.toml) and serves it from Netlify Functions. The database is Neon Postgres (AWS us-east-2).

## Environment variables

Set these in the Netlify UI (**Site configuration → Environment variables**) or with `npx netlify env:set NAME`. Never put them in `netlify.toml` or git:

- Variables declared in `netlify.toml` only reach the **build**, never the running functions.
- They also override UI values during the build.

**Scope** is the Netlify scope each variable needs. *Functions* means the running app reads it; *Builds* means the build command reads it.

### Required

| Name | Scope | Notes |
| --- | --- | --- |
| `DATABASE_URL` | Builds, Functions | Neon **pooled** connection string. The build uses it to run migrations; the app uses it at runtime. |
| `BETTER_AUTH_SECRET` | Functions | Signs sessions. Generate once with `openssl rand -hex 32` and keep it stable; changing it signs everyone out. |
| `BETTER_AUTH_TRUSTED_ORIGINS` | Functions | Comma-separated exact `https://` origins people use to reach the app: the Netlify site address, plus any custom domain. No wildcards. Replaces the starter template's hardcoded domains. |
| `ANTHROPIC_API_KEY` | Functions | LLM key for the in-app agent. Set a hard spend cap in the Anthropic console. |
| `AGENT_ENGINE` | Functions | Not a secret: `anthropic`. Pins the engine so it never auto-selects another provider. |
| `A2A_SECRET` | Functions | Generate with `openssl rand -hex 32`. Lets long agent turns (the "close out this week's jobs" run takes about 90 s) run on Netlify's 15-minute background function. Without it, turns run inline in the normal request and can hit its time limit. |
| `PAYPAL_CLIENT_ID` | Functions | PayPal **sandbox** app client id. |
| `PAYPAL_CLIENT_SECRET` | Functions | PayPal **sandbox** app secret. |
| `PAYPAL_API_BASE` | Functions | Not a secret: the sandbox base URL, `https://api-m.sandbox.paypal.com`. The app refuses any non-sandbox host. |

### Optional

| Name | Scope | Notes |
| --- | --- | --- |
| `BETTER_AUTH_URL` | Functions | Only for a custom domain: the public origin sign-in links should use. Netlify's own address is detected automatically. |
| `DATABASE_URL_UNPOOLED` | Builds | Neon direct (unpooled) URL for migrations. The framework derives one from the pooled URL when unset. |
| `POLICY_PATH` | Functions | Leave unset. The bundled `policy.json` is used. |
| `AGENT_NATIVE_ENABLE_KEEP_WARM` | Builds | Leave unset. Keeping functions warm also keeps Neon awake and uses up the free compute quota. |

### Must NOT be set in production

| Name | Why |
| --- | --- |
| `AUTH_DISABLED` | Turns login off and runs every request as one shared user. Local development only. |
| `AUTH_REQUIRE_EMAIL_VERIFICATION=1` | With no email provider configured, this disables password sign-up entirely, so judges could not create accounts. |
| `GA_MEASUREMENT_ID`, `GTM_CONTAINER_ID` | Analytics is off for now. These were starter-template values. |

`AUTH_SKIP_EMAIL_VERIFICATION` is ignored on hosted deployments.

## Already set in `netlify.toml` (build time only)

| Name | Value | Why |
| --- | --- | --- |
| `NITRO_PRESET` | `netlify` | Builds the Netlify function format. |
| `NPM_CONFIG_PRODUCTION` | `false` | Installs dev dependencies the build needs. |
| `AGENT_NATIVE_RELEASE_MIGRATIONS` | `1` (production) | Read at build time and baked in, so request functions skip migration probes; the build runs migrations instead. |
| `AGENT_NATIVE_DISABLE_KEEP_WARM_BACKGROUND` | `1` (production) | Only matters if keep-warm is enabled; skips the more expensive background warm-up. |

## Build and Neon migrations

The build command in `netlify.toml`:

1. Uses `NETLIFY_DATABASE_URL` if a Netlify database extension provides one, otherwise `DATABASE_URL` (Neon).
2. Runs `NITRO_PRESET=netlify pnpm build`.
3. For **production** deploys only (`CONTEXT=production`), runs `pnpm migrate:production`. That command:
   - applies the framework's tables;
   - creates the Spend Desk tables;
   - inserts the idempotent demo seed (4 tasks and a $200 budget for 2026-11), which is skipped if it already exists.

Deploy previews and branch deploys skip migrations and reuse the production schema. Because migrations only add tables, older and newer builds can run side by side.

To migrate by hand before a deploy (for example from your own computer with `DATABASE_URL` exported):

```bash
pnpm migrate:production
```

## Functions region

Netlify deploys new sites' functions to **`cmh` (Ohio), which is AWS us-east-2**, the same region as the Neon database. Nothing needs to be set. Changing the region needs a Netlify Pro plan (UI: **Cloud compute → Functions → Region**).

## After the first deploy

1. Open the site, sign up with email and password, and confirm you land on `/desk`.
2. Ask the agent to "close out this week's jobs". This sends real **sandbox** payouts; press **Reset demo** afterwards.
3. Check the Netlify function logs for `dispatch_mode=background-processing` on the long agent turn, which confirms `A2A_SECRET` is working.
