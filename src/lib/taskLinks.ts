// Maps a task's generic (related_table, related_id) pair to a link back to
// the owning entity's detail page — same dimension pattern activity_timeline
// already uses (owner_table/owner_id), just resolved into a URL + label.
const RELATED_TABLE_INFO: Record<string, { path: string; label: string }> = {
  sales_orders: { path: "/sales-orders", label: "Sales Order" },
  purchase_orders: { path: "/purchase-orders", label: "Purchase Order" },
  jobs: { path: "/jobs", label: "Job" },
  parties: { path: "/clients", label: "Client / Supplier" },
};

export function relatedEntityLink(relatedTable: string | null, relatedId: string | null): { href: string; label: string } | null {
  if (!relatedTable || !relatedId) return null;
  const info = RELATED_TABLE_INFO[relatedTable];
  if (!info) return null;
  return { href: `${info.path}/${relatedId}`, label: info.label };
}
