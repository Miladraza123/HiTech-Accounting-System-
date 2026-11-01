import type { EditableLine } from "@/components/QuotationLineEditor";

/** A Purchase Order stays editable until it is fully received, closed or cancelled. */
export const PO_EDITABLE_STATUSES = ["Confirmed", "PartiallyReceived"] as const;

export function isPurchaseOrderEditable(status: string): boolean {
  return (PO_EDITABLE_STATUSES as readonly string[]).includes(status);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type EditedLineInput = {
  id?: string;
  item_id?: string;
  description: string;
  ordered_qty: number;
  unit?: string;
  rate: number;
  tax_pct: number;
};

/**
 * Editor rows → request lines. A row that came from the database keeps its
 * line id as its `key`, so the server can tell "changed" from "new"; rows the
 * user added in the editor have a generated key and are sent without an id.
 * Blank rows are dropped.
 */
export function serializeEditedLines(lines: EditableLine[]): EditedLineInput[] {
  return lines
    .filter((l) => l.description.trim())
    .map((l) => ({
      ...(UUID.test(l.key) ? { id: l.key } : {}),
      item_id: l.item_id || undefined,
      description: l.description,
      ordered_qty: Number(l.qty) || 0,
      unit: l.unit || undefined,
      rate: Number(l.rate) || 0,
      tax_pct: Number(l.tax_pct) || 0,
    }));
}

export type PoSnapshotLine = {
  id: string;
  description: string;
  ordered_qty: number;
  unit: string | null;
  rate: number;
  tax_pct: number;
  amount: number | null;
  received_qty: number;
};

export type PoSnapshot = {
  header: {
    po_no: string;
    supplier_name: string | null;
    warehouse_name: string | null;
    expected_delivery: string | null;
    status: string;
    subtotal: number;
    tax_total: number;
    grand_total: number;
  };
  lines: PoSnapshotLine[];
};

/** Defensive read of a stored snapshot (jsonb) — returns null if it is not the expected shape. */
export function parseSnapshot(value: unknown): PoSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { header?: unknown; lines?: unknown };
  if (!v.header || typeof v.header !== "object" || !Array.isArray(v.lines)) return null;
  return value as PoSnapshot;
}
