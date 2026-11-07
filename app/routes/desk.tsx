import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { useSetHeaderActions, useSetPageTitle } from "@agent-native/toolkit/app-shell/header-actions";
import { IconEdit, IconRefresh } from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { APP_TITLE, APP_VERSION } from "@/lib/app-config";
import { cn } from "@/lib/utils";

export function meta() {
  return [{ title: `Spend Desk — ${APP_TITLE}` }];
}

type PaymentsResult = {
  payments: {
    id: string;
    taskId: string;
    taskTitle: string | null;
    amountUsd: number;
    payeeEmail: string;
    memo: string;
    status: string;
    outlook: Outlook | null;
  }[];
};
type Payment = PaymentsResult["payments"][number];
type Outlook = "auto_pay" | "needs_approval" | "blocked_over_budget" | "blocked_payee_not_allowed";
type Budget = { month: string; capUsd: number; spentUsd: number; remainingUsd: number; autoApproveLimitUsd: number };
type Receipt = {
  id: string;
  paymentId: string;
  taskId: string;
  amountUsd: number;
  payeeEmail: string;
  policyResult: string;
  approver: string;
  paypalBatchId: string | null;
  paypalItemId: string | null;
  budgetRemainingAfterUsd: number;
  detail: string;
  createdAt: string;
};

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });

