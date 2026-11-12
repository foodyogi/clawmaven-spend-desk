//! ClawMaven Spend Desk treasury (NEAR testnet).
//!
//! Holds the demo funds and pays contractors from its own balance. The Spend
//! Desk agent signs `payout` with a function-call access key that cannot move
//! NEAR by itself, so every payout goes through the checks below.
//!
//! - Only the agent account may request payouts, with zero deposit.
//! - The owner can pause and unpause (the on-chain kill switch), change the
//!   per-payout cap, the total budget cap and the payee allowlist, and reset
//!   the spent total for a new demo period.
//! - Every payout request from the agent is written to an on-chain audit log,
//!   including policy refusals (paused, payee not allowed, over a cap, repeated
//!   idempotency key). Refusals return `false` instead of panicking so the
//!   audit entry is kept. Calls from any other account, attached deposits and
//!   malformed arguments still panic and are not recorded, so outsiders cannot
//!   grow the log (and the storage the contract pays for).

use near_sdk::json_types::{U64, U128};
use near_sdk::store::{IterableSet, LookupSet, Vector};
use near_sdk::{
    AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, PromiseError, PromiseOrValue,
    env, near, require,
};

const MAX_KEY_LEN: usize = 64;
const MAX_MEMO_LEN: usize = 256;
const MAX_AUDIT_PAGE: u64 = 50;
const CALLBACK_GAS: Gas = Gas::from_tgas(10);

#[near]
#[derive(BorshStorageKey)]
enum StorageKey {
    AllowedPayees,
    UsedKeys,
    AuditLog,
}

