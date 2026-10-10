"use client";

import { useActionState } from "react";
import { savePartyDocSettingsAction, type DocSettingsResult } from "@/app/actions/docSettings";
import { useAutoDismissSuccess } from "@/lib/useAutoDismissSuccess";
import { buttonClass } from "@/components/ui/Button";

const initialState: DocSettingsResult = { error: null };

export function PartyDocSettingsForm({
  partyId,
  shortCode,
  requireQuotationAttn,
  requireInvoicePo,
}: {
  partyId: string;
  shortCode: string | null;
  requireQuotationAttn: boolean;
  requireInvoicePo: boolean;
}) {
  const [state, formAction, pending] = useActionState(savePartyDocSettingsAction, initialState);
  const showSuccess = useAutoDismissSuccess(state);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="party_id" value={partyId} />
      <label className="block space-y-1.5 max-w-[12rem]">
        <span className="text-xs font-medium text-ink-soft">Client code</span>
        <input name="short_code" defaultValue={shortCode ?? ""} maxLength={10} placeholder="TPFL" className="input uppercase" />
      </label>
      <p className="text-[11px] text-ink-faint">Used in the quotation reference, e.g. HTE/TPFL/12. 2 to 10 letters or digits.</p>
      <label className="flex items-center gap-2 text-xs text-ink-soft">
        <input type="checkbox" name="require_quotation_attn" defaultChecked={requireQuotationAttn} />
        Attn is required on this client&apos;s quotations
      </label>
      <label className="flex items-center gap-2 text-xs text-ink-soft">
        <input type="checkbox" name="require_invoice_po" defaultChecked={requireInvoicePo} />
        Client PO number is required on this client&apos;s service invoices
      </label>
      {state.error && <p className="rounded-md bg-bad-soft px-3 py-2 text-xs text-bad">{state.error}</p>}
      {showSuccess && <p className="rounded-md bg-good-soft px-3 py-2 text-xs text-good">Saved.</p>}
      <button type="submit" disabled={pending} className={buttonClass("secondary", "sm", "disabled:opacity-60")}>
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