const OUTLOOK: Record<Outlook, { label: string; className: string }> = {
  auto_pay: { label: "Will auto-pay", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  needs_approval: { label: "Needs your approval", className: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  blocked_over_budget: { label: "Will be blocked: over budget", className: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300" },
  blocked_payee_not_allowed: { label: "Will be blocked: payee not allowed", className: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300" },
};

const RESULT: Record<string, { label: string; className: string }> = {
  auto_paid: { label: "auto_paid", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  approved_and_paid: { label: "approved_and_paid", className: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  blocked_over_budget: { label: "blocked_over_budget", className: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300" },
  blocked_payee_not_allowed: { label: "blocked_payee_not_allowed", className: "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300" },
  rejected: { label: "rejected", className: "border-zinc-500/40 bg-zinc-500/10 text-zinc-700 dark:text-zinc-300" },
  paypal_error: { label: "paypal_error", className: "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300" },
};

function Chip({ label, className }: { label: string; className?: string }) {
  return (
    <Badge variant="outline" size="sm" className={cn("whitespace-nowrap font-medium", className)}>
      {label}
    </Badge>
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong";
}

export default function DeskRoute() {
  const budget = useActionQuery<Budget>("get-budget", {});
  const payments = useActionQuery<PaymentsResult>("list-payments", { status: "all" });
  const receipts = useActionQuery<{ receipts: Receipt[] }>("list-receipts", {});
  const [resetOpen, setResetOpen] = useState(false);
  const reset = useActionMutation("reset-demo", {
    onSuccess: () => toast.success("Demo reset: 4 tasks, $0 spent."),
    onError: (err) => toast.error(errorMessage(err)),
  });

  useSetPageTitle("Spend Desk");
  useSetHeaderActions(
    <Button variant="outline" size="sm" onClick={() => setResetOpen(true)} disabled={reset.isPending}>
      <IconRefresh className="size-4" strokeWidth={1.8} />
      Reset demo
    </Button>,
  );

  const all = payments.data?.payments ?? [];
  const open = all.filter((p) => p.outlook !== null);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-6 md:px-6">
        <header className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{APP_TITLE}</h1>
            <Chip label={`v${APP_VERSION}`} className="text-muted-foreground" />
            <Chip label="PayPal sandbox · no real money" className="border-sky-500/40 text-sky-700 dark:text-sky-300" />
          </div>
          <p className="text-sm text-muted-foreground">
            Policy: payouts up to {usd(budget.data?.autoApproveLimitUsd ?? 25)} pay automatically, anything above needs a human's approval, and
            anything over the remaining monthly budget is blocked before it reaches PayPal.
          </p>
        </header>

        <BudgetCard budget={budget.data} payments={all} />
        <QueueCard payments={open} loading={payments.isLoading} />
        <ReceiptsCard receipts={receipts.data?.receipts ?? []} payments={all} loading={receipts.isLoading} />
      </div>

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset the demo?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes every payment and receipt, sets spent back to $0 and restores the four completed tasks. PayPal sandbox
              payouts already sent are not reversed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => reset.mutate({})}>Reset demo</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function BudgetCard({ budget, payments }: { budget: Budget | undefined; payments: Payment[] }) {
  const pct = budget ? Math.min(100, (budget.spentUsd / budget.capUsd) * 100) : 0;
  const stats: [string, string][] = budget
    ? [
        ["Monthly cap", usd(budget.capUsd)],
        ["Spent", usd(budget.spentUsd)],
        ["Remaining", usd(budget.remainingUsd)],
        ["Auto-approve limit", usd(budget.autoApproveLimitUsd)],
      ]
    : [];
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Budget{budget ? ` · ${budget.month}` : ""}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map(([label, value]) => (
            <div key={label} className="rounded-lg border border-border px-3 py-2">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="text-lg font-semibold tabular-nums" data-testid={`budget-${label.toLowerCase().replace(/\W+/g, "-")}`}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-col gap-1.5">
          <Progress value={pct} aria-label="Budget spent" />
          <p className="text-xs text-muted-foreground tabular-nums">
            {budget ? `${usd(budget.spentUsd)} of ${usd(budget.capUsd)} spent (${Math.round(pct)}%)` : "Loading budget…"}
          </p>
        </div>
        {payments.length > 0 ? (
          <ul className="flex flex-wrap gap-2 text-xs">
            {payments.map((p) => (
              <li key={p.id} className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1">
                <span>{p.taskTitle ?? p.taskId}</span>
                <span className="tabular-nums text-muted-foreground">{usd(p.amountUsd)}</span>
                <span className="font-medium">{p.status}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

function QueueCard({ payments, loading }: { payments: Payment[]; loading: boolean }) {
  const [editing, setEditing] = useState<Payment | null>(null);
  const [deciding, setDeciding] = useState<{ payment: Payment; decision: "approve" | "reject" } | null>(null);
  const execute = useActionMutation("execute-payout", {
    timeoutMs: 120_000,
    onSuccess: (res: { receipt: Receipt }) => {
      const r = res.receipt;
      const msg = `${r.policyResult}: ${usd(r.amountUsd)} to ${r.payeeEmail}`;
      if (r.policyResult === "auto_paid" || r.policyResult === "approved_and_paid") toast.success(msg);
      else toast.message(msg);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const pendingId = execute.isPending ? (execute.variables as { paymentId?: string } | undefined)?.paymentId : undefined;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Approval queue</CardTitle>
      </CardHeader>
      <CardContent>
        {payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {loading ? "Loading…" : 'No open payments. Ask the agent to "close out this week\'s jobs" to propose payouts.'}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {payments.map((p) => (
              <li key={p.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 md:flex-row md:items-center md:gap-4" data-testid={`queue-${p.taskId}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{p.taskTitle ?? p.taskId}</span>
                    <span className="font-semibold tabular-nums">{usd(p.amountUsd)}</span>
                    {p.outlook ? <Chip {...OUTLOOK[p.outlook]} /> : null}
                  </div>
                  <p className="truncate text-xs text-muted-foreground" title={p.payeeEmail}>
                    {p.payeeEmail} · {p.memo}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(p)} disabled={!!pendingId} aria-label={`Edit ${p.taskTitle}`}>
                    <IconEdit className="size-4" strokeWidth={1.8} />
                    Edit
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setDeciding({ payment: p, decision: "reject" })} disabled={!!pendingId}>
                    Reject
                  </Button>
                  <Button size="sm" onClick={() => setDeciding({ payment: p, decision: "approve" })} disabled={!!pendingId}>
                    {pendingId === p.id ? "Working…" : "Approve"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <EditDialog payment={editing} onClose={() => setEditing(null)} />

      <AlertDialog open={!!deciding} onOpenChange={(o) => !o && setDeciding(null)}>
        <AlertDialogContent>
          {deciding ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {deciding.decision === "approve"
                    ? `Approve ${usd(deciding.payment.amountUsd)} to ${deciding.payment.payeeEmail}?`
                    : `Reject ${usd(deciding.payment.amountUsd)} for ${deciding.payment.taskTitle}?`}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {deciding.decision === "reject"
                    ? "Nothing is sent to PayPal. A rejected receipt is written and the task can be proposed again."
                    : deciding.payment.outlook === "blocked_over_budget" || deciding.payment.outlook === "blocked_payee_not_allowed"
                      ? "Policy will block this payout before it reaches PayPal and write a blocked receipt."
                      : "This sends a PayPal sandbox payout (no real money) and writes a receipt. The budget is re-checked at execution time."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() =>
                    execute.mutate({
                      paymentId: deciding.payment.id,
                      amountUsd: deciding.payment.amountUsd,
                      payeeEmail: deciding.payment.payeeEmail,
                      decision: deciding.decision,
                    })
                  }
                >
                  {deciding.decision === "approve" ? "Approve" : "Reject"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function EditDialog({ payment, onClose }: { payment: Payment | null; onClose: () => void }) {
  const [draft, setDraft] = useState({ amount: "", payee: "", memo: "" });
  const [forId, setForId] = useState<string | null>(null);
  if (payment && forId !== payment.id) {
    setForId(payment.id);
    setDraft({ amount: String(payment.amountUsd), payee: payment.payeeEmail, memo: payment.memo });
  }
  const edit = useActionMutation("edit-payment", {
    onSuccess: () => {
      toast.success("Payment updated");
      setForId(null);
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const amount = Number(draft.amount);
  const valid = Number.isFinite(amount) && amount > 0 && draft.payee.includes("@");

  return (
    <Dialog open={!!payment} onOpenChange={(o) => !o && (setForId(null), onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit payment{payment?.taskTitle ? ` · ${payment.taskTitle}` : ""}</DialogTitle>
          <DialogDescription>Editing never pays. Approve the payment afterwards.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!payment || !valid) return;
            edit.mutate({ paymentId: payment.id, amountUsd: amount, payeeEmail: draft.payee.trim(), memo: draft.memo });
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-amount">Amount (USD)</Label>
            <Input id="edit-amount" inputMode="decimal" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-payee">Payee PayPal email</Label>
            <Input id="edit-payee" type="email" value={draft.payee} onChange={(e) => setDraft({ ...draft, payee: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-memo">Memo</Label>
            <Input id="edit-memo" value={draft.memo} onChange={(e) => setDraft({ ...draft, memo: e.target.value })} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => (setForId(null), onClose())}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || edit.isPending}>
              {edit.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReceiptsCard({ receipts, payments, loading }: { receipts: Receipt[]; payments: Payment[]; loading: boolean }) {
  const [selected, setSelected] = useState<Receipt | null>(null);
  const titleFor = (r: Receipt) => payments.find((p) => p.id === r.paymentId)?.taskTitle ?? r.taskId;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Receipts ledger</CardTitle>
      </CardHeader>
      <CardContent>
        {receipts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{loading ? "Loading…" : "No receipts yet. Every payout attempt writes one."}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {receipts.map((r) => (
              <li key={r.id} data-testid={`receipt-${r.taskId}`}>
                <button
                  type="button"
                  onClick={() => setSelected(r)}
                  className="flex w-full flex-col gap-1 rounded-md px-2 py-2.5 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-medium">{titleFor(r)}</span>
                    <span className="font-semibold tabular-nums">{usd(r.amountUsd)}</span>
                    <Chip {...(RESULT[r.policyResult] ?? { label: r.policyResult })} />
                  </span>
                  <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span className="max-w-full truncate">{r.payeeEmail}</span>
                    <span>
                      Approver <span className="text-foreground">{r.approver}</span>
                    </span>
                    <span>
                      PayPal batch <span className="font-mono text-foreground">{r.paypalBatchId ?? "— (not sent)"}</span>
                    </span>
                    <span className="tabular-nums">{when(r.createdAt)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent>
          {selected ? (
            <>
              <DialogHeader>
                <DialogTitle>Receipt · {titleFor(selected)}</DialogTitle>
                <DialogDescription>{selected.detail}</DialogDescription>
              </DialogHeader>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                {(
                  [
                    ["Policy result", <Chip key="c" {...(RESULT[selected.policyResult] ?? { label: selected.policyResult })} />],
                    ["Approver", selected.approver],
                    ["Amount", usd(selected.amountUsd)],
                    ["Payee", selected.payeeEmail],
                    ["PayPal batch id", selected.paypalBatchId ?? "— (not sent to PayPal)"],
                    ["PayPal item id", selected.paypalItemId ?? "—"],
                    ["Budget remaining after", usd(selected.budgetRemainingAfterUsd)],
                    ["Payment id", selected.paymentId],
                    ["Receipt id", selected.id],
                    ["Time", new Date(selected.createdAt).toLocaleString()],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="min-w-0 break-all font-medium">{v}</dd>
                  </div>
                ))}
              </dl>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
