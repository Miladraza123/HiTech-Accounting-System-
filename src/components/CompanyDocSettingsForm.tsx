"use client";

import { useActionState } from "react";
import { saveCompanyDocSettingsAction, type DocSettingsResult } from "@/app/actions/docSettings";
import { useAutoDismissSuccess } from "@/lib/useAutoDismissSuccess";
import { buttonClass } from "@/components/ui/Button";

const initialState: DocSettingsResult = { error: null };

export function CompanyDocSettingsForm({
  shortCode,
  signatoryName,
  serviceInvoiceNote,
  phone2,
  email2,
}: {
  shortCode: string | null;
  signatoryName: string | null;
  serviceInvoiceNote: string | null;
  phone2: string | null;
  email2: string | null;
}) {
  const [state, formAction, pending] = useActionState(saveCompanyDocSettingsAction, initialState);
  const showSuccess = useAutoDismissSuccess(state);

  return (
    <form action={formAction} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Company code (quotation reference)</span>
          <input name="short_code" defaultValue={shortCode ?? ""} maxLength={10} placeholder="HTE" className="input uppercase" />
          <span className="text-[11px] text-ink-faint">Quotation reference: HTE/&lt;client code&gt;/&lt;number&gt;, e.g. HTE/TPFL/0012</span>
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Name printed under the signature</span>
          <input name="signatory_name" defaultValue={signatoryName ?? ""} placeholder="MUHAMMAD ABBAS" className="input" />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Second phone (optional)</span>
          <input name="phone2" defaultValue={phone2 ?? ""} placeholder="(+92) 21 351 586 14" className="input" />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-soft">Second email (optional)</span>
          <input name="email2" type="email" defaultValue={email2 ?? ""} className="input" />
        </label>
      </div>
      <p className="text-[11px] text-ink-faint -mt-1">The first phone, email, address, NTN and STRN come from the Company Profile above. All of these print in the header of the Quotation and Service Invoice.</p>
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-ink-soft">Note printed at the bottom of every Service Invoice</span>
        <textarea name="service_invoice_note" defaultValue={serviceInvoiceNote ?? ""} rows={3} className="input resize-none" />
      </label>
      {state.error && <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">{state.error}</p>}
      {showSuccess && <p className="rounded-md bg-good-soft px-3 py-2 text-sm text-good">Saved.</p>}
      <button type="submit" disabled={pending} className={buttonClass("secondary", "sm", "disabled:opacity-60")}>
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
