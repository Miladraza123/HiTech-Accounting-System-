"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  cancelSalaryPaymentAction,
  cancelSalarySheetAction,
  finalizeSalarySheetAction,
  paySalarySheetAction,
  recalculateSalarySheetAction,
} from "@/app/actions/hr";
import { karachiToday } from "@/lib/karachiTime";
import { CancelWithReasonButton } from "@/components/CancelWithReasonButton";
import { PaymentSourceFields, type PaymentSource } from "@/components/PaymentSourceFields";

export function SalarySheetActions({
  sheetId,
  status,
  canPrepare,
  canPay,
  journalOn,
  hasJournal,
  periodEnded,
  bankAccounts,
  pettyCashFunds,
}: {
  sheetId: string;
  status: string;
  canPrepare: boolean;
  canPay: boolean;
  journalOn: boolean;
  hasJournal: boolean;
  periodEnded: boolean;
  bankAccounts: { id: string; account_name: string }[];
  pettyCashFunds: { id: string; fund_name: string }[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [confirmFinal, setConfirmFinal] = useState(false);
  const [paying, setPaying] = useState(false);
  const [paidOn, setPaidOn] = useState(karachiToday());
  const [source, setSource] = useState<PaymentSource>("cash");
  const [bankId, setBankId] = useState("");
  const [pettyId, setPettyId] = useState("");
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<{ error: string | null }>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.error) return setError(res.error);
      after?.();
      router.refresh();
    });
  }

  const btn = "rounded-md px-3 py-1.5 text-sm transition disabled:opacity-60";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start gap-2">
        {status === "Draft" && canPrepare && (
          <button type="button" disabled={pending} onClick={() => run(() => recalculateSalarySheetAction(sheetId))} className={`${btn} border border-line-strong bg-bg hover:bg-surface-2`}>
            {pending ? "…" : "Recalculate"}
          </button>
        )}
        {status === "Draft" && canPay && !confirmFinal && (
          <button
            type="button"
            disabled={pending || !periodEnded}
            title={periodEnded ? undefined : "The period has not ended yet"}
            onClick={() => setConfirmFinal(true)}
            className={`${btn} bg-accent text-white font-medium hover:opacity-90`}
          >
            Finalise
          </button>
        )}
        {status === "Finalized" && canPay && !paying && (
          <button type="button" disabled={pending} onClick={() => setPaying(true)} className={`${btn} bg-accent text-white font-medium hover:opacity-90`}>
            Mark as Paid
          </button>
        )}
        {status === "Paid" && canPay && (
          <CancelWithReasonButton label="Cancel Payment" onCancel={cancelSalaryPaymentAction.bind(null, sheetId)} />
        )}
        {(status === "Draft" ? canPrepare : status === "Finalized" && canPay) && (
          <CancelWithReasonButton label={status === "Draft" ? "Discard Draft" : "Cancel Sheet"} onCancel={cancelSalarySheetAction.bind(null, sheetId)} />
        )}
      </div>

      {confirmFinal && (
        <div className="rounded-md border border-accent bg-accent-soft/30 p-3 space-y-2 text-sm">
          <p>
            Finalising recalculates every line from the latest attendance, then locks these days: attendance, policy and pay changes for them will be
            refused until this sheet is cancelled.{" "}
            {journalOn ? "A journal entry will be posted (Salaries & Wages / Salaries Payable / Employee Advances)." : "Salary journal is OFF, so nothing is posted to the ledger."}
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setConfirmFinal(false)} className={`${btn} border border-line-strong bg-bg`}>
              Back
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => finalizeSalarySheetAction(sheetId), () => setConfirmFinal(false))}
              className={`${btn} bg-accent text-white font-medium`}
            >
              {pending ? "Finalising…" : "Confirm Finalise"}
            </button>
          </div>
        </div>
      )}

      {paying && (
        <div className="rounded-md border border-accent p-3 space-y-3 text-sm max-w-md">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">Paid on *</span>
            <input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className="input" />
          </label>
          <PaymentSourceFields
            source={source}
            onSource={setSource}
            bankAccountId={bankId}
            onBankAccount={setBankId}
            pettyCashFundId={pettyId}
            onPettyCashFund={setPettyId}
            bankAccounts={bankAccounts}
            pettyCashFunds={pettyCashFunds}
          />
          <p className="text-xs text-ink-faint">
            {hasJournal ? "Posts: Salaries Payable → the account chosen above." : "This sheet has no journal entry, so the payment is only recorded here."}
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setPaying(false)} className={`${btn} border border-line-strong bg-bg`}>
              Back
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(
                  () =>
                    paySalarySheetAction(sheetId, {
                      paid_on: paidOn,
                      payment_source: source,
                      bank_account_id: source === "bank" ? bankId || null : null,
                      petty_cash_fund_id: source === "petty_cash" ? pettyId || null : null,
                    }),
                  () => setPaying(false)
                )
              }
              className={`${btn} bg-accent text-white font-medium`}
            >
              {pending ? "Saving…" : "Confirm Payment"}
            </button>
          </div>
        </div>
      )}
      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
    </div>
  );
}
