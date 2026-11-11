//! Sandbox tests: deploy the real wasm to a local NEAR Sandbox and exercise it
//! with real transactions. No testnet account is needed.

use near_api::{AccountId, NearGas, NearToken, Signer};
use near_sdk::serde_json::json;
use std::sync::Arc;

struct Env {
    sandbox: near_sandbox::Sandbox,
    network: near_api::NetworkConfig,
    signer: Arc<Signer>,
    contract: near_api::Contract,
    agent: AccountId,
    owner: AccountId,
    payee: AccountId,
    stranger: AccountId,
}

const CAP: NearToken = NearToken::from_near(2);

async fn create(sandbox: &near_sandbox::Sandbox, name: &str) -> testresult::TestResult<AccountId> {
    let id: AccountId = name.parse()?;
    sandbox.create_account(id.as_str().parse()?).initial_balance(NearToken::from_near(10)).send().await?;
    Ok(id)
}

async fn setup() -> testresult::TestResult<Env> {
    let wasm = std::fs::read(cargo_near_build::build_with_cli(Default::default())?)?;
    let sandbox = near_sandbox::Sandbox::start_sandbox().await?;
    let network = near_api::NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let signer = Signer::from_secret_key(near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?)?;
    let owner = create(&sandbox, "owner.sandbox").await?;
    let agent = create(&sandbox, "agent.sandbox").await?;
    let payee = create(&sandbox, "payee.sandbox").await?;
    let stranger = create(&sandbox, "stranger.sandbox").await?;
    let treasury = create(&sandbox, "treasury.sandbox").await?;
    // An allowlisted account that does not exist, to exercise a failed transfer.
    let ghost: AccountId = "ghost.sandbox".parse()?;
    near_api::Contract::deploy(treasury.clone())
        .use_code(wasm)
        .with_init_call(
            "new",
            json!({
                "owner": owner,
                "agent": agent,
                "allowed_payees": [payee, ghost],
                "per_payout_cap_yocto": CAP.as_yoctonear().to_string(),
            }),
        )?
        .with_signer(signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    Ok(Env { sandbox, network, signer, contract: near_api::Contract(treasury), agent, owner, payee, stranger })
}

impl Env {
    async fn payout(&self, from: &AccountId, payee: &str, amount: NearToken, key: &str, deposit: NearToken) -> testresult::TestResult<bool> {
        let outcome = self
            .contract
            .call_function(
                "payout",
                json!({ "payee": payee, "amount_yocto": amount.as_yoctonear().to_string(), "memo": "sandbox test", "idempotency_key": key }),
            )
            .transaction()
            .deposit(deposit)
            .gas(NearGas::from_tgas(50))
            .with_signer(from.clone(), self.signer.clone())
            .send_to(&self.network)
            .await?;
        Ok(outcome.is_success())
    }

    async fn spent(&self) -> testresult::TestResult<u128> {
        let v: String = self.contract.call_function("get_spent", ()).read_only().fetch_from(&self.network).await?.data;
        Ok(v.parse()?)
    }

    async fn balance(&self, id: &AccountId) -> testresult::TestResult<NearToken> {
        Ok(near_api::Tokens::account(id.clone()).near_balance().fetch_from(&self.network).await?.total)
    }
}

#[tokio::test]
async fn sandbox_payout_rules() -> testresult::TestResult<()> {
    let env = setup().await?;
    let _ = &env.sandbox;
    let one = NearToken::from_near(1);
    let zero = NearToken::from_yoctonear(0);

    // Happy path: the agent pays an allowlisted payee from the treasury balance.
    let before = env.balance(&env.payee).await?;
    assert!(env.payout(&env.agent, env.payee.as_str(), one, "job-1", zero).await?, "happy path should succeed");
    assert_eq!(env.balance(&env.payee).await?, before.saturating_add(one));
    assert_eq!(env.spent().await?, one.as_yoctonear());

    // Repeated idempotency key: refused, nothing paid twice.
    assert!(!env.payout(&env.agent, env.payee.as_str(), one, "job-1", zero).await?, "repeated key should fail");
    assert_eq!(env.balance(&env.payee).await?, before.saturating_add(one));
    assert_eq!(env.spent().await?, one.as_yoctonear());

    // Unauthorized callers: the owner and a stranger cannot request payouts.
    assert!(!env.payout(&env.owner, env.payee.as_str(), one, "job-2", zero).await?, "owner must not request payouts");
    assert!(!env.payout(&env.stranger, env.payee.as_str(), one, "job-3", zero).await?, "stranger must not request payouts");

    // Disallowed payee.
    assert!(!env.payout(&env.agent, env.stranger.as_str(), one, "job-4", zero).await?, "disallowed payee should fail");

    // Over the per-payout cap, and an attached deposit (payout is not payable).
    assert!(!env.payout(&env.agent, env.payee.as_str(), CAP.saturating_add(NearToken::from_yoctonear(1)), "job-5", zero).await?);
    assert!(!env.payout(&env.agent, env.payee.as_str(), one, "job-6", NearToken::from_yoctonear(1)).await?);
    assert_eq!(env.spent().await?, one.as_yoctonear(), "refused calls must not change spent");

    // A failed transfer (allowlisted account that does not exist) is rolled back:
    // spent returns to its previous value and the key can be used again.
    let _ = env.payout(&env.agent, "ghost.sandbox", one, "job-7", zero).await?;
    assert_eq!(env.spent().await?, one.as_yoctonear(), "failed transfer must be rolled back");
    let key_used: bool = env.contract.call_function("is_key_used", json!({ "idempotency_key": "job-7" })).read_only().fetch_from(&env.network).await?.data;
    assert!(!key_used, "a failed transfer must release its idempotency key");
    Ok(())
}
