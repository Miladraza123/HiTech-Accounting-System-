"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateQuotationHeaderAction } from "@/app/actions/docSettings";
import { buttonClass } from "@/components/ui/Button";

/** Ref # (read-only), Attn and Subject of a quotation, with an inline editor. */
export function QuotationHeaderEditor({
  quotationId,
  refNo,
  attn,
  subject,
  canEdit,
  contacts,
}: {
  quotationId: string;
  refNo: string;
  attn: string | null;
  subject: string | null;
  canEdit: boolean;
  contacts: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [attnValue, setAttnValue] = useState(attn ?? "");
  const [subjectValue, setSubjectValue] = useState(subject ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await updateQuotationHeaderAction(quotationId, attnValue, subjectValue);
        if (res.error) setError(res.error);
        else {
          setEditing(false);
          router.refresh();
        }
      } catch {
        setError("Could not save. Check your connection and try again.");
      }
    });
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-4 space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">Print Details</h2>
        {canEdit && !editing && (
          <button type="button" onClick={() => setEditing(true)} className="text-xs text-accent-ink underline underline-offset-2">
            Edit
          </button>
        )}
      </div>
      <p className="text-xs text-ink-soft">
        Ref #: <span className="font-mono text-ink">{refNo}</span>
      </p>
      {!editing ? (
        <>
          <p className="text-xs text-ink-soft">
            Attn: <span className="text-ink">{attn || "—"}</span>
          </p>
          <p className="text-xs text-ink-soft">
            Subject: <span className="text-ink">{subject || "—"}</span>
          </p>
        </>
      ) : (
        <div className="space-y-2">
          <label className="block space-y-1">
            <span className="text-[11px] text-ink-faint">Attn (optional)</span>
            <input value={attnValue} onChange={(e) => setAttnValue(e.target.value)} list={`attn-${quotationId}`} className="input !py-1 text-xs" />
            <datalist id={`attn-${quotationId}`}>
              {contacts.map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] text-ink-faint">Subject</span>
            <input value={subjectValue} onChange={(e) => setSubjectValue(e.target.value)} className="input !py-1 text-xs" />
          </label>
          {error && <p className="text-xs text-bad">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => setEditing(false)} className={buttonClass("secondary", "sm")}>
              Cancel
            </button>
            <button type="button" onClick={save} disabled={pending} className={buttonClass("primary", "sm", "disabled:opacity-60")}>
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
