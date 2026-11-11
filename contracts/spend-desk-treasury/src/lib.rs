//! ClawMaven Spend Desk treasury (NEAR testnet).
//!
//! Holds the demo funds and pays contractors from its own balance. The Spend
//! Desk agent signs `payout` with a function-call access key that cannot move
//! NEAR by itself, so every payout goes through the checks below.
//!
//! Step C (smoke test) scope: owner and agent set at init, payee allowlist, a
//! temporary per-payout cap, idempotency keys, spent tracking and views. Pause,
//! a total budget cap and the audit log come in the next step.

use near_sdk::json_types::U128;
use near_sdk::store::{IterableSet, LookupSet};
use near_sdk::{
    AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, PromiseError, env, near,
    require,
};

const MAX_KEY_LEN: usize = 64;
const MAX_MEMO_LEN: usize = 256;
const CALLBACK_GAS: Gas = Gas::from_tgas(10);

#[near]
#[derive(BorshStorageKey)]
enum StorageKey {
    AllowedPayees,
    UsedKeys,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Treasury {
    owner: AccountId,
    agent: AccountId,
    allowed_payees: IterableSet<AccountId>,
    per_payout_cap: NearToken,
    spent: NearToken,
    used_keys: LookupSet<String>,
}

/// Limits and totals, for view calls.
#[near(serializers = [json])]
pub struct Config {
    pub owner: AccountId,
    pub agent: AccountId,
    pub per_payout_cap_yocto: U128,
    pub spent_yocto: U128,
    pub allowed_payees: Vec<AccountId>,
}

#[near]
impl Treasury {
    /// Called once, by the treasury account itself, in the deploy transaction.
    #[init]
    #[private]
    pub fn new(owner: AccountId, agent: AccountId, allowed_payees: Vec<AccountId>, per_payout_cap_yocto: U128) -> Self {
        require!(per_payout_cap_yocto.0 > 0, "per_payout_cap_yocto must be positive");
        let mut set = IterableSet::new(StorageKey::AllowedPayees);
        for payee in allowed_payees {
            set.insert(payee);
        }
        Self {
            owner,
            agent,
            allowed_payees: set,
            per_payout_cap: NearToken::from_yoctonear(per_payout_cap_yocto.0),
            spent: NearToken::from_yoctonear(0),
            used_keys: LookupSet::new(StorageKey::UsedKeys),
        }
    }

    /// Pays `amount_yocto` to an allowlisted `payee` from the treasury balance.
    /// Only the agent account may call it, with zero deposit (the method is not
    /// payable). An idempotency key can pay at most once; a failed transfer
    /// releases the key and the spend again (see `on_payout_settled`).
    pub fn payout(&mut self, payee: AccountId, amount_yocto: U128, memo: String, idempotency_key: String) -> Promise {
        require!(env::predecessor_account_id() == self.agent, "Only the agent account can request payouts");
        require!(self.allowed_payees.contains(&payee), "Payee is not on the allowed list");
        require!(amount_yocto.0 > 0, "Amount must be positive");
        let amount = NearToken::from_yoctonear(amount_yocto.0);
        require!(amount <= self.per_payout_cap, "Amount exceeds the per-payout cap");
        require!(!idempotency_key.is_empty() && idempotency_key.len() <= MAX_KEY_LEN, "idempotency_key must be 1 to 64 characters");
        require!(memo.len() <= MAX_MEMO_LEN, "memo is longer than 256 bytes");
        require!(!self.used_keys.contains(&idempotency_key), "Idempotency key already used; this payout was already made");

        self.used_keys.insert(idempotency_key.clone());
        self.spent = self.spent.saturating_add(amount);
        env::log_str(&format!(
            "spend-desk payout requested: payee={payee} amount_yocto={} key={idempotency_key} memo={memo}",
            amount.as_yoctonear()
        ));

        Promise::new(payee.clone()).transfer(amount).then(
            Self::ext(env::current_account_id())
                .with_static_gas(CALLBACK_GAS)
                .on_payout_settled(payee, amount_yocto, idempotency_key),
        )
    }

