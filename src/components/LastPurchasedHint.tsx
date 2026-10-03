"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type HistoryRow = { po_id: string; po_no: string; po_date: string; supplier_name: string; rate: number };

/**
 * Shown while picking an item on a new Purchase Order line: the item's last
 * few purchases (supplier, rate, date), so a repeat RFQ/PR doesn't need
 * re-sourcing from scratch — go straight back to a known supplier with a new
 * rate. There's no RFQ/PR table in this schema, so this reads purchase
 * history directly off purchase_order_lines.item_id.
 */
export function LastPurchasedHint({ itemId }: { itemId: string }) {
  const [rows, setRows] = useState<HistoryRow[]>([]);

  useEffect(() => {
    if (!itemId) return;
    let cancelled = false;
    createClient()
      .rpc("fn_item_purchase_history", { p_item_id: itemId, p_limit: 3 })
      .then(({ data }) => {
        if (!cancelled) setRows((data ?? []) as HistoryRow[]);
      });
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  if (!rows.length) return null;

  return (
    <div className="mt-1 space-y-0.5">
      <p className="text-[10px] uppercase tracking-wide text-ink-faint">Last purchased</p>
      {rows.map((r) => (
        <Link
          key={r.po_id}
          href={`/purchase-orders/${r.po_id}`}
          className="block text-[11px] text-ink-faint hover:text-ink leading-tight"
          title="Open this Purchase Order"
        >
          <span className="text-ink-soft">{r.supplier_name}</span> @ {r.rate} <span className="text-ink-faint">({r.po_date})</span>
        </Link>
      ))}
    </div>
  );
}
