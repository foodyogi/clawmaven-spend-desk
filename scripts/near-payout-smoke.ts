// NEAR testnet smoke test for the Spend Desk treasury contract. Run with
// `pnpm near:smoke`. Signs ONLY with the agent's function-call key
// (NEAR_AGENT_PRIVATE_KEY), sends one tiny payout, then retries the same
// idempotency key to prove the contract does not pay twice. Exits non-zero on
// any failure. Testnet only; no real funds.
//
// Optional flags (after `--`):
//   --over-cap     also request 1 yoctoNEAR over the per-payout cap; it must be refused.
//   --pause-cycle  also show the agent key cannot call `pause`, then wait while the
//                  owner pauses (command printed), check a payout is refused, wait
//                  for unpause, and check the same payout then goes through.
import { loadEnv } from "@agent-native/core/scripts";
import { Account, actions, JsonRpcProvider, KeyPair, type KeyPairString, nearToYocto, teraToGas, yoctoToNear } from "near-api-js";

loadEnv();

const AMOUNT_NEAR = "0.01";

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

// guard:allow-env-credential — testnet network name for this demo rail, not a credential
const network = process.env.NEAR_NETWORK;
// guard:allow-env-credential — public testnet RPC URL, not a credential
const rpcUrl = process.env.NEAR_RPC_URL || "https://test.rpc.fastnear.com";
// guard:allow-env-credential — public treasury contract account id, not a credential
const contractId = process.env.NEAR_CONTRACT_ID;
// guard:allow-env-credential — public agent account id, not a credential
const agentId = process.env.NEAR_AGENT_ACCOUNT_ID;
// guard:allow-env-credential — deploy-level function-call key for the single-tenant demo agent (never a full-access key)
const agentKey = process.env.NEAR_AGENT_PRIVATE_KEY;
// guard:allow-env-credential — public payee account id for the smoke test, not a credential
const payeeId = process.env.NEAR_SMOKE_PAYEE || "m22spend-payee1.testnet";
// guard:allow-env-credential — public owner account id, only printed in CLI commands, not a credential
const ownerId = process.env.NEAR_OWNER_ACCOUNT_ID || "m22spend-owner.testnet";
const flags = new Set(process.argv.slice(2).filter((a) => a !== "--"));
for (const f of flags) if (!["--over-cap", "--pause-cycle"].includes(f)) fail(`Unknown flag ${f}. Use --over-cap and/or --pause-cycle.`);

if (network !== "testnet") fail("NEAR_NETWORK must be exactly 'testnet'. This script never runs against mainnet.");
if (!contractId || !agentId || !agentKey) fail("Set NEAR_CONTRACT_ID, NEAR_AGENT_ACCOUNT_ID and NEAR_AGENT_PRIVATE_KEY in .env.");
for (const id of [contractId, agentId, payeeId]) {
  if (!id.endsWith(".testnet")) fail(`${id} is not a .testnet account.`);
}
if (!agentKey.startsWith("ed25519:")) fail("NEAR_AGENT_PRIVATE_KEY must be an ed25519:... private key.");

const provider = new JsonRpcProvider({ url: rpcUrl });
const agent = new Account(agentId, provider, agentKey as KeyPairString);

// Refuse to run with anything but the scoped function-call key.
const publicKey = KeyPair.fromString(agentKey as KeyPairString).getPublicKey().toString();
const accessKey = (await agent.getAccessKey(publicKey).catch(() => null)) as {
  permission: "FullAccess" | { FunctionCall: { receiver_id: string; method_names: string[]; allowance: string | null } };
} | null;
if (!accessKey) fail(`The key in NEAR_AGENT_PRIVATE_KEY is not an access key of ${agentId}.`);
if (accessKey.permission === "FullAccess") fail("NEAR_AGENT_PRIVATE_KEY is a FULL-ACCESS key. Use the function-call key scoped to the treasury.");
const fc = accessKey.permission.FunctionCall;
if (fc.receiver_id !== contractId) fail(`The function-call key is scoped to ${fc.receiver_id}, not ${contractId}.`);
if (fc.method_names.length !== 1 || fc.method_names[0] !== "payout") fail(`The function-call key allows ${JSON.stringify(fc.method_names)}; expected ["payout"] only.`);
console.log(`agent key: function-call only, receiver ${fc.receiver_id}, methods ${JSON.stringify(fc.method_names)}, allowance ${fc.allowance === null ? "unlimited" : `${yoctoToNear(BigInt(fc.allowance))} NEAR`}`);

const view = async <T>(method: string, args: Record<string, unknown> = {}) =>
  (await provider.callFunction({ contractId, method, args })) as T;
const balanceOf = async (accountId: string) => BigInt((await new Account(accountId, provider).getState()).balance.total);

type TxResponse = Awaited<ReturnType<Account["signAndSendTransaction"]>>;
async function payout(key: string, amountYocto: bigint = nearToYocto(AMOUNT_NEAR)): Promise<TxResponse> {
  return agent.signAndSendTransaction({
    receiverId: contractId!,
    actions: [
      actions.functionCall(
        "payout",
        { payee: payeeId, amount_yocto: amountYocto.toString(), memo: "Spend Desk testnet smoke", idempotency_key: key },
        teraToGas("50"),
        0n,
      ),
    ],
    waitUntil: "FINAL",
    throwOnFailure: false,
  });
}
function describe(res: TxResponse): { hash: string; ok: boolean; detail: string } {
  const status = res.status as { SuccessValue?: string; Failure?: unknown };
  if (status && typeof status === "object" && "SuccessValue" in status) {
    const value = Buffer.from(status.SuccessValue ?? "", "base64").toString();
    return { hash: res.transaction_outcome.id, ok: value === "true", detail: `contract returned ${value || "(empty)"}` };
  }
  return { hash: res.transaction_outcome.id, ok: false, detail: JSON.stringify(status?.Failure ?? status).slice(0, 300) };
}
const explorer = (hash: string) => `https://testnet.nearblocks.io/txns/${hash}`;

