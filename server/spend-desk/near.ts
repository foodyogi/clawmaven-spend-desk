// NEAR testnet payout rail: asks the Spend Desk treasury contract to pay a
// contractor. Signs ONLY with the agent's function-call key, which can call
// `payout` on the treasury and nothing else; the contract holds the funds and
// enforces its own caps, allowlist, pause switch and audit log.
import { Account, actions, JsonRpcProvider, KeyPair, type KeyPairString, teraToGas } from "near-api-js";

export class NearError extends Error {
  constructor(
    message: string,
    /** Hash of a transaction that was sent and failed, when there is one. */
    readonly txHash: string | null = null,
  ) {
    super(message);
  }
}

export interface NearPayoutResult {
  txHash: string;
  /** "paid": the transfer landed. "refused": the contract returned false. */
  outcome: "paid" | "refused";
  /** The contract's audit outcome, e.g. Paid, RefusedOverTotalCap, TransferFailed. */
  onChainOutcome: string;
}

const DEFAULT_RPC = "https://test.rpc.fastnear.com";
const MAX_MEMO_BYTES = 256;

function config() {
  // guard:allow-env-credential — testnet network name for the demo rail, not a credential
  const network = process.env.NEAR_NETWORK;
  // guard:allow-env-credential — public testnet RPC URL, not a credential
  const rpcUrl = process.env.NEAR_RPC_URL || DEFAULT_RPC;
  // guard:allow-env-credential — public treasury contract account id, not a credential
  const contractId = process.env.NEAR_CONTRACT_ID;
  // guard:allow-env-credential — public agent account id, not a credential
  const agentId = process.env.NEAR_AGENT_ACCOUNT_ID;
  // guard:allow-env-credential — deploy-level function-call key for the single-tenant demo agent (never a full-access key)
  const agentKey = process.env.NEAR_AGENT_PRIVATE_KEY;
  if (network !== "testnet") throw new NearError("The NEAR rail runs on testnet only: set NEAR_NETWORK=testnet.");
  if (!contractId?.endsWith(".testnet") || !agentId?.endsWith(".testnet")) {
    throw new NearError("NEAR rail is not configured: set NEAR_CONTRACT_ID and NEAR_AGENT_ACCOUNT_ID (.testnet accounts).");
  }
  if (!agentKey?.startsWith("ed25519:")) throw new NearError("NEAR rail is not configured: set NEAR_AGENT_PRIVATE_KEY (the function-call key).");
  return { rpcUrl, contractId, agentId, agentKey: agentKey as KeyPairString };
}

/** The public treasury contract id for links, or null when the rail is not configured. */
export function nearContractId(): string | null {
  // guard:allow-env-credential — public treasury contract account id, not a credential
  const id = process.env.NEAR_CONTRACT_ID;
  return id?.endsWith(".testnet") ? id : null;
}

let verifiedPublicKey: string | null = null;

/** Refuses to sign with anything but a function-call key scoped to the treasury's payout. */
async function assertScopedKey(account: Account, agentKey: KeyPairString, contractId: string) {
  const publicKey = KeyPair.fromString(agentKey).getPublicKey().toString();
  if (verifiedPublicKey === publicKey) return;
  const key = (await account.getAccessKey(publicKey).catch(() => null)) as {
    permission: "FullAccess" | { FunctionCall: { receiver_id: string; method_names: string[] } };
  } | null;
  if (!key) throw new NearError("NEAR_AGENT_PRIVATE_KEY is not an access key of the agent account (revoked?).");
  if (key.permission === "FullAccess") throw new NearError("NEAR_AGENT_PRIVATE_KEY is a full-access key; the app only signs with the scoped function-call key.");
  const fc = key.permission.FunctionCall;
  if (fc.receiver_id !== contractId || fc.method_names.length !== 1 || fc.method_names[0] !== "payout") {
    throw new NearError(`The agent key is scoped to ${fc.receiver_id} ${JSON.stringify(fc.method_names)}, not ${contractId} ["payout"].`);
  }
  verifiedPublicKey = publicKey;
}

/**
 * Requests one payout from the treasury. `idempotencyKey` is the Spend Desk
 * payment id, so the contract refuses a second payout for the same payment.
 * Throws NearError when the request can't be made or the transaction fails.
 */
export async function sendNearPayout(input: {
  idempotencyKey: string;
  payee: string;
  amountYocto: bigint;
  memo: string;
}): Promise<NearPayoutResult> {
  const { rpcUrl, contractId, agentId, agentKey } = config();
  if (!input.payee.endsWith(".testnet")) throw new NearError(`${input.payee} is not a NEAR testnet account.`);
  const account = new Account(agentId, new JsonRpcProvider({ url: rpcUrl }), agentKey);
  await assertScopedKey(account, agentKey, contractId);

  const memo = Buffer.from(input.memo).subarray(0, MAX_MEMO_BYTES).toString();
  const res = await account
    .signAndSendTransaction({
      receiverId: contractId,
      actions: [
        actions.functionCall(
          "payout",
          { payee: input.payee, amount_yocto: input.amountYocto.toString(), memo, idempotency_key: input.idempotencyKey },
          teraToGas("50"),
          0n,
        ),
      ],
      waitUntil: "FINAL",
      throwOnFailure: false,
    })
    .catch((err: unknown) => {
      throw new NearError(`NEAR transaction was not sent: ${err instanceof Error ? err.message : String(err)}`.slice(0, 500));
    });

  const txHash = res.transaction_outcome.id;
  const logs = [res.transaction_outcome.outcome.logs, ...res.receipts_outcome.map((r) => r.outcome.logs)].flat();
  const outcomes = logs.map((l) => /^spend-desk payout (\w+):/.exec(l)?.[1]).filter((o): o is string => !!o);
  const onChainOutcome = outcomes[outcomes.length - 1] ?? "Unknown";
  const status = res.status as { SuccessValue?: string; Failure?: unknown };
  if (status && typeof status === "object" && "SuccessValue" in status) {
    const value = Buffer.from(status.SuccessValue ?? "", "base64").toString();
    return { txHash, outcome: value === "true" ? "paid" : "refused", onChainOutcome };
  }
  throw new NearError(`NEAR transaction ${txHash} failed: ${JSON.stringify(status?.Failure ?? status).slice(0, 300)}`, txHash);
}
