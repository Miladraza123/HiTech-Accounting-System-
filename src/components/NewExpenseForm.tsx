"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createExpenseAction } from "@/app/actions/cashBank";
import type { Tables } from "@/lib/supabase/database.types";

export function NewExpenseForm({
  expenseHeads,
  bankAccounts,
  pettyCashFunds,
  jobs,
  profiles,
}: {
  expenseHeads: Tables<"expense_heads">[];
  bankAccounts: Tables<"bank_accounts">[];
  pettyCashFunds: Tables<"petty_cash_funds">[];
  jobs: { id: string; job_no: string; description: string }[];
  profiles: Tables<"profiles">[];
}) {
  const router = useRouter();
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().slice(0, 10));
  const [expenseHeadId, setExpenseHeadId] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentSource, setPaymentSource] = useState<"cash" | "bank" | "petty_cash">("cash");
  const [bankAccountId, setBankAccountId] = useState("");
  const [pettyCashFundId, setPettyCashFundId] = useState("");
  const [jobId, setJobId] = useState("");
  const [responsibleUserId, setResponsibleUserId] = useState("");
  const [department, setDepartment] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    if (!expenseHeadId) {
      setError("Expense Head select karen.");
      return;
    }
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      setError("Amount zero se zyada hona chahiye.");
      return;
    }
    if (paymentSource === "bank" && !bankAccountId) {
      setError("Bank Account select karen.");
      return;
    }
    if (paymentSource === "petty_cash" && !pettyCashFundId) {
      setError("Petty Cash Fund select karen.");
      return;
    }
    startTransition(async () => {
      const res = await createExpenseAction({
        expense_date: expenseDate,
        expense_head_id: expenseHeadId,
        amount: amt,
        payment_source: paymentSource,
        bank_account_id: paymentSource === "bank" ? bankAccountId : null,
        petty_cash_fund_id: paymentSource === "petty_cash" ? pettyCashFundId : null,
        job_id: jobId || null,
        responsible_user_id: responsibleUserId || null,
        department: department || null,
        description: description || null,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      router.push(`/expenses/${res.id}`);
    });
  }

  return (
    <div className="space-y-4 rounded-xl border border-line bg-surface p-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Expense Head *</span>
          <select value={expenseHeadId} onChange={(e) => setExpenseHeadId(e.target.value)} className="input">
            <option value="">— Select —</option>
            {expenseHeads.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Date</span>
          <input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} className="input" />
        </label>
      </div>

      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-ink-soft">Amount *</span>
        <input type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="input" />
      </label>

      <div className="space-y-1.5">
        <span className="text-xs font-medium text-ink-soft">Payment Source *</span>
        <div className="flex gap-4 text-sm">
          {(["cash", "bank", "petty_cash"] as const).map((src) => (
            <label key={src} className="flex items-center gap-1.5">
              <input type="radio" checked={paymentSource === src} onChange={() => setPaymentSource(src)} />
              {src === "cash" ? "Cash in Hand" : src === "bank" ? "Bank" : "Petty Cash"}
            </label>
          ))}
        </div>
      </div>

      {paymentSource === "bank" && (
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Bank Account *</span>
          <select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} className="input">
            <option value="">— Select —</option>
            {bankAccounts.map((b) => (
              <option key={b.id} value={b.id}>
                {b.account_name}
              </option>
            ))}
          </select>
        </label>
      )}
      {paymentSource === "petty_cash" && (
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Petty Cash Fund *</span>
          <select value={pettyCashFundId} onChange={(e) => setPettyCashFundId(e.target.value)} className="input">
            <option value="">— Select —</option>
            {pettyCashFunds.map((f) => (
              <option key={f.id} value={f.id}>
                {f.fund_name}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Job (optional)</span>
          <select value={jobId} onChange={(e) => setJobId(e.target.value)} className="input">
            <option value="">— None —</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.job_no} — {j.description}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Responsible Person</span>
          <select value={responsibleUserId} onChange={(e) => setResponsibleUserId(e.target.value)} className="input">
            <option value="">— None —</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Department</span>
          <input value={department} onChange={(e) => setDepartment(e.target.value)} className="input" />
        </label>
      </div>

      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-ink-soft">Description</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="input resize-none" />
      </label>

      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-60"
      >
        {pending ? "Save ho raha hai…" : "Expense Record Karen"}
      </button>
    </div>
  );
}
