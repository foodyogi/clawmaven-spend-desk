//! Sandbox tests: deploy the real wasm to a local NEAR Sandbox and exercise it
//! with real transactions. No testnet account is needed.

use near_api::{AccountId, NearGas, NearToken, Signer};
use near_sdk::serde_json::{Value, json};
use std::sync::Arc;

const PER_PAYOUT_CAP: NearToken = NearToken::from_near(2);
const TOTAL_CAP: NearToken = NearToken::from_near(4);

struct Env {
    _sandbox: near_sandbox::Sandbox,
    network: near_api::NetworkConfig,
    signer: Arc<Signer>,
    contract: near_api::Contract,
    agent: AccountId,
    owner: AccountId,
    payee: AccountId,
    stranger: AccountId,
}

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
                "per_payout_cap_yocto": PER_PAYOUT_CAP.as_yoctonear().to_string(),
                "total_cap_yocto": TOTAL_CAP.as_yoctonear().to_string(),
            }),
        )?
        .with_signer(signer.clone())
        .send_to(&network)
        .await?
        .assert_success();
    Ok(Env { _sandbox: sandbox, network, signer, contract: near_api::Contract(treasury), agent, owner, payee, stranger })
}

impl Env {
    /// `Some(value)` when the transaction succeeded (the contract's bool), `None` when it failed.
    async fn payout(&self, from: &AccountId, payee: &str, amount: NearToken, key: &str, deposit: NearToken) -> testresult::TestResult<Option<bool>> {
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
        Ok(match outcome.into_result() {
            Ok(success) => Some(success.json::<bool>()?),
            Err(_) => None,
        })
    }

    async fn call(&self, from: &AccountId, method: &str, args: Value) -> testresult::TestResult<bool> {
        let outcome = self
            .contract
            .call_function(method, args)
            .transaction()
            .gas(NearGas::from_tgas(30))
            .with_signer(from.clone(), self.signer.clone())
            .send_to(&self.network)
            .await?;
        Ok(outcome.is_success())
    }

    async fn view<T: near_sdk::serde::de::DeserializeOwned + Send + Sync>(&self, method: &str, args: Value) -> testresult::TestResult<T> {
        Ok(self.contract.call_function(method, args).read_only().fetch_from(&self.network).await?.data)
    }

    async fn spent(&self) -> testresult::TestResult<u128> {
        Ok(self.view::<String>("get_spent", json!({})).await?.parse()?)
    }

    async fn balance(&self, id: &AccountId) -> testresult::TestResult<NearToken> {
        Ok(near_api::Tokens::account(id.clone()).near_balance().fetch_from(&self.network).await?.total)
    }
}