type AuditEntry = { index: string; idempotency_key: string; outcome: string };
async function lastAudit(): Promise<AuditEntry | undefined> {
  const config = await view<{ audit_log_length: string }>("get_config");
  const len = Number(config.audit_log_length);
  return len ? (await view<AuditEntry[]>("get_audit_log", { from_index: String(len - 1), limit: "1" }))[0] : undefined;
}
async function expectRefused(label: string, key: string, outcome: string, amountYocto?: bigint) {
  const spent = BigInt(await view<string>("get_spent"));
  const payeeBal = await balanceOf(payeeId);
  const res = describe(await payout(key, amountYocto));
  const audit = await lastAudit();
  console.log(`${label}: tx ${res.hash} (${res.ok ? "PAID" : "refused"}: ${res.detail}); audit #${audit?.index} ${audit?.outcome}`);
  console.log(`           ${explorer(res.hash)}`);
  if (res.ok || BigInt(await view<string>("get_spent")) !== spent || (await balanceOf(payeeId)) !== payeeBal) fail(`${label}: expected a refusal with no spend.`);
  if (audit?.idempotency_key !== key || audit.outcome !== outcome) fail(`${label}: expected audit outcome ${outcome}.`);
}

const config = await view<{ paused: boolean; per_payout_cap_yocto: string; total_cap_yocto: string; remaining_yocto: string }>("get_config");
console.log(`treasury ${contractId}: ${config.paused ? "PAUSED" : "active"}, per-payout cap ${yoctoToNear(BigInt(config.per_payout_cap_yocto))} NEAR, total cap ${yoctoToNear(BigInt(config.total_cap_yocto))} NEAR, remaining ${yoctoToNear(BigInt(config.remaining_yocto))} NEAR`);
if (config.paused) fail("the treasury is paused. Unpause it (owner) before running the smoke test.");

const key = `smoke-${Date.now()}`;
const spentBefore = BigInt(await view<string>("get_spent"));
const payeeBefore = await balanceOf(payeeId);
console.log(`payout: ${AMOUNT_NEAR} NEAR -> ${payeeId}, idempotency key ${key}`);

const first = describe(await payout(key));
console.log(`tx 1 hash: ${first.hash} (${first.ok ? "paid" : "NOT paid"}: ${first.detail})`);
console.log(`           ${explorer(first.hash)}`);
if (!first.ok) fail("the first payout did not succeed.");
const spentAfter = BigInt(await view<string>("get_spent"));
const payeeAfter = await balanceOf(payeeId);
console.log(`on-chain spent: ${yoctoToNear(spentBefore)} -> ${yoctoToNear(spentAfter)} NEAR; payee balance +${yoctoToNear(payeeAfter - payeeBefore)} NEAR`);
if (spentAfter - spentBefore !== nearToYocto(AMOUNT_NEAR)) fail("on-chain spent did not grow by the payout amount.");

await expectRefused("retry (same key)", key, "RefusedDuplicateKey");
console.log(`retry refused: on-chain spent still ${yoctoToNear(BigInt(await view<string>("get_spent")))} NEAR, payee balance unchanged. Not paid twice.`);

if (flags.has("--over-cap")) {
  const cap = BigInt(await view<string>("get_per_payout_cap"));
  await expectRefused(`over-cap (${yoctoToNear(cap)} NEAR + 1 yocto)`, `smoke-overcap-${Date.now()}`, "RefusedOverPerPayoutCap", cap + 1n);
}

if (flags.has("--pause-cycle")) {
  // The agent's key is limited to `payout`, so the network itself rejects a `pause` call.
  const attempt = await agent
    .signAndSendTransaction({
      receiverId: contractId,
      actions: [actions.functionCall("pause", {}, teraToGas("30"), 0n)],
      waitUntil: "FINAL",
      throwOnFailure: false,
    })
    .then((r) => describe(r))
    .catch((e: unknown) => ({ hash: "(not sent)", ok: false, detail: String(e instanceof Error ? e.message : e).slice(0, 200) }));
  if (await view<boolean>("is_paused")) fail("the agent key managed to pause the treasury.");
  console.log(`agent key calling pause: rejected (${attempt.detail})`);

  const ownerCall = (method: string) =>
    `near contract call-function as-transaction ${contractId} ${method} json-args '{}' prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' sign-as ${ownerId} network-config testnet sign-with-keychain send`;
  const waitFor = async (paused: boolean) => {
    for (let i = 0; i < 120; i++) {
      if ((await view<boolean>("is_paused")) === paused) return;
      await new Promise((r) => setTimeout(r, 5_000));
    }
    fail(`timed out after 10 minutes waiting for the treasury to be ${paused ? "paused" : "unpaused"}.`);
  };
  console.log(`\nOWNER STEP: in another Terminal, pause the treasury:\n  ${ownerCall("pause")}\nwaiting...`);
  await waitFor(true);
  const pausedKey = `smoke-paused-${Date.now()}`;
  await expectRefused("payout while paused", pausedKey, "RefusedPaused");
  console.log(`\nOWNER STEP: unpause the treasury:\n  ${ownerCall("unpause")}\nwaiting...`);
  await waitFor(false);
  const resumed = describe(await payout(pausedKey));
  console.log(`after unpause, same key: tx ${resumed.hash} (${resumed.ok ? "paid" : "NOT paid"}: ${resumed.detail})`);
  console.log(`           ${explorer(resumed.hash)}`);
  if (!resumed.ok) fail("the payout did not go through after unpause.");
}
console.log("near:smoke passed.");
