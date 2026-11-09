import { PrintPdfActions } from "@/components/PrintPdfActions";
import { CancelWithReasonButton } from "@/components/CancelWithReasonButton";
import { cancelSiteMaterialDocAction } from "@/app/actions/siteMaterial";

export type SiteMaterialDoc = {
  id: string;
  doc_no: string;
  kind: string;
  status: string;
  doc_date: string;
  vehicle_no: string | null;
  driver_name: string | null;
  reference: string | null;
  dc_description: string | null;
  cancel_reason: string | null;
  service_material_lines: {
    description: string;
    qty: number;
    unit: string | null;
    sort_order: number;
    is_stock: boolean;
    line_description: string | null;
  }[];
};

/** The Raw Material DCs (and returns) of a job, with print and (Owner) cancel. */
export function SiteMaterialDocs({
  docs,
  jobPath,
  canCancel,
  hasSignature,
  hasStamp,
}: {
  docs: SiteMaterialDoc[];
  /** The page to refresh after a cancel, e.g. /jobs/<id>. */
  jobPath: string;
  /** Owner, and the job can still change. */
  canCancel: boolean;
  hasSignature: boolean;
  hasStamp: boolean;
}) {
  if (!docs.length) return <p className="text-xs text-ink-faint">No material issued to this job yet.</p>;
  return (
    <div className="rounded-xl border border-line bg-surface overflow-hidden divide-y divide-line">
      {docs.map((d) => {
        const lines = [...d.service_material_lines].sort((a, b) => a.sort_order - b.sort_order);
        return (
          <div key={d.id} className="px-4 py-2.5 text-sm space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs">
                <span className="font-mono text-ink">{d.doc_no}</span>{" "}
                <span className="text-ink-faint">{d.kind === "issue" ? "Issued to site" : "Returned from site"}</span>
              </span>
              <div className="flex items-center gap-3">
                {d.kind === "issue" && d.status !== "Cancelled" && (
                  <PrintPdfActions
                    printPath={`/service-material/${d.id}/print`}
                    filename={`${d.doc_no}.pdf`}
                    hasSignature={hasSignature}
                    hasStamp={hasStamp}
                    hasPhone={false}
                    hasEmail={false}
                  />
                )}
                <span className={`rounded-full px-2 py-0.5 text-xs font-mono ${d.status === "Cancelled" ? "bg-bad-soft text-bad" : "bg-good-soft text-good"}`}>{d.status}</span>
              </div>
            </div>
            <p className="text-xs text-ink-faint">
              {d.doc_date} {d.reference && `· Ref ${d.reference}`} {d.vehicle_no && `· ${d.vehicle_no}`} {d.driver_name && `· ${d.driver_name}`}
            </p>
            {d.dc_description && <p className="text-xs text-ink-soft">{d.dc_description}</p>}
            <ul className="text-xs text-ink-soft space-y-0.5">
              {lines.map((l, i) => (
                <li key={i}>
                  {l.description} — {Number(l.qty)} {l.unit ?? ""}
                  {!l.is_stock && <span className="ml-1 text-ink-faint">(custom, no stock)</span>}
                  {l.line_description && <span className="ml-1 text-ink-faint">· {l.line_description}</span>}
                </li>
              ))}
            </ul>
            {d.status === "Cancelled" && d.cancel_reason && <p className="text-xs text-bad">Reason: {d.cancel_reason}</p>}
            {canCancel && d.status !== "Cancelled" && (
              <CancelWithReasonButton label="Cancel this document" onCancel={cancelSiteMaterialDocAction.bind(null, d.id, jobPath)} />
            )}
          </div>
        );
      })}
    </div>
  );
}
