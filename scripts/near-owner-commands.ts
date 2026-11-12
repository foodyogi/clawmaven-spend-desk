// Prints (never runs) the NEAR CLI commands for the treasury kill switch, for a
// person to run in Mac Terminal with keys from their own keychain:
//   pnpm near:pause | pnpm near:unpause | pnpm near:revoke
// Nothing is sent from here and no private key is printed. Testnet only.
import { loadEnv } from "@agent-native/core/scripts";
import { KeyPair, type KeyPairString } from "near-api-js";

loadEnv();

// guard:allow-env-credential — public treasury contract account id, not a credential
const contract = process.env.NEAR_CONTRACT_ID || "m22spend-treasury2.testnet";
// guard:allow-env-credential — public owner account id, not a credential
const owner = process.env.NEAR_OWNER_ACCOUNT_ID || "m22spend-owner.testnet";
// guard:allow-env-credential — public agent account id, not a credential
const agent = process.env.NEAR_AGENT_ACCOUNT_ID || "m22spend-agent.testnet";
// guard:allow-env-credential — read only to derive the agent's PUBLIC key; the private key is never printed
const agentPrivateKey = process.env.NEAR_AGENT_PRIVATE_KEY;
const FALLBACK_AGENT_PUBLIC_KEY = "ed25519:6GyBn3DoaeML2wyiTLNrWfbLn4E5gMXhw3NviwwVaLL";

for (const id of [contract, owner, agent]) {
  if (!id.endsWith(".testnet")) {
    console.error(`FAIL: ${id} is not a .testnet account; these commands are testnet only.`);
    process.exit(1);
  }
}

function agentPublicKey(): string {
  try {
    if (agentPrivateKey?.startsWith("ed25519:")) return KeyPair.fromString(agentPrivateKey as KeyPairString).getPublicKey().toString();
  } catch {}
  return FALLBACK_AGENT_PUBLIC_KEY;
}

const ownerCall = (method: string) =>
  `near contract call-function as-transaction ${contract} ${method} json-args '{}' prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' sign-as ${owner} network-config testnet sign-with-keychain send`;
const status = `near contract call-function as-read-only ${contract} get_config json-args '{}' network-config testnet now`;
const listKeys = `near account list-keys ${agent} network-config testnet now`;

function print(title: string, steps: [string, string][]) {
  console.log(`\n${title}\nRun these in Mac Terminal (signed with keys from your keychain). Nothing has been sent.\n`);
  steps.forEach(([what, cmd], i) => console.log(`${i + 1}. ${what}\n   ${cmd}\n`));
}

const which = process.argv[2];
if (which === "pause") {
  print(`Kill switch: pause ${contract} (owner ${owner})`, [
    ["Pause the treasury. Every payout request is refused (RefusedPaused) until unpause.", ownerCall("pause")],
    ['Check it: "paused": true.', status],
  ]);
} else if (which === "unpause") {
  print(`Unpause ${contract} (owner ${owner})`, [
    ["Unpause the treasury.", ownerCall("unpause")],
    ['Check it: "paused": false.', status],
  ]);
} else if (which === "revoke") {
  const pk = agentPublicKey();
  print(`Kill switch: revoke the agent's function-call key on ${agent}`, [
    [
      `Delete the agent's payout key ${pk}, signed by ${agent}'s full-access key. Keep the full-access key.`,
      `near account delete-keys ${agent} public-keys '${pk}' network-config testnet sign-with-keychain send`,
    ],
    ["Check the payout key is gone (only the full-access key should remain).", listKeys],
    ["Now try a NEAR payout in the app: the receipt is near_error (key revoked), the budget is released, and nothing is sent.", "(in the app)"],
    [
      `When you are ready to restore payouts, add a fresh payout-only key scoped to ${contract} with a 0.25 NEAR gas allowance.`,
      `near account add-key ${agent} grant-function-call-access --allowance '0.25 NEAR' --contract-account-id ${contract} --function-names payout autogenerate-new-keypair save-to-legacy-keychain network-config testnet sign-with-keychain send`,
    ],
    ["Load the new key into .env (checks its scope on chain; never prints the private key).", "pnpm near:set-agent-key"],
    ["Restart the dev server so the app picks up the new key.", "pnpm dev"],
  ]);
} else {
  console.error("Usage: pnpm near:pause | pnpm near:unpause | pnpm near:revoke");
  process.exit(1);
}
