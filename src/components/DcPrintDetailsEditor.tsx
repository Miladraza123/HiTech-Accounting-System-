"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateDcPrintDetailsAction } from "@/app/actions/deliveryChallans";
import { buttonClass } from "@/components/ui/Button";

type Line = { sales_order_line_id: string; description: string; remarks: string | null };

/** Ref/PO Number and the per-line Remarks printed on the Delivery Challan, editable after the challan is made. */
export function DcPrintDetailsEditor({
  dcId,
  refNo,
  poNumber,
  project,
  projectSuggestions,
  lines,
  canEdit,
}: {
  dcId: string;
  refNo: string | null;
  poNumber: string | null;
  project: string | null;
  projectSuggestions: string[];
  lines: Line[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [ref, setRef] = useState(refNo ?? "");
  const [projectValue, setProjectValue] = useState(project ?? "");
  const [remarks, setRemarks] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.sales_order_line_id, l.remarks ?? ""])));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await updateDcPrintDetailsAction(
          dcId,
          ref,
          lines.map((l) => ({ sales_order_line_id: l.sales_order_line_id, remarks: remarks[l.sales_order_line_id] ?? "" })),
          projectValue
        );
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
      {!editing ? (
        <>
          <p className="text-xs text-ink-soft">
            Ref/PO Number: <span className="text-ink">{refNo || poNumber || "—"}</span>
            {!refNo && poNumber && <span className="text-ink-faint"> (client PO)</span>}
          </p>
          <p className="text-xs text-ink-soft">
            Project: <span className="text-ink">{project || "—"}</span>
          </p>
          {lines.some((l) => l.remarks) && (
            <ul className="text-xs text-ink-soft space-y-0.5">
              {lines.filter((l) => l.remarks).map((l) => (
                <li key={l.sales_order_line_id}>
                  {l.description.split("\n")[0]}: <span className="text-ink">{l.remarks}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <div className="space-y-2">
          <label className="block space-y-1">
            <span className="text-[11px] text-ink-faint">Ref/PO Number</span>
            <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder={poNumber ?? ""} className="input !py-1 text-xs" />
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] text-ink-faint">Project (optional)</span>
            <input value={projectValue} onChange={(e) => setProjectValue(e.target.value)} list={`dc-project-${dcId}`} className="input !py-1 text-xs" />
            <datalist id={`dc-project-${dcId}`}>
              {projectSuggestions.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </label>
          {lines.map((l) => (
            <label key={l.sales_order_line_id} className="block space-y-1">
              <span className="text-[11px] text-ink-faint">Remarks: {l.description.split("\n")[0]}</span>
              <input
                value={remarks[l.sales_order_line_id] ?? ""}
                onChange={(e) => setRemarks((r) => ({ ...r, [l.sales_order_line_id]: e.target.value }))}
                className="input !py-1 text-xs"
              />
            </label>
          ))}
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
