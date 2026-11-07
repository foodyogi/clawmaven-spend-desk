// PayPal Payouts (sandbox) client used by executePayout.

const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 30_000;
const PENDING_STATUSES = new Set(["PENDING", "ONHOLD", "NEW"]);
// Statuses where the money did not reach the payee.
const FAILED_STATUSES = new Set(["FAILED", "RETURNED", "BLOCKED", "DENIED", "REFUNDED", "REVERSED"]);

export class PayPalError extends Error {}

export interface PayoutResult {
  batchId: string;
  itemId: string | null;
  itemStatus: string;
}

function config() {
  // guard:allow-env-credential — deploy-level sandbox app credential for this single-tenant demo
  const base = process.env.PAYPAL_API_BASE?.replace(/\/+$/, "");
  // guard:allow-env-credential — deploy-level sandbox app credential for this single-tenant demo
  const clientId = process.env.PAYPAL_CLIENT_ID;
  // guard:allow-env-credential — deploy-level sandbox app credential for this single-tenant demo
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!base || !clientId || !clientSecret) {
    throw new PayPalError("PayPal sandbox is not configured (PAYPAL_API_BASE, PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET)");
  }
  if (!new URL(base).hostname.includes("sandbox")) {
    throw new PayPalError("PAYPAL_API_BASE is not a sandbox host; Spend Desk is sandbox-only");
  }
  return { base, clientId, clientSecret };
}

// Only the fields PayPal documents as safe to show; never headers or tokens.
async function describeError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const parts = [`HTTP ${res.status}`, body.name, body.message, body.error];
  if (body.debug_id) parts.push(`debug_id=${body.debug_id}`);
  return parts.filter(Boolean).join(" | ");
}

/**
 * Sends one sandbox payout. `senderBatchId` must be unique per payment: PayPal
 * rejects a repeated id, so a retry can never pay the same payment twice.
 * Waits briefly for the item to leave PENDING so the receipt can carry its id.
 */
export async function sendPayout(input: {
  senderBatchId: string;
  amountCents: number;
  receiver: string;
  note: string;
}): Promise<PayoutResult> {
  const { base, clientId, clientSecret } = config();
  const tokenRes = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!tokenRes.ok) throw new PayPalError(`OAuth token request failed: ${await describeError(tokenRes)}`);
  const { access_token: token } = (await tokenRes.json()) as { access_token: string };
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const createRes = await fetch(`${base}/v1/payments/payouts`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      sender_batch_header: {
        sender_batch_id: input.senderBatchId,
        email_subject: "ClawMaven Spend Desk sandbox payout",
        recipient_type: "EMAIL",
      },
      items: [
        {
          recipient_type: "EMAIL",
          amount: { value: (input.amountCents / 100).toFixed(2), currency: "USD" },
          receiver: input.receiver,
          note: input.note.slice(0, 4000),
          sender_item_id: input.senderBatchId,
        },
      ],
    }),
  });
  if (!createRes.ok) throw new PayPalError(`Payout create failed: ${await describeError(createRes)}`);
  const created = (await createRes.json()) as { batch_header: { payout_batch_id: string } };
  const batchId = created.batch_header.payout_batch_id;

  let itemId: string | null = null;
  let itemStatus = "PENDING";
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    // The batch already exists, so a failed status read must not look like a
    // failed payout; keep the last known status instead.
    const res = await fetch(`${base}/v1/payments/payouts/${batchId}`, { headers }).catch(() => null);
    if (res?.ok) {
      const batch = (await res.json()) as {
        items?: { payout_item_id: string; transaction_status: string; errors?: { name?: string; message?: string } }[];
      };
      const item = batch.items?.[0];
      if (item) {
        itemId = item.payout_item_id;
        itemStatus = item.transaction_status;
        if (FAILED_STATUSES.has(itemStatus)) {
          const why = item.errors ? `: ${item.errors.name ?? ""} ${item.errors.message ?? ""}`.trimEnd() : "";
          throw new PayPalError(`Payout item ${itemId} in batch ${batchId} ended as ${itemStatus}${why}`);
        }
        if (!PENDING_STATUSES.has(itemStatus)) break;
      }
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return { batchId, itemId, itemStatus };
}
