import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fetchLineItems } from "@/lib/itemOptions";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { isPurchaseOrderEditable } from "@/lib/poEdit";
import { EditPurchaseOrderForm } from "@/components/EditPurchaseOrderForm";

export default async function EditPurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "purchase_order.manage"))) redirect(`/purchase-orders/${id}`);

  const supabase = await createClient();
  const [{ data: po }, { data: lines }] = await Promise.all([
    supabase.from("purchase_orders").select("*, parties(legal_name)").eq("id", id).maybeSingle(),
    supabase.from("purchase_order_lines").select("*").eq("purchase_order_id", id).order("sort_order"),
  ]);
  if (!po) notFound();
  if (!isPurchaseOrderEditable(po.status)) redirect(`/purchase-orders/${id}`);

  const [{ data: suppliers }, { data: warehouses }, items, { data: units }, { count: grnCount }] = await Promise.all([
    supabase.from("parties").select("id, legal_name").eq("is_active", true).in("party_type", ["supplier", "both"]).order("legal_name").limit(20),
    supabase.from("warehouses").select("*").eq("is_active", true).order("name"),
    fetchLineItems(supabase, (lines ?? []).map((l) => l.item_id)),
    supabase.from("units").select("*").order("code"),
    supabase.from("grns").select("id", { count: "exact", head: true }).eq("purchase_order_id", id),
  ]);

  const supplierName = (po.parties as unknown as { legal_name: string } | null)?.legal_name ?? "";

  return (
    <div className="space-y-4">
      <div>
        <Link href={`/purchase-orders/${id}`} className="text-xs text-ink-faint hover:text-ink">
          ← {po.po_no}
        </Link>
        <h1 className="text-lg font-semibold text-ink mt-1">
          Edit Purchase Order <span className="font-mono">{po.po_no}</span>
        </h1>
      </div>

      <EditPurchaseOrderForm
        po={{
          id: po.id,
          po_no: po.po_no,
          revision_no: po.revision_no,
          supplier_id: po.supplier_id,
          supplier_name: supplierName,
          purchase_type: po.purchase_type,
          warehouse_id: po.warehouse_id,
          expected_delivery: po.expected_delivery,
        }}
        lines={lines ?? []}
        suppliers={suppliers ?? []}
        warehouses={warehouses ?? []}
        items={items}
        units={units ?? []}
        hasReceipts={(grnCount ?? 0) > 0}
      />
    </div>
  );
}
