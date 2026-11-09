export type MaterialDocLike = {
  kind: string;
  status: string;
  service_material_lines: { item_id: string | null; qty: number | string; description?: string; unit?: string | null }[];
};

export type MaterialRow = {
  /** The item id for stock lines; the typed name for custom lines. */
  key: string;
  item_id: string | null;
  /** A custom item (typed name, no stock): never returnable, cost only shown on the job. */
  custom: boolean;
  description: string;
  unit: string | null;
  issued: number;
  returned: number;
  net: number;
  /** null when the cost ledger is not visible to this user (finance only). */
  cost: number | null;
};

const keyOf = (itemId: string | null, name: string | null | undefined) => itemId ?? `c:${(name ?? "").trim().toLowerCase()}`;

/**
 * Per item: quantity issued and returned (cancelled documents ignored), what is still out on the job, and
 * its cost (the cost ledger already carries the reversals of cancelled documents, so it is simply summed).
 * Custom items are listed too. `netQty` counts stock items only: a custom item is used up on the job and
 * is not something that has to come back.
 */
export function summarizeMaterial(
  docs: MaterialDocLike[],
  ledger: { item_id: string | null; label?: string | null; amount: number | string }[] | null
): { rows: MaterialRow[]; netQty: number; totalCost: number | null } {
  const byKey = new Map<string, MaterialRow>();
  const row = (itemId: string | null, name: string, unit: string | null = null): MaterialRow => {
    const key = keyOf(itemId, name);
    let r = byKey.get(key);
    if (!r) {
      r = { key, item_id: itemId, custom: itemId === null, description: name, unit, issued: 0, returned: 0, net: 0, cost: ledger ? 0 : null };
      byKey.set(key, r);
    }
    return r;
  };

  for (const d of docs) {
    if (d.status === "Cancelled") continue;
    for (const l of d.service_material_lines) {
      const r = row(l.item_id, l.description ?? "", l.unit ?? null);
      if (!r.description && l.description) r.description = l.description;
      if (d.kind === "issue") r.issued += Number(l.qty);
      else r.returned += Number(l.qty);
    }
  }
  if (ledger) {
    for (const e of ledger) {
      const r = row(e.item_id, e.label ?? "");
      r.cost = (r.cost ?? 0) + Number(e.amount);
    }
  }

  const rows = [...byKey.values()]
    .map((r) => ({ ...r, net: round3(r.issued - r.returned), cost: r.cost === null ? null : round2(r.cost) }))
    .filter((r) => r.issued !== 0 || r.returned !== 0 || (r.cost ?? 0) !== 0)
    .sort((a, b) => a.description.localeCompare(b.description));
  return {
    rows,
    netQty: round3(rows.filter((r) => !r.custom).reduce((t, r) => t + r.net, 0)),
    totalCost: ledger ? round2(rows.reduce((t, r) => t + (r.cost ?? 0), 0)) : null,
  };
}

/** What the cost panel is called: the job is still running, finished, or cancelled. */
export function costHeading(status: string): string {
  if (status === "Delivered") return "Total Cost (final)";
  if (status === "Cancelled") return "Material cost (job cancelled)";
  return "Material cost so far (job in progress)";
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}