#[tokio::test]
async fn sandbox_treasury_rules() -> testresult::TestResult<()> {
    let env = setup().await?;
    let zero = NearToken::from_yoctonear(0);
    let one = NearToken::from_near(1);
    let p = env.payee.as_str();

    // Happy path: the agent pays an allowlisted payee from the treasury balance.
    let before = env.balance(&env.payee).await?;
    assert_eq!(env.payout(&env.agent, p, one, "job-1", zero).await?, Some(true), "happy path");
    assert_eq!(env.balance(&env.payee).await?, before.saturating_add(one));
    assert_eq!(env.spent().await?, one.as_yoctonear());

    // Repeated idempotency key: refused (recorded), nothing paid twice.
    assert_eq!(env.payout(&env.agent, p, one, "job-1", zero).await?, Some(false), "repeated key");
    assert_eq!(env.balance(&env.payee).await?, before.saturating_add(one));

    // Unauthorized callers fail outright and are not recorded.
    assert_eq!(env.payout(&env.owner, p, one, "job-2", zero).await?, None, "owner must not request payouts");
    assert_eq!(env.payout(&env.stranger, p, one, "job-3", zero).await?, None, "stranger must not request payouts");

    // Disallowed payee and over the per-payout cap: refused and recorded.
    assert_eq!(env.payout(&env.agent, env.stranger.as_str(), one, "job-4", zero).await?, Some(false), "disallowed payee");
    assert_eq!(env.payout(&env.agent, p, PER_PAYOUT_CAP.saturating_add(NearToken::from_yoctonear(1)), "job-5", zero).await?, Some(false), "over per-payout cap");

    // An attached deposit fails outright (payout is not payable).
    assert_eq!(env.payout(&env.agent, p, one, "job-6", NearToken::from_yoctonear(1)).await?, None, "deposit");

    // Over the total cap: 1 + 2 = 3 of 4 spent, then 1.5 more would exceed it.
    assert_eq!(env.payout(&env.agent, p, NearToken::from_near(2), "job-7", zero).await?, Some(true));
    assert_eq!(env.payout(&env.agent, p, NearToken::from_millinear(1500), "job-8", zero).await?, Some(false), "over total cap");
    assert_eq!(env.view::<String>("get_remaining", json!({})).await?, one.as_yoctonear().to_string());

    // Owner-only methods are rejected from the agent (and from strangers).
    for (method, args) in [
        ("pause", json!({})),
        ("unpause", json!({})),
        ("set_per_payout_cap", json!({ "per_payout_cap_yocto": "1" })),
        ("set_total_cap", json!({ "total_cap_yocto": "1" })),
        ("set_allowed_payees", json!({ "allowed_payees": [env.stranger] })),
        ("reset_spent", json!({})),
    ] {
        assert!(!env.call(&env.agent, method, args.clone()).await?, "agent must not call {method}");
        assert!(!env.call(&env.stranger, method, args).await?, "stranger must not call {method}");
    }
    assert!(!env.view::<bool>("is_paused", json!({})).await?);

    // Kill switch: the owner pauses, payouts are refused, then unpauses.
    assert!(env.call(&env.owner, "pause", json!({})).await?);
    assert!(env.view::<bool>("is_paused", json!({})).await?);
    let paused_before = env.balance(&env.payee).await?;
    assert_eq!(env.payout(&env.agent, p, NearToken::from_millinear(100), "job-9", zero).await?, Some(false), "paused");
    assert_eq!(env.balance(&env.payee).await?, paused_before);
    assert!(env.call(&env.owner, "unpause", json!({})).await?);
    assert_eq!(env.payout(&env.agent, p, NearToken::from_millinear(100), "job-9", zero).await?, Some(true), "after unpause");

    // A failed transfer (allowlisted account that does not exist) is rolled back.
    let spent_before_ghost = env.spent().await?;
    assert_eq!(env.payout(&env.agent, "ghost.sandbox", NearToken::from_millinear(100), "job-10", zero).await?, Some(false));
    assert_eq!(env.spent().await?, spent_before_ghost, "failed transfer must be rolled back");
    assert!(!env.view::<bool>("is_key_used", json!({ "idempotency_key": "job-10" })).await?);

    // Owner setters and a new period.
    assert!(env.call(&env.owner, "set_total_cap", json!({ "total_cap_yocto": NearToken::from_near(10).as_yoctonear().to_string() })).await?);
    assert!(env.call(&env.owner, "set_per_payout_cap", json!({ "per_payout_cap_yocto": NearToken::from_near(3).as_yoctonear().to_string() })).await?);
    assert!(env.call(&env.owner, "set_allowed_payees", json!({ "allowed_payees": [env.payee] })).await?);
    assert!(!env.view::<bool>("is_allowed_payee", json!({ "account_id": "ghost.sandbox" })).await?);
    assert!(env.call(&env.owner, "reset_spent", json!({})).await?);
    let config: Value = env.view("get_config", json!({})).await?;
    assert_eq!(config["spent_yocto"], "0");
    assert_eq!(config["remaining_yocto"], NearToken::from_near(10).as_yoctonear().to_string());
    assert_eq!(config["per_payout_cap_yocto"], NearToken::from_near(3).as_yoctonear().to_string());

    // Audit log: every agent request, in order; failed calls from others are absent.
    let log: Vec<Value> = env.view("get_audit_log", json!({})).await?;
    let outcomes: Vec<(&str, &str)> = log.iter().map(|e| (e["idempotency_key"].as_str().unwrap(), e["outcome"].as_str().unwrap())).collect();
    assert_eq!(
        outcomes,
        vec![
            ("job-1", "Paid"),
            ("job-1", "RefusedDuplicateKey"),
            ("job-4", "RefusedPayeeNotAllowed"),
            ("job-5", "RefusedOverPerPayoutCap"),
            ("job-7", "Paid"),
            ("job-8", "RefusedOverTotalCap"),
            ("job-9", "RefusedPaused"),
            ("job-9", "Paid"),
            ("job-10", "TransferFailed"),
        ]
    );
    let page: Vec<Value> = env.view("get_audit_log", json!({ "from_index": "2", "limit": "2" })).await?;
    assert_eq!(page.iter().map(|e| e["index"].as_str().unwrap()).collect::<Vec<_>>(), vec!["2", "3"]);
    Ok(())
}
