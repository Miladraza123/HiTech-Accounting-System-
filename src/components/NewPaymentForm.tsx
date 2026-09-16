"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { createPaymentAction, type PaymentAllocationInput } from "@/app/actions/payments";
import type { Tables } from "@/lib/supabase/database.types";
import { useOfflineQueue } from "@/components/OfflineQueueProvider";
import { SearchablePicker, PARTY_SOURCE, type PickerFilter, type PickerOption } from "@/components/SearchablePicker";

/** One outstanding document of the selected party, as fn_party_outstanding returns it. */
export type OutstandingDoc = { doc_id: string; doc_no: string; doc_date: string; outstanding_amount: number };

/**
 * How many outstanding documents of one party the allocation table offers.
 * They come back oldest-first, which is the order a payment should settle
 * them in, so the cap only ever hides the newest — and a party with more than
 * this many unsettled documents has a bigger problem than this screen.
 */
const OUTSTANDING_LIMIT = 100;

// The eligible party set flips with the direction: a Receipt can only come
// from a client, a Payment can only go to a supplier. Mirrors the old
// `party_type !== "supplier"` / `!== "client"` client-side filter exactly,
// expressed so the database can apply it.
const PARTY_FILTERS: Record<"receipt" | "payment", PickerFilter[]> = {
  receipt: [
    { column: "is_active", op: "eq", value: true },
    { column: "party_type", op: "in", value: ["client", "both"] },
  ],
  payment: [
    { column: "is_active", op: "eq", value: true },
    { column: "party_type", op: "in", value: ["supplier", "both"] },
  ],
};

