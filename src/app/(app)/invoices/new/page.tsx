import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { NewInvoiceForm } from "@/components/NewInvoiceForm";

export default async function NewInvoicePage() {
  const user = await getCurrentUser();
  if (!(await hasPermission(user, "invoice.manage"))) redirect("/invoices");

  const supabase = await createClient();
  const { data: salesOrders } = await supabase
    .from("sales_orders")
    .select("*, parties(legal_name), sales_order_lines(*)")
    .not("status", "in", "(Cancelled,Closed)")
    .order("created_at", { ascending: false });

  // Only Sales Orders that have delivered-but-not-yet-invoiced qty
  const eligible = (salesOrders ?? []).filter((so) => {
    const lines = so.sales_order_lines as unknown as { delivered_qty: number; invoiced_qty: number }[];
    return lines.some((l) => l.invoiced_qty < l.delivered_qty);
  });

  return (
    <div className="space-y-4">
      <div>
        <Link href="/invoices" className="text-xs text-ink-faint hover:text-ink">
          ← GST Invoices
        </Link>
        <h1 className="text-lg font-semibold text-ink mt-1">New Invoice</h1>
      </div>

      {!eligible.length ? (
        <div className="rounded-xl border border-warn bg-warn-soft p-5 text-sm text-warn max-w-xl">
          No Sales Order found with delivered but not yet invoiced quantity. Invoices are created only for delivered quantity.{" "}
          <Link href="/delivery-challans" className="underline underline-offset-2 font-medium">
            View Delivery Challans
          </Link>
          .
        </div>
      ) : (
        <NewInvoiceForm
          salesOrders={eligible.map((so) => ({
            id: so.id,
            so_no: so.so_no,
            business_line: so.business_line,
            parties: so.parties as unknown as { legal_name: string } | null,
            lines: (so.sales_order_lines as unknown as {
              id: string;
              description: string;
              delivered_qty: number;
              invoiced_qty: number;
              unit: string | null;
              rate: number;
              tax_pct: number;
            }[]).filter((l) => l.invoiced_qty < l.delivered_qty),
          }))}
        />
      )}
    </div>
  );
}
