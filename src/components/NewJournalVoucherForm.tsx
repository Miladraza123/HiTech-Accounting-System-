"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createJournalVoucherAction, type JournalVoucherLineInput } from "@/app/actions/cashBank";
import { JournalVoucherLineEditor, blankJvLine, decodeDimension, type EditableJvLine } from "@/components/JournalVoucherLineEditor";
import type { Tables } from "@/lib/supabase/database.types";

function serialize(lines: EditableJvLine[]): JournalVoucherLineInput[] {
  return lines
    .filter((l) => l.account_code && (Number(l.debit) > 0 || Number(l.credit) > 0))
    .map((l) => ({
      account_code: l.account_code,
      debit: Number(l.debit) || 0,
      credit: Number(l.credit) || 0,
      memo: l.memo || undefined,
      ...decodeDimension(l.dimension),
    }));
}

export function NewJournalVoucherForm({
  accounts,
  parties,
  bankAccounts,
  pettyCashFunds,
}: {
  accounts: Tables<"chart_of_accounts">[];
  parties: Tables<"parties">[];
  bankAccounts: Tables<"bank_accounts">[];
  pettyCashFunds: Tables<"petty_cash_funds">[];
}) {
  const router = useRouter();
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [narration, setNarration] = useState("");
  const [lines, setLines] = useState<EditableJvLine[]>([blankJvLine(), blankJvLine()]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    if (!narration.trim()) {
      setError("Narration is required.");
      return;
    }
    const serialized = serialize(lines);
    if (serialized.length < 2) {
      setError("At least 2 lines are required (one Debit, one Credit).");
      return;
    }
    const totalDebit = serialized.reduce((s, l) => s + l.debit, 0);
    const totalCredit = serialized.reduce((s, l) => s + l.credit, 0);
    if (Math.round((totalDebit - totalCredit) * 100) !== 0) {
      setError("Entry is not balanced — Debit and Credit totals must be equal.");
      return;
    }
    startTransition(async () => {
      const res = await createJournalVoucherAction({ entry_date: entryDate, narration: narration.trim(), lines: serialized });
      if (res.error) {
        setError(res.error);
        return;
      }
      router.push("/journal-vouchers");
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-surface p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">Date</span>
            <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} className="input" />
          </label>
        </div>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Narration *</span>
          <input value={narration} onChange={(e) => setNarration(e.target.value)} className="input" placeholder="Reason / details for the entry" />
        </label>
      </div>

      <JournalVoucherLineEditor accounts={accounts} parties={parties} bankAccounts={bankAccounts} pettyCashFunds={pettyCashFunds} lines={lines} onChange={setLines} />

      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-60"
      >
        {pending ? "Posting…" : "Post Journal Voucher"}
      </button>
    </div>
  );
}
