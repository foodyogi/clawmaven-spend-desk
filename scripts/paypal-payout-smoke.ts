// PayPal Payouts sandbox smoke test: sends ONE $1.00 payout and waits for a
// final item status. Run with `pnpm paypal:smoke`. Exits non-zero on failure.
import { loadEnv } from "@agent-native/core/scripts";

loadEnv();

const RECEIVER = "sb-ymuio53707515@personal.example.com";
const AMOUNT = "1.00";
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 120_000;
const PENDING_STATUSES = new Set(["PENDING", "ONHOLD", "NEW"]);

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

// Only the fields PayPal documents as safe to show; never headers or tokens.
async function paypalError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const parts = [`HTTP ${res.status}`, body.name, body.message, body.error];
  if (body.debug_id) parts.push(`debug_id=${body.debug_id}`);
  return parts.filter(Boolean).join(" | ");
}

// guard:allow-env-credential — deploy-level sandbox app credential for this single-tenant demo, read by a CLI script
const base = process.env.PAYPAL_API_BASE?.replace(/\/+$/, "");
// guard:allow-env-credential — deploy-level sandbox app credential for this single-tenant demo, read by a CLI script
const clientId = process.env.PAYPAL_CLIENT_ID;
// guard:allow-env-credential — deploy-level sandbox app credential for this single-tenant demo, read by a CLI script
const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
if (!base || !clientId || !clientSecret) {
  fail("PAYPAL_API_BASE, PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set");
}
if (!new URL(base).hostname.includes("sandbox")) {
  fail("PAYPAL_API_BASE is not a sandbox host; this script is sandbox-only");
}

const tokenRes = await fetch(`${base}/v1/oauth2/token`, {
  method: "POST",
  headers: {
    Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body: "grant_type=client_credentials",
});
if (!tokenRes.ok) fail(`OAuth token request failed: ${await paypalError(tokenRes)}`);
const { access_token: token } = (await tokenRes.json()) as { access_token: string };
const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

// Unique sender_batch_id: PayPal rejects a repeated id, so a re-run can never
// double-send the same batch. The POST is sent exactly once (no retry).
const senderBatchId = `smoke-${Date.now()}`;
const createRes = await fetch(`${base}/v1/payments/payouts`, {
  method: "POST",
  headers: auth,
  body: JSON.stringify({
    sender_batch_header: {
      sender_batch_id: senderBatchId,
      email_subject: "ClawMaven Spend Desk sandbox smoke test",
      recipient_type: "EMAIL",
    },
    items: [
      {
        recipient_type: "EMAIL",
        amount: { value: AMOUNT, currency: "USD" },
        receiver: RECEIVER,
        note: "Sandbox smoke test (no real money)",
        sender_item_id: `${senderBatchId}-1`,
      },
    ],
  }),
});
if (!createRes.ok) fail(`Payout create failed: ${await paypalError(createRes)}`);
const created = (await createRes.json()) as {
  batch_header: { payout_batch_id: string; batch_status: string };
};
const batchId = created.batch_header.payout_batch_id;
console.log(`batch id: ${batchId} (batch status ${created.batch_header.batch_status})`);

const deadline = Date.now() + POLL_TIMEOUT_MS;
let itemStatus = "UNKNOWN";
while (Date.now() < deadline) {
  const res = await fetch(`${base}/v1/payments/payouts/${batchId}`, { headers: auth });
  if (!res.ok) fail(`Batch status request failed: ${await paypalError(res)}`);
  const batch = (await res.json()) as {
    batch_header: { batch_status: string };
    items?: { payout_item_id: string; transaction_status: string; errors?: { name?: string; message?: string } }[];
  };
  const item = batch.items?.[0];
  itemStatus = item?.transaction_status ?? "UNKNOWN";
  if (item && !PENDING_STATUSES.has(itemStatus)) {
    console.log(`item id: ${item.payout_item_id}`);
    console.log(`item status: ${itemStatus} (batch status ${batch.batch_header.batch_status})`);
    if (itemStatus === "SUCCESS") process.exit(0);
    fail(`item ended as ${itemStatus}${item.errors ? `: ${item.errors.name} ${item.errors.message}` : ""}`);
  }
  await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
}
fail(`timed out after ${POLL_TIMEOUT_MS / 1000}s; last item status ${itemStatus}`);
