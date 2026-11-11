// NEAR testnet smoke test for the Spend Desk treasury contract. Run with
// `pnpm near:smoke`. Signs ONLY with the agent's function-call key
// (NEAR_AGENT_PRIVATE_KEY), sends one tiny payout, then retries the same
// idempotency key to prove the contract does not pay twice. Exits non-zero on
// any failure. Testnet only; no real funds.
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
async function payout(key: string): Promise<TxResponse> {
  return agent.signAndSendTransaction({
    receiverId: contractId!,
    actions: [
      actions.functionCall(
        "payout",
        { payee: payeeId, amount_yocto: nearToYocto(AMOUNT_NEAR).toString(), memo: "Spend Desk testnet smoke", idempotency_key: key },
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

console.log("retry: same idempotency key");
const retry = describe(await payout(key));
console.log(`tx 2 hash: ${retry.hash} (${retry.ok ? "PAID AGAIN" : "refused"}: ${retry.detail})`);
console.log(`           ${explorer(retry.hash)}`);
const spentFinal = BigInt(await view<string>("get_spent"));
const payeeFinal = await balanceOf(payeeId);
if (retry.ok || spentFinal !== spentAfter || payeeFinal !== payeeAfter) fail("the retry paid again or changed the totals.");
console.log(`retry refused: on-chain spent still ${yoctoToNear(spentFinal)} NEAR, payee balance unchanged. Not paid twice.`);