/// The result of one payout request, as stored in the audit log.
#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Outcome {
    /// Transfer sent; waiting for its result.
    Pending,
    Paid,
    /// The transfer failed and was refunded; the spend and key were released.
    TransferFailed,
    RefusedPaused,
    RefusedPayeeNotAllowed,
    RefusedOverPerPayoutCap,
    RefusedOverTotalCap,
    RefusedDuplicateKey,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct AuditEntry {
    pub index: U64,
    /// Block timestamp in milliseconds.
    pub timestamp_ms: U64,
    pub payee: AccountId,
    pub amount_yocto: U128,
    pub idempotency_key: String,
    pub memo: String,
    pub outcome: Outcome,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Treasury {
    owner: AccountId,
    agent: AccountId,
    paused: bool,
    allowed_payees: IterableSet<AccountId>,
    per_payout_cap: NearToken,
    total_cap: NearToken,
    spent: NearToken,
    used_keys: LookupSet<String>,
    audit_log: Vector<AuditEntry>,
}

/// Limits, totals and status, for view calls.
#[near(serializers = [json])]
pub struct Config {
    pub owner: AccountId,
    pub agent: AccountId,
    pub paused: bool,
    pub per_payout_cap_yocto: U128,
    pub total_cap_yocto: U128,
    pub spent_yocto: U128,
    pub remaining_yocto: U128,
    pub allowed_payees: Vec<AccountId>,
    pub audit_log_length: U64,
}

#[near]
impl Treasury {
    /// Called once, by the treasury account itself, in the deploy transaction.
    #[init]
    #[private]
    pub fn new(
        owner: AccountId,
        agent: AccountId,
        allowed_payees: Vec<AccountId>,
        per_payout_cap_yocto: U128,
        total_cap_yocto: U128,
    ) -> Self {
        require!(per_payout_cap_yocto.0 > 0, "per_payout_cap_yocto must be positive");
        require!(total_cap_yocto.0 > 0, "total_cap_yocto must be positive");
        let mut set = IterableSet::new(StorageKey::AllowedPayees);
        for payee in allowed_payees {
            set.insert(payee);
        }
        Self {
            owner,
            agent,
            paused: false,
            allowed_payees: set,
            per_payout_cap: NearToken::from_yoctonear(per_payout_cap_yocto.0),
            total_cap: NearToken::from_yoctonear(total_cap_yocto.0),
            spent: NearToken::from_yoctonear(0),
            used_keys: LookupSet::new(StorageKey::UsedKeys),
            audit_log: Vector::new(StorageKey::AuditLog),
        }
    }

    /// Pays `amount_yocto` to an allowlisted `payee` from the treasury balance.
    /// Agent only, zero deposit (not payable). Returns `false` (and records the
    /// refusal) when paused, the payee is not allowed, a cap would be exceeded
    /// or the idempotency key was already used. Otherwise transfers and returns
    /// the result of `on_payout_settled`.
    pub fn payout(&mut self, payee: AccountId, amount_yocto: U128, memo: String, idempotency_key: String) -> PromiseOrValue<bool> {
        require!(env::predecessor_account_id() == self.agent, "Only the agent account can request payouts");
        require!(amount_yocto.0 > 0, "Amount must be positive");
        require!(!idempotency_key.is_empty() && idempotency_key.len() <= MAX_KEY_LEN, "idempotency_key must be 1 to 64 characters");
        require!(memo.len() <= MAX_MEMO_LEN, "memo is longer than 256 bytes");
        let amount = NearToken::from_yoctonear(amount_yocto.0);

        // A retry of a key that already paid is reported as a duplicate even
        // if the caps have changed since.
        let refusal = if self.paused {
            Some(Outcome::RefusedPaused)
        } else if self.used_keys.contains(&idempotency_key) {
            Some(Outcome::RefusedDuplicateKey)
        } else if !self.allowed_payees.contains(&payee) {
            Some(Outcome::RefusedPayeeNotAllowed)
        } else if amount > self.per_payout_cap {
            Some(Outcome::RefusedOverPerPayoutCap)
        } else if self.spent.saturating_add(amount) > self.total_cap {
            Some(Outcome::RefusedOverTotalCap)
        } else {
            None
        };
        if let Some(outcome) = refusal {
            self.record(&payee, amount, &idempotency_key, &memo, outcome);
            return PromiseOrValue::Value(false);
        }

        self.used_keys.insert(idempotency_key.clone());
        self.spent = self.spent.saturating_add(amount);
        let index = self.record(&payee, amount, &idempotency_key, &memo, Outcome::Pending);
        PromiseOrValue::Promise(
            Promise::new(payee).transfer(amount).then(
                Self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_payout_settled(U64(index), amount_yocto, idempotency_key),
            ),
        )
    }

    /// Settles a payout: marks it paid, or (the transfer was refunded to this
    /// contract) rolls back the spend, releases the key and marks it failed.
    #[private]
    pub fn on_payout_settled(
        &mut self,
        audit_index: U64,
        amount_yocto: U128,
        idempotency_key: String,
        #[callback_result] result: Result<(), PromiseError>,
    ) -> bool {
        let paid = result.is_ok();
        if !paid {
            self.spent = self.spent.saturating_sub(NearToken::from_yoctonear(amount_yocto.0));
            self.used_keys.remove(&idempotency_key);
        }
        let outcome = if paid { Outcome::Paid } else { Outcome::TransferFailed };
        if let Some(entry) = self.audit_log.get_mut(audit_index.0 as u32) {
            entry.outcome = outcome;
        }
        env::log_str(&format!("spend-desk payout {outcome:?}: audit_index={} key={idempotency_key}", audit_index.0));
        paid
    }

    // ---- Owner-only controls -------------------------------------------------

    /// Kill switch: every payout request is refused until `unpause`.
    pub fn pause(&mut self) {
        self.assert_owner();
        self.paused = true;
        env::log_str("spend-desk treasury paused");
    }

    pub fn unpause(&mut self) {
        self.assert_owner();
        self.paused = false;
        env::log_str("spend-desk treasury unpaused");
    }

    pub fn set_per_payout_cap(&mut self, per_payout_cap_yocto: U128) {
        self.assert_owner();
        require!(per_payout_cap_yocto.0 > 0, "per_payout_cap_yocto must be positive");
        self.per_payout_cap = NearToken::from_yoctonear(per_payout_cap_yocto.0);
    }

    pub fn set_total_cap(&mut self, total_cap_yocto: U128) {
        self.assert_owner();
        require!(total_cap_yocto.0 > 0, "total_cap_yocto must be positive");
        self.total_cap = NearToken::from_yoctonear(total_cap_yocto.0);
    }

    /// Replaces the payee allowlist.
    pub fn set_allowed_payees(&mut self, allowed_payees: Vec<AccountId>) {
        self.assert_owner();
        self.allowed_payees.clear();
        for payee in allowed_payees {
            self.allowed_payees.insert(payee);
        }
    }

    /// Starts a new budget period: spent goes back to 0. The audit log and the
    /// used idempotency keys are kept.
    pub fn reset_spent(&mut self) {
        self.assert_owner();
        self.spent = NearToken::from_yoctonear(0);
        env::log_str("spend-desk spent reset to 0");
    }

    // ---- Views ---------------------------------------------------------------

    pub fn get_config(&self) -> Config {
        Config {
            owner: self.owner.clone(),
            agent: self.agent.clone(),
            paused: self.paused,
            per_payout_cap_yocto: U128(self.per_payout_cap.as_yoctonear()),
            total_cap_yocto: U128(self.total_cap.as_yoctonear()),
            spent_yocto: U128(self.spent.as_yoctonear()),
            remaining_yocto: self.get_remaining(),
            allowed_payees: self.allowed_payees.iter().cloned().collect(),
            audit_log_length: U64(self.audit_log.len() as u64),
        }
    }

    pub fn get_spent(&self) -> U128 {
        U128(self.spent.as_yoctonear())
    }

    /// Total cap minus spent, never below zero.
    pub fn get_remaining(&self) -> U128 {
        U128(self.total_cap.saturating_sub(self.spent).as_yoctonear())
    }

    pub fn get_per_payout_cap(&self) -> U128 {
        U128(self.per_payout_cap.as_yoctonear())
    }

    pub fn get_total_cap(&self) -> U128 {
        U128(self.total_cap.as_yoctonear())
    }

    pub fn is_paused(&self) -> bool {
        self.paused
    }

    pub fn is_allowed_payee(&self, account_id: AccountId) -> bool {
        self.allowed_payees.contains(&account_id)
    }

    pub fn is_key_used(&self, idempotency_key: String) -> bool {
        self.used_keys.contains(&idempotency_key)
    }

    /// Audit entries from `from_index` (default 0), oldest first, at most
    /// `limit` (default and maximum 50).
    pub fn get_audit_log(&self, from_index: Option<U64>, limit: Option<U64>) -> Vec<AuditEntry> {
        let from = from_index.map_or(0, |v| v.0);
        let limit = limit.map_or(MAX_AUDIT_PAGE, |v| v.0.min(MAX_AUDIT_PAGE));
        let len = self.audit_log.len() as u64;
        (from..len.min(from.saturating_add(limit)))
            .filter_map(|i| self.audit_log.get(i as u32).cloned())
            .collect()
    }

    // ---- Internal ------------------------------------------------------------

    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "Only the owner can do this");
    }

    fn record(&mut self, payee: &AccountId, amount: NearToken, key: &str, memo: &str, outcome: Outcome) -> u64 {
        let index = self.audit_log.len() as u64;
        self.audit_log.push(AuditEntry {
            index: U64(index),
            timestamp_ms: U64(env::block_timestamp_ms()),
            payee: payee.clone(),
            amount_yocto: U128(amount.as_yoctonear()),
            idempotency_key: key.to_string(),
            memo: memo.to_string(),
            outcome,
        });
        env::log_str(&format!(
            "spend-desk payout {outcome:?}: audit_index={index} payee={payee} amount_yocto={} key={key}",
            amount.as_yoctonear()
        ));
        index
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
    fn milli(n: u128) -> U128 {
        U128(NearToken::from_millinear(n).as_yoctonear())
    }

    fn setup(predecessor: &str) -> Treasury {
        let mut ctx = VMContextBuilder::new();
        ctx.current_account_id(acc("treasury.near")).predecessor_account_id(acc("treasury.near"));
        testing_env!(ctx.build());
        let t = Treasury::new(acc("owner.near"), acc("agent.near"), vec![acc("payee1.near")], milli(50), milli(100));
        ctx.predecessor_account_id(acc(predecessor));
        testing_env!(ctx.build());
        t
    }

    fn refused(r: PromiseOrValue<bool>) -> bool {
        matches!(r, PromiseOrValue::Value(false))
    }

    #[test]
    fn init_sets_config() {
        let t = setup("agent.near");
        let c = t.get_config();
        assert_eq!((c.owner, c.agent, c.paused), (acc("owner.near"), acc("agent.near"), false));
        assert_eq!((c.spent_yocto.0, c.remaining_yocto.0), (0, milli(100).0));
        assert!(t.is_allowed_payee(acc("payee1.near")));
    }

    #[test]
    fn payout_tracks_spent_key_and_audit() {
        let mut t = setup("agent.near");
        assert!(!refused(t.payout(acc("payee1.near"), milli(10), "job".into(), "k1".into())));
        assert_eq!(t.get_spent().0, milli(10).0);
        assert!(t.is_key_used("k1".into()));
        assert_eq!(t.get_audit_log(None, None)[0].outcome, Outcome::Pending);
    }

    #[test]
    fn policy_refusals_are_recorded_and_pay_nothing() {
        let mut t = setup("agent.near");
        assert!(refused(t.payout(acc("payee1.near"), milli(51), "".into(), "a".into())));
        assert!(refused(t.payout(acc("stranger.near"), milli(1), "".into(), "b".into())));
        let _ = t.payout(acc("payee1.near"), milli(50), "".into(), "c".into());
        let _ = t.payout(acc("payee1.near"), milli(50), "".into(), "d".into());
        assert!(refused(t.payout(acc("payee1.near"), milli(1), "".into(), "e".into())));
        assert!(refused(t.payout(acc("payee1.near"), milli(1), "".into(), "c".into())));
        let outcomes: Vec<Outcome> = t.get_audit_log(None, None).iter().map(|e| e.outcome).collect();
        assert_eq!(outcomes[0], Outcome::RefusedOverPerPayoutCap);
        assert_eq!(outcomes[1], Outcome::RefusedPayeeNotAllowed);
        assert_eq!(outcomes[4], Outcome::RefusedOverTotalCap);
        assert_eq!(outcomes[5], Outcome::RefusedDuplicateKey);
        assert_eq!(t.get_spent().0, milli(100).0);
        assert_eq!(t.get_remaining().0, 0);
    }

    #[test]
    #[should_panic(expected = "Only the agent account can request payouts")]
    fn owner_cannot_request_payouts() {
        let mut t = setup("owner.near");
        let _ = t.payout(acc("payee1.near"), U128(1), "".into(), "k1".into());
    }

    #[test]
    #[should_panic(expected = "Only the owner can do this")]
    fn agent_cannot_pause() {
        let mut t = setup("agent.near");
        t.pause();
    }

    #[test]
    fn audit_log_pages() {
        let mut t = setup("agent.near");
        for i in 0..5 {
            let _ = t.payout(acc("stranger.near"), milli(1), "".into(), format!("k{i}"));
        }
        let page = t.get_audit_log(Some(U64(3)), Some(U64(10)));
        assert_eq!(page.iter().map(|e| e.index.0).collect::<Vec<_>>(), vec![3, 4]);
        assert_eq!(t.get_audit_log(None, Some(U64(2))).len(), 2);
    }
}
