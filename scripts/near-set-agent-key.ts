// Copies the agent's NEAR function-call private key from NEAR CLI's legacy
// key store (~/.near-credentials/testnet) into .env as NEAR_AGENT_PRIVATE_KEY,
// without printing it. It only accepts a key that the testnet RPC confirms is a
// function-call key on the agent account, scoped to the treasury contract and
// the `payout` method, so a full-access key can never land in .env.
// Run by a person with `pnpm near:set-agent-key`. Testnet only.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { loadEnv } from "@agent-native/core/scripts";

loadEnv();

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

// guard:allow-env-credential — testnet network name for this demo rail, not a credential
if (process.env.NEAR_NETWORK !== "testnet") fail("Set NEAR_NETWORK=testnet in .env first.");
// guard:allow-env-credential — public testnet RPC URL, not a credential
const rpcUrl = process.env.NEAR_RPC_URL || "https://test.rpc.fastnear.com";
// guard:allow-env-credential — public agent account id, not a credential
const agentId = process.env.NEAR_AGENT_ACCOUNT_ID;
// guard:allow-env-credential — public treasury contract account id, not a credential
const contractId = process.env.NEAR_CONTRACT_ID;
if (!agentId?.endsWith(".testnet") || !contractId?.endsWith(".testnet")) {
  fail("Set NEAR_AGENT_ACCOUNT_ID and NEAR_CONTRACT_ID (.testnet accounts) in .env first.");
}

// NEAR CLI's legacy key store keeps <account>.json, or <account>/<public key>.json
// once the account has more than one saved key.
const store = path.join(homedir(), ".near-credentials", "testnet");
const candidates = [path.join(store, `${agentId}.json`)];
const dir = path.join(store, agentId);
if (existsSync(dir)) for (const f of readdirSync(dir)) if (f.endsWith(".json")) candidates.push(path.join(dir, f));
const keys = candidates
  .filter((f) => existsSync(f))
  .map((f) => {
    const json = JSON.parse(readFileSync(f, "utf8")) as { public_key?: string; private_key?: string };
    return { file: f, publicKey: json.public_key, privateKey: json.private_key, mtime: statSync(f).mtimeMs };
  })
  .filter((k): k is { file: string; publicKey: string; privateKey: string; mtime: number } => !!k.publicKey && !!k.privateKey);
if (keys.length === 0) fail(`No saved keys for ${agentId} in ${store}. Run the add-key command with save-to-legacy-keychain first.`);

async function permission(publicKey: string): Promise<unknown> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "set-agent-key",
      method: "query",
      params: { request_type: "view_access_key", finality: "final", account_id: agentId, public_key: publicKey },
    }),
  });
  const body = (await res.json()) as { result?: { permission?: unknown } };
  return body.result?.permission ?? null;
}

const scoped: typeof keys = [];
for (const k of keys) {
  const p = (await permission(k.publicKey)) as { FunctionCall?: { receiver_id: string; method_names: string[] } } | string | null;
  const fc = typeof p === "object" && p ? p.FunctionCall : undefined;
  const ok = !!fc && fc.receiver_id === contractId && fc.method_names.length === 1 && fc.method_names[0] === "payout";
  console.log(`${k.publicKey}: ${p === "FullAccess" ? "full-access key (skipped)" : ok ? "function-call key for payout (accepted)" : "not a matching function-call key (skipped)"}`);
  if (ok) scoped.push(k);
}
if (scoped.length === 0) fail("No saved key is a function-call key scoped to the treasury's payout method. Nothing was written.");
const chosen = scoped.sort((a, b) => b.mtime - a.mtime)[0]!;

const envFile = path.join(process.cwd(), ".env");
const lines = existsSync(envFile) ? readFileSync(envFile, "utf8").split("\n").filter((l) => !l.startsWith("NEAR_AGENT_PRIVATE_KEY=")) : [];
while (lines.length && lines[lines.length - 1] === "") lines.pop();
lines.push(`NEAR_AGENT_PRIVATE_KEY=${chosen.privateKey}`, "");
writeFileSync(envFile, lines.join("\n"), { mode: 0o600 });
console.log(`Wrote NEAR_AGENT_PRIVATE_KEY to .env for public key ${chosen.publicKey}. The private key was not printed.`);