export function NewPaymentForm({
  clientParties,
  supplierParties,
  defaultParty,
  defaultDirection,
  initialOutstanding,
  bankAccounts,
  pettyCashFunds,
}: {
  // Only a first page of each list — the rest are found by typing, searched
  // in the database rather than shipped to the browser. See SearchablePicker.
  clientParties: Pick<Tables<"parties">, "id" | "legal_name">[];
  supplierParties: Pick<Tables<"parties">, "id" | "legal_name">[];
  defaultParty: PickerOption | null;
  defaultDirection: "receipt" | "payment";
  /**
   * The outstanding documents of the pre-selected party (?party=…), fetched on
   * the server so this screen still works from a cached page with no network.
   * Every other party's list is fetched on demand when it is picked — the page
   * used to ship EVERY outstanding invoice and bill in the business, 22 MB of
   * them at 120,000 invoices, to display a handful of rows.
   */
  initialOutstanding: OutstandingDoc[];
  bankAccounts: Tables<"bank_accounts">[];
  pettyCashFunds: Tables<"petty_cash_funds">[];
}) {
  const router = useRouter();
  const [direction, setDirection] = useState<"receipt" | "payment">(defaultDirection);
  const [partyId, setPartyId] = useState(defaultParty?.id ?? "");
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState("");
  const [source, setSource] = useState<"cash" | "bank" | "petty_cash">("cash");
  const [bankAccountId, setBankAccountId] = useState("");
  const [pettyCashFundId, setPettyCashFundId] = useState("");
  const [referenceNo, setReferenceNo] = useState("");
  const [notes, setNotes] = useState("");
  const [allocAmounts, setAllocAmounts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { isOnline, enqueue } = useOfflineQueue();
  const [savedOffline, setSavedOffline] = useState(false);

  const partyOptions: PickerOption[] = (direction === "receipt" ? clientParties : supplierParties).map((p) => ({
    id: p.id,
    label: p.legal_name,
  }));

  // Keyed by direction AND party, because the same party can be both a client
  // and a supplier ("both"), with different documents outstanding each way.
  const [outstandingByKey, setOutstandingByKey] = useState<Record<string, OutstandingDoc[]>>(
    defaultParty ? { [`${defaultDirection}:${defaultParty.id}`]: initialOutstanding } : {}
  );
  const [outstandingError, setOutstandingError] = useState<string | null>(null);
  const [loadingOutstanding, setLoadingOutstanding] = useState(false);

  const outstandingKey = partyId ? `${direction}:${partyId}` : "";
  // Which keys have already been fetched (or arrived from the server), held in
  // a ref rather than derived from the cache itself so that the effect below
  // never has to read state it also writes.
  const fetchedKeys = useRef<Set<string>>(new Set(defaultParty ? [`${defaultDirection}:${defaultParty.id}`] : []));

  useEffect(() => {
    if (!outstandingKey || fetchedKeys.current.has(outstandingKey)) return;
    fetchedKeys.current.add(outstandingKey);
    const key = outstandingKey;
    let cancelled = false;
    setOutstandingError(null);
    setLoadingOutstanding(true);
    createClient()
      .rpc("fn_party_outstanding", { p_party_id: partyId, p_direction: direction, p_limit: OUTSTANDING_LIMIT })
      .then(({ data, error }) => {
        if (cancelled) return;
        setLoadingOutstanding(false);
        if (error) {
          // Offline, or the request failed. The payment itself can still be
          // recorded — allocation is optional — so say so rather than silently
          // showing "no outstanding documents", which would be a different and
          // wrong statement. The key is released so picking the party again
          // after reconnecting retries.
          fetchedKeys.current.delete(key);
          setOutstandingError("Could not load this party's outstanding documents. You can still record the payment and allocate it later.");
          return;
        }
        setOutstandingByKey((c) => ({ ...c, [key]: (data ?? []) as OutstandingDoc[] }));
      });
    return () => {
      cancelled = true;
    };
  }, [outstandingKey, direction, partyId]);

  const rows = useMemo(() => {
    const docs = outstandingKey ? outstandingByKey[outstandingKey] : undefined;
    return (docs ?? []).map((o) => ({ key: o.doc_id, label: o.doc_no, date: o.doc_date, outstanding: o.outstanding_amount }));
  }, [outstandingKey, outstandingByKey]);

  const allocTotal = rows.reduce((s, r) => s + (Number(allocAmounts[r.key]) || 0), 0);
  const amountNum = Number(amount) || 0;
  const unallocated = amountNum - allocTotal;

  function switchDirection(d: "receipt" | "payment") {
    setDirection(d);
    setPartyId("");
    setAllocAmounts({});
  }

  function submit() {
    setError(null);
    if (!partyId) {
      setError("Select Party.");
      return;
    }
    if (amountNum <= 0) {
      setError("Amount must be greater than zero.");
      return;
    }
    if (allocTotal > amountNum) {
      setError("Allocation total cannot exceed the amount.");
      return;
    }
    if (source === "bank" && !bankAccountId) {
      setError("Select Bank Account.");
      return;
    }
    if (source === "petty_cash" && !pettyCashFundId) {
      setError("Select Petty Cash Fund.");
      return;
    }
    const allocations: PaymentAllocationInput[] = rows
      .map((r) => ({ key: r.key, amount: Number(allocAmounts[r.key]) || 0 }))
      .filter((r) => r.amount > 0)
      .map((r) => (direction === "receipt" ? { invoice_id: r.key, amount: r.amount } : { supplier_bill_id: r.key, amount: r.amount }));

    // Phase 5 (Master Offline-First Roadmap) — the plan's own "highest
    // financial-sensitivity phase": see this form's own RPC entry in
    // offlineQueue.ts for why a duplicate sync retry can never double-
    // post real money, and why any allocation is re-validated against
    // the TRUE, live outstanding amount at sync time.
    if (!isOnline) {
      startTransition(async () => {
        await enqueue({
          kind: "create",
          table: "payments",
          recordId: crypto.randomUUID(),
          label: direction === "receipt" ? "Receipt" : "Payment",
          payload: {
            party_id: partyId,
            direction,
            payment_date: paymentDate,
            method: method || null,
            reference_no: referenceNo || null,
            amount: amountNum,
            notes: notes || null,
            allocations,
            bank_account_id: source === "bank" ? bankAccountId : null,
            petty_cash_fund_id: source === "petty_cash" ? pettyCashFundId : null,
          },
        });
        setSavedOffline(true);
      });
      return;
    }

    startTransition(async () => {
      const res = await createPaymentAction({
        party_id: partyId,
        direction,
        payment_date: paymentDate,
        method: method || null,
        reference_no: referenceNo || null,
        amount: amountNum,
        notes: notes || null,
        allocations,
        bank_account_id: source === "bank" ? bankAccountId : null,
        petty_cash_fund_id: source === "petty_cash" ? pettyCashFundId : null,
      });
      if (res.error) setError(res.error);
      else router.push(`/payments/${res.id}`);
    });
  }

  if (savedOffline) {
    return (
      <div className="rounded-xl border border-line bg-surface p-6 max-w-xl space-y-3">
        <p className="rounded-md bg-good-soft px-3 py-2 text-sm text-good">
          Payment saved on this device — it will get its Payment number and sync automatically once you&apos;re back
          online.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-surface p-5 space-y-4">
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Direction *</span>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => switchDirection("receipt")}
              className={`rounded-md border px-3 py-2 text-sm text-left transition ${
                direction === "receipt" ? "border-accent bg-accent-soft/40 text-ink" : "border-line bg-bg text-ink-soft hover:bg-surface-2"
              }`}
            >
              <span className="block font-medium">Receipt — Money coming in from Client</span>
            </button>
            <button
              type="button"
              onClick={() => switchDirection("payment")}
              className={`rounded-md border px-3 py-2 text-sm text-left transition ${
                direction === "payment" ? "border-accent bg-accent-soft/40 text-ink" : "border-line bg-bg text-ink-soft hover:bg-surface-2"
              }`}
            >
              <span className="block font-medium">Payment — Money going out to Supplier</span>
            </button>
          </div>
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">{direction === "receipt" ? "Client" : "Supplier"} *</span>
          {/* Keyed on direction so switching Receipt/Payment clears the
              picker's own selection along with `partyId` below — a client
              must never stay selected on a supplier payment. */}
          <SearchablePicker
            key={direction}
            name="party_id"
            source={PARTY_SOURCE}
            filters={PARTY_FILTERS[direction]}
            initialOptions={partyOptions}
            initialSelected={direction === defaultDirection ? defaultParty : null}
            placeholder={direction === "receipt" ? "Type a client name…" : "Type a supplier name…"}
            onChange={(o) => {
              setPartyId(o?.id ?? "");
              setAllocAmounts({});
            }}
          />
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">Amount *</span>
            <input type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="input" />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">Date</span>
            <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className="input" />
          </label>
        </div>

        <div className="space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Cash/Bank Source *</span>
          <div className="flex gap-4 text-sm">
            {(["cash", "bank", "petty_cash"] as const).map((s) => (
              <label key={s} className="flex items-center gap-1.5">
                <input type="radio" checked={source === s} onChange={() => setSource(s)} />
                {s === "cash" ? "Cash in Hand" : s === "bank" ? "Bank" : "Petty Cash"}
              </label>
            ))}
          </div>
        </div>

        {source === "bank" && (
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
        {source === "petty_cash" && (
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
            <span className="text-xs font-medium text-ink-soft">Method / Note</span>
            <input value={method} onChange={(e) => setMethod(e.target.value)} className="input" placeholder="e.g. Cheque, Online Transfer" />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">Reference #</span>
            <input value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} className="input" placeholder="Cheque # / transaction id" />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-soft">Notes</span>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className="input" />
          </label>
        </div>
      </div>

      {partyId && (
        <div className="rounded-xl border border-line bg-surface overflow-hidden">
          <div className="px-4 py-2.5 border-b border-line">
            <h2 className="text-sm font-semibold text-ink">Bill-wise Allocation (optional)</h2>
            <p className="text-xs text-ink-faint mt-0.5">
              If you don&apos;t allocate, the amount will remain &quot;unallocated&quot; — as an on-account advance you can allocate it later.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs font-mono uppercase tracking-wide text-ink-faint">
                <tr>
                  <th className="text-left px-3 py-2">{direction === "receipt" ? "Invoice #" : "Bill #"}</th>
                  <th className="text-left px-3 py-2">Date</th>
                  <th className="text-right px-3 py-2">Outstanding</th>
                  <th className="text-right px-3 py-2 w-32 min-w-[8rem]">Allocate</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-t border-line">
                    <td className="px-3 py-2 font-mono text-xs text-ink">{r.label}</td>
                    <td className="px-3 py-2 text-ink-soft text-xs">{r.date}</td>
                    <td className="px-3 py-2 text-right tabular text-ink-soft">{r.outstanding.toLocaleString()}</td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max={r.outstanding}
                        value={allocAmounts[r.key] ?? ""}
                        onChange={(e) => setAllocAmounts((a) => ({ ...a, [r.key]: e.target.value }))}
                        className="input !py-1 text-xs text-right tabular"
                        placeholder="0"
                      />
                    </td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={4} className="px-4 py-4 text-center text-ink-faint text-xs">
                      {loadingOutstanding
                        ? "Loading outstanding documents…"
                        : outstandingError
                          ? outstandingError
                          : `This party has no outstanding ${direction === "receipt" ? "invoice" : "bill"}.`}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-6 border-t border-line px-4 py-2.5 text-xs tabular">
            <span className="text-ink-soft">Allocated: {allocTotal.toLocaleString()}</span>
            <span className={unallocated < 0 ? "text-bad font-medium" : "text-ink-soft"}>Unallocated: {unallocated.toLocaleString()}</span>
          </div>
        </div>
      )}

      {!isOnline && (
        <p className="rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">
          ⏳ You&apos;re offline — this Payment will be saved on this device and synced automatically once you&apos;re
          back online.
        </p>
      )}

      {error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition disabled:opacity-60"
      >
        {pending ? "Saving…" : isOnline ? "Record Payment" : "Save Offline"}
      </button>
    </div>
  );
}