    /// Settles a payout: on success logs it, on failure (the transfer was
    /// refunded to this contract) releases the key and the spend.
    #[private]
    pub fn on_payout_settled(
        &mut self,
        payee: AccountId,
        amount_yocto: U128,
        idempotency_key: String,
        #[callback_result] result: Result<(), PromiseError>,
    ) -> bool {
        if result.is_ok() {
            env::log_str(&format!("spend-desk payout paid: payee={payee} amount_yocto={} key={idempotency_key}", amount_yocto.0));
            return true;
        }
        self.spent = self.spent.saturating_sub(NearToken::from_yoctonear(amount_yocto.0));
        self.used_keys.remove(&idempotency_key);
        env::log_str(&format!("spend-desk payout failed and was rolled back: payee={payee} key={idempotency_key}"));
        false
    }

    pub fn get_spent(&self) -> U128 {
        U128(self.spent.as_yoctonear())
    }

    pub fn get_per_payout_cap(&self) -> U128 {
        U128(self.per_payout_cap.as_yoctonear())
    }

    pub fn is_allowed_payee(&self, account_id: AccountId) -> bool {
        self.allowed_payees.contains(&account_id)
    }

    pub fn is_key_used(&self, idempotency_key: String) -> bool {
        self.used_keys.contains(&idempotency_key)
    }

    pub fn get_config(&self) -> Config {
        Config {
            owner: self.owner.clone(),
            agent: self.agent.clone(),
            per_payout_cap_yocto: U128(self.per_payout_cap.as_yoctonear()),
            spent_yocto: U128(self.spent.as_yoctonear()),
            allowed_payees: self.allowed_payees.iter().cloned().collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn acc(s: &str) -> AccountId {
        s.parse().unwrap()
    }

    fn setup(predecessor: &str) -> Treasury {
        let mut ctx = VMContextBuilder::new();
        ctx.current_account_id(acc("treasury.near")).predecessor_account_id(acc("treasury.near"));
        testing_env!(ctx.build());
        let t = Treasury::new(acc("owner.near"), acc("agent.near"), vec![acc("payee1.near")], U128(NearToken::from_millinear(50).as_yoctonear()));
        ctx.predecessor_account_id(acc(predecessor));
        testing_env!(ctx.build());
        t
    }

    #[test]
    fn init_sets_config() {
        let t = setup("agent.near");
        let c = t.get_config();
        assert_eq!(c.owner, acc("owner.near"));
        assert_eq!(c.agent, acc("agent.near"));
        assert_eq!(c.spent_yocto.0, 0);
        assert!(t.is_allowed_payee(acc("payee1.near")));
        assert!(!t.is_allowed_payee(acc("stranger.near")));
    }

    #[test]
    fn payout_tracks_spent_and_key() {
        let mut t = setup("agent.near");
        let _ = t.payout(acc("payee1.near"), U128(NearToken::from_millinear(10).as_yoctonear()), "test".into(), "k1".into());
        assert_eq!(t.get_spent().0, NearToken::from_millinear(10).as_yoctonear());
        assert!(t.is_key_used("k1".into()));
    }

    #[test]
    #[should_panic(expected = "Amount exceeds the per-payout cap")]
    fn over_cap_is_refused() {
        let mut t = setup("agent.near");
        let _ = t.payout(acc("payee1.near"), U128(NearToken::from_millinear(51).as_yoctonear()), "".into(), "k1".into());
    }

    #[test]
    #[should_panic(expected = "Only the agent account can request payouts")]
    fn owner_cannot_request_payouts() {
        let mut t = setup("owner.near");
        let _ = t.payout(acc("payee1.near"), U128(1), "".into(), "k1".into());
    }
}
